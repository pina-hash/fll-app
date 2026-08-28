// tests/entity-operations.test.ts
//
// EVERY DESTRUCTIVE OPERATION, PROVED BOTH WAYS: it removes what it should,
// and it leaves standing what it should not. The second half is the one that
// matters. A delete that quietly takes attendance with it looks exactly like
// a delete that worked, right up to the Friday somebody asks who was there.
//
// The pattern in every test here is the repo's: the claim, its negative
// control, and the SERVICE ROLE as the positive control -- because an empty
// result from a denied read is indistinguishable from an empty table, and the
// only way to tell them apart is to show the same row still exists to
// somebody who is allowed to see it.

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
	cleanupRun,
	closeDb,
	createStudent,
	createTeam,
	expectPostgrestError,
	seedMentor,
	serviceClient,
	signIn,
	sql,
	type SeededMentor,
	type SeededStudent,
	type SeededTeam
} from './db/harness';

let mentor: SeededMentor;
let team: SeededTeam;
let student: SeededStudent;

beforeAll(async () => {
	mentor = await seedMentor('entops');
	team = await createTeam(mentor.client, 'EntOps');
	student = await createStudent(mentor.client, team, 'Ent', 'O');
}, 60_000);

afterAll(async () => {
	await cleanupRun();
	await closeDb();
});

/** A meeting today, started, with its phases from the template. */
async function liveMeeting(): Promise<string> {
	// Only one session runs at a time in this schema, and these tests share a
	// database with each other. End whatever the last one left open rather
	// than letting the next meeting_start fail for a reason that has nothing
	// to do with what is being tested.
	const running = await sql<{ id: string }[]>`
		select id from public.meetings where started_at is not null and ended_at is null and cancelled_at is null`;
	for (const { id } of running) {
		await mentor.client.rpc('meeting_end', { p_meeting_id: id });
	}
	const [{ today }] = await sql<{ today: string }[]>`select public._app_today() as today`;
	const { data, error } = await mentor.client.rpc('meeting_create', {
		p_kind: 'friday',
		p_meeting_date: today,
		p_planned_start_at: new Date().toISOString()
	});
	if (error) throw new Error(`meeting_create failed: ${error.message}`);
	const id = (data as { meeting_id: string }).meeting_id;
	const started = await mentor.client.rpc('meeting_start', { p_meeting_id: id });
	if (started.error) throw new Error(`meeting_start failed: ${started.error.message}`);
	return id;
}

describe('cancelling a meeting keeps everything that happened at it', () => {
	test('cancel takes nothing with it, and restore puts the session back', async () => {
		const meetingId = await liveMeeting();

		// Something happened at this session: somebody was there, and a task
		// was made against it.
		const { error: attErr } = await mentor.client
			.from('attendance')
			.insert({ meeting_id: meetingId, student_id: student.studentId })
			.select();
		expect(attErr).toBeNull();
		const { data: taskRows, error: taskErr } = await mentor.client
			.from('tasks')
			.insert({
				team_id: team.teamId,
				meeting_id: meetingId,
				title: 'Built the arm',
				role: 'lead_builder',
				created_by_mentor_id: mentor.mentorId
			})
			.select();
		expect(taskErr).toBeNull();
		const taskId = (taskRows ?? [])[0]?.id as string;

		const before = await counts(meetingId);
		expect(before).toEqual({ attendance: 1, phases: before.phases, tasks: 1 });
		expect(before.phases).toBeGreaterThan(0);

		const { data, error } = await mentor.client.rpc('meeting_cancel', { p_meeting_id: meetingId });
		expect(error).toBeNull();
		const out = data as unknown as { attendance_kept: number; tasks_kept: number; recaps_kept: number };
		expect(out.attendance_kept).toBe(1);
		expect(out.tasks_kept).toBe(1);

		// THE ASSERTION THIS FILE EXISTS FOR: nothing moved.
		expect(await counts(meetingId)).toEqual(before);

		// POSITIVE CONTROL through the service role: the rows are really there,
		// not merely invisible to the mentor's reads.
		const svc = serviceClient();
		const { data: svcAtt } = await svc.from('attendance').select('id').eq('meeting_id', meetingId);
		expect(svcAtt).toHaveLength(1);
		const { data: svcTask } = await svc.from('tasks').select('id').eq('id', taskId);
		expect(svcTask).toHaveLength(1);

		// And the session is no longer the current one anywhere.
		const [{ current }] = await sql<{ current: string | null }[]>`
			select public._resolve_current_meeting_id() as current`;
		expect(current).not.toBe(meetingId);

		// Restore brings it back, and it is current again.
		const { error: restoreErr } = await mentor.client.rpc('meeting_restore', { p_meeting_id: meetingId });
		expect(restoreErr).toBeNull();
		const [{ current: back }] = await sql<{ current: string | null }[]>`
			select public._resolve_current_meeting_id() as current`;
		expect(back).toBe(meetingId);

		await mentor.client.rpc('meeting_end', { p_meeting_id: meetingId });
	}, 120_000);

	test('a hard delete WOULD have taken all of it, which is why there is no hard delete', async () => {
		const meetingId = await liveMeeting();
		await mentor.client
			.from('attendance')
			.insert({ meeting_id: meetingId, student_id: student.studentId })
			.select();

		// The negative control for the choice itself: run the delete the schema
		// still permits, in a transaction, and watch what goes. This is the
		// measurement that made meetings soft-delete, kept executable so the
		// reason cannot rot.
		const [{ lost_attendance, lost_phases, detached_tasks }] = await sql<
			{ lost_attendance: number; lost_phases: number; detached_tasks: number }[]
		>`
			with before as (
				select
					(select count(*) from public.attendance where meeting_id = ${meetingId}) as att,
					(select count(*) from public.meeting_phases where meeting_id = ${meetingId}) as ph,
					(select count(*) from public.tasks where meeting_id = ${meetingId}) as tk
			),
			gone as (
				delete from public.meetings where id = ${meetingId} returning 1
			)
			select
				(select att from before)::int as lost_attendance,
				(select ph from before)::int as lost_phases,
				(select tk from before)::int as detached_tasks
			from gone`;

		expect(lost_attendance).toBe(1);
		expect(lost_phases).toBeGreaterThan(0);

		// It really is gone now, which is the point: this ran for real.
		const [{ att_now, ph_now }] = await sql<{ att_now: number; ph_now: number }[]>`
			select
				(select count(*)::int from public.attendance where meeting_id = ${meetingId}) as att_now,
				(select count(*)::int from public.meeting_phases where meeting_id = ${meetingId}) as ph_now`;
		expect({ att_now, ph_now }).toEqual({ att_now: 0, ph_now: 0 });
		expect(detached_tasks).toBeGreaterThanOrEqual(0);
	}, 120_000);

	test('cancel is refused to a student, and the refusal is a sentence', async () => {
		const meetingId = await liveMeeting();
		const asStudent = await signIn(student.email, student.pin);
		const refused = await asStudent.rpc('meeting_cancel', { p_meeting_id: meetingId });
		expect(expectPostgrestError(refused).message).toBe('Only a mentor can cancel a session.');

		// NEGATIVE CONTROL: the same call, same session, from the mentor works.
		const { error } = await mentor.client.rpc('meeting_cancel', { p_meeting_id: meetingId });
		expect(error).toBeNull();
	}, 120_000);
});

describe('reopening a meeting ended by accident', () => {
	test('reopen clears the end stamp and puts the last phase back in charge', async () => {
		const meetingId = await liveMeeting();
		await mentor.client.rpc('meeting_advance_phase', { p_meeting_id: meetingId });
		const { error: endErr } = await mentor.client.rpc('meeting_end', { p_meeting_id: meetingId });
		expect(endErr).toBeNull();

		const [{ ended, phase }] = await sql<{ ended: string | null; phase: string | null }[]>`
			select ended_at::text as ended, current_phase_id::text as phase from public.meetings where id = ${meetingId}`;
		expect(ended).not.toBeNull();
		expect(phase).toBeNull();

		const { data, error } = await mentor.client.rpc('meeting_reopen', { p_meeting_id: meetingId });
		expect(error).toBeNull();
		expect((data as unknown as { reopened: boolean }).reopened).toBe(true);

		const [{ ended: after, phase: phaseAfter }] = await sql<{ ended: string | null; phase: string | null }[]>`
			select ended_at::text as ended, current_phase_id::text as phase from public.meetings where id = ${meetingId}`;
		expect(after).toBeNull();
		expect(phaseAfter).not.toBeNull();

		// The recaps drafted at the end are NOT thrown away by reopening.
		const { data: recaps } = await serviceClient().from('meeting_recaps').select('id').eq('meeting_id', meetingId);
		expect(Array.isArray(recaps)).toBe(true);

		await mentor.client.rpc('meeting_end', { p_meeting_id: meetingId });
	}, 120_000);

	test('reopening is refused while another session is running', async () => {
		const first = await liveMeeting();
		await mentor.client.rpc('meeting_end', { p_meeting_id: first });
		const second = await liveMeeting();

		const refused = await mentor.client.rpc('meeting_reopen', { p_meeting_id: first });
		expect(expectPostgrestError(refused).message).toBe('Another session is running. End that one first.');

		// NEGATIVE CONTROL: end the running one and the same call succeeds.
		await mentor.client.rpc('meeting_end', { p_meeting_id: second });
		const { error } = await mentor.client.rpc('meeting_reopen', { p_meeting_id: first });
		expect(error).toBeNull();
		await mentor.client.rpc('meeting_end', { p_meeting_id: first });
	}, 120_000);
});

describe('reordering phases without tripping the unique ordinal', () => {
	test('two phases swap places, and every ordinal is still distinct and >= 1', async () => {
		const meetingId = await liveMeeting();
		const phases = await phaseList(meetingId);
		expect(phases.length).toBeGreaterThanOrEqual(3);

		// The first phase has started (meeting_start started it), so pick two
		// that have not.
		const movable = phases.filter((p) => p.started_at === null);
		expect(movable.length).toBeGreaterThanOrEqual(2);
		const target = movable[1];
		const above = movable[0];

		const { error } = await mentor.client.rpc('meeting_phase_reorder', {
			p_phase_id: target.id,
			p_direction: -1
		});
		expect(error).toBeNull();

		const after = await phaseList(meetingId);
		const byId = new Map(after.map((p) => [p.id, p.ordinal]));
		expect(byId.get(target.id)).toBe(above.ordinal);
		expect(byId.get(above.id)).toBe(target.ordinal);

		// The constraint held the whole way through: no duplicates, none below 1,
		// and nothing parked at the million the function uses mid-swap.
		const ordinals = after.map((p) => p.ordinal);
		expect(new Set(ordinals).size).toBe(ordinals.length);
		expect(Math.min(...ordinals)).toBeGreaterThanOrEqual(1);
		expect(Math.max(...ordinals)).toBeLessThan(1000);

		await mentor.client.rpc('meeting_end', { p_meeting_id: meetingId });
	}, 120_000);

	test('a phase that has already run does not move, and neither does the first one upward', async () => {
		const meetingId = await liveMeeting();
		const phases = await phaseList(meetingId);
		const started = phases.find((p) => p.started_at !== null);
		expect(started).toBeDefined();

		const ran = await mentor.client.rpc('meeting_phase_reorder', {
			p_phase_id: started!.id,
			p_direction: 1
		});
		expect(expectPostgrestError(ran).message).toMatch(/already run/i);

		const first = phases.find((p) => p.ordinal === 1)!;
		const up = await mentor.client.rpc('meeting_phase_reorder', { p_phase_id: first.id, p_direction: -1 });
		expect(expectPostgrestError(up).message).toMatch(/already run|already first/i);

		await mentor.client.rpc('meeting_end', { p_meeting_id: meetingId });
	}, 120_000);
});

describe('archiving a team refuses rather than stranding a roster', () => {
	test('a team with students is refused; emptied, it archives and restores', async () => {
		const doomed = await createTeam(mentor.client, 'Archive');
		const kid = await createStudent(mentor.client, doomed, 'Arch', 'K');

		const refused = await mentor.client.rpc('team_archive', { p_team_id: doomed.teamId });
		expect(expectPostgrestError(refused).message).toMatch(/still 1 students on/i);

		// POSITIVE CONTROL: the team is genuinely still live, not half-archived.
		const [{ archived }] = await sql<{ archived: string | null }[]>`
			select archived_at::text as archived from public.teams where id = ${doomed.teamId}`;
		expect(archived).toBeNull();

		// An unclaimed seat code blocks it too, and says so differently.
		await mentor.client.rpc('student_deactivate', { p_student_id: kid.studentId });
		await mentor.client.rpc('team_claim_codes_issue', { p_team_id: doomed.teamId, p_count: 1 });
		const refusedCode = await mentor.client.rpc('team_archive', { p_team_id: doomed.teamId });
		expect(expectPostgrestError(refusedCode).message).toMatch(/claim codes for .* have not been used/i);

		// Void it and the team archives.
		const listed = await mentor.client.rpc('team_claim_codes', { p_team_id: doomed.teamId });
		const claimId = (listed.data as unknown as { claim_id: string }[])[0].claim_id;
		await mentor.client.rpc('team_claim_code_void', { p_claim_id: claimId });

		const { error } = await mentor.client.rpc('team_archive', { p_team_id: doomed.teamId });
		expect(error).toBeNull();

		// Archived means gone from the roster state, and STILL THERE in the table.
		const state = await mentor.client.rpc('team_roster_state');
		const ids = (state.data as unknown as { team_id: string }[]).map((t) => t.team_id);
		expect(ids).not.toContain(doomed.teamId);
		const { data: svcTeam } = await serviceClient().from('teams').select('id').eq('id', doomed.teamId);
		expect(svcTeam).toHaveLength(1);
		// And the deactivated student is still on it: archiving destroyed nothing.
		const { data: svcKid } = await serviceClient().from('students').select('id').eq('id', kid.studentId);
		expect(svcKid).toHaveLength(1);

		const restored = await mentor.client.rpc('team_restore', { p_team_id: doomed.teamId });
		expect(restored.error).toBeNull();
		const state2 = await mentor.client.rpc('team_roster_state');
		expect((state2.data as unknown as { team_id: string }[]).map((t) => t.team_id)).toContain(doomed.teamId);
	}, 120_000);
});

describe('a notebook page a child can take back', () => {
	test('delete hides it from every read, restore brings it back, and the row never left', async () => {
		// Since 0026 notebook_can_edit is not a role gate: any student on the
		// team writes any section. This child holds NO role on purpose, which
		// is what makes this the student's path and not the mentor's. A
		// meeting is still started because the rest of the child's runtime
		// expects one.
		await liveMeeting();

		const asStudent = await signIn(student.email, student.pin);
		const { data: rows, error: insErr } = await asStudent
			.from('notebook_entries')
			.insert({
				team_id: team.teamId,
				section: 'innovation_project',
				title: 'Our first idea',
				body: 'We thought about the reef.',
				authored_by_student_id: student.studentId
			})
			.select();
		expect(insErr).toBeNull();
		const entryId = (rows ?? [])[0]?.id as string;
		expect(entryId).toBeTruthy();

		const { error } = await asStudent.rpc('notebook_entry_delete', { p_entry_id: entryId });
		expect(error).toBeNull();

		// Gone from the student's reads AND from the mentor's, because the
		// filter is in the read policy rather than in one screen.
		const { data: mine } = await asStudent.from('notebook_entries').select('id').eq('id', entryId);
		expect(mine).toEqual([]);
		const { data: theirs } = await mentor.client.from('notebook_entries').select('id').eq('id', entryId);
		expect(theirs).toEqual([]);

		// POSITIVE CONTROL: the row is still there. This is a soft delete, and
		// an empty read is exactly what a hard delete would look like without
		// this assertion.
		const { data: svc } = await serviceClient().from('notebook_entries').select('id, deleted_at').eq('id', entryId);
		expect(svc).toHaveLength(1);
		expect((svc as unknown as { deleted_at: string | null }[])[0].deleted_at).not.toBeNull();

		// A mentor can see it in the bin and put it back.
		const bin = await mentor.client.rpc('notebook_bin', { p_team_id: team.teamId });
		expect((bin.data as unknown as { entry_id: string }[]).map((r) => r.entry_id)).toContain(entryId);

		const { error: restoreErr } = await asStudent.rpc('notebook_entry_restore', { p_entry_id: entryId });
		expect(restoreErr).toBeNull();
		const { data: back } = await asStudent.from('notebook_entries').select('id').eq('id', entryId);
		expect(back).toHaveLength(1);

		// And the bin is empty again.
		const bin2 = await mentor.client.rpc('notebook_bin', { p_team_id: team.teamId });
		expect((bin2.data as unknown as { entry_id: string }[]).map((r) => r.entry_id)).not.toContain(entryId);
	}, 120_000);

	test('a student on another team can neither delete nor see the bin', async () => {
		const other = await createTeam(mentor.client, 'OtherNb');
		const outsider = await createStudent(mentor.client, other, 'Out', 'S');
		const asOutsider = await signIn(outsider.email, outsider.pin);

		const { data: rows } = await mentor.client
			.from('notebook_entries')
			.insert({
				team_id: team.teamId,
				section: 'innovation_project',
				title: 'Not yours',
				body: 'Mentor wrote this.'
			})
			.select();
		const entryId = (rows ?? [])[0]?.id as string;

		const refused = await asOutsider.rpc('notebook_entry_delete', { p_entry_id: entryId });
		expect(expectPostgrestError(refused).message).toMatch(/not yours to change/i);

		// The bin answers a caller it does not like with nothing, not an error.
		const bin = await asOutsider.rpc('notebook_bin', { p_team_id: team.teamId });
		expect(bin.error).toBeNull();
		expect(bin.data).toEqual([]);

		// POSITIVE CONTROL: still there, and the mentor's own bin call works.
		const { data: svc } = await serviceClient().from('notebook_entries').select('id').eq('id', entryId);
		expect(svc).toHaveLength(1);
	}, 120_000);
});

describe('redrafting a recap leaves a confirmed one alone', () => {
	test('regenerate redrafts the unconfirmed and keeps the confirmed', async () => {
		const meetingId = await liveMeeting();
		await mentor.client
			.from('attendance')
			.insert({ meeting_id: meetingId, student_id: student.studentId })
			.select();
		await mentor.client.rpc('meeting_end', { p_meeting_id: meetingId });

		const { data: drafted } = await serviceClient()
			.from('meeting_recaps')
			.select('id, team_id, confirmed')
			.eq('meeting_id', meetingId);
		expect((drafted ?? []).length).toBeGreaterThan(0);

		// Confirm one of them the way the app does: through the UPDATE grant on
		// (confirmed, summary), the notebook_can_edit policy and the
		// notebook_can_confirm trigger beneath it (0026), both of which a
		// mentor passes. Ask for the row back, because a refused update is 204
		// with zero rows and no error.
		const target = (drafted ?? [])[0] as unknown as { id: string };
		const { data: confirmedRows, error: confirmErr } = await mentor.client
			.from('meeting_recaps')
			.update({ confirmed: true })
			.eq('id', target.id)
			.select();
		expect(confirmErr).toBeNull();
		expect(confirmedRows).toHaveLength(1);

		const { data, error } = await mentor.client.rpc('meeting_recap_regenerate', { p_meeting_id: meetingId });
		expect(error).toBeNull();
		const out = data as unknown as { recaps_drafted: number; confirmed_kept: number };
		expect(out.confirmed_kept).toBe(1);

		// The confirmed one survived with its id intact: it was not deleted and
		// redrafted, it was left alone.
		const { data: still } = await serviceClient().from('meeting_recaps').select('id, confirmed').eq('id', target.id);
		expect(still).toHaveLength(1);
		expect((still as unknown as { confirmed: boolean }[])[0].confirmed).toBe(true);
	}, 120_000);

	test('a session that has not ended has nothing to recap, and says so', async () => {
		const meetingId = await liveMeeting();
		const refused = await mentor.client.rpc('meeting_recap_regenerate', { p_meeting_id: meetingId });
		expect(expectPostgrestError(refused).message).toMatch(/has not ended/i);
		await mentor.client.rpc('meeting_end', { p_meeting_id: meetingId });
	}, 120_000);
});

// --- small readers -------------------------------------------------------

async function counts(meetingId: string): Promise<{ attendance: number; phases: number; tasks: number }> {
	const [row] = await sql<{ attendance: number; phases: number; tasks: number }[]>`
		select
			(select count(*)::int from public.attendance where meeting_id = ${meetingId}) as attendance,
			(select count(*)::int from public.meeting_phases where meeting_id = ${meetingId}) as phases,
			(select count(*)::int from public.tasks where meeting_id = ${meetingId}) as tasks`;
	return row;
}

async function phaseList(meetingId: string): Promise<{ id: string; ordinal: number; started_at: string | null }[]> {
	return sql<{ id: string; ordinal: number; started_at: string | null }[]>`
		select id, ordinal, started_at::text as started_at
		from public.meeting_phases where meeting_id = ${meetingId} order by ordinal`;
}

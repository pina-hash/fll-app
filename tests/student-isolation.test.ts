// tests/student-isolation.test.ts
//
// A STUDENT CANNOT REACH ANOTHER TEAM THROUGH THE RUNTIME, AND NOT BECAUSE
// THE SCREEN DECLINES TO DRAW IT.
//
// The student runtime reads tasks, the roster, attendance, blockers, roles and
// evidence with the signed-in student's own token, so the only thing standing
// between one team and another is RLS. This file drives those reads as a REAL
// GoTrue session through PostgREST -- the same path the phone takes -- and
// pairs every empty answer with the service role showing the row is really
// there. An empty result from a denied read is otherwise indistinguishable
// from an empty table.
//
// It also covers the two writes a student can make into somebody else's work
// (claiming a task, raising a blocker) and the evidence rule from 0010, which
// has to hold against a queued write replayed from a device that was offline.

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
	type Client,
	type SeededMentor,
	type SeededStudent,
	type SeededTeam
} from './db/harness';

let mentor: SeededMentor;
let mine: SeededTeam;
let theirs: SeededTeam;
let me: SeededStudent;
let teammate: SeededStudent;
let stranger: SeededStudent;
let meClient: Client;
let meetingId: string;

/** Ids of rows that exist on the OTHER team, for the positive controls. */
let theirTaskId: string;
let theirBlockerId: string;
let theirEvidenceId: string;

const service = serviceClient();

beforeAll(async () => {
	mentor = await seedMentor('iso');
	mine = await createTeam(mentor.client, 'iso-mine');
	theirs = await createTeam(mentor.client, 'iso-theirs');
	me = await createStudent(mentor.client, mine, 'Nadia', 'M', { pin: '314159' });
	teammate = await createStudent(mentor.client, mine, 'Owen', 'P');
	stranger = await createStudent(mentor.client, theirs, 'Pilar', 'Q');
	meClient = await signIn(me.email, me.pin);

	const [{ today }] = await sql<{ today: string }[]>`
		select to_char((now() at time zone 'America/Los_Angeles')::date, 'YYYY-MM-DD') as today`;
	const { data: created } = await mentor.client.rpc('meeting_create', {
		p_kind: 'friday',
		p_meeting_date: today,
		p_planned_start_at: new Date().toISOString()
	});
	meetingId = (created as unknown as { meeting_id: string }).meeting_id;
	await mentor.client.rpc('meeting_start', { p_meeting_id: meetingId });

	// One task, one blocker and one piece of evidence on EACH team, so every
	// "you cannot see theirs" has a "you can see yours" next to it.
	for (const [team, label] of [
		[mine, 'mine'],
		[theirs, 'theirs']
	] as const) {
		const { data: task } = await mentor.client
			.from('tasks')
			.insert({
				team_id: team.teamId,
				title: `Secret work for ${label}`,
				created_by_mentor_id: mentor.mentorId
			})
			.select('id')
			.single();
		const student = team === mine ? me : stranger;
		const { data: blocker } = await mentor.client
			.from('blockers')
			.insert({ team_id: team.teamId, student_id: student.studentId, note: `Stuck on ${label}` })
			.select('id')
			.single();
		const { data: evidence } = await service
			.from('evidence')
			.insert({
				task_id: task!.id,
				team_id: team.teamId,
				storage_path: `${team.teamId}/${task!.id}/proof.jpg`,
				caption: `Photo for ${label}`,
				uploaded_by_student_id: student.studentId
			})
			.select('id')
			.single();
		if (team === theirs) {
			theirTaskId = task!.id;
			theirBlockerId = blocker!.id;
			theirEvidenceId = evidence!.id;
		}
	}
}, 90_000);

afterAll(async () => {
	await sql`delete from public.evidence where team_id in (${mine.teamId}, ${theirs.teamId})`;
	await cleanupRun();
	await closeDb();
});

describe('reads: another team is invisible, and the rows really exist', () => {
	test('tasks', async () => {
		const all = await meClient.from('tasks').select('id, team_id, title');
		expect(all.error).toBeNull();
		expect(all.data!.length).toBeGreaterThan(0);
		expect(all.data!.every((t) => t.team_id === mine.teamId)).toBe(true);

		const targeted = await meClient.from('tasks').select('id').eq('id', theirTaskId);
		expect(targeted.data).toEqual([]);

		// POSITIVE CONTROL: the row is there; the student simply cannot see it.
		const asService = await service.from('tasks').select('id, title').eq('id', theirTaskId).single();
		expect(asService.data?.title).toBe('Secret work for theirs');
	});

	test('the roster', async () => {
		const roster = await meClient.from('students').select('id, team_id, first_name');
		expect(roster.data!.every((s) => s.team_id === mine.teamId)).toBe(true);
		expect(roster.data!.map((s) => s.first_name).sort()).toEqual(['Nadia', 'Owen']);
		expect(roster.data!.some((s) => s.first_name === 'Pilar')).toBe(false);

		const asService = await service.from('students').select('first_name').eq('id', stranger.studentId).single();
		expect(asService.data?.first_name).toBe('Pilar');
	});

	test('blockers', async () => {
		const targeted = await meClient.from('blockers').select('id').eq('id', theirBlockerId);
		expect(targeted.data).toEqual([]);
		const mineVisible = await meClient.from('blockers').select('id, team_id');
		expect(mineVisible.data!.length).toBeGreaterThan(0);
		expect(mineVisible.data!.every((b) => b.team_id === mine.teamId)).toBe(true);

		const asService = await service.from('blockers').select('note').eq('id', theirBlockerId).single();
		expect(asService.data?.note).toBe('Stuck on theirs');
	});

	test('evidence', async () => {
		const targeted = await meClient.from('evidence').select('id').eq('id', theirEvidenceId);
		expect(targeted.data).toEqual([]);
		const mineVisible = await meClient.from('evidence').select('id, team_id');
		expect(mineVisible.data!.every((e) => e.team_id === mine.teamId)).toBe(true);

		const asService = await service.from('evidence').select('caption').eq('id', theirEvidenceId).single();
		expect(asService.data?.caption).toBe('Photo for theirs');
	});

	test('attendance', async () => {
		await mentor.client.from('attendance').insert([
			{ meeting_id: meetingId, student_id: me.studentId },
			{ meeting_id: meetingId, student_id: stranger.studentId }
		]);

		const seen = await meClient.from('attendance').select('student_id');
		expect(seen.data!.map((a) => a.student_id)).toEqual([me.studentId]);

		// POSITIVE CONTROL: two rows exist for this meeting.
		const asService = await service.from('attendance').select('student_id').eq('meeting_id', meetingId);
		expect(asService.data!.length).toBe(2);
	});

	test('role assignments, and team_resolve_roles for the other team', async () => {
		await mentor.client.rpc('role_assign', {
			p_team_id: theirs.teamId,
			p_student_id: stranger.studentId,
			p_role: 'run_captain',
			p_tier: 'primary'
		});

		const rows = await meClient.from('role_assignments').select('team_id');
		expect(rows.data!.every((r) => r.team_id === mine.teamId)).toBe(true);

		const theirRoles = await meClient.rpc('team_resolve_roles', { p_team_id: theirs.teamId });
		expect(theirRoles.error).toBeNull();
		expect(theirRoles.data).toEqual([]);

		// POSITIVE CONTROL: their team is not an empty team, it is a hidden one.
		const mentorSees = await mentor.client.rpc('team_resolve_roles', { p_team_id: theirs.teamId });
		expect((mentorSees.data as unknown as unknown[]).length).toBe(5);
	});

	test('the team itself', async () => {
		const teams = await meClient.from('teams').select('id, name');
		expect(teams.data!.map((t) => t.id)).toEqual([mine.teamId]);

		const asService = await service.from('teams').select('name').eq('id', theirs.teamId).single();
		expect(asService.data?.name).toBe(theirs.name);
	});
});

describe('writes: a student cannot reach into another team', () => {
	test('claiming another team task changes nothing and reports no error', async () => {
		// RLS FILTERS AN UPDATE, IT DOES NOT RAISE. This is the shape a client
		// has to understand: PostgREST answers 204 and zero rows change.
		const attempt = await meClient
			.from('tasks')
			.update({ assigned_student_id: me.studentId })
			.eq('id', theirTaskId)
			.select('id');
		expect(attempt.error).toBeNull();
		expect(attempt.data).toEqual([]);

		const asService = await service.from('tasks').select('assigned_student_id').eq('id', theirTaskId).single();
		expect(asService.data?.assigned_student_id).toBeNull();

		// POSITIVE CONTROL: the same write on the student's OWN team returns the
		// row, which is what proves the empty array above meant "refused".
		const own = await service.from('tasks').select('id').eq('team_id', mine.teamId).limit(1).single();
		const allowed = await meClient
			.from('tasks')
			.update({ assigned_student_id: me.studentId })
			.eq('id', own.data!.id)
			.select('id');
		expect(allowed.data).toHaveLength(1);
	});

	test('raising a blocker on another team is refused outright', async () => {
		const attempt = await meClient
			.from('blockers')
			.insert({ team_id: theirs.teamId, student_id: stranger.studentId, note: 'Not mine to raise' });
		expect(expectPostgrestError(attempt).code).toBe('42501');
	});

	test('raising a blocker AS someone else is refused, even on my own team', async () => {
		const attempt = await meClient
			.from('blockers')
			.insert({ team_id: mine.teamId, student_id: teammate.studentId, note: 'Pretending to be Owen' });
		expect(expectPostgrestError(attempt).code).toBe('42501');

		// POSITIVE CONTROL: as themselves, on their own team, it goes through.
		const allowed = await meClient
			.from('blockers')
			.insert({ team_id: mine.teamId, student_id: me.studentId, note: 'This one is mine' });
		expect(allowed.error).toBeNull();
	});

	test('checking another student in is refused', async () => {
		const attempt = await meClient
			.from('attendance')
			.insert({ meeting_id: meetingId, student_id: teammate.studentId });
		expect(expectPostgrestError(attempt).code).toBe('42501');
	});

	test('attaching evidence to another team is refused', async () => {
		const attempt = await meClient.from('evidence').insert({
			task_id: theirTaskId,
			team_id: theirs.teamId,
			storage_path: `${theirs.teamId}/${theirTaskId}/sneaky.jpg`,
			uploaded_by_student_id: me.studentId
		});
		expect(expectPostgrestError(attempt).code).toBe('42501');
	});
});

describe('the evidence rule (0010) holds against a replayed write', () => {
	let guardedTaskId: string;

	beforeAll(async () => {
		const { data } = await mentor.client
			.from('tasks')
			.insert({
				team_id: mine.teamId,
				title: 'Show me the robot',
				evidence_required: true,
				created_by_mentor_id: mentor.mentorId
			})
			.select('id')
			.single();
		guardedTaskId = data!.id;
	});

	test('a student cannot close an evidence-required task with no photo', async () => {
		const attempt = await meClient.from('tasks').update({ status: 'done' }).eq('id', guardedTaskId);
		expect(attempt.error?.message).toContain('needs a photo');

		const asService = await service.from('tasks').select('status').eq('id', guardedTaskId).single();
		expect(asService.data?.status).toBe('open');
	});

	test('with a photo attached the same update goes through', async () => {
		const { error } = await meClient.from('evidence').insert({
			task_id: guardedTaskId,
			team_id: mine.teamId,
			storage_path: `${mine.teamId}/${guardedTaskId}/robot.jpg`,
			caption: 'The robot',
			uploaded_by_student_id: me.studentId
		});
		expect(error).toBeNull();

		const done = await meClient.from('tasks').update({ status: 'done' }).eq('id', guardedTaskId).select('status');
		expect(done.error).toBeNull();
		expect(done.data).toEqual([{ status: 'done' }]);
	});

	test('a mentor may still close one without a photo: they set the flag and they are standing there', async () => {
		const { data } = await mentor.client
			.from('tasks')
			.insert({
				team_id: mine.teamId,
				title: 'Mentor closes this one',
				evidence_required: true,
				created_by_mentor_id: mentor.mentorId
			})
			.select('id')
			.single();
		const closed = await mentor.client.from('tasks').update({ status: 'done' }).eq('id', data!.id).select('status');
		expect(closed.error).toBeNull();
		expect(closed.data).toEqual([{ status: 'done' }]);
	});
});

describe('the write queue replays are idempotent at the database', () => {
	test('a blocker insert replayed with the SAME client-minted id is a no-op', async () => {
		const id = crypto.randomUUID();
		const row = {
			id,
			team_id: mine.teamId,
			student_id: me.studentId,
			note: 'The queue replayed me'
		};
		const first = await meClient.from('blockers').insert(row);
		expect(first.error).toBeNull();

		const replay = await meClient.from('blockers').insert(row);
		// 23505 is what the queue reads as "already landed", not as a failure.
		expect(expectPostgrestError(replay).code).toBe('23505');

		const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from public.blockers where id = ${id}`;
		expect(n).toBe(1);
	});

	test('an attendance insert replayed for the same meeting and student is a no-op', async () => {
		const replay = await meClient
			.from('attendance')
			.insert({ id: crypto.randomUUID(), meeting_id: meetingId, student_id: me.studentId });
		// A DIFFERENT id, but the natural key (meeting, student) still collides,
		// which is the second half of what makes the queue safe to replay.
		expect(expectPostgrestError(replay).code).toBe('23505');

		const [{ n }] = await sql<{ n: number }[]>`
			select count(*)::int as n from public.attendance
			where meeting_id = ${meetingId} and student_id = ${me.studentId}`;
		expect(n).toBe(1);
	});
});

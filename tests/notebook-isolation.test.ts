// tests/notebook-isolation.test.ts
//
// THE TEAM BOUNDARY AND THE SECTION EDIT RULE ON THE NOTEBOOK TABLES, proved
// through the runtime (PostgREST with real GoTrue sessions), not the UI. Two
// teams; on team A a Notebook Lead (primary and second), a Lead Builder and a
// roleless teammate; on team B a rival lead. Reads stop at the team line,
// writes stop at notebook_can_edit(section), and every denial has a positive
// control so an empty answer is never mistaken for an empty table.

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
let teamA: SeededTeam;
let teamB: SeededTeam;
let noa: SeededStudent; // team A notebook_values_lead, primary
let ella: SeededStudent; // team A notebook_values_lead, second
let ben: SeededStudent; // team A lead_builder, primary
let cara: SeededStudent; // team A, no role
let dana: SeededStudent; // team B notebook_values_lead, primary

let noaClient: Client;
let ellaClient: Client;
let benClient: Client;
let caraClient: Client;
let danaClient: Client;

const service = serviceClient();

// Rows created in the tests, referenced across them.
const robotEntryId = crypto.randomUUID();
const valuesEntryId = crypto.randomUUID();

let recapAId: string | null = null;
let liveMeetingId: string | null = null;

beforeAll(async () => {
	mentor = await seedMentor('nb');
	teamA = await createTeam(mentor.client, 'Notebook A');
	teamB = await createTeam(mentor.client, 'Notebook B');
	noa = await createStudent(mentor.client, teamA, 'Noa', 'V');
	ella = await createStudent(mentor.client, teamA, 'Ella', 'E');
	ben = await createStudent(mentor.client, teamA, 'Ben', 'B');
	cara = await createStudent(mentor.client, teamA, 'Cara', 'C');
	dana = await createStudent(mentor.client, teamB, 'Dana', 'D');

	for (const [teamId, student, role, tier] of [
		[teamA.teamId, noa, 'notebook_values_lead', 'primary'],
		[teamA.teamId, ella, 'notebook_values_lead', 'second'],
		[teamA.teamId, ben, 'lead_builder', 'primary'],
		[teamB.teamId, dana, 'notebook_values_lead', 'primary']
	] as const) {
		const { error } = await mentor.client.rpc('role_assign', {
			p_team_id: teamId,
			p_student_id: student.studentId,
			p_role: role,
			p_tier: tier
		});
		if (error) throw new Error(`role_assign failed: ${error.message}`);
	}

	noaClient = await signIn(noa.email, noa.pin);
	ellaClient = await signIn(ella.email, ella.pin);
	benClient = await signIn(ben.email, ben.pin);
	caraClient = await signIn(cara.email, cara.pin);
	danaClient = await signIn(dana.email, dana.pin);
});

afterAll(async () => {
	// A meeting left running would leak the covering rule into later files.
	if (liveMeetingId) await mentor.client.rpc('meeting_end', { p_meeting_id: liveMeetingId });
	await cleanupRun();
	await closeDb();
});

describe('the section edit rule (no meeting running: assignment holders edit)', () => {
	test('the Notebook Lead writes every section', async () => {
		for (const [id, section] of [
			[valuesEntryId, 'core_values'],
			[crypto.randomUUID(), 'innovation_project'],
			[crypto.randomUUID(), 'season_summary']
		] as const) {
			const res = await noaClient
				.from('notebook_entries')
				.insert({
					id,
					team_id: teamA.teamId,
					section,
					prompt_key: 'cv-teamwork',
					body: 'We built the scoop together.',
					authored_by_student_id: noa.studentId
				})
				.select('id');
			expect(res.error).toBeNull();
			expect(res.data).toHaveLength(1);
		}
	});

	test('the Lead Builder writes Robot Design, with a failed try as a first-class row', async () => {
		const res = await benClient
			.from('notebook_entries')
			.insert({
				id: robotEntryId,
				team_id: teamA.teamId,
				section: 'robot_design',
				title: 'A claw arm for the rock',
				body: 'It dropped the rock on every turn.',
				outcome: 'failed',
				change_note: 'We switched to a scoop.',
				authored_by_student_id: ben.studentId
			})
			.select('id');
		expect(res.error).toBeNull();
		expect(res.data).toHaveLength(1);
	});

	test('the Lead Builder cannot write the Innovation Project or Core Values', async () => {
		for (const section of ['innovation_project', 'core_values'] as const) {
			const denied = await benClient.from('notebook_entries').insert({
				id: crypto.randomUUID(),
				team_id: teamA.teamId,
				section,
				body: 'Out of my lane.',
				authored_by_student_id: ben.studentId
			});
			expect(expectPostgrestError(denied).code).toBe('42501');
		}

		// AN RLS-FILTERED UPDATE IS NOT AN ERROR: zero rows, which is why the
		// notebook ops ask for the rows back.
		const update = await benClient
			.from('notebook_entries')
			.update({ body: 'rewritten' })
			.eq('id', valuesEntryId)
			.select('id');
		expect(update.error).toBeNull();
		expect(update.data).toHaveLength(0);
	});

	test('a roleless teammate READS everything but writes nothing', async () => {
		const read = await caraClient.from('notebook_entries').select('id').eq('team_id', teamA.teamId);
		expect(read.error).toBeNull();
		expect(read.data?.length).toBeGreaterThanOrEqual(4);

		const insert = await caraClient.from('notebook_entries').insert({
			id: crypto.randomUUID(),
			team_id: teamA.teamId,
			section: 'robot_design',
			body: 'no role, no pen',
			authored_by_student_id: cara.studentId
		});
		expect(expectPostgrestError(insert).code).toBe('42501');

		const update = await caraClient
			.from('notebook_entries')
			.update({ body: 'nope' })
			.eq('id', robotEntryId)
			.select('id');
		expect(update.error).toBeNull();
		expect(update.data).toHaveLength(0);

		// Positive control: the same statement as the builder moves the row.
		const control = await benClient
			.from('notebook_entries')
			.update({ body: 'It dropped the rock three runs in a row.' })
			.eq('id', robotEntryId)
			.select('id');
		expect(control.error).toBeNull();
		expect(control.data).toHaveLength(1);
	});

	test('an author cannot be forged: writing as someone else is refused', async () => {
		const forged = await noaClient.from('notebook_entries').insert({
			id: crypto.randomUUID(),
			team_id: teamA.teamId,
			section: 'core_values',
			body: 'signed with the wrong name',
			authored_by_student_id: ben.studentId
		});
		expect(expectPostgrestError(forged).code).toBe('42501');
	});

	test('the mentor edits any team and writes with no student byline', async () => {
		const res = await mentor.client
			.from('notebook_entries')
			.insert({
				id: crypto.randomUUID(),
				team_id: teamB.teamId,
				section: 'season_summary',
				body: 'Mentor note on team B.'
			})
			.select('id');
		expect(res.error).toBeNull();
		expect(res.data).toHaveLength(1);
	});
});

describe('the team boundary', () => {
	test('a rival lead reads NOTHING of team A, and the rows exist for the service role', async () => {
		const denied = await danaClient.from('notebook_entries').select('id').eq('team_id', teamA.teamId);
		expect(denied.error).toBeNull();
		expect(denied.data).toHaveLength(0);

		const control = await service.from('notebook_entries').select('id').eq('team_id', teamA.teamId);
		expect(control.error).toBeNull();
		expect(control.data?.length).toBeGreaterThan(0);
	});

	test('a rival lead cannot write into team A, however the row is dressed', async () => {
		// Honest team_id: the policy refuses, because dana cannot edit team A.
		const honest = await danaClient.from('notebook_entries').insert({
			id: crypto.randomUUID(),
			team_id: teamA.teamId,
			section: 'core_values',
			body: 'rival graffiti',
			authored_by_student_id: dana.studentId
		});
		expect(expectPostgrestError(honest).code).toBe('42501');

		// Forged citation: an entry on dana's OWN team naming team A's photo.
		// The COMPOSITE FOREIGN KEY (evidence_id, team_id) refuses before any
		// policy question, because team A's photo does not exist under team
		// B's id.
		const taskId = crypto.randomUUID();
		const evidenceId = crypto.randomUUID();
		await service.from('tasks').insert({
			id: taskId,
			team_id: teamA.teamId,
			title: 'Team A task',
			created_by_mentor_id: mentor.mentorId
		});
		await service.from('evidence').insert({
			id: evidenceId,
			task_id: taskId,
			team_id: teamA.teamId,
			storage_path: `${teamA.teamId}/${taskId}/${evidenceId}.jpg`,
			uploaded_by_student_id: noa.studentId
		});

		const forged = await danaClient.from('notebook_entries').insert({
			id: crypto.randomUUID(),
			team_id: teamB.teamId,
			section: 'core_values',
			body: 'their photo, our notebook',
			evidence_id: evidenceId,
			authored_by_student_id: dana.studentId
		});
		expect(expectPostgrestError(forged).code).toBe('23503');
	});

	test('a rival lead cannot delete team A rows: zero rows, row still there', async () => {
		const del = await danaClient.from('notebook_entries').delete().eq('id', robotEntryId).select('id');
		expect(del.error).toBeNull();
		expect(del.data).toHaveLength(0);

		const still = await service.from('notebook_entries').select('id').eq('id', robotEntryId);
		expect(still.data).toHaveLength(1);
	});
});

describe('recaps: generated by the session, edited by the Notebook Lead', () => {
	test('ending a meeting drafts a recap for every team', async () => {
		const created = await mentor.client.rpc('meeting_create', {
			p_kind: 'friday',
			p_meeting_date: new Date().toISOString().slice(0, 10),
			p_planned_start_at: new Date().toISOString()
		});
		expect(created.error).toBeNull();
		const meetingId = (created.data as { meeting_id: string }).meeting_id;
		const started = await mentor.client.rpc('meeting_start', { p_meeting_id: meetingId });
		expect(started.error).toBeNull();
		const ended = await mentor.client.rpc('meeting_end', { p_meeting_id: meetingId });
		expect(ended.error).toBeNull();
		expect((ended.data as { recaps_drafted: number }).recaps_drafted).toBeGreaterThanOrEqual(2);

		const recapA = await noaClient
			.from('meeting_recaps')
			.select('id, team_id, confirmed')
			.eq('meeting_id', meetingId)
			.eq('team_id', teamA.teamId);
		expect(recapA.error).toBeNull();
		expect(recapA.data).toHaveLength(1);
		expect(recapA.data?.[0]?.confirmed).toBe(false);
		recapAId = recapA.data?.[0]?.id ?? null;
	});

	test('a rival reads nothing of team A recaps; the service role sees them', async () => {
		const denied = await danaClient.from('meeting_recaps').select('id').eq('team_id', teamA.teamId);
		expect(denied.error).toBeNull();
		expect(denied.data).toHaveLength(0);

		const control = await service.from('meeting_recaps').select('id').eq('team_id', teamA.teamId);
		expect(control.data?.length).toBeGreaterThan(0);
	});

	test('the lead edits the summary; the builder and the roleless teammate get zero rows', async () => {
		const lead = await noaClient
			.from('meeting_recaps')
			.update({ summary: 'We planned the claw and split the missions.' })
			.eq('id', recapAId!)
			.select('id');
		expect(lead.error).toBeNull();
		expect(lead.data).toHaveLength(1);

		for (const client of [benClient, caraClient]) {
			const denied = await client
				.from('meeting_recaps')
				.update({ summary: 'not mine to write' })
				.eq('id', recapAId!)
				.select('id');
			expect(denied.error).toBeNull();
			expect(denied.data).toHaveLength(0);
		}
	});

	test('confirming stamps the server clock and the confirming student; a client cannot write the stamp', async () => {
		const direct = await noaClient
			.from('meeting_recaps')
			.update({ confirmed_at: new Date().toISOString() } as never)
			.eq('id', recapAId!);
		expect(expectPostgrestError(direct).code).toBe('42501');

		const confirm = await noaClient
			.from('meeting_recaps')
			.update({ confirmed: true })
			.eq('id', recapAId!)
			.select('id, confirmed, confirmed_at, confirmed_by_student_id');
		expect(confirm.error).toBeNull();
		expect(confirm.data?.[0]?.confirmed).toBe(true);
		expect(confirm.data?.[0]?.confirmed_at).not.toBeNull();
		expect(confirm.data?.[0]?.confirmed_by_student_id).toBe(noa.studentId);

		// Reopening clears the stamp.
		const reopen = await noaClient
			.from('meeting_recaps')
			.update({ confirmed: false })
			.eq('id', recapAId!)
			.select('confirmed, confirmed_at, confirmed_by_student_id');
		expect(reopen.error).toBeNull();
		expect(reopen.data?.[0]?.confirmed_at).toBeNull();
		expect(reopen.data?.[0]?.confirmed_by_student_id).toBeNull();
	});
});

describe('the covering rule during a live meeting (team_resolve_roles is the authority)', () => {
	test('with only the second lead checked in, the second edits and the absent primary does not', async () => {
		const created = await mentor.client.rpc('meeting_create', {
			p_kind: 'saturday',
			p_meeting_date: new Date().toISOString().slice(0, 10),
			p_planned_start_at: new Date().toISOString()
		});
		expect(created.error).toBeNull();
		liveMeetingId = (created.data as { meeting_id: string }).meeting_id;
		const started = await mentor.client.rpc('meeting_start', { p_meeting_id: liveMeetingId });
		expect(started.error).toBeNull();

		// Only Ella (the second) checks in: she is now the ACTIVE notebook lead.
		const checkin = await ellaClient
			.from('attendance')
			.insert({ id: crypto.randomUUID(), meeting_id: liveMeetingId!, student_id: ella.studentId });
		expect(checkin.error).toBeNull();

		const ellaEdit = await ellaClient
			.from('notebook_entries')
			.update({ body: 'We built the scoop together as a team.' })
			.eq('id', valuesEntryId)
			.select('id');
		expect(ellaEdit.error).toBeNull();
		expect(ellaEdit.data).toHaveLength(1);

		// Noa holds the primary assignment but is not here; the seat is Ella's.
		const noaEdit = await noaClient
			.from('notebook_entries')
			.update({ body: 'absent edit' })
			.eq('id', valuesEntryId)
			.select('id');
		expect(noaEdit.error).toBeNull();
		expect(noaEdit.data).toHaveLength(0);
	});
});

describe('SQL-level sanity', () => {
	test('notebook_can_edit is definer, pinned, and executable by authenticated but not anon', async () => {
		const [row] = await sql<{ prosecdef: boolean; anon: boolean; authed: boolean }[]>`
			select p.prosecdef,
			       has_function_privilege('anon', p.oid, 'execute') as anon,
			       has_function_privilege('authenticated', p.oid, 'execute') as authed
			from pg_proc p join pg_namespace n on n.oid = p.pronamespace
			where n.nspname = 'public' and p.proname = 'notebook_can_edit'`;
		expect(row).toEqual({ prosecdef: true, anon: false, authed: true });
	});

	test('notebook_season_stats answers null, not an error, to a caller outside the team', async () => {
		const rival = await danaClient.rpc('notebook_season_stats', { p_team_id: teamA.teamId });
		expect(rival.error).toBeNull();
		expect(rival.data).toBeNull();

		const own = await noaClient.rpc('notebook_season_stats', { p_team_id: teamA.teamId });
		expect(own.error).toBeNull();
		expect(own.data).not.toBeNull();
	});
});

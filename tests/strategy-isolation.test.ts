// tests/strategy-isolation.test.ts
//
// THE TEAM BOUNDARY AND THE EDIT RULE ON THE STRATEGY TABLES, proved through
// the runtime (PostgREST with real GoTrue sessions), not the UI. Two teams,
// a run captain, a second, a roleless teammate and a rival captain: reads
// stop at the team line, writes stop at strategy_can_edit, and every denial
// has a positive control so an empty answer is never mistaken for an empty
// table.

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
let alice: SeededStudent; // team A run captain, primary
let ben: SeededStudent; // team A run captain, second
let cara: SeededStudent; // team A, no role
let dana: SeededStudent; // team B run captain, primary

let aliceClient: Client;
let benClient: Client;
let caraClient: Client;
let danaClient: Client;

const service = serviceClient();

// Rows created by the captain in the setup, referenced across tests.
const strategyId = crypto.randomUUID();
const launchId = crypto.randomUUID();
const waypointId = crypto.randomUUID();

let meetingId: string | null = null;

beforeAll(async () => {
	mentor = await seedMentor('strat');
	teamA = await createTeam(mentor.client, 'Strat A');
	teamB = await createTeam(mentor.client, 'Strat B');
	alice = await createStudent(mentor.client, teamA, 'Alice', 'A');
	ben = await createStudent(mentor.client, teamA, 'Ben', 'B');
	cara = await createStudent(mentor.client, teamA, 'Cara', 'C');
	dana = await createStudent(mentor.client, teamB, 'Dana', 'D');

	for (const [student, tier] of [
		[alice, 'primary'],
		[ben, 'second']
	] as const) {
		const { error } = await mentor.client.rpc('role_assign', {
			p_team_id: teamA.teamId,
			p_student_id: student.studentId,
			p_role: 'run_captain',
			p_tier: tier
		});
		if (error) throw new Error(`role_assign failed: ${error.message}`);
	}
	const { error } = await mentor.client.rpc('role_assign', {
		p_team_id: teamB.teamId,
		p_student_id: dana.studentId,
		p_role: 'run_captain',
		p_tier: 'primary'
	});
	if (error) throw new Error(`role_assign failed: ${error.message}`);

	aliceClient = await signIn(alice.email, alice.pin);
	benClient = await signIn(ben.email, ben.pin);
	caraClient = await signIn(cara.email, cara.pin);
	danaClient = await signIn(dana.email, dana.pin);
});

afterAll(async () => {
	// A meeting left running would leak the covering rule into later files.
	if (meetingId) await mentor.client.rpc('meeting_end', { p_meeting_id: meetingId });
	await cleanupRun();
	await closeDb();
});

describe('the run captain edits; assignment holders count while nobody is active', () => {
	test('the captain creates the strategy, a launch and a waypoint through PostgREST', async () => {
		const s = await aliceClient
			.from('strategies')
			.insert({ id: strategyId, team_id: teamA.teamId, version: 1 })
			.select('id');
		expect(s.error).toBeNull();
		expect(s.data).toHaveLength(1);

		const l = await aliceClient
			.from('launches')
			.insert({ id: launchId, strategy_id: strategyId, team_id: teamA.teamId, name: 'Launch 1', sort_order: 1 })
			.select('id');
		expect(l.error).toBeNull();

		const w = await aliceClient
			.from('waypoints')
			.insert({ id: waypointId, launch_id: launchId, team_id: teamA.teamId, x_mm: 200, y_mm: 300, sort_order: 1 })
			.select('id');
		expect(w.error).toBeNull();
	});

	test('the SECOND may also edit while no meeting has an active captain', async () => {
		const res = await benClient
			.from('waypoints')
			.update({ x_mm: 210 })
			.eq('id', waypointId)
			.select('id');
		expect(res.error).toBeNull();
		expect(res.data).toHaveLength(1);
	});

	test('a roleless teammate READS the plan but cannot write it', async () => {
		const read = await caraClient.from('waypoints').select('id').eq('team_id', teamA.teamId);
		expect(read.error).toBeNull();
		expect(read.data?.length).toBeGreaterThan(0);

		const insert = await caraClient.from('waypoints').insert({
			id: crypto.randomUUID(),
			launch_id: launchId,
			team_id: teamA.teamId,
			x_mm: 100,
			y_mm: 100,
			sort_order: 9
		});
		expect(expectPostgrestError(insert).code).toBe('42501');

		// AN RLS-FILTERED UPDATE IS NOT AN ERROR: it is zero rows, which is
		// exactly why the planner asks for the rows back.
		const update = await caraClient
			.from('waypoints')
			.update({ x_mm: 999 })
			.eq('id', waypointId)
			.select('id');
		expect(update.error).toBeNull();
		expect(update.data).toHaveLength(0);

		// Positive control: the very same statement as the captain moves a row.
		const control = await aliceClient
			.from('waypoints')
			.update({ x_mm: 220 })
			.eq('id', waypointId)
			.select('id');
		expect(control.error).toBeNull();
		expect(control.data).toHaveLength(1);
	});

	test('the mentor edits any team', async () => {
		const res = await mentor.client
			.from('launches')
			.update({ attachment_name: 'Box pusher' })
			.eq('id', launchId)
			.select('id');
		expect(res.error).toBeNull();
		expect(res.data).toHaveLength(1);
	});
});

describe('the team boundary', () => {
	test('a rival captain reads NOTHING of team A, and the rows exist for the service role', async () => {
		for (const table of ['strategies', 'launches', 'waypoints'] as const) {
			const denied = await danaClient.from(table).select('id').eq('team_id', teamA.teamId);
			expect(denied.error).toBeNull();
			expect(denied.data).toHaveLength(0);

			const control = await service.from(table).select('id').eq('team_id', teamA.teamId);
			expect(control.error).toBeNull();
			expect(control.data?.length).toBeGreaterThan(0);
		}
	});

	test('a rival captain cannot write into team A, however the row is dressed', async () => {
		// Honest team_id: the policy refuses, because dana cannot edit team A.
		const honest = await danaClient.from('waypoints').insert({
			id: crypto.randomUUID(),
			launch_id: launchId,
			team_id: teamA.teamId,
			x_mm: 50,
			y_mm: 50,
			sort_order: 1
		});
		expect(expectPostgrestError(honest).code).toBe('42501');

		// Forged team_id: the COMPOSITE FOREIGN KEY refuses before any policy
		// question, because team A's launch does not exist under team B's id.
		const forged = await danaClient.from('waypoints').insert({
			id: crypto.randomUUID(),
			launch_id: launchId,
			team_id: teamB.teamId,
			x_mm: 50,
			y_mm: 50,
			sort_order: 1
		});
		expect(expectPostgrestError(forged).code).toBe('23503');
	});

	test('a rival captain cannot hard-delete team A rows: zero rows, row still there', async () => {
		const del = await danaClient.from('waypoints').delete().eq('id', waypointId).select('id');
		expect(del.error).toBeNull();
		expect(del.data).toHaveLength(0);

		const still = await service.from('waypoints').select('id').eq('id', waypointId);
		expect(still.data).toHaveLength(1);
	});

	test('the robot profile is team-scoped the same way', async () => {
		const ins = await aliceClient
			.from('team_robots')
			.insert({ id: crypto.randomUUID(), team_id: teamA.teamId, speed_cm_s: 32 })
			.select('id');
		expect(ins.error).toBeNull();

		const denied = await danaClient.from('team_robots').select('id').eq('team_id', teamA.teamId);
		expect(denied.error).toBeNull();
		expect(denied.data).toHaveLength(0);

		const rival = await danaClient
			.from('team_robots')
			.update({ speed_cm_s: 99 })
			.eq('team_id', teamA.teamId)
			.select('id');
		expect(rival.error).toBeNull();
		expect(rival.data).toHaveLength(0);

		const control = await service.from('team_robots').select('speed_cm_s').eq('team_id', teamA.teamId);
		expect(control.data).toHaveLength(1);
		expect(Number(control.data?.[0]?.speed_cm_s)).toBe(32);
	});
});

describe('the covering rule during a live meeting (team_resolve_roles is the authority)', () => {
	test('with only the second checked in, the second edits and the absent primary does not', async () => {
		const created = await mentor.client.rpc('meeting_create', {
			p_kind: 'friday',
			p_meeting_date: new Date().toISOString().slice(0, 10),
			p_planned_start_at: new Date().toISOString()
		});
		expect(created.error).toBeNull();
		meetingId = (created.data as { meeting_id: string }).meeting_id;
		const started = await mentor.client.rpc('meeting_start', { p_meeting_id: meetingId });
		expect(started.error).toBeNull();

		// Only Ben (the second) checks in: he is now the ACTIVE run captain.
		const checkin = await benClient
			.from('attendance')
			.insert({ id: crypto.randomUUID(), meeting_id: meetingId!, student_id: ben.studentId });
		expect(checkin.error).toBeNull();

		const benEdit = await benClient
			.from('waypoints')
			.update({ y_mm: 310 })
			.eq('id', waypointId)
			.select('id');
		expect(benEdit.error).toBeNull();
		expect(benEdit.data).toHaveLength(1);

		// Alice holds the primary assignment but is not here; the seat is Ben's.
		const aliceEdit = await aliceClient
			.from('waypoints')
			.update({ y_mm: 999 })
			.eq('id', waypointId)
			.select('id');
		expect(aliceEdit.error).toBeNull();
		expect(aliceEdit.data).toHaveLength(0);
	});

	test('once the primary checks in, the seat is hers again', async () => {
		const checkin = await aliceClient
			.from('attendance')
			.insert({ id: crypto.randomUUID(), meeting_id: meetingId!, student_id: alice.studentId });
		expect(checkin.error).toBeNull();

		const aliceEdit = await aliceClient
			.from('waypoints')
			.update({ y_mm: 320 })
			.eq('id', waypointId)
			.select('id');
		expect(aliceEdit.error).toBeNull();
		expect(aliceEdit.data).toHaveLength(1);

		const benEdit = await benClient
			.from('waypoints')
			.update({ y_mm: 998 })
			.eq('id', waypointId)
			.select('id');
		expect(benEdit.error).toBeNull();
		expect(benEdit.data).toHaveLength(0);
	});
});

describe('SQL-level sanity', () => {
	test('strategy_can_edit is definer, pinned, and executable by authenticated but not anon', async () => {
		const [row] = await sql<{ prosecdef: boolean; anon: boolean; authed: boolean }[]>`
			select p.prosecdef,
			       has_function_privilege('anon', p.oid, 'execute') as anon,
			       has_function_privilege('authenticated', p.oid, 'execute') as authed
			from pg_proc p join pg_namespace n on n.oid = p.pronamespace
			where n.nspname = 'public' and p.proname = 'strategy_can_edit'`;
		expect(row).toEqual({ prosecdef: true, anon: false, authed: true });
	});
});

// tests/strategy-snapshot.test.ts
//
// STRATEGY VERSIONING. strategy_snapshot freezes the working copy under a
// label and starts version+1 as a faithful, atomically-created copy of the
// whole tree (launches, their missions, their waypoints) with fresh ids.
// The RPC re-checks the caller in its own body: a roleless teammate and a
// rival team's captain are refused in the caller's own terms.

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
	type Client,
	type SeededMentor,
	type SeededStudent,
	type SeededTeam
} from './db/harness';

let mentor: SeededMentor;
let team: SeededTeam;
let rivalTeam: SeededTeam;
let captain: SeededStudent;
let teammate: SeededStudent;
let rival: SeededStudent;
let captainClient: Client;
let teammateClient: Client;
let rivalClient: Client;

const service = serviceClient();
const strategyId = crypto.randomUUID();
const launchId = crypto.randomUUID();
let missionId: string;

beforeAll(async () => {
	mentor = await seedMentor('snap');
	team = await createTeam(mentor.client, 'Snap');
	rivalTeam = await createTeam(mentor.client, 'Snap Rival');
	captain = await createStudent(mentor.client, team, 'Cap', 'C');
	teammate = await createStudent(mentor.client, team, 'Tia', 'T');
	rival = await createStudent(mentor.client, rivalTeam, 'Rob', 'R');
	for (const [t, s] of [
		[team, captain],
		[rivalTeam, rival]
	] as const) {
		const { error } = await mentor.client.rpc('role_assign', {
			p_team_id: t.teamId,
			p_student_id: s.studentId,
			p_role: 'run_captain',
			p_tier: 'primary'
		});
		if (error) throw new Error(`role_assign failed: ${error.message}`);
	}
	captainClient = await signIn(captain.email, captain.pin);
	teammateClient = await signIn(teammate.email, teammate.pin);
	rivalClient = await signIn(rival.email, rival.pin);

	const { data: missions } = await captainClient.from('missions').select('id').order('sort_order').limit(1);
	missionId = missions![0].id;

	// v1: one launch, one mission, three waypoints.
	await captainClient.from('strategies').insert({ id: strategyId, team_id: team.teamId, version: 1 });
	await captainClient
		.from('launches')
		.insert({ id: launchId, strategy_id: strategyId, team_id: team.teamId, name: 'Opening', attachment_name: 'Pusher', sort_order: 1 });
	await captainClient.from('launch_missions').insert({
		id: crypto.randomUUID(),
		launch_id: launchId,
		team_id: team.teamId,
		mission_id: missionId,
		sort_order: 1,
		scoring_lines: [0]
	});
	await captainClient.from('waypoints').insert(
		[
			{ x: 100, y: 200 },
			{ x: 800, y: 700 },
			{ x: 120, y: 210 }
		].map((p, i) => ({
			id: crypto.randomUUID(),
			launch_id: launchId,
			team_id: team.teamId,
			x_mm: p.x,
			y_mm: p.y,
			sort_order: i + 1
		}))
	);
});

afterAll(async () => {
	await cleanupRun();
	await closeDb();
});

describe('strategy_snapshot', () => {
	test('the captain snapshots: v1 keeps the label, v2 is a faithful copy with fresh ids', async () => {
		const res = await captainClient.rpc('strategy_snapshot', {
			p_team_id: team.teamId,
			p_label: 'first real plan'
		});
		expect(res.error).toBeNull();
		const out = res.data as { strategy_id: string; version: number };
		expect(out.version).toBe(2);

		const { data: versions } = await service
			.from('strategies')
			.select('id, version, label')
			.eq('team_id', team.teamId)
			.order('version');
		expect(versions).toHaveLength(2);
		expect(versions![0]).toMatchObject({ id: strategyId, version: 1, label: 'first real plan' });
		expect(versions![1]).toMatchObject({ id: out.strategy_id, version: 2, label: null });

		const { data: copiedLaunches } = await service
			.from('launches')
			.select('id, name, attachment_name, sort_order')
			.eq('strategy_id', out.strategy_id);
		expect(copiedLaunches).toHaveLength(1);
		expect(copiedLaunches![0]).toMatchObject({ name: 'Opening', attachment_name: 'Pusher', sort_order: 1 });
		expect(copiedLaunches![0].id).not.toBe(launchId);

		const newLaunchId = copiedLaunches![0].id;
		const { data: copiedMissions } = await service
			.from('launch_missions')
			.select('mission_id, scoring_lines')
			.eq('launch_id', newLaunchId);
		expect(copiedMissions).toEqual([{ mission_id: missionId, scoring_lines: [0] }]);

		const { data: copiedWaypoints } = await service
			.from('waypoints')
			.select('x_mm, y_mm, sort_order')
			.eq('launch_id', newLaunchId)
			.order('sort_order');
		expect(copiedWaypoints).toEqual([
			{ x_mm: 100, y_mm: 200, sort_order: 1 },
			{ x_mm: 800, y_mm: 700, sort_order: 2 },
			{ x_mm: 120, y_mm: 210, sort_order: 3 }
		]);

		// The original tree is untouched.
		const { data: original } = await service.from('waypoints').select('id').eq('launch_id', launchId);
		expect(original).toHaveLength(3);
	});

	test('a roleless teammate is refused in their own terms', async () => {
		const res = await teammateClient.rpc('strategy_snapshot', { p_team_id: team.teamId });
		const err = expectPostgrestError(res);
		expect(err.message).toBe('Only the Run Captain or a mentor can save a strategy version.');
	});

	test('a rival captain cannot snapshot another team', async () => {
		const res = await rivalClient.rpc('strategy_snapshot', { p_team_id: team.teamId });
		expect(expectPostgrestError(res).message).toBe(
			'Only the Run Captain or a mentor can save a strategy version.'
		);
	});

	test('a team with no strategy yet is told so', async () => {
		const res = await rivalClient.rpc('strategy_snapshot', { p_team_id: rivalTeam.teamId });
		expect(expectPostgrestError(res).message).toBe('There is no strategy to save yet.');
	});

	test('the mentor snapshots too, and versions keep counting', async () => {
		const res = await mentor.client.rpc('strategy_snapshot', { p_team_id: team.teamId });
		expect(res.error).toBeNull();
		expect((res.data as { version: number }).version).toBe(3);
	});
});

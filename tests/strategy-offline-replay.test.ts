// tests/strategy-offline-replay.test.ts
//
// AN EDIT MADE OFFLINE LANDS EXACTLY ONCE ON RECONNECT. The queue replays
// ops verbatim, so the proof is at the op layer: applyPlannerOp (the exact
// function the WriteQueue delegates planner ops to) is driven twice with the
// same client-minted id against the real stack, and exactly one row exists.
// The negative control replays the same payload under a DIFFERENT id and
// gets a second row, which is what shows the dedup comes from the id and not
// from the values.

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { applyPlannerOp, plannerDelete, plannerInsert, plannerUpdate } from '$lib/planner/ops';
import {
	cleanupRun,
	closeDb,
	createStudent,
	createTeam,
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
let captain: SeededStudent;
let teammate: SeededStudent;
let captainClient: Client;
let teammateClient: Client;

const service = serviceClient();

const strategyId = crypto.randomUUID();
const launchId = crypto.randomUUID();

beforeAll(async () => {
	mentor = await seedMentor('replay');
	team = await createTeam(mentor.client, 'Replay');
	captain = await createStudent(mentor.client, team, 'Rita', 'R');
	teammate = await createStudent(mentor.client, team, 'Theo', 'T');
	const { error } = await mentor.client.rpc('role_assign', {
		p_team_id: team.teamId,
		p_student_id: captain.studentId,
		p_role: 'run_captain',
		p_tier: 'primary'
	});
	if (error) throw new Error(`role_assign failed: ${error.message}`);
	captainClient = await signIn(captain.email, captain.pin);
	teammateClient = await signIn(teammate.email, teammate.pin);

	// The tree the waypoint ops hang off, queued the same way the planner
	// queues it: strategy first, then the launch, in order.
	expect(
		await applyPlannerOp(captainClient, plannerInsert('strategies', { id: strategyId, team_id: team.teamId, version: 1 }))
	).toBe('done');
	expect(
		await applyPlannerOp(
			captainClient,
			plannerInsert('launches', { id: launchId, strategy_id: strategyId, team_id: team.teamId, name: 'L1', sort_order: 1 })
		)
	).toBe('done');
});

afterAll(async () => {
	await cleanupRun();
	await closeDb();
});

describe('replayed inserts', () => {
	const waypointId = crypto.randomUUID();
	const row = () => ({
		id: waypointId,
		launch_id: launchId,
		team_id: team.teamId,
		x_mm: 400,
		y_mm: 500,
		sort_order: 1
	});

	test('the same op twice is one row: the second landing is a duplicate key, which counts as done', async () => {
		expect(await applyPlannerOp(captainClient, plannerInsert('waypoints', row()))).toBe('done');
		// The reconnect replay: the op is applied again, verbatim.
		expect(await applyPlannerOp(captainClient, plannerInsert('waypoints', row()))).toBe('done');

		const { data } = await service.from('waypoints').select('id').eq('id', waypointId);
		expect(data).toHaveLength(1);
	});

	test('NEGATIVE CONTROL: the same payload under a different id is a second row', async () => {
		const otherId = crypto.randomUUID();
		expect(
			await applyPlannerOp(captainClient, plannerInsert('waypoints', { ...row(), id: otherId }))
		).toBe('done');

		const { data } = await service
			.from('waypoints')
			.select('id')
			.eq('launch_id', launchId)
			.eq('x_mm', 400)
			.eq('y_mm', 500);
		expect(data).toHaveLength(2);

		// Leave one waypoint for the update/delete cases below.
		await service.from('waypoints').delete().eq('id', otherId);
	});

	test('replayed updates are last-write-wins and idempotent', async () => {
		const op = plannerUpdate('waypoints', waypointId, { x_mm: 777, y_mm: 111 });
		expect(await applyPlannerOp(captainClient, op)).toBe('done');
		expect(await applyPlannerOp(captainClient, op)).toBe('done');

		const { data } = await service.from('waypoints').select('x_mm, y_mm').eq('id', waypointId);
		expect(data).toEqual([{ x_mm: 777, y_mm: 111 }]);
	});

	test('a refused update is SHOWN, not swallowed: zero rows plus a visible row is a refusal', async () => {
		// The teammate holds no role: RLS filters the update to zero rows with
		// no error. applyPlannerOp probes and reports it as a failure message.
		const res = await applyPlannerOp(
			teammateClient,
			plannerUpdate('waypoints', waypointId, { x_mm: 1 })
		);
		expect(res).toEqual({ message: 'The server did not accept this change.' });

		// And the row is untouched.
		const { data } = await service.from('waypoints').select('x_mm').eq('id', waypointId);
		expect(data).toEqual([{ x_mm: 777 }]);
	});

	test('a replayed delete is done both times, and an edit whose target is gone is done, not an error', async () => {
		expect(await applyPlannerOp(captainClient, plannerDelete('waypoints', waypointId))).toBe('done');
		// The replay: zero rows, row not visible any more, so it already worked.
		expect(await applyPlannerOp(captainClient, plannerDelete('waypoints', waypointId))).toBe('done');

		const { data } = await service.from('waypoints').select('id').eq('id', waypointId);
		expect(data).toHaveLength(0);

		// A queued move whose waypoint someone else deleted: nothing to save,
		// nothing to scare a child with.
		expect(
			await applyPlannerOp(captainClient, plannerUpdate('waypoints', waypointId, { x_mm: 5 }))
		).toBe('done');
	});
});

describe('the robot profile upsert on its natural key', () => {
	test('the same op replayed converges on one row per team', async () => {
		const op = {
			kind: 'robot_profile',
			teamId: team.teamId,
			row: {
				id: crypto.randomUUID(),
				team_id: team.teamId,
				width_mm: 170,
				length_mm: 210,
				speed_cm_s: 28,
				dwell_s: 6,
				between_launches_s: 7
			}
		} as const;
		expect(await applyPlannerOp(captainClient, op)).toBe('done');
		expect(await applyPlannerOp(captainClient, op)).toBe('done');

		const { data } = await service.from('team_robots').select('width_mm').eq('team_id', team.teamId);
		expect(data).toEqual([{ width_mm: 170 }]);
	});

	test('a teammate without the role is refused, visibly', async () => {
		const res = await applyPlannerOp(teammateClient, {
			kind: 'robot_profile',
			teamId: team.teamId,
			row: {
				id: crypto.randomUUID(),
				team_id: team.teamId,
				width_mm: 1,
				length_mm: 1,
				speed_cm_s: 1,
				dwell_s: 0,
				between_launches_s: 0
			}
		});
		expect(typeof res === 'object' && res !== null && 'message' in res).toBe(true);

		const { data } = await service.from('team_robots').select('width_mm').eq('team_id', team.teamId);
		expect(data).toEqual([{ width_mm: 170 }]);
	});
});

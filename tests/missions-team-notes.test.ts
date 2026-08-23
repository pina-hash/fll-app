// tests/missions-team-notes.test.ts
//
// The missions table is global reference data everyone reads and only a
// mentor can move the mat position on. team_mission_notes is team-scoped the
// same way tasks are: a student reads and writes only their own team's note,
// a mentor reads and writes every team's, and a team A student cannot see or
// touch team B's note -- proved both ways, per CLAUDE.md's testing standard.

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
	asUser,
	captureError,
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
let a1: SeededStudent;
let b1: SeededStudent;
let alice: Client;
const svc = serviceClient();

let missionId = '';
let noteBId = '';

beforeAll(async () => {
	mentor = await seedMentor('mission-notes');
	teamA = await createTeam(mentor.client, 'MA');
	teamB = await createTeam(mentor.client, 'MB');
	a1 = await createStudent(mentor.client, teamA, 'Nia', 'A');
	b1 = await createStudent(mentor.client, teamB, 'Ben', 'B');

	const m01 = await svc.from('missions').select('id').eq('code', 'M01').single();
	if (m01.error) throw new Error(`seed lookup M01: ${m01.error.message}`);
	missionId = m01.data.id;

	const noteB = await mentor.client
		.from('team_mission_notes')
		.insert({ team_id: teamB.teamId, mission_id: missionId, note: 'B strategy' })
		.select('id')
		.single();
	if (noteB.error) throw new Error(`seed note B: ${noteB.error.message}`);
	noteBId = noteB.data.id;

	alice = await signIn(a1.email, a1.pin);
});

afterAll(async () => {
	// missions is global reference data, not run-scoped: put M01's position
	// back to how the seed left it so this file leaves no residue behind for
	// the next run or for a human poking at the local stack afterward.
	if (missionId) {
		await sql`update public.missions set position_x_mm = null, position_y_mm = null where id = ${missionId}`;
	}
	await cleanupRun();
	await closeDb();
});

describe('missions: global reference data', () => {
	test('exactly 15 missions exist', async () => {
		const { data, error } = await svc.from('missions').select('code');
		expect(error).toBeNull();
		expect(data).toHaveLength(15);
	});

	test('a student reads the full mission list', async () => {
		const { data, error } = await alice.from('missions').select('code');
		expect(error).toBeNull();
		expect(data).toHaveLength(15);
	});

	test('a student cannot move the mat position; a mentor can', async () => {
		// No .select(): an RLS-filtered write comes back as 204/no-error even
		// when it changed nothing, so the empty row set (not an error) is what
		// proves the denial here -- .select() below turns it back into 42501.
		const silent = await alice.from('missions').update({ position_x_mm: 100 }).eq('id', missionId).select('id');
		expect(silent.error).toBeNull();
		expect(silent.data).toEqual([]);

		const control = await svc.from('missions').select('position_x_mm').eq('id', missionId).single();
		expect(control.data!.position_x_mm).toBeNull();

		const ok = await mentor.client
			.from('missions')
			.update({ position_x_mm: 250, position_y_mm: 400 })
			.eq('id', missionId)
			.select('position_x_mm, position_y_mm');
		expect(ok.error).toBeNull();
		expect(ok.data).toEqual([{ position_x_mm: 250, position_y_mm: 400 }]);
	});
});

describe('team_mission_notes: reads', () => {
	test('a team A student reads only team A notes; team B note exists for the service role', async () => {
		const denied = await alice.from('team_mission_notes').select('id').eq('id', noteBId);
		expect(denied.error).toBeNull();
		expect(denied.data).toEqual([]);

		const control = await svc.from('team_mission_notes').select('id').eq('id', noteBId);
		expect(control.data).toHaveLength(1);
	});

	test('SQL path: the same select as authenticated with the student claims is empty', async () => {
		const visible = await asUser(a1.authUserId, (tx) => tx`select id from public.team_mission_notes where id = ${noteBId}`);
		expect(visible).toHaveLength(0);
	});

	test('the mentor reads both teams notes', async () => {
		const { data, error } = await mentor.client.from('team_mission_notes').select('id, team_id');
		expect(error).toBeNull();
		expect(data!.map((n) => n.id)).toContain(noteBId);
	});
});

describe('team_mission_notes: writes', () => {
	test('a team A student can write their own team note (positive control)', async () => {
		const { data, error } = await alice
			.from('team_mission_notes')
			.insert({ team_id: teamA.teamId, mission_id: missionId, note: 'A strategy' })
			.select('note');
		expect(error).toBeNull();
		expect(data).toEqual([{ note: 'A strategy' }]);
	});

	test('a team A student cannot write into team B', async () => {
		const error = expectPostgrestError(
			await alice
				.from('team_mission_notes')
				.insert({ team_id: teamB.teamId, mission_id: missionId, note: 'forged' })
		);
		expect(error.code).toBe('42501');

		const control = await svc
			.from('team_mission_notes')
			.select('note')
			.eq('team_id', teamB.teamId)
			.eq('mission_id', missionId)
			.single();
		expect(control.data!.note).toBe('B strategy');
	});

	test('a team A student cannot update team B note', async () => {
		const { data, error } = await alice
			.from('team_mission_notes')
			.update({ note: 'hacked' })
			.eq('id', noteBId)
			.select('id');
		expect(error).toBeNull();
		expect(data).toEqual([]);
		const control = await svc.from('team_mission_notes').select('note').eq('id', noteBId).single();
		expect(control.data!.note).toBe('B strategy');
	});

	test('a student is refused at the grant level before team_id is even considered (defense in depth)', async () => {
		const error = await captureError(() =>
			asUser(
				a1.authUserId,
				(tx) => tx`update public.team_mission_notes set team_id = ${teamB.teamId} where team_id = ${teamA.teamId}`
			)
		);
		expect(error.message).toMatch(/permission denied/);
	});

	test('the immutable-columns trigger itself blocks team_id/mission_id, proved via the service role', async () => {
		const own = await sql<{ id: string }[]>`
			select id from public.team_mission_notes where team_id = ${teamA.teamId} and mission_id = ${missionId}`;
		expect(own).toHaveLength(1);

		const error = await captureError(
			() => sql`update public.team_mission_notes set team_id = ${teamB.teamId} where id = ${own[0].id}`
		);
		expect(error.message).toMatch(/cannot be changed/);
	});
});

describe('SQL-catalog sanity for the seeded mission rows', () => {
	test('every mission code from the rulebook is present', async () => {
		const codes = await sql<{ code: string }[]>`select code from public.missions order by sort_order`;
		expect(codes.map((c) => c.code)).toEqual([
			'M01', 'M02', 'M03', 'M04', 'M05', 'M06', 'M07', 'M08', 'M09', 'M10', 'M11', 'M12', 'M13', 'M14', 'M15'
		]);
	});
});

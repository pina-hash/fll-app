// tests/role-assignments.test.ts
//
// ONE HOLDER PER (TEAM, ROLE, TIER) AT ANY INSTANT, AS A CONSTRAINT (0005).
// The overlap is refused by Postgres (SQLSTATE 23P01), not by application
// code; a student from another team is refused by the composite foreign key.

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
	cleanupRun,
	closeDb,
	createStudent,
	createTeam,
	expectPostgrestError,
	seedMentor,
	signIn,
	type SeededMentor,
	type SeededStudent,
	type SeededTeam
} from './db/harness';

let mentor: SeededMentor;
let teamA: SeededTeam;
let teamB: SeededTeam;
let a1: SeededStudent;
let a2: SeededStudent;
let b1: SeededStudent;

beforeAll(async () => {
	mentor = await seedMentor('roles');
	teamA = await createTeam(mentor.client, 'RolesA');
	teamB = await createTeam(mentor.client, 'RolesB');
	a1 = await createStudent(mentor.client, teamA, 'Ivy', 'I');
	a2 = await createStudent(mentor.client, teamA, 'Jon', 'J');
	b1 = await createStudent(mentor.client, teamB, 'Kim', 'K');
});

afterAll(async () => {
	await cleanupRun();
	await closeDb();
});

describe('the exclusion constraints', () => {
	test('two primary lead_builders with overlapping ranges are refused with 23P01; a second is fine', async () => {
		const first = await mentor.client
			.from('role_assignments')
			.insert({ team_id: teamA.teamId, student_id: a1.studentId, role: 'lead_builder', tier: 'primary', effective_from: '2026-09-01' })
			.select('id')
			.single();
		expect(first.error).toBeNull();

		const clash = expectPostgrestError(
			await mentor.client
				.from('role_assignments')
				.insert({ team_id: teamA.teamId, student_id: a2.studentId, role: 'lead_builder', tier: 'primary', effective_from: '2026-10-01' })
		);
		expect(clash.code).toBe('23P01');

		const second = await mentor.client
			.from('role_assignments')
			.insert({ team_id: teamA.teamId, student_id: a2.studentId, role: 'lead_builder', tier: 'second', effective_from: '2026-09-01' })
			.select('id')
			.single();
		expect(second.error).toBeNull();
	});

	test('one student cannot hold both tiers of one role at once', async () => {
		const clash = expectPostgrestError(
			await mentor.client
				.from('role_assignments')
				.insert({ team_id: teamA.teamId, student_id: a1.studentId, role: 'lead_builder', tier: 'second', effective_from: '2027-01-01' })
		);
		expect(clash.code).toBe('23P01');
	});

	test('ending the first assignment opens the seat from that date; half-open ranges do not touch', async () => {
		const ended = await mentor.client
			.from('role_assignments')
			.update({ effective_to: '2026-11-01' })
			.eq('team_id', teamA.teamId)
			.eq('student_id', a1.studentId)
			.eq('role', 'lead_builder')
			.select('id');
		expect(ended.error).toBeNull();
		expect(ended.data).toHaveLength(1);

		// a2 still holds the open-ended `second` seat, and one student cannot
		// hold both tiers at once: a promotion ends the old seat the same day.
		const stillSecond = expectPostgrestError(
			await mentor.client
				.from('role_assignments')
				.insert({ team_id: teamA.teamId, student_id: a2.studentId, role: 'lead_builder', tier: 'primary', effective_from: '2026-11-01' })
		);
		expect(stillSecond.code).toBe('23P01');
		const endedSecond = await mentor.client
			.from('role_assignments')
			.update({ effective_to: '2026-11-01' })
			.eq('team_id', teamA.teamId)
			.eq('student_id', a2.studentId)
			.eq('tier', 'second')
			.select('id');
		expect(endedSecond.data).toHaveLength(1);

		const successor = await mentor.client
			.from('role_assignments')
			.insert({ team_id: teamA.teamId, student_id: a2.studentId, role: 'lead_builder', tier: 'primary', effective_from: '2026-11-01' });
		expect(successor.error).toBeNull();
	});

	test('a different role is a different seat', async () => {
		const ok = await mentor.client
			.from('role_assignments')
			.insert({ team_id: teamA.teamId, student_id: a1.studentId, role: 'run_captain', tier: 'primary', effective_from: '2026-09-01' });
		expect(ok.error).toBeNull();
	});

	test('a range that ends before it starts is refused', async () => {
		const bad = expectPostgrestError(
			await mentor.client
				.from('role_assignments')
				.insert({ team_id: teamA.teamId, student_id: a2.studentId, role: 'innovation_lead', tier: 'primary', effective_from: '2026-09-10', effective_to: '2026-09-01' })
		);
		expect(bad.code).toBe('23514');
	});
});

describe('the team boundary', () => {
	test('a team B student cannot be assigned a team A role (composite foreign key)', async () => {
		const bad = expectPostgrestError(
			await mentor.client
				.from('role_assignments')
				.insert({ team_id: teamA.teamId, student_id: b1.studentId, role: 'innovation_lead', tier: 'primary' })
		);
		expect(bad.code).toBe('23503');
	});

	test('a student reads their own team roles only and cannot write any', async () => {
		const ivy = await signIn(a1.email, a1.pin);
		const read = await ivy.from('role_assignments').select('team_id');
		expect(read.error).toBeNull();
		expect(read.data!.length).toBeGreaterThan(0);
		expect(read.data!.every((r) => r.team_id === teamA.teamId)).toBe(true);

		const write = expectPostgrestError(
			await ivy.from('role_assignments').insert({ team_id: teamA.teamId, student_id: a1.studentId, role: 'notebook_values_lead', tier: 'primary' })
		);
		expect(write.code).toBe('42501');
	});
});

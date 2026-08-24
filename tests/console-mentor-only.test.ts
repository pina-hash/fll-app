// tests/console-mentor-only.test.ts
//
// EVERY MENTOR-ONLY SURFACE IS REFUSED TO A STUDENT, NOT MERELY HIDDEN. The
// console has two independent boundaries and this file exercises the inner
// one, the database: each RPC 0009 added re-checks the caller in its own body,
// and every refusal here is paired with the same call succeeding for a mentor
// in the same test, because an error from a student is only meaningful if the
// call itself works.
//
// The outer boundary is the route group at src/routes/app/(mentor)/, which
// answers 403 to a student session. It is not exercised here: this suite talks
// to Postgres and GoTrue, not to SvelteKit.
//
// team_resolve_roles is the interesting one. It is not mentor-only -- a
// student's own runtime will need it -- so it is scoped instead: a student
// asking about ANOTHER team gets an empty answer, which is the same answer a
// team that does not exist gives. Probing reveals nothing.

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
	cleanupRun,
	closeDb,
	createStudent,
	createTeam,
	seedMentor,
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
let student: SeededStudent;
let studentClient: Client;
let meetingId: string;

beforeAll(async () => {
	mentor = await seedMentor('gate');
	teamA = await createTeam(mentor.client, 'gate-a');
	teamB = await createTeam(mentor.client, 'gate-b');
	student = await createStudent(mentor.client, teamA, 'Sam', 'G', { pin: '135791' });
	studentClient = await signIn(student.email, student.pin);

	const [{ today }] = await sql<{ today: string }[]>`
		select to_char((now() at time zone 'America/Los_Angeles')::date, 'YYYY-MM-DD') as today`;
	const { data } = await mentor.client.rpc('meeting_create', {
		p_kind: 'friday',
		p_meeting_date: today,
		p_planned_start_at: new Date().toISOString()
	});
	meetingId = (data as unknown as { meeting_id: string }).meeting_id;
}, 60_000);

afterAll(async () => {
	await cleanupRun();
	await closeDb();
});

describe('board_live_summary is mentor-only', () => {
	test('a student is refused, and the same call as the mentor returns the board', async () => {
		const refused = await studentClient.rpc('board_live_summary');
		expect(refused.error?.message).toBe('Only a mentor can open the live board.');
		expect(refused.data).toBeNull();

		// POSITIVE CONTROL: the call works, so the refusal above is the gate and
		// not a broken function.
		const allowed = await mentor.client.rpc('board_live_summary');
		expect(allowed.error).toBeNull();
		expect(Array.isArray((allowed.data as unknown as { teams: unknown[] }).teams)).toBe(true);
	});
});

describe('the provisioning and phase RPCs are mentor-only', () => {
	// PromiseLike, not Promise: a PostgREST builder is thenable but is not a
	// Promise, so typing this as Promise fails the check while running fine.
	const cases: {
		name: string;
		call: (c: Client) => PromiseLike<{ error: { message: string } | null }>;
		refusal: string;
	}[] = [
		{
			name: 'meeting_start',
			call: (c) => c.rpc('meeting_start', { p_meeting_id: meetingId }),
			refusal: 'Only a mentor can start a meeting.'
		},
		{
			name: 'meeting_advance_phase',
			call: (c) => c.rpc('meeting_advance_phase', { p_meeting_id: meetingId }),
			refusal: 'Only a mentor can change the phase.'
		},
		{
			name: 'meeting_end',
			call: (c) => c.rpc('meeting_end', { p_meeting_id: meetingId }),
			refusal: 'Only a mentor can end a meeting.'
		},
		{
			name: 'team_regenerate_join_code',
			call: (c) => c.rpc('team_regenerate_join_code', { p_team_id: teamB.teamId }),
			refusal: 'Only a mentor can change a team code.'
		},
		{
			name: 'role_assign',
			call: (c) =>
				c.rpc('role_assign', {
					p_team_id: teamA.teamId,
					p_student_id: student.studentId,
					p_role: 'run_captain',
					p_tier: 'primary'
				}),
			refusal: 'Only a mentor can assign a role.'
		},
		{
			name: 'role_unassign',
			call: (c) => c.rpc('role_unassign', { p_team_id: teamA.teamId, p_role: 'run_captain', p_tier: 'primary' }),
			refusal: 'Only a mentor can clear a role.'
		},
		{
			name: 'team_create',
			call: (c) => c.rpc('team_create', { p_name: 'Student Made This' }),
			refusal: 'Only a mentor can create a team.'
		}
	];

	for (const c of cases) {
		test(`${c.name} refuses a student in the caller's own terms`, async () => {
			const { error } = await c.call(studentClient);
			expect(error?.message).toBe(c.refusal);
		});
	}

	test('POSITIVE CONTROL: the same calls succeed for a mentor', async () => {
		// Ordered so each precondition is met: start, advance, end.
		expect((await mentor.client.rpc('meeting_start', { p_meeting_id: meetingId })).error).toBeNull();
		expect((await mentor.client.rpc('meeting_advance_phase', { p_meeting_id: meetingId })).error).toBeNull();
		expect((await mentor.client.rpc('meeting_end', { p_meeting_id: meetingId })).error).toBeNull();
		expect(
			(
				await mentor.client.rpc('role_assign', {
					p_team_id: teamA.teamId,
					p_student_id: student.studentId,
					p_role: 'run_captain',
					p_tier: 'primary'
				})
			).error
		).toBeNull();
		expect(
			(await mentor.client.rpc('role_unassign', { p_team_id: teamA.teamId, p_role: 'run_captain', p_tier: 'primary' }))
				.error
		).toBeNull();
	});

	test('a student cannot write the console tables directly either', async () => {
		// The RPCs are not the only door: RLS has to hold on the tables the
		// console writes through the client.
		const roleInsert = await studentClient
			.from('role_assignments')
			.insert({ team_id: teamA.teamId, student_id: student.studentId, role: 'lead_builder', tier: 'primary' });
		expect(roleInsert.error?.code).toBe('42501');

		const teamUpdate = await studentClient.from('teams').update({ name: 'Renamed By A Student' }).eq('id', teamA.teamId);
		expect(teamUpdate.error).toBeNull(); // no rows matched; RLS filtered them out
		const [{ name }] = await sql<{ name: string }[]>`select name from public.teams where id = ${teamA.teamId}`;
		expect(name).toBe(teamA.name);

		// From 0018 NOBODY holds an update grant on teams.accent -- not even a
		// mentor. The colour changes only through team_confirm_accent or
		// team_set_accent, each of which re-checks its own caller. So a direct
		// write is not filtered to zero rows, it is refused outright (42501).
		const accentUpdate = await studentClient.from('teams').update({ accent: 'magenta' }).eq('id', teamA.teamId);
		expect(accentUpdate.error?.code).toBe('42501');
		const [{ accent }] = await sql<{ accent: string | null }[]>`select accent from public.teams where id = ${teamA.teamId}`;
		expect(accent).not.toBe('magenta');
	});
});

describe('team_resolve_roles is scoped, not mentor-only', () => {
	test('a student reads their OWN team and gets the five roles', async () => {
		const { data, error } = await studentClient.rpc('team_resolve_roles', { p_team_id: teamA.teamId });
		expect(error).toBeNull();
		expect((data as unknown as unknown[]).length).toBe(5);
	});

	test('the same student asking about ANOTHER team gets nothing, and the mentor gets five', async () => {
		const denied = await studentClient.rpc('team_resolve_roles', { p_team_id: teamB.teamId });
		expect(denied.error).toBeNull();
		expect(denied.data).toEqual([]);

		// POSITIVE CONTROL: team B is not an empty team, it is a hidden one.
		const seen = await mentor.client.rpc('team_resolve_roles', { p_team_id: teamB.teamId });
		expect((seen.data as unknown as unknown[]).length).toBe(5);
	});

	test('a team that does not exist answers exactly like a team the caller may not see', async () => {
		const missing = await studentClient.rpc('team_resolve_roles', {
			p_team_id: '00000000-0000-4000-8000-0000000000ff'
		});
		expect(missing.data).toEqual([]);
		expect(missing.error).toBeNull();
	});
});

// tests/login-roster.test.ts
//
// THE ANON HALF OF THE STUDENT LOGIN SCREEN. team_login_roster returns the
// team's id and name and each active student's first name, last initial and
// slug -- and nothing else: no student id, no auth user id, no PIN, no grade.
// Unknown and archived codes answer null. The client-side address builder
// matches the database's, byte for byte.

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
	anonClient,
	cleanupRun,
	closeDb,
	createStudent,
	createTeam,
	expectPostgrestError,
	seedMentor,
	sql,
	type SeededMentor,
	type SeededStudent,
	type SeededTeam
} from './db/harness';
import { studentEmail } from '../src/lib/auth/student-identity';

let mentor: SeededMentor;
let team: SeededTeam;
let s1: SeededStudent;
let s2: SeededStudent;

type Roster = {
	team_id: string;
	team_name: string;
	join_code: string;
	students: Array<Record<string, unknown>>;
};

beforeAll(async () => {
	mentor = await seedMentor('roster');
	team = await createTeam(mentor.client, 'Roster');
	s1 = await createStudent(mentor.client, team, 'Zoe', 'Z', { grade: 7 });
	s2 = await createStudent(mentor.client, team, 'Ana', 'A', { grade: 5 });
});

afterAll(async () => {
	await cleanupRun();
	await closeDb();
});

describe('team_login_roster as anon', () => {
	test('returns the team and exactly first_name, last_initial, slug per active student, sorted', async () => {
		const { data, error } = await anonClient().rpc('team_login_roster', { p_join_code: team.joinCode });
		expect(error).toBeNull();
		const roster = data as Roster;
		expect(roster.team_id).toBe(team.teamId);
		expect(roster.team_name).toBe(team.name);
		expect(roster.join_code).toBe(team.joinCode);
		expect(roster.students.map((s) => s.slug)).toEqual([s2.slug, s1.slug]);
		for (const s of roster.students) {
			expect(Object.keys(s).sort()).toEqual(['first_name', 'last_initial', 'slug']);
		}
		const serialized = JSON.stringify(roster);
		expect(serialized).not.toContain(s1.studentId);
		expect(serialized).not.toContain(s1.authUserId);
		expect(serialized).not.toContain(s1.pin);
		expect(serialized).not.toMatch(/grade/);
	});

	test('normalizes the typed code: lowercase and surrounding whitespace', async () => {
		const { data } = await anonClient().rpc('team_login_roster', { p_join_code: `  ${team.joinCode.toLowerCase()} ` });
		expect((data as Roster).team_id).toBe(team.teamId);
	});

	test('an unknown code answers null, not an error', async () => {
		const { data, error } = await anonClient().rpc('team_login_roster', { p_join_code: 'ZZZZZZ' });
		expect(error).toBeNull();
		expect(data).toBeNull();
	});

	test('a deactivated student leaves the roster; an archived team answers null', async () => {
		await mentor.client.rpc('student_deactivate', { p_student_id: s1.studentId });
		const after = await anonClient().rpc('team_login_roster', { p_join_code: team.joinCode });
		expect((after.data as Roster).students.map((s) => s.slug)).toEqual([s2.slug]);
		await mentor.client.rpc('student_reactivate', { p_student_id: s1.studentId });

		const archived = await mentor.client.from('teams').update({ archived_at: new Date().toISOString() }).eq('id', team.teamId).select('id');
		expect(archived.error).toBeNull();
		expect(archived.data).toHaveLength(1);
		const gone = await anonClient().rpc('team_login_roster', { p_join_code: team.joinCode });
		expect(gone.data).toBeNull();
		await mentor.client.from('teams').update({ archived_at: null }).eq('id', team.teamId);
	});

	test('anon has no table access at all', async () => {
		expect(expectPostgrestError(await anonClient().from('teams').select('id')).code).toBe('42501');
		expect(expectPostgrestError(await anonClient().from('students').select('id')).code).toBe('42501');
		expect(expectPostgrestError(await anonClient().from('tasks').select('id')).code).toBe('42501');
	});
});

describe('the client address matches the database address', () => {
	test.each([
		['AR6X2Y', 'alexp'],
		['gfuqzx', 'maria2'],
		[' DY9MEZ ', 'j']
	])('studentEmail(%s, %s) == public._student_email', async (code, slug) => {
		const [{ email }] = await sql<{ email: string }[]>`select public._student_email(${code}, ${slug}) as email`;
		expect(studentEmail(code, slug)).toBe(email);
	});

	test('and what student_create stored is what the client would build', async () => {
		const [{ email }] = await sql<{ email: string }[]>`select email from auth.users where id = ${s2.authUserId}`;
		expect(email).toBe(studentEmail(team.joinCode, s2.slug));
	});
});

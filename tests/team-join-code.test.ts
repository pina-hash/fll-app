// tests/team-join-code.test.ts
//
// ROTATING A JOIN CODE REWRITES EVERY LOGIN ON THE TEAM. The code is half of a
// student's synthetic address ({code}-{slug}@fll.invalid, 0004), so 0003
// deliberately shipped no way to change it. The console needs the operation,
// and 0009's team_regenerate_join_code does it properly: teams.join_code,
// auth.users.email and auth.identities.identity_data all move in one
// transaction, and the sessions signed in under the old code are dropped.
//
// The claim that matters is END TO END and can only be made against GoTrue:
// the OLD address stops signing in, the NEW address signs in with THE SAME
// PIN. Both directions are asserted, in that order.

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
	cleanupRun,
	closeDb,
	createStudent,
	createTeam,
	seedMentor,
	signIn,
	signInError,
	sql,
	type SeededMentor,
	type SeededStudent,
	type SeededTeam
} from './db/harness';
import { studentEmail } from '../src/lib/auth/student-identity';

let mentor: SeededMentor;
let team: SeededTeam;
let student: SeededStudent;

beforeAll(async () => {
	mentor = await seedMentor('code');
	team = await createTeam(mentor.client, 'code');
	student = await createStudent(mentor.client, team, 'Rosa', 'K', { pin: '223344' });
}, 60_000);

afterAll(async () => {
	await cleanupRun();
	await closeDb();
});

describe('team_regenerate_join_code', () => {
	test('the old address signs in before the rotation', async () => {
		// POSITIVE CONTROL for the whole file: without this, "the old address
		// stopped working" would be indistinguishable from "it never worked".
		const client = await signIn(student.email, student.pin);
		const { data } = await client.auth.getUser();
		expect(data.user?.email).toBe(student.email);
	});

	test('rotating mints a new code, keeps it a legal code, and reports the students it touched', async () => {
		const { data, error } = await mentor.client.rpc('team_regenerate_join_code', { p_team_id: team.teamId });
		expect(error).toBeNull();
		const result = data as unknown as {
			join_code: string;
			previous_join_code: string;
			students_relogin: number;
		};
		expect(result.previous_join_code).toBe(team.joinCode);
		expect(result.join_code).not.toBe(team.joinCode);
		expect(result.join_code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
		expect(result.students_relogin).toBe(1);

		team = { ...team, joinCode: result.join_code };
	});

	test('the address in auth.users and in auth.identities both moved to the new code', async () => {
		const expected = studentEmail(team.joinCode, student.slug);
		const [row] = await sql<{ email: string; identity_email: string }[]>`
			select u.email, i.identity_data ->> 'email' as identity_email
			from auth.users u
			join auth.identities i on i.user_id = u.id and i.provider = 'email'
			where u.id = ${student.authUserId}`;
		expect(row.email).toBe(expected);
		expect(row.identity_email).toBe(expected);
		// The client-side mirror agrees with the database, as 0004 requires.
		expect(expected).not.toBe(student.email);
	});

	test('the OLD address no longer signs in', async () => {
		const message = await signInError(student.email, student.pin);
		expect(message).not.toBeNull();
	});

	test('the NEW address signs in with the SAME PIN: rotation is not a PIN reset', async () => {
		const client = await signIn(studentEmail(team.joinCode, student.slug), student.pin);
		const { data } = await client.auth.getUser();
		expect(data.user?.id).toBe(student.authUserId);
	});

	test('the sessions signed in under the old code were dropped', async () => {
		// The sign-in on the line above created a fresh one, so the assertion is
		// about the count at the moment of rotation, captured from the row's
		// updated_at rather than guessed.
		const [{ n }] = await sql<{ n: number }[]>`
			select count(*)::int as n from auth.sessions
			where user_id = ${student.authUserId}
				and created_at < (select updated_at from public.teams where id = ${team.teamId})`;
		expect(n).toBe(0);
	});

	test('an archived team is refused, and a live team is not', async () => {
		const archived = await createTeam(mentor.client, 'code-archived');
		await mentor.client.from('teams').update({ archived_at: new Date().toISOString() }).eq('id', archived.teamId);

		const refused = await mentor.client.rpc('team_regenerate_join_code', { p_team_id: archived.teamId });
		expect(refused.error?.message).toBe('That team is archived.');

		// POSITIVE CONTROL: un-archive it and the same call goes through.
		await mentor.client.from('teams').update({ archived_at: null }).eq('id', archived.teamId);
		const allowed = await mentor.client.rpc('team_regenerate_join_code', { p_team_id: archived.teamId });
		expect(allowed.error).toBeNull();
	});

	test('teams.join_code still has no client write grant: the definer is the only writer', async () => {
		const rows = await sql`
			select 1 from information_schema.column_privileges
			where table_schema = 'public' and table_name = 'teams' and column_name = 'join_code'
				and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE')`;
		expect(rows).toHaveLength(0);
	});
});

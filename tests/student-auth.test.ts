// tests/student-auth.test.ts
//
// THE STUDENT AUTH PATH, END TO END THROUGH GOTRUE. A mentor mints a student
// through student_create, the student signs in with their PIN through the real
// auth service, the mentor resets the PIN through student_reset_pin (which
// writes auth.users.encrypted_password with pgcrypto's bcrypt from SQL), the
// old PIN stops working and the new one works. This file is the proof the
// SQL-side reset path is relied on; if it ever reddens, the fallback is an
// admin-API route (see CLAUDE.md).

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
	anonClient,
	cleanupRun,
	closeDb,
	createStudent,
	createTeam,
	expectPostgrestError,
	seedMentor,
	signIn,
	signInError,
	sql,
	type SeededMentor,
	type SeededTeam
} from './db/harness';
import { studentEmail } from '../src/lib/auth/student-identity';

let mentor: SeededMentor;
let team: SeededTeam;

beforeAll(async () => {
	mentor = await seedMentor('auth');
	team = await createTeam(mentor.client, 'Auth');
});

afterAll(async () => {
	await cleanupRun();
	await closeDb();
});

describe('student_create', () => {
	test('mints the auth user, the identity and the students row; a supplied PIN is not echoed', async () => {
		const { data, error } = await mentor.client.rpc('student_create', {
			p_team_id: team.teamId,
			p_first_name: 'Alex',
			p_last_initial: 'p',
			p_grade: 6,
			p_pin: '112233'
		});
		expect(error).toBeNull();
		const out = data as Record<string, unknown>;
		expect(out.slug).toBe('alexp');
		expect(out.email).toBe(studentEmail(team.joinCode, 'alexp'));
		expect(out.pin).toBeNull();

		const [user] = await sql<{ email: string; encrypted_password: string; confirmed: boolean; providers: string }[]>`
			select u.email, u.encrypted_password, u.email_confirmed_at is not null as confirmed,
			       u.raw_app_meta_data ->> 'providers' as providers
			from auth.users u join public.students s on s.auth_user_id = u.id
			where s.id = ${out.student_id as string}`;
		expect(user.email).toBe(out.email);
		expect(user.confirmed).toBe(true);
		expect(user.encrypted_password).toMatch(/^\$2a\$10\$/);
		const [identity] = await sql<{ n: number }[]>`
			select count(*)::int as n from auth.identities i join public.students s on s.auth_user_id = i.user_id
			where s.id = ${out.student_id as string} and i.provider = 'email'`;
		expect(identity.n).toBe(1);
	});

	test('the student signs in through GoTrue with the PIN and auth_whoami says who they are', async () => {
		const client = await signIn(studentEmail(team.joinCode, 'alexp'), '112233');
		const { data, error } = await client.rpc('auth_whoami');
		expect(error).toBeNull();
		const who = data as Record<string, unknown>;
		expect(who.kind).toBe('student');
		expect(who.slug).toBe('alexp');
		expect(who.team_id).toBe(team.teamId);
		expect(who.join_code).toBe(team.joinCode);
	});

	test('a wrong PIN is refused', async () => {
		expect(await signInError(studentEmail(team.joinCode, 'alexp'), '999999')).not.toBeNull();
	});

	test('a second Alex P. on the same team gets alexp2; a null PIN mints one and returns it once', async () => {
		const { data, error } = await mentor.client.rpc('student_create', {
			p_team_id: team.teamId,
			p_first_name: 'Alex',
			p_last_initial: 'P'
		});
		expect(error).toBeNull();
		const out = data as Record<string, unknown>;
		expect(out.slug).toBe('alexp2');
		expect(out.pin).toMatch(/^[0-9]{6}$/);
		const client = await signIn(out.email as string, out.pin as string);
		expect((await client.auth.getUser()).data.user?.email).toBe(out.email);
	});

	test('validation: PIN shape, last initial, empty name', async () => {
		const badPin = expectPostgrestError(
			await mentor.client.rpc('student_create', { p_team_id: team.teamId, p_first_name: 'Bea', p_last_initial: 'Q', p_pin: '1234' })
		);
		expect(badPin.message).toBe('A PIN is exactly 6 digits.');
		const badInitial = expectPostgrestError(
			await mentor.client.rpc('student_create', { p_team_id: team.teamId, p_first_name: 'Bea', p_last_initial: 'Qu' })
		);
		expect(badInitial.message).toBe('A last initial is a single letter.');
		const badName = expectPostgrestError(
			await mentor.client.rpc('student_create', { p_team_id: team.teamId, p_first_name: '   ', p_last_initial: 'Q' })
		);
		expect(badName.message).toBe('A first name is 1 to 40 characters.');
	});

	test('a student cannot mint students; anon cannot even call the function', async () => {
		const student = await signIn(studentEmail(team.joinCode, 'alexp'), '112233');
		const asStudent = expectPostgrestError(
			await student.rpc('student_create', { p_team_id: team.teamId, p_first_name: 'Eve', p_last_initial: 'X' })
		);
		expect(asStudent.message).toBe('Only a mentor can add a student.');

		const asAnon = expectPostgrestError(
			await anonClient().rpc('student_create', { p_team_id: team.teamId, p_first_name: 'Eve', p_last_initial: 'X' })
		);
		expect(asAnon.code).toBe('42501');
	});
});

describe('student_reset_pin', () => {
	test('old PIN stops, new PIN works, live sessions are dropped; only a mentor may call it', async () => {
		const s = await createStudent(mentor.client, team, 'Rin', 'R', { pin: '555555' });
		const before = await signIn(s.email, '555555');

		const asStudent = expectPostgrestError(await before.rpc('student_reset_pin', { p_student_id: s.studentId, p_new_pin: '777777' }));
		expect(asStudent.message).toBe('Only a mentor can reset a PIN.');

		const badShape = expectPostgrestError(
			await mentor.client.rpc('student_reset_pin', { p_student_id: s.studentId, p_new_pin: '12345' })
		);
		expect(badShape.message).toBe('A PIN is exactly 6 digits.');

		const { data, error } = await mentor.client.rpc('student_reset_pin', { p_student_id: s.studentId, p_new_pin: '777777' });
		expect(error).toBeNull();
		expect((data as { ok: boolean }).ok).toBe(true);

		const [hash] = await sql<{ encrypted_password: string }[]>`
			select encrypted_password from auth.users where id = ${s.authUserId}`;
		expect(hash.encrypted_password).toMatch(/^\$2a\$10\$/);

		expect(await signInError(s.email, '555555')).not.toBeNull();
		const after = await signIn(s.email, '777777');
		expect((await after.auth.getUser()).data.user?.id).toBe(s.authUserId);

		// The pre-reset session's refresh token is gone with its auth.sessions row.
		const refreshed = await before.auth.refreshSession();
		expect(refreshed.error).not.toBeNull();
	});
});

describe('student_deactivate / student_reactivate', () => {
	test('a deactivated student cannot sign in and is not on the roster; reactivation restores both', async () => {
		const s = await createStudent(mentor.client, team, 'Dee', 'D', { pin: '424242' });
		await signIn(s.email, s.pin);

		const off = await mentor.client.rpc('student_deactivate', { p_student_id: s.studentId });
		expect(off.error).toBeNull();
		expect(await signInError(s.email, s.pin)).not.toBeNull();
		const roster = await anonClient().rpc('team_login_roster', { p_join_code: team.joinCode });
		const slugs = ((roster.data as { students: { slug: string }[] }).students ?? []).map((x) => x.slug);
		expect(slugs).not.toContain(s.slug);

		const on = await mentor.client.rpc('student_reactivate', { p_student_id: s.studentId });
		expect(on.error).toBeNull();
		const back = await signIn(s.email, s.pin);
		expect((await back.auth.getUser()).data.user?.id).toBe(s.authUserId);
	});
});

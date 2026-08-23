// tests/mentor-signin-gate.test.ts
//
// THE SIGN-IN GATE on auth.users (0002). A non-boscotech.edu Google account
// cannot become a mentor; an email/password sign-up cannot become one either;
// an @fll.invalid address cannot be minted by anything but student_create.
// Each refusal is shown at the database (the insert GoTrue performs) and,
// where GoTrue exposes the path, through GoTrue itself.

import { afterAll, describe, expect, test } from 'vitest';
import { anonClient, captureError, cleanupRun, closeDb, RUN, serviceClient, sql } from './db/harness';

afterAll(async () => {
	await cleanupRun();
	await closeDb();
});

function googleUser(email: string, name = 'Some One') {
	return sql`
		insert into auth.users (
			instance_id, id, aud, role, email, email_confirmed_at,
			confirmation_token, recovery_token, email_change_token_new, email_change,
			email_change_token_current, email_change_confirm_status, phone_change, phone_change_token,
			reauthentication_token, raw_app_meta_data, raw_user_meta_data,
			is_super_admin, is_sso_user, is_anonymous, created_at, updated_at
		) values (
			'00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', ${email}, now(),
			'', '', '', '', '', 0, '', '', '',
			${sql.json({ provider: 'google', providers: ['google'] })},
			${sql.json({ full_name: name })},
			false, false, false, now(), now()
		) returning id`;
}

async function userCount(email: string): Promise<number> {
	const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from auth.users where email = ${email}`;
	return n;
}

describe('at the database', () => {
	test('a Google account outside boscotech.edu is refused and leaves no row', async () => {
		const email = `outsider-${RUN}@gmail.com`;
		const error = await captureError(() => googleUser(email));
		expect(error.message).toMatch(/limited to boscotech\.edu Google accounts/);
		expect(await userCount(email)).toBe(0);
	});

	test('a look-alike domain is refused (exact domain match, not a suffix match)', async () => {
		const email = `tricky-${RUN}@notboscotech.edu`;
		const error = await captureError(() => googleUser(email));
		expect(error.message).toMatch(/limited to boscotech\.edu/);
		expect(await userCount(email)).toBe(0);
	});

	test('a boscotech.edu address on the email provider (not Google) is refused', async () => {
		const email = `test-${RUN}-emailprov@boscotech.edu`;
		const error = await captureError(
			() => sql`
				insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
					confirmation_token, recovery_token, email_change_token_new, email_change,
					email_change_token_current, email_change_confirm_status, phone_change, phone_change_token,
					reauthentication_token, raw_app_meta_data, raw_user_meta_data,
					is_super_admin, is_sso_user, is_anonymous, created_at, updated_at)
				values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', ${email}, now(),
					'', '', '', '', '', 0, '', '', '',
					${sql.json({ provider: 'email', providers: ['email'] })}, '{}'::jsonb,
					false, false, false, now(), now())`
		);
		expect(error.message).toMatch(/limited to boscotech\.edu Google accounts/);
		expect(await userCount(email)).toBe(0);
	});

	test('an @fll.invalid address outside student_create is refused', async () => {
		const email = `zzzzzz-forged${RUN}@fll.invalid`;
		const error = await captureError(
			() => sql`
				insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
					confirmation_token, recovery_token, email_change_token_new, email_change,
					email_change_token_current, email_change_confirm_status, phone_change, phone_change_token,
					reauthentication_token, raw_app_meta_data, raw_user_meta_data,
					is_super_admin, is_sso_user, is_anonymous, created_at, updated_at)
				values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', ${email}, now(),
					'', '', '', '', '', 0, '', '', '',
					${sql.json({ provider: 'email', providers: ['email'] })}, '{}'::jsonb,
					false, false, false, now(), now())`
		);
		expect(error.message).toMatch(/created by a mentor, not by signing up/);
		expect(await userCount(email)).toBe(0);
	});

	test('a boscotech.edu Google account becomes a mentor, named from the profile, not admin while an admin exists', async () => {
		const email = `test-${RUN}-gate@boscotech.edu`;
		await googleUser(email, 'Gate Mentor');
		const [m] = await sql<{ display_name: string; is_admin: boolean; email: string }[]>`
			select display_name, is_admin, email from public.mentors where email = ${email}`;
		expect(m).toBeDefined();
		expect(m.display_name).toBe('Gate Mentor');
		expect(m.email).toBe(email);
		// The seed admin (or the first real mentor) already holds the admin
		// seat, so a later arrival does not.
		const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from public.mentors where is_admin and deactivated_at is null`;
		expect(n).toBeGreaterThanOrEqual(1);
		expect(m.is_admin).toBe(false);
	});

	test('the very first mentor is the admin (shown on the seed row, which the trigger created)', async () => {
		const [first] = await sql<{ is_admin: boolean }[]>`
			select is_admin from public.mentors order by created_at asc limit 1`;
		expect(first.is_admin).toBe(true);
	});

	test('mixed-case email is stored lowercased', async () => {
		const email = `Test-${RUN}-Case@BoscoTech.edu`;
		await googleUser(email);
		const [m] = await sql<{ email: string }[]>`select email from public.mentors where auth_user_id = (select id from auth.users where email = ${email} or email = ${email.toLowerCase()} limit 1)`;
		expect(m.email).toBe(email.toLowerCase());
	});
});

describe('through GoTrue', () => {
	test('public email/password sign-up with an outside address is refused by the database', async () => {
		const email = `signup-${RUN}@gmail.com`;
		const { data, error } = await anonClient().auth.signUp({ email, password: 'longenough1' });
		expect(error).not.toBeNull();
		expect(data.session).toBeNull();
		expect(await userCount(email)).toBe(0);
	});

	test('public sign-up with an @fll.invalid address is refused', async () => {
		const email = `zzzzzz-signup${RUN}@fll.invalid`;
		const { error } = await anonClient().auth.signUp({ email, password: '123456' });
		expect(error).not.toBeNull();
		expect(await userCount(email)).toBe(0);
	});

	test('public sign-up with a boscotech.edu address (email provider) is refused', async () => {
		const email = `test-${RUN}-signup@boscotech.edu`;
		const { error } = await anonClient().auth.signUp({ email, password: 'longenough1' });
		expect(error).not.toBeNull();
		expect(await userCount(email)).toBe(0);
	});

	test('the admin API cannot create an outside Google user either', async () => {
		const email = `admin-${RUN}@gmail.com`;
		const { error } = await serviceClient().auth.admin.createUser({
			email,
			email_confirm: true,
			app_metadata: { provider: 'google', providers: ['google'] }
		});
		expect(error).not.toBeNull();
		expect(await userCount(email)).toBe(0);
	});
});

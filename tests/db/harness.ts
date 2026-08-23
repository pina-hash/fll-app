// tests/db/harness.ts
//
// The test harness runs against the REAL local Supabase stack (`supabase
// start`), not an embedded Postgres: the claims this repo makes -- a bcrypt hash
// written from SQL signs in through GoTrue, a column with no grant is refused
// by PostgREST, a trigger on auth.users rejects a Google sign-in -- are claims
// about those services, and only those services can confirm them.
//
// Three ways in:
//   sql        -- postgres.js as `postgres`: bypasses RLS. Seeding and raw
//                 catalog assertions only.
//   asRole     -- ONE transaction with request.jwt.claims set and `set local
//                 role`, the way PostgREST runs a statement. For SQLSTATE-level
//                 assertions (42501, 23P01, ...).
//   signIn     -- a supabase-js client holding a real GoTrue session, the way a
//                 device does. For end-to-end proof through Kong/PostgREST.
//
// Every file creates its own mentor and teams with a run-unique suffix and
// removes them in afterAll via cleanupRun(); the database is shared across
// files, which is why vitest runs files serially (vitest.config.ts).

import postgres from 'postgres';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/lib/supabase/database.types';
import { studentEmail } from '../../src/lib/auth/student-identity';

export type Db = Database;
export type Client = SupabaseClient<Database>;

function required(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(
			`${name} is not set. Tests read .env.test (loaded by vitest.config.ts), which holds the local stack's default keys.`
		);
	}
	return value;
}

export const LOCAL = {
	url: required('PUBLIC_SUPABASE_URL'),
	anonKey: required('PUBLIC_SUPABASE_ANON_KEY'),
	serviceKey: required('SUPABASE_SERVICE_ROLE_KEY'),
	dbUrl: required('SUPABASE_DB_URL')
};

/** Runs as `postgres`. Bypasses RLS. */
export const sql = postgres(LOCAL.dbUrl, { max: 4, onnotice: () => {} });

/** A run-unique suffix so files never collide with each other or a previous run. */
export const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const clientOptions = {
	auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
} as const;

/** A client with no session at all: what the login screen has before sign-in. */
export function anonClient(): Client {
	return createClient<Database>(LOCAL.url, LOCAL.anonKey, clientOptions);
}

/** The service role. Bypasses RLS; the positive control for every denial. */
export function serviceClient(): Client {
	return createClient<Database>(LOCAL.url, LOCAL.serviceKey, clientOptions);
}

/** A client holding a real GoTrue session for email + password. Throws on failure. */
export async function signIn(email: string, password: string): Promise<Client> {
	const client = anonClient();
	const { error } = await client.auth.signInWithPassword({ email, password });
	if (error) throw new Error(`sign-in as ${email} failed: ${error.message}`);
	return client;
}

/** The sign-in error, or null if it unexpectedly succeeded. */
export async function signInError(email: string, password: string): Promise<string | null> {
	const client = anonClient();
	const { error } = await client.auth.signInWithPassword({ email, password });
	return error ? error.message : null;
}

export type Claims = { sub?: string; role?: string; email?: string } | null;

/**
 * One transaction as `authenticated` (or `anon`) with the given JWT claims,
 * exactly as PostgREST sets them. A failing statement rejects the whole call.
 */
export async function asRole<T>(
	role: 'authenticated' | 'anon',
	claims: Claims,
	fn: (tx: postgres.TransactionSql) => Promise<T>
): Promise<T> {
	return sql.begin(async (tx) => {
		await tx`select set_config('request.jwt.claims', ${JSON.stringify({ role, ...(claims ?? {}) })}, true)`;
		await tx.unsafe(`set local role ${role}`);
		return fn(tx);
	}) as Promise<T>;
}

/** Shorthand: a transaction as the signed-in user with this auth user id. */
export function asUser<T>(authUserId: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
	return asRole('authenticated', { sub: authUserId }, fn);
}

/** Fails loudly if the statement SUCCEEDS; otherwise hands back the error. */
export async function captureError(run: () => Promise<unknown>): Promise<{ code?: string; message: string }> {
	try {
		await run();
	} catch (error) {
		const e = error as { code?: string; message?: string };
		return { code: e.code, message: e.message ?? String(error) };
	}
	throw new Error('Expected this statement to be rejected, but it succeeded.');
}

/** A supabase-js result that MUST carry an error; returns it. */
export function expectPostgrestError(result: { error: { code?: string; message: string } | null }) {
	if (!result.error) throw new Error('Expected a PostgREST error, but the call succeeded.');
	return result.error;
}

export interface SeededMentor {
	authUserId: string;
	mentorId: string;
	email: string;
	password: string;
	client: Client;
}

/**
 * Creates a mentor the way a Google sign-in does: an auth.users row with
 * provider 'google' on a boscotech.edu address, which fires 0002's trigger.
 * A password is set too so the tests can sign in through GoTrue without
 * Google. `password` may be omitted to create a mentor that cannot sign in.
 */
export async function seedMentor(label: string, opts: { password?: string } = {}): Promise<SeededMentor> {
	const password = opts.password ?? `pw-${RUN}-${label}`;
	const email = `test-${RUN}-${label}@boscotech.edu`;
	const [{ id: authUserId }] = await sql<{ id: string }[]>`
		insert into auth.users (
			instance_id, id, aud, role, email, encrypted_password,
			email_confirmed_at, confirmation_token, recovery_token,
			email_change_token_new, email_change, email_change_token_current, email_change_confirm_status,
			phone_change, phone_change_token, reauthentication_token,
			raw_app_meta_data, raw_user_meta_data,
			is_super_admin, is_sso_user, is_anonymous, created_at, updated_at
		) values (
			'00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
			${email}, extensions.crypt(${password}, extensions.gen_salt('bf', 10)),
			now(), '', '', '', '', '', 0, '', '', '',
			${sql.json({ provider: 'google', providers: ['google'] })},
			${sql.json({ full_name: `Test Mentor ${label}` })},
			false, false, false, now(), now()
		)
		returning id`;
	const [{ id: mentorId }] = await sql<{ id: string }[]>`
		select id from public.mentors where auth_user_id = ${authUserId}`;
	const client = await signIn(email, password);
	return { authUserId, mentorId, email, password, client };
}

export interface SeededTeam {
	teamId: string;
	name: string;
	joinCode: string;
}

export async function createTeam(mentor: Client, label: string): Promise<SeededTeam> {
	const { data, error } = await mentor.rpc('team_create', { p_name: `Test ${RUN} ${label}` });
	if (error) throw new Error(`team_create failed: ${error.message}`);
	const row = data as { team_id: string; name: string; join_code: string };
	return { teamId: row.team_id, name: row.name, joinCode: row.join_code };
}

export interface SeededStudent {
	studentId: string;
	authUserId: string;
	teamId: string;
	firstName: string;
	lastInitial: string;
	slug: string;
	email: string;
	pin: string;
}

export async function createStudent(
	mentor: Client,
	team: SeededTeam,
	firstName: string,
	lastInitial: string,
	opts: { pin?: string; grade?: number } = {}
): Promise<SeededStudent> {
	const pin = opts.pin ?? '246810';
	const { data, error } = await mentor.rpc('student_create', {
		p_team_id: team.teamId,
		p_first_name: firstName,
		p_last_initial: lastInitial,
		p_grade: opts.grade ?? 6,
		p_pin: pin
	});
	if (error) throw new Error(`student_create failed: ${error.message}`);
	const row = data as { student_id: string; slug: string; email: string };
	const [{ auth_user_id }] = await sql<{ auth_user_id: string }[]>`
		select auth_user_id from public.students where id = ${row.student_id}`;
	const email = studentEmail(team.joinCode, row.slug);
	if (email !== row.email) {
		throw new Error(`client and database disagree on the address: ${email} vs ${row.email}`);
	}
	return {
		studentId: row.student_id,
		authUserId: auth_user_id,
		teamId: team.teamId,
		firstName,
		lastInitial,
		slug: row.slug,
		email,
		pin
	};
}

/**
 * Removes everything this run created, in dependency order. Teams are matched
 * by their run-tagged name, mentors and students by their run-tagged or
 * team-derived address.
 */
export async function cleanupRun(): Promise<void> {
	const teamIds = (await sql<{ id: string }[]>`select id from public.teams where name like ${'Test ' + RUN + ' %'}`).map(
		(r) => r.id
	);
	const mentorAuthIds = (
		await sql<{ auth_user_id: string }[]>`
			select auth_user_id from public.mentors where email like ${'test-' + RUN + '-%'}`
	).map((r) => r.auth_user_id);
	const mentorIds = (
		await sql<{ id: string }[]>`select id from public.mentors where auth_user_id = any(${mentorAuthIds}::uuid[])`
	).map((r) => r.id);

	await sql.begin(async (tx) => {
		if (teamIds.length) {
			await tx`delete from public.evidence where team_id = any(${teamIds}::uuid[])`;
			await tx`delete from public.blockers where team_id = any(${teamIds}::uuid[])`;
			await tx`delete from public.tasks where team_id = any(${teamIds}::uuid[])`;
			await tx`delete from public.role_assignments where team_id = any(${teamIds}::uuid[])`;
			await tx`delete from public.attendance a using public.students s
				where a.student_id = s.id and s.team_id = any(${teamIds}::uuid[])`;
		}
		if (mentorIds.length) {
			await tx`delete from public.tasks where created_by_mentor_id = any(${mentorIds}::uuid[])`;
			await tx`update public.blockers set resolved_by_mentor_id = null where resolved_by_mentor_id = any(${mentorIds}::uuid[])`;
			await tx`delete from public.meetings where created_by = any(${mentorIds}::uuid[])`;
		}
		if (teamIds.length) {
			// Students' auth users cascade to public.students.
			await tx`delete from auth.users u using public.students s
				where s.auth_user_id = u.id and s.team_id = any(${teamIds}::uuid[])`;
			await tx`delete from public.teams where id = any(${teamIds}::uuid[])`;
		}
		if (mentorAuthIds.length) {
			await tx`delete from auth.users where id = any(${mentorAuthIds}::uuid[])`;
		}
	});
}

/** Closes the postgres pool. Call once per file, after cleanupRun(). */
export async function closeDb(): Promise<void> {
	await sql.end({ timeout: 5 });
}

// tests/schema-catalog.test.ts
//
// THE CATALOG SAYS WHAT THE MIGRATIONS CLAIM. Every public table has RLS on;
// anon holds no table privilege and can execute exactly one function; each RPC
// resolves to exactly one pg_proc row (the signature trap: two overloads that
// differ only by a defaulted parameter make PostgREST unable to call either);
// the five realtime tables are published with full replica identity.

import { afterAll, describe, expect, test } from 'vitest';
import { closeDb, sql } from './db/harness';

afterAll(async () => {
	await closeDb();
});

const TABLES = [
	'attendance',
	'blockers',
	'evidence',
	'meeting_phases',
	'meetings',
	'mentors',
	'phase_templates',
	'role_assignments',
	'students',
	'tasks',
	'teams'
];

const RPCS = [
	'auth_whoami',
	'board_live_summary',
	'meeting_advance_phase',
	'meeting_create',
	'meeting_end',
	'meeting_start',
	'role_assign',
	'role_unassign',
	'student_create',
	'student_deactivate',
	'student_reactivate',
	'student_reset_pin',
	'team_create',
	'team_login_roster',
	'team_regenerate_join_code',
	'team_resolve_roles',
	'is_mentor',
	'is_admin_mentor',
	'current_mentor_id',
	'current_student_id',
	'current_student_team_id'
];

describe('tables', () => {
	test('the eleven tables exist and every one of them has row level security enabled', async () => {
		const rows = await sql<{ relname: string; relrowsecurity: boolean }[]>`
			select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
			where n.nspname = 'public' and c.relkind = 'r' order by 1`;
		expect(rows.map((r) => r.relname)).toEqual(TABLES);
		expect(rows.every((r) => r.relrowsecurity)).toBe(true);
	});

	test('every table has at least one policy (RLS on with no policy is a deny-all, which would be a bug here)', async () => {
		const rows = await sql<{ tablename: string; n: number }[]>`
			select tablename, count(*)::int as n from pg_policies where schemaname = 'public' group by 1 order by 1`;
		expect(rows.map((r) => r.tablename)).toEqual(TABLES);
		expect(rows.every((r) => r.n >= 1)).toBe(true);
	});

	test('anon holds no table or column privilege anywhere in public', async () => {
		const tables = await sql`select 1 from information_schema.table_privileges where table_schema = 'public' and grantee = 'anon'`;
		expect(tables).toHaveLength(0);
		const columns = await sql`select 1 from information_schema.column_privileges where table_schema = 'public' and grantee = 'anon'`;
		expect(columns).toHaveLength(0);
	});

	test('server-owned columns carry no INSERT/UPDATE grant for authenticated', async () => {
		const rows = await sql<{ table_name: string; column_name: string; privilege_type: string }[]>`
			select table_name, column_name, privilege_type from information_schema.column_privileges
			where table_schema = 'public' and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE')
			  and (table_name, column_name) in (
				('evidence', 'upload_timestamp'),
				('tasks', 'closed_at'), ('tasks', 'created_at'), ('tasks', 'updated_at'),
				('blockers', 'raised_at'), ('blockers', 'updated_at'),
				('attendance', 'checked_in_at'),
				('mentors', 'auth_user_id'), ('mentors', 'email'),
				('students', 'auth_user_id'), ('students', 'slug'), ('students', 'team_id'), ('students', 'deactivated_at'),
				('teams', 'join_code')
			  )`;
		// attendance.checked_in_at is UPDATE-granted on purpose (a mentor corrects a stamp); nothing else is.
		expect(rows).toEqual([{ table_name: 'attendance', column_name: 'checked_in_at', privilege_type: 'UPDATE' }]);
	});
});

describe('functions', () => {
	test('anon can execute exactly team_login_roster', async () => {
		const rows = await sql<{ proname: string }[]>`
			select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
			where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1`;
		expect(rows.map((r) => r.proname)).toEqual(['team_login_roster']);
	});

	test('each RPC and helper resolves to exactly one pg_proc row', async () => {
		for (const name of RPCS) {
			const [{ n }] = await sql<{ n: number }[]>`
				select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
				where n.nspname = 'public' and p.proname = ${name}`;
			expect({ name, n }).toEqual({ name, n: 1 });
		}
	});

	test('every SECURITY DEFINER function pins search_path', async () => {
		const rows = await sql<{ proname: string; proconfig: string[] | null }[]>`
			select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
			where n.nspname = 'public' and p.prosecdef`;
		expect(rows.length).toBeGreaterThan(0);
		for (const r of rows) {
			expect({ fn: r.proname, pinned: (r.proconfig ?? []).some((c) => c.startsWith('search_path=')) }).toEqual({
				fn: r.proname,
				pinned: true
			});
		}
	});

	test('private helpers (underscore-prefixed) are executable by nobody but the owner', async () => {
		const rows = await sql<{ proname: string; anon: boolean; authed: boolean }[]>`
			select p.proname,
			       has_function_privilege('anon', p.oid, 'execute') as anon,
			       has_function_privilege('authenticated', p.oid, 'execute') as authed
			from pg_proc p join pg_namespace n on n.oid = p.pronamespace
			where n.nspname = 'public' and p.proname like '\\_%'`;
		expect(rows.length).toBeGreaterThan(0);
		for (const r of rows) {
			expect({ fn: r.proname, anon: r.anon, authed: r.authed }).toEqual({ fn: r.proname, anon: false, authed: false });
		}
	});
});

describe('realtime', () => {
	test('meetings, meeting_phases, tasks, blockers and attendance are published with full replica identity', async () => {
		const published = await sql<{ tablename: string }[]>`
			select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' order by 1`;
		expect(published.map((r) => r.tablename)).toEqual(['attendance', 'blockers', 'meeting_phases', 'meetings', 'tasks']);
		const identity = await sql<{ relname: string; relreplident: string }[]>`
			select relname, relreplident from pg_class
			where relname in ('attendance', 'blockers', 'meeting_phases', 'meetings', 'tasks') order by 1`;
		expect(identity.every((r) => r.relreplident === 'f')).toBe(true);
	});
});

describe('seed', () => {
	test('every live team has an accent, and the four seeded teams have four different ones', async () => {
		const rows = await sql<{ name: string; accent: string }[]>`
			select name, accent::text from public.teams
			where name in ('Red Team', 'Blue Team', 'Green Team', 'Gold Team') order by name`;
		expect(rows).toHaveLength(4);
		expect(new Set(rows.map((r) => r.accent)).size).toBe(4);
		// The stylesheet keys off these four strings and nothing else.
		expect(rows.every((r) => ['cyan', 'chartreuse', 'magenta', 'amber'].includes(r.accent))).toBe(true);
		const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from public.teams where accent is null`;
		expect(n).toBe(0);
	});

	test('the local seed left one admin mentor, four teams and both phase templates', async () => {
		const [{ admins }] = await sql<{ admins: number }[]>`select count(*)::int as admins from public.mentors where is_admin`;
		expect(admins).toBeGreaterThanOrEqual(1);
		const teams = await sql<{ join_code: string }[]>`select join_code from public.teams where name in ('Red Team', 'Blue Team', 'Green Team', 'Gold Team')`;
		expect(teams).toHaveLength(4);
		expect(teams.every((t) => /^[A-HJ-NP-Z2-9]{6}$/.test(t.join_code))).toBe(true);
		const totals = await sql<{ kind: string; minutes: number }[]>`
			select kind::text, sum(planned_minutes)::int as minutes from public.phase_templates group by 1 order by 1`;
		expect(totals).toEqual([
			{ kind: 'friday', minutes: 90 },
			{ kind: 'saturday', minutes: 120 }
		]);
	});
});

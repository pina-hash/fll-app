// tests/schema-catalog.test.ts
//
// THE CATALOG SAYS WHAT THE MIGRATIONS CLAIM. Every public table has RLS on;
// anon holds no table privilege at all and can execute only the handful of
// functions listed below; each RPC resolves to exactly one pg_proc row (the
// signature trap: two overloads that differ only by a defaulted parameter make
// PostgREST unable to call either); every published table carries full replica
// identity.

import { afterAll, describe, expect, test } from 'vitest';
import { closeDb, sql } from './db/harness';

afterAll(async () => {
	await closeDb();
});

const TABLES = [
	'attendance',
	'blockers',
	'evidence',
	'launch_missions',
	'launches',
	'mat_config',
	'mat_images',
	'match_run_launches',
	'match_run_scores',
	'match_runs',
	'meeting_phases',
	'meeting_recaps',
	'meetings',
	'mentors',
	'missions',
	'notebook_entries',
	'phase_templates',
	'role_assignments',
	'strategies',
	'student_parent_access',
	'students',
	'tasks',
	'team_board_devices',
	'team_mission_notes',
	'team_robots',
	'teams',
	'waypoints'
];

const RPCS = [
	'auth_whoami',
	'board_live_summary',
	'match_run_history',
	'parent_access_issue',
	'parent_access_revoke',
	'parent_photo_path',
	'parent_view',
	'meeting_current',
	'meeting_advance_phase',
	'notebook_can_edit',
	'notebook_season_stats',
	'meeting_create',
	'meeting_end',
	'meeting_start',
	'role_assign',
	'role_unassign',
	'student_create',
	'student_deactivate',
	'student_move_team',
	'student_self_enroll',
	'student_reactivate',
	'student_reset_pin',
	'strategy_can_edit',
	'strategy_snapshot',
	'team_board_disable',
	'team_board_enable',
	'team_create',
	'team_join_open',
	'team_join_window_close',
	'team_join_window_open',
	'team_login_roster',
	'team_regenerate_join_code',
	'team_resolve_roles',
	'team_roster_state',
	'team_size_cap',
	'is_mentor',
	'is_admin_mentor',
	'current_board_team_id',
	'current_mentor_id',
	'current_student_id',
	'current_student_team_id'
];

describe('tables', () => {
	test('every table exists and every one of them has row level security enabled', async () => {
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
				('teams', 'join_code'), ('teams', 'join_open_since'), ('teams', 'join_open_meeting_id'),
				('match_runs', 'points'), ('match_run_scores', 'points'),
				('student_parent_access', 'token'), ('student_parent_access', 'revoked_at'),
					('meeting_recaps', 'draft'), ('meeting_recaps', 'confirmed_at'),
					('meeting_recaps', 'confirmed_by_student_id'), ('meeting_recaps', 'confirmed_by_mentor_id'),
					('meeting_recaps', 'created_at'), ('meeting_recaps', 'updated_at'),
					('notebook_entries', 'created_at'), ('notebook_entries', 'updated_at')
			  )`;
		// attendance.checked_in_at is UPDATE-granted on purpose (a mentor corrects a stamp); nothing else is.
		expect(rows).toEqual([{ table_name: 'attendance', column_name: 'checked_in_at', privilege_type: 'UPDATE' }]);
	});
});

describe('functions', () => {
	// anon's reach is five functions and no table, and each one is a door the
	// spec asked for: the login roster (0004), the two halves of the parent
	// view (0014), self-enrollment (0013) and the cap the login screen prints.
	// Adding a sixth is a decision, not an accident, which is what this list
	// is for.
	test('anon can execute exactly the five public doors, and nothing else', async () => {
		const rows = await sql<{ proname: string }[]>`
			select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
			where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1`;
		expect(rows.map((r) => r.proname)).toEqual([
			'parent_photo_path',
			'parent_view',
			'student_self_enroll',
			'team_login_roster',
			'team_size_cap'
		]);
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
	// 0008's five, plus students and teams (0013): the console's roster pane
	// has to fill in as children sign themselves up, and the join-window pill
	// has to agree across two mentors' laptops.
	test('the seven published tables carry full replica identity', async () => {
		const expected = [
			'attendance',
			'blockers',
			'meeting_phases',
			'meetings',
			'students',
			'tasks',
			'teams'
		];
		const published = await sql<{ tablename: string }[]>`
			select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' order by 1`;
		expect(published.map((r) => r.tablename)).toEqual(expected);
		const identity = await sql<{ relname: string; relreplident: string }[]>`
			select relname, relreplident from pg_class
			where relname = any(${expected}) order by 1`;
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

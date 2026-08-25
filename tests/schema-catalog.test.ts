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
import {
	linkedAvailable,
	linkedRef,
	linkedUnavailableReason,
	remoteCatalogQuery,
	warnLinkedSkipped
} from './db/linked';

// The five doors, in one place, asserted against BOTH databases below. Adding
// a sixth is a decision, not an accident, and it has to be made twice.
const PUBLIC_DOORS = [
	'parent_photo_path',
	'parent_view',
	'student_claim_seat',
	'team_login_roster',
	'team_size_cap'
];

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
	'student_claim_codes',
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
	'notebook_bin',
	'notebook_entry_delete',
	'notebook_entry_restore',
	'meeting_create',
	'meeting_end',
	'meeting_cancel',
	'meeting_restore',
	'meeting_reopen',
	'meeting_phase_reorder',
	'meeting_recap_regenerate',
	'meeting_start',
	'role_assign',
	'role_unassign',
	'student_create',
	'student_deactivate',
	'student_move_team',
	'student_claim_seat',
	'student_reactivate',
	'student_reset_pin',
	'strategy_can_edit',
	'strategy_snapshot',
	'team_board_disable',
	'team_board_enable',
	'team_create',
	'team_archive',
	'team_restore',
	'team_claim_codes',
	'team_claim_codes_issue',
	'team_claim_code_void',
	'team_claim_code_reissue',
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
				('teams', 'join_code'),
				('meetings', 'cancelled_at'), ('meetings', 'cancelled_by_mentor_id'),
				('notebook_entries', 'deleted_at'),
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
		expect(rows.map((r) => r.proname)).toEqual(PUBLIC_DOORS);
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

// ---------------------------------------------------------------------------
// THE SAME ASSERTIONS, AGAINST THE DATABASE WHERE THEY CAN ACTUALLY FAIL.
//
// Everything above this line runs against the local stack, which is built
// from the migration chain and nothing else. That is the one environment
// where a stray grant cannot appear, so those assertions could only ever
// pass. They did, for twenty migrations, while the linked project had anon
// executing all 85 functions in `public` (fixed by 0021) and `authenticated`
// executing all 26 private helpers (fixed by 0022).
//
// A hosted project carries ALTER DEFAULT PRIVILEGES the local image does not,
// so every `create function` there arrives already granted. Nothing in
// `supabase/` asks for that and nothing in `supabase/` can see it. The only
// way to know is to look at production.
//
// Skipped LOUDLY when there is no token. The announcement below is a real
// test rather than a module-level console.warn because vitest's reporter
// swallows output written during collection: the first version of this file
// warned into the void and the run printed a bare "5 skipped", which is the
// silent skip this block exists to end.
// ---------------------------------------------------------------------------
describe('grants on the linked project', () => {
	// ALWAYS runs, whether or not there is a token. Its whole job is to make
	// the difference between "checked production" and "did not check
	// production" impossible to miss in the output.
	test('this run states whether production was checked at all', () => {
		const reason = linkedUnavailableReason();
		if (reason) {
			warnLinkedSkipped('grants on the linked project');
		} else {
			process.stderr.write(`
linked project ${linkedRef} reachable: grant assertions below ran against production.

`);
		}
		// The assertion is that the run KNOWS which of the two happened, and
		// said so. Both outcomes are legitimate; a run that cannot tell them
		// apart is not.
		expect(reason === null || reason.length > 0).toBe(true);
	});
});

describe.skipIf(!linkedAvailable)(`grants on the linked project (${linkedRef ?? 'unlinked'})`, () => {
	test('anon can execute exactly the five public doors, and nothing else', async () => {
		const rows = await remoteCatalogQuery<{ proname: string }>(
			`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
			 where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')
			 order by 1`
		);
		expect(rows.map((r) => r.proname)).toEqual(PUBLIC_DOORS);
	});

	test('private helpers are executable by neither anon nor authenticated', async () => {
		const rows = await remoteCatalogQuery<{ proname: string; anon: boolean; authed: boolean }>(
			`select p.proname,
			        has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
			        has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed
			 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
			 where n.nspname = 'public' and p.proname like '\\_%'
			 order by 1`
		);
		// Positive control on the query itself: an empty result would pass the
		// loop below without measuring anything, which is the shape of bug this
		// whole block is here to prevent.
		expect(rows.length).toBeGreaterThan(0);
		for (const r of rows) {
			expect({ fn: r.proname, anon: r.anon, authed: r.authed }).toEqual({
				fn: r.proname,
				anon: false,
				authed: false
			});
		}
	});

	test('anon holds no table or column privilege anywhere in public', async () => {
		const tables = await remoteCatalogQuery(
			`select 1 from information_schema.table_privileges where table_schema = 'public' and grantee = 'anon'`
		);
		expect(tables.length).toBe(0);
		const columns = await remoteCatalogQuery(
			`select 1 from information_schema.column_privileges where table_schema = 'public' and grantee = 'anon'`
		);
		expect(columns.length).toBe(0);
	});

	test('the hosted default no longer grants EXECUTE to anon or authenticated', async () => {
		// The grants above are the symptom; this is the cause. Without it, the
		// next migration re-opens everything the last two closed and no
		// assertion above would notice until somebody ran this suite again.
		const rows = await remoteCatalogQuery<{ acl: string | null }>(
			`select array_to_string(d.defaclacl, ' | ') as acl
			 from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
			 where n.nspname = 'public' and d.defaclobjtype = 'f'
			   and pg_get_userbyid(d.defaclrole) = 'postgres'`
		);
		expect(rows.length).toBe(1);
		const acl = rows[0].acl ?? '';
		expect({ anon: acl.includes('anon='), authenticated: acl.includes('authenticated=') }).toEqual({
			anon: false,
			authenticated: false
		});
	});

	test('the migration chain is fully applied, so these grants describe the shipped schema', async () => {
		// A grant assertion against a database that is three migrations behind
		// is measuring a schema nobody is running. 0019 and 0020 were applied
		// by hand and left out of the ledger once already.
		const rows = await remoteCatalogQuery<{ version: string }>(
			`select version from supabase_migrations.schema_migrations order by version`
		);
		const applied = rows.map((r) => r.version);
		expect(applied).toContain('0021');
		expect(applied).toContain('0022');
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
	test('the four seeded teams are NUMBERED and have chosen no colour', async () => {
		// From 0018 a team chooses its own colour, so the seed hands none out:
		// an assigned colour is not a chosen one. Null is the real state on
		// the first Friday, not a broken row.
		const rows = await sql<{ name: string; accent: string | null }[]>`
			select name, accent::text from public.teams
			where name in ('Team 1', 'Team 2', 'Team 3', 'Team 4') order by name`;
		expect(rows.map((r) => r.name)).toEqual(['Team 1', 'Team 2', 'Team 3', 'Team 4']);
		expect(rows.every((r) => r.accent === null)).toBe(true);
	});

	test('the accent enum is the eleven-colour palette, with red and blue absent', async () => {
		// The stylesheet keys off these eleven strings and nothing else, and
		// the mat's launch areas are why no red or blue hue is among them
		// (0018's header carries the reasoning).
		const [{ vals }] = await sql<{ vals: string[] }[]>`
			select enum_range(null::public.team_accent)::text[] as vals`;
		expect(vals).toEqual([
			'bark', 'orange', 'olive', 'lime', 'green', 'sage',
			'teal', 'violet', 'purple', 'orchid', 'magenta'
		]);
	});

	test('a colour is taken once: the partial unique index is the enforcer', async () => {
		const [{ n }] = await sql<{ n: number }[]>`
			select count(*)::int as n from pg_indexes
			where schemaname = 'public' and indexname = 'teams_accent_unique_live'`;
		expect(n).toBe(1);
	});

	test('the local seed left one admin mentor, four teams and both phase templates', async () => {
		const [{ admins }] = await sql<{ admins: number }[]>`select count(*)::int as admins from public.mentors where is_admin`;
		expect(admins).toBeGreaterThanOrEqual(1);
		const teams = await sql<{ join_code: string }[]>`select join_code from public.teams where name in ('Team 1', 'Team 2', 'Team 3', 'Team 4')`;
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

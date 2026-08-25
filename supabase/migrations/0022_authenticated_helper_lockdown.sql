-- 0022_authenticated_helper_lockdown.sql
--
-- THE SAME HOSTED DEFAULT THAT GAVE `anon` EXECUTE ON EVERYTHING ALSO GAVE IT
-- TO `authenticated`, AND 0021 ONLY CLOSED THE FIRST HALF. On the linked
-- project all 26 underscore-prefixed private helpers in `public` are
-- executable by `authenticated`. On the local stack, which is built from this
-- chain and nothing else, the number is 0. CLAUDE.md has said since 0001 that
-- private helpers are "revoked from public, and granted to nobody".
--
-- Applied by the Supabase CLI, after 0021.
--
-- THIS IS NOT A LIVE EXPOSURE, AND THIS FILE SHOULD NOT PRETEND OTHERWISE.
-- The 29 functions the default over-granted to `authenticated` break down as
-- 14 trigger functions, which PostgREST refuses to call outside a trigger;
-- 14 SECURITY INVOKER helpers, which by construction execute with the
-- CALLER's privileges and under the caller's RLS, so they can confer nothing
-- the caller did not already have; and exactly one SECURITY DEFINER function,
-- `student_claim_seat`, which is a deliberate public door already granted to
-- `anon`, so an authenticated caller gains nothing they could not get by
-- signing out first.
--
-- MEASURED RATHER THAN ARGUED, because "INVOKER cannot escalate" is the kind
-- of claim that is true until somebody grants the caller a table. The worst
-- candidate is `_student_detach_from_team`, which takes any student id, has
-- no caller check at all, and deletes role assignments. Reproduced on a
-- seeded local stack with this file's exact over-grant replicated, signed in
-- as one student against a TEAMMATE on the same team:
--
--   Maya deletes Diego's role_assignments directly ...... 0 rows
--   Maya nulls Diego's task assignments directly ........ 0 rows
--   the same delete as the table owner .................. 2 rows
--   session identity check: current_student_id() = Maya, is_mentor() = false
--
-- The third line is the positive control that makes the first two mean
-- something: the rows exist, so the zeroes are refusals and not an empty
-- table. The fourth is the negative control proving the session really was a
-- student and not an anonymous or mentor caller. `role_assignments` carries
-- exactly one DELETE policy and its qual is `is_mentor()`, so a student's
-- delete matches nothing. The function then dies outright on
-- `permission denied for table match_runs`, because `authenticated` holds no
-- UPDATE there.
--
-- SO WHY CHANGE ANYTHING. Two reasons, neither of them "it might be
-- exploitable".
--
-- FIRST, `tests/schema-catalog.test.ts` asserts that underscore helpers are
-- "executable by nobody but the owner", checking anon AND authenticated. That
-- assertion is correct and it has always passed, because it only ever ran
-- against local. 0023's companion change points it at the linked project, and
-- against the linked project it FAILS on all 26. Aligning the database to the
-- rule the test states is the honest direction. Weakening the test to match a
-- drifted database is not.
--
-- SECOND, and this is the part that actually matters: the default is still
-- open for `authenticated`. Every function a future migration creates on the
-- linked project arrives executable by every signed-in student, mentor and
-- board device. Today's set happens to be triggers and INVOKER helpers. The
-- next private helper somebody writes may well be SECURITY DEFINER, because
-- most of the interesting ones in this schema are, and a DEFINER helper with
-- no caller check that is callable by any student IS an escalation. This file
-- closes the door before that function exists rather than after.
--
-- PROVED SAFE BEFORE REVOKING, because a helper the CALLER has to execute
-- would break the moment this ran. Three ways a helper can be on a caller's
-- path were checked against the linked project and all three came back empty:
-- no column DEFAULT names a `public._` function, no RLS policy names one
-- (policies here name `is_mentor` and the `current_*` helpers, none of which
-- are underscore-prefixed), and no CHECK constraint names one. Everything
-- else calls them from inside a DEFINER function or a trigger, both of which
-- run as the owner and need no grant. Local has held exactly this shape since
-- 0001 with the suite green.
--
-- WHAT THIS FILE DOES NOT DO. It leaves `service_role` alone: that is the
-- admin key, it is expected to reach everything, and the one module that
-- holds it fetches rather than decides. It does not touch the 14 trigger
-- functions' or `student_claim_seat`'s `authenticated` grant, because the
-- rule being restored is about underscore-prefixed private helpers, not about
-- reshaping every grant on the linked project to match local exactly. It does
-- not touch the table and sequence defaults; see 0021 section 5, still true.
--
-- ===========================================================================
-- TO UNDO
-- ===========================================================================
--
--   -- Put back the hosted default:
--   alter default privileges for role postgres in schema public
--     grant execute on functions to authenticated;
--
--   -- Put back the grant on the helpers that exist today:
--   do $$
--   declare r record;
--   begin
--     for r in select p.oid::regprocedure as sig
--              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--              where n.nspname = 'public' and p.proname like '\_%'
--     loop
--       execute format('grant execute on function %s to authenticated', r.sig);
--     end loop;
--   end;
--   $$;

-- ---------------------------------------------------------------------------
-- 1. REVOKE, ONE HELPER AT A TIME AND BY NAME.
--
--    Not `revoke execute on all functions in schema public from
--    authenticated`, which would also strip the 56 public RPCs this chain
--    grants on purpose and take the whole console down. The sweep is scoped
--    to the underscore prefix, which is the repo's own marker for "private",
--    so it cannot reach a function a client is meant to call.
--
--    Idempotent: revoking a privilege nobody holds is a no-op, so this file
--    is a no-op on local, where the count is already 0.
-- ---------------------------------------------------------------------------
do $$
declare
	r record;
	v_n integer := 0;
begin
	for r in
		select p.oid::regprocedure as sig
		from pg_proc p
		join pg_namespace n on n.oid = p.pronamespace
		where n.nspname = 'public'
			and p.proname like '\_%'
		order by 1
	loop
		execute format('revoke execute on function %s from authenticated', r.sig);
		v_n := v_n + 1;
	end loop;

	raise notice '0022: swept authenticated EXECUTE from % private helpers.', v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. CLOSE THE SOURCE, THE OTHER HALF OF 0021 SECTION 3.
--
--    Without this the next `create function` on the linked project arrives
--    executable by every signed-in caller again, and section 1 becomes a
--    cleanup somebody has to remember to repeat. Local already behaves this
--    way, so this is what makes the two agree going forward rather than
--    only today.
--
--    Only `postgres` is addressed, for the reason 0021 gave: migrations
--    create objects as `postgres`, and the `supabase_admin` default belongs
--    to the platform.
-- ---------------------------------------------------------------------------
alter default privileges for role postgres in schema public
	revoke execute on functions from authenticated;

-- ---------------------------------------------------------------------------
-- 3. PROVE IT, AND PROVE THE SWEEP DID NOT GO TOO FAR.
--
--    Two assertions, because only checking that the helpers are closed would
--    pass just as happily if this file had revoked EXECUTE from the entire
--    schema and left a mentor unable to open the live board. The second
--    assertion is the one that would catch that.
-- ---------------------------------------------------------------------------
do $$
declare
	v_open_helpers integer;
	v_leftover text;
	v_public_rpcs integer;
begin
	select count(*), coalesce(string_agg(p.proname, ', ' order by p.proname), '(none)')
	into v_open_helpers, v_leftover
	from pg_proc p
	join pg_namespace n on n.oid = p.pronamespace
	where n.nspname = 'public'
		and p.proname like '\_%'
		and (has_function_privilege('anon', p.oid, 'EXECUTE')
			or has_function_privilege('authenticated', p.oid, 'EXECUTE'));

	if v_open_helpers <> 0 then
		raise exception
			'0022 refuses: % private helpers are still executable by anon or authenticated after the sweep (%).',
			v_open_helpers, v_leftover;
	end if;

	-- The console has to still work. These four are load bearing on four
	-- different screens and none of them is underscore-prefixed, so a
	-- correctly scoped sweep leaves all four alone.
	select count(*)
	into v_public_rpcs
	from pg_proc p
	join pg_namespace n on n.oid = p.pronamespace
	where n.nspname = 'public'
		and p.proname in ('board_live_summary', 'meeting_start', 'auth_whoami', 'team_resolve_roles')
		and has_function_privilege('authenticated', p.oid, 'EXECUTE');

	if v_public_rpcs <> 4 then
		raise exception
			'0022 refuses: the sweep reached past the private helpers. Only % of 4 sampled public RPCs are still executable by authenticated.',
			v_public_rpcs;
	end if;

	raise notice '0022: 0 private helpers open, 4 of 4 sampled public RPCs intact.';
end;
$$;

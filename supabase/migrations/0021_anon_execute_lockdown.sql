-- 0021_anon_execute_lockdown.sql
--
-- THE LINKED PROJECT HANDED `anon` EXECUTE ON ALL 85 FUNCTIONS IN `public`,
-- AND NOTHING IN THIS CHAIN ASKED IT TO. CLAUDE.md has said since 0013 that
-- anon can execute exactly FIVE functions and that a sixth is a decision
-- rather than an accident. On the local stack that is true and measurable:
-- 5 of 85. On the linked project it was 85 of 85, and had been since 0001.
--
-- Applied by the Supabase CLI, after 0020.
--
-- WHY THE TWO ENVIRONMENTS DISAGREED, WHICH IS THE WHOLE POINT OF THIS FILE.
-- A hosted Supabase project ships with default privileges the local CLI image
-- does not carry. Measured, same query against both:
--
--   local  pg_default_acl, objtype 'f', grantor postgres:
--          postgres=X/postgres
--   linked pg_default_acl, objtype 'f', grantor postgres:
--          postgres=X/postgres | anon=X/postgres
--                              | authenticated=X/postgres
--                              | service_role=X/postgres
--
-- Migrations connect as `postgres`, so on the linked project every
-- `create function` in this chain silently acquired an explicit `anon=X`
-- grant at creation time. The chain never ran ALTER DEFAULT PRIVILEGES
-- anywhere (`grep -rn "default privileges" supabase/` is empty), so this was
-- never ours; it is the hosted project's own bootstrap, and it will do the
-- same to the next function anybody writes.
--
-- THE `revoke all ... from public` ON EVERY RPC DID NOT AND COULD NOT CATCH
-- THIS. That statement removes PUBLIC's implicit grant. The default privilege
-- above is an EXPLICIT grant to the `anon` role, and revoking from PUBLIC
-- does not touch a named role. Both statements are correct and neither one
-- was ever going to see the other. That is why this file revokes from `anon`
-- by name, and why it also neutralises the default so the next migration does
-- not re-open what this one closes.
--
-- WHY THE TESTS DID NOT CATCH IT EITHER, WRITTEN DOWN RATHER THAN HIDDEN.
-- `tests/schema-catalog.test.ts` asserts the five-function list, and it is a
-- correct assertion. It runs against the local stack, which is the one
-- environment where the bug cannot occur. A test that can only pass is not a
-- control. Making that assertion run against the linked project is a task in
-- its own right and is NOT done here.
--
-- WHAT WAS ACTUALLY REACHABLE, BECAUSE "granted" AND "exploitable" ARE NOT
-- THE SAME CLAIM AND THIS FILE SHOULD NOT OVERSTATE ITS OWN IMPORTANCE.
-- Measured against the linked project with its real anon key, every writer
-- refused: team_create, student_create, student_reset_pin,
-- team_regenerate_join_code, meeting_cancel, team_archive,
-- team_claim_codes_issue, team_set_short_name, team_confirm_accent,
-- strategy_snapshot, notebook_entry_delete. Two things saved them. Every
-- definer RPC re-checks its own caller in its own body, and `is_mentor()` is
-- `select exists (...)`, which cannot return NULL, so the bare
-- `if not public.is_mentor()` form in 0003 and 0004 fires instead of falling
-- through the way CLAUDE.md warns a NULL-returning gate does. The private
-- `_` helpers are SECURITY INVOKER, so they ran as `anon` and died on the
-- table grants that this chain does state correctly.
--
-- What did answer anon: `_student_email`, `_student_slug_base`,
-- `_generate_claim_code`, `_generate_join_code` (pure functions, no table
-- access, so INVOKER did not save them) and `team_accent_options`, which is
-- the only DEFINER function in `public` with no caller check of any kind,
-- direct or delegated. So the exposure was one real read and four pieces of
-- derivable arithmetic, not a hole in the roster. It is still not a set of
-- doors anybody chose to open.
--
-- WHAT THIS FILE DOES NOT DO. It does not touch `authenticated`. The same
-- default over-granted 29 functions to `authenticated` that the chain does
-- not grant it (linked: 85, local: 56), and those are mostly the private `_`
-- helpers. That is a real divergence and it is reported, not fixed here:
-- `authenticated` is a signed-in mentor, student or board device, every
-- definer RPC re-checks which of those it is, and the INVOKER helpers get
-- RLS. Widening this file to reshape 29 more grants would make a security
-- fix into a refactor. It also does not touch the table and sequence
-- defaults, which carry the same shape; see the note at the end.
--
-- ===========================================================================
-- TO UNDO
-- ===========================================================================
--
--   -- Put back the hosted default, and with it the original condition:
--   alter default privileges for role postgres in schema public
--     grant execute on functions to anon;
--
--   -- Put back the blanket grant on everything that exists today:
--   grant execute on all functions in schema public to anon;
--
-- Undoing this file restores the over-grant. There is no state between the
-- two worth keeping, which is why the undo is two statements and not a list.

-- ---------------------------------------------------------------------------
-- 1. REFUSE IF THE FIVE DOORS ARE NOT ALL HERE.
--
--    This file is going to revoke EXECUTE from anon across the whole schema
--    and then hand back exactly five grants. If one of those five has been
--    renamed or given a parameter since 0019, the re-grant below would fail
--    to match it and the sweep would lock out the login screen or the parent
--    link. Count them first and raise with the names, per CLAUDE.md: a
--    migration refuses rather than destroys.
-- ---------------------------------------------------------------------------
do $$
declare
	v_expected text[] := array[
		'team_login_roster(p_join_code text)',
		'student_claim_seat(p_claim_code text, p_first_name text, p_last_initial text, p_grade smallint, p_pin text)',
		'team_size_cap()',
		'parent_view(p_token text)',
		'parent_photo_path(p_token text, p_evidence_id uuid)'
	];
	v_found text[];
	v_missing text[];
begin
	select coalesce(array_agg(sig order by sig), '{}')
	into v_found
	from (
		select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig
		from pg_proc p
		join pg_namespace n on n.oid = p.pronamespace
		where n.nspname = 'public'
	) s
	where s.sig = any(v_expected);

	select coalesce(array_agg(e order by e), '{}')
	into v_missing
	from unnest(v_expected) e
	where e <> all(v_found);

	if array_length(v_missing, 1) is not null then
		raise exception
			'0021 refuses: % of the 5 public doors are not in this schema under the signature this file expects (%). Revoking now would lock anon out of the login screen or the parent link. Reconcile the signatures first.',
			array_length(v_missing, 1), array_to_string(v_missing, '; ');
	end if;

	raise notice '0021: all 5 public doors present, proceeding.';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. THE SWEEP.
--
--    Revoke from the whole schema, then hand back the five. Doing it in that
--    order rather than revoking a computed list of eighty means this file
--    states the ALLOW LIST, which is the thing a reviewer should be reading,
--    and it stays correct if somebody adds a function tomorrow without
--    reading this header.
--
--    Idempotent: revoking a privilege nobody holds and granting one already
--    held are both no-ops.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from anon;

grant execute on function public.team_login_roster(text) to anon;
grant execute on function public.student_claim_seat(text, text, text, smallint, text) to anon;
grant execute on function public.team_size_cap() to anon;
grant execute on function public.parent_view(text) to anon;
grant execute on function public.parent_photo_path(text, uuid) to anon;

-- ---------------------------------------------------------------------------
-- 3. CLOSE THE SOURCE, OR THIS FILE IS A ONE-OFF CLEANUP THAT ROTS.
--
--    Without this, migration 0022 creates a function on the linked project
--    and it arrives with `anon=X` again, and nobody finds out until somebody
--    repeats the audit. Local already looks like this, so this statement is
--    what makes the two environments agree going forward rather than just
--    agreeing today.
--
--    Only `postgres` is addressed. The `supabase_admin` default carries the
--    same shape but that role is the platform's, not ours, and migrations do
--    not create objects as it.
-- ---------------------------------------------------------------------------
alter default privileges for role postgres in schema public
	revoke execute on functions from anon;

-- ---------------------------------------------------------------------------
-- 4. PROVE IT IN THE SAME TRANSACTION, AND ROLL BACK IF IT IS NOT TRUE.
--
--    A sweep that silently did nothing looks exactly like a sweep that
--    worked. Count what anon can execute now and refuse the whole file
--    unless it is precisely the five.
-- ---------------------------------------------------------------------------
do $$
declare
	v_anon_exec integer;
	v_total integer;
	v_leftover text;
begin
	select
		count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE')),
		count(*)
	into v_anon_exec, v_total
	from pg_proc p
	join pg_namespace n on n.oid = p.pronamespace
	where n.nspname = 'public';

	if v_anon_exec <> 5 then
		select coalesce(string_agg(p.proname, ', ' order by p.proname), '(none)')
		into v_leftover
		from pg_proc p
		join pg_namespace n on n.oid = p.pronamespace
		where n.nspname = 'public'
			and has_function_privilege('anon', p.oid, 'EXECUTE')
			and p.proname not in ('team_login_roster', 'student_claim_seat',
			                      'team_size_cap', 'parent_view', 'parent_photo_path');

		raise exception
			'0021 refuses: anon can execute % of % functions in public after the sweep, expected exactly 5. Unexpected: %.',
			v_anon_exec, v_total, v_leftover;
	end if;

	raise notice '0021: anon can execute % of % functions in public.', v_anon_exec, v_total;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. THE TABLE AND SEQUENCE DEFAULTS, LEFT ALONE ON PURPOSE.
--
--    The linked project carries the same shape for tables
--    (anon=arwdDxtm/postgres) and sequences (anon=rwU/postgres). Measured
--    today, anon holds NO privilege on any table in public, because this
--    chain's convention is that every table states its own
--    `revoke all ... from anon, authenticated` and every table has done so.
--    So there is nothing to clean up, only something to prevent: a future
--    table whose author forgets that line would be world-readable on the
--    linked project and correct on local, which is this same bug wearing a
--    different hat.
--
--    Not fixed here because it is not currently reachable and because
--    revoking the table default changes what happens to every future table
--    in this schema, which deserves its own file and its own test rather
--    than a footnote in a security patch. Written down so the next person
--    finds it already measured.
-- ---------------------------------------------------------------------------

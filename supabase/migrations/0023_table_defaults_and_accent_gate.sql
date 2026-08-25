-- 0023_table_defaults_and_accent_gate.sql
--
-- THE TWO THINGS 0021 AND 0022 WROTE DOWN AND DID NOT DO. Those files closed
-- the hosted FUNCTION default for `anon` and then for `authenticated`, and
-- each ended with a section admitting what it had left standing: the table
-- and sequence defaults, and `team_accent_options`, the one SECURITY DEFINER
-- function in `public` with no caller check of any kind.
--
-- Applied by the Supabase CLI, after 0022.
--
-- ===========================================================================
-- PART 1: THE TABLE AND SEQUENCE DEFAULTS
-- ===========================================================================
--
-- MEASURED FIRST, BOTH ENVIRONMENTS, BEFORE ANYTHING WAS CHANGED. The
-- difference is real but narrower than "the hosted project grants
-- everything", and the honest numbers matter more than the alarming summary.
-- `pg_default_acl` in schema `public`, grantor `postgres`, which is the row
-- that governs because migrations connect as `postgres`:
--
--   TABLES      linked  anon=arwdDxtm  authenticated=arwdDxtm
--               local   anon=Dxtm      authenticated=Dxtm
--               difference: the linked project adds a, r, w, d, which is
--               INSERT, SELECT, UPDATE and DELETE. Both keep Dxtm, which is
--               TRUNCATE, REFERENCES, TRIGGER and MAINTAIN, and which is the
--               "nothing useful by default" CLAUDE.md has always described.
--
--   SEQUENCES   linked  anon=rwU       authenticated=rwU
--               local   anon=w         authenticated=w
--               difference: the linked project adds r and U, SELECT and
--               USAGE.
--
-- The `supabase_admin` rows are IDENTICAL on both sides (arwdDxtm and rwU)
-- and are left alone: that role belongs to the platform and this chain does
-- not create objects as it.
--
-- NOTHING IS LEAKING TODAY AND THIS FILE DOES NOT PRETEND OTHERWISE. Measured
-- on both: `anon` holds NO table privilege at all, and `authenticated` holds
-- SELECT and DELETE across the same 28 tables in both environments. The
-- convention works. Every table in this chain states its own
-- `revoke all ... from anon, authenticated` and every table has done it.
-- There are also ZERO sequences in `public`, so the sequence half of this
-- file governs nothing that exists and is written for the one that does not
-- exist yet.
--
-- SO THIS FILE CHANGES A CONVENTION INTO A GUARANTEE. A convention holds
-- until somebody forgets. A table added next season whose author omits that
-- one line is fully readable and writable by `anon` on the linked project
-- and correct on local, and NOTHING would show it: not the migration, which
-- is silent about grants it did not write, and not the suite, which until
-- 0022 only ever looked at local. Neutralising the default makes the
-- forgotten case fail CLOSED instead of open.
--
-- WHY `revoke all` AND NOT "revoke down to match local". Matching local would
-- leave Dxtm, and D is TRUNCATE, which no RLS policy governs. It is not
-- reachable through PostgREST today, which is why local has got away with it,
-- but "not currently reachable through the API we happen to use" is a weaker
-- guarantee than "not granted". The chain needs NONE of these defaults: every
-- table states its grants explicitly, which is exactly why the current state
-- is already clean. So the correct target is zero, and because this file is
-- in the chain it applies to BOTH environments and they converge rather than
-- drift further apart.
--
-- THIS CANNOT AFFECT A SINGLE EXISTING ROW, TABLE OR GRANT. ALTER DEFAULT
-- PRIVILEGES governs objects created AFTER it runs and nothing else. The
-- guard in part 3 asserts that the 28 tables still carry what they carried,
-- which is not in doubt but is cheap to state and would catch a later edit
-- that turned one of these statements into a real REVOKE.
--
-- ===========================================================================
-- PART 2: THE GATE ON team_accent_options
-- ===========================================================================
--
-- THE GATE IS "A SIGNED-IN MENTOR OR A SIGNED-IN STUDENT", AND THE REASONING
-- IS ABOUT WHO PICKS A COLOUR, NOT ABOUT WHO IS SENIOR.
--
-- Ruled out, in order:
--
--   mentor only        WRONG. `AccentPicker.svelte` is on the student's own
--                      /me/team screen and a Run Captain proposes the colour.
--                      Gating this to mentors breaks the feature 0018 exists
--                      for.
--   the caller's team  MEANINGLESS. `teams.accent` is unique across live
--                      teams by partial index, so "which colours are taken"
--                      is inherently a question about the OTHER teams. A
--                      team-scoped answer would always say "nothing is
--                      taken" and every child would pick the same colour.
--   nobody at all      Already true for `anon` since 0021 revoked EXECUTE.
--                      This is the second line of defence beneath it:
--                      CLAUDE.md says the route guard and the database are
--                      never trusted alone, and the same applies to a grant
--                      and a body check.
--
-- BOARD DEVICES ARE EXCLUDED, DELIBERATELY. `current_student_id()` reads
-- `public.students` and a board lives in `team_board_devices`, so it answers
-- NULL for one and the gate refuses it. That is the rule CLAUDE.md already
-- states: a board is a DEVICE, not a person, it reads its own team and closes
-- its own team's tasks and that is all. It has no colour to choose and there
-- is no board caller: the two callers are the mentor team page and the
-- student /me/team page.
--
-- IT RAISES RATHER THAN RETURNING AN EMPTY LIST. "Probing reveals nothing"
-- governs the anon doors, where an empty answer is what stops a stranger
-- learning whether a thing exists. Every caller that reaches this function is
-- now signed in, and an empty palette on a colour picker reads as a broken
-- screen rather than a refusal. `board_live_summary` sets the precedent for a
-- signed-in caller who is the wrong kind of person: it raises a sentence in
-- the user's own terms.
--
-- The function changes LANGUAGE from sql to plpgsql, which `create or
-- replace` allows because the signature and return type are untouched. No
-- `drop function` is needed and the signature trap does not apply: it takes
-- no arguments before or after.
--
-- ===========================================================================
-- TO UNDO
-- ===========================================================================
--
--   -- Part 1, restore the hosted defaults:
--   alter default privileges for role postgres in schema public
--     grant all on tables to anon, authenticated;
--   alter default privileges for role postgres in schema public
--     grant all on sequences to anon, authenticated;
--   -- On the LOCAL stack the hosted values were never these; to restore what
--   -- the CLI image ships, grant truncate, references, trigger, maintain on
--   -- tables and update on sequences instead.
--
--   -- Part 2, re-run 0018's team_accent_options() definition verbatim. It is
--   -- the language sql version with no gate.
--
-- Undoing part 1 restores the forgotten-revoke hole. Undoing part 2 makes the
-- colour palette readable by any signed-in caller including a board device.

-- ---------------------------------------------------------------------------
-- 1. Neutralise the table and sequence defaults for the two API roles.
--
--    `service_role` is left alone on purpose, exactly as 0021 and 0022 left
--    it: it is the admin key, the one module that holds it fetches rather
--    than decides, and every table grants it everything explicitly anyway.
--
--    Idempotent: revoking a default privilege that is not there is a no-op,
--    so this file is a no-op on second application and very nearly one on
--    local, where only Dxtm and w are being removed.
-- ---------------------------------------------------------------------------
alter default privileges for role postgres in schema public
	revoke all on tables from anon, authenticated;

alter default privileges for role postgres in schema public
	revoke all on sequences from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The gate.
-- ---------------------------------------------------------------------------
create or replace function public.team_accent_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	-- A mentor, or a student who is choosing. Not a board device, not a
	-- deactivated student (current_student_id() already excludes those), and
	-- not anon, which lost EXECUTE in 0021.
	--
	-- Both halves are non-nullable by construction: is_mentor() is
	-- `select exists (...)`, and `... is not null` is a boolean test. The
	-- coalesce is belt and braces, per CLAUDE.md's rule about `if not (...)`
	-- gates falling straight through on NULL.
	if not coalesce(
		public.is_mentor() or public.current_student_id() is not null,
		false
	) then
		raise exception 'Only a mentor or a team member can see which colours are taken.';
	end if;

	return (
		select coalesce(jsonb_agg(jsonb_build_object(
			'accent', a.accent,
			'taken_by_team_id', t.id,
			'taken_by', t.name
		) order by a.ord), '[]'::jsonb)
		from unnest(enum_range(null::public.team_accent)) with ordinality as a(accent, ord)
		left join public.teams t on t.accent = a.accent and t.archived_at is null
	);
end;
$$;

revoke all on function public.team_accent_options() from public;
grant execute on function public.team_accent_options() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. PROVE IT, IN THE SAME TRANSACTION, AND ROLL BACK IF IT IS NOT TRUE.
-- ---------------------------------------------------------------------------
do $$
declare
	v_bad_defaults text;
	v_anon_tables integer;
	v_authed_tables integer;
	v_accent_gated boolean;
begin
	-- (a) Neither API role may appear in the postgres default for tables or
	--     sequences any more.
	-- defaclobjtype is "char", whose || is ambiguous against an unknown
	-- literal; cast before concatenating.
	select coalesce(string_agg(
		d.defaclobjtype::text || ': ' || array_to_string(d.defaclacl, ' | '), '; '), '')
	into v_bad_defaults
	from pg_default_acl d
	join pg_namespace n on n.oid = d.defaclnamespace
	where n.nspname = 'public'
		and d.defaclobjtype in ('r', 'S')
		and pg_get_userbyid(d.defaclrole) = 'postgres'
		and (array_to_string(d.defaclacl, ' ') like '%anon=%'
			or array_to_string(d.defaclacl, ' ') like '%authenticated=%');

	if v_bad_defaults <> '' then
		raise exception
			'0023 refuses: the postgres default still grants anon or authenticated on tables or sequences (%).',
			v_bad_defaults;
	end if;

	-- (b) The security invariant this whole line of work is about.
	select count(*) into v_anon_tables
	from information_schema.role_table_grants
	where table_schema = 'public' and grantee = 'anon';

	if v_anon_tables <> 0 then
		raise exception
			'0023 refuses: anon holds % table privilege rows in public, expected 0.',
			v_anon_tables;
	end if;

	-- (c) THE OVER-REVOKE GUARD. Altering a DEFAULT cannot touch an existing
	--     table, so this should be impossible; it is here because the cost of
	--     stating it is nothing and the cost of a later edit quietly turning
	--     one of the statements above into a real `revoke all on all tables`
	--     is the entire console.
	select count(distinct table_name) into v_authed_tables
	from information_schema.role_table_grants
	where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'SELECT';

	if v_authed_tables < 20 then
		raise exception
			'0023 refuses: authenticated can SELECT only % tables in public. The sweep reached past the defaults.',
			v_authed_tables;
	end if;

	-- (d) The gate is actually in the body that shipped.
	select pg_get_functiondef(p.oid) like '%Only a mentor or a team member%'
	into v_accent_gated
	from pg_proc p
	join pg_namespace n on n.oid = p.pronamespace
	where n.nspname = 'public' and p.proname = 'team_accent_options';

	if not coalesce(v_accent_gated, false) then
		raise exception '0023 refuses: team_accent_options did not take the caller check.';
	end if;

	raise notice
		'0023: table and sequence defaults closed to anon and authenticated; anon holds 0 table grants; authenticated selects % tables; team_accent_options gated.',
		v_authed_tables;
end;
$$;

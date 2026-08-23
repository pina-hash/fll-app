-- 0001_foundation_types_helpers.sql
--
-- THE FOUNDATION: the extension, the four enum types, and the identity helpers
-- that every later migration and every RLS policy in this schema calls.
--
-- Applied by the Supabase CLI: `supabase migration up` against the local stack,
-- `supabase db push` against the linked project. The CLI records each file in
-- supabase_migrations.schema_migrations, so a file is applied exactly once per
-- database; it is still written to re-apply cleanly because a failed first
-- attempt is retried over a half-built schema.
--
-- WHY THE HELPERS ARE SECURITY DEFINER. A policy on `students` has to answer
-- "which team is the caller on?", and the answer lives in `students`. A plain
-- function would re-enter the `students` policies and recurse. A definer
-- function owned by `postgres` (which carries BYPASSRLS on Supabase) reads the
-- row without consulting any policy, and `set search_path = ''` means every
-- name inside it is schema-qualified, so no role can shadow a table.
--
-- WHY THEY ARE GRANTED TO `authenticated`. A function named directly inside an
-- RLS `using` clause is evaluated as the QUERYING role, not from inside a
-- definer body, so the role needs EXECUTE or every own-team read fails with
-- "permission denied for function". `anon` holds no table grant anywhere in
-- this schema and therefore never reaches a policy; it gets nothing.
--
-- ===========================================================================
-- TO UNDO
-- ===========================================================================
--
--   drop function if exists public._student_slug_base(text, text);
--   drop function if exists public._generate_join_code();
--   drop function if exists public.set_updated_at();
--   drop function if exists public.current_student_team_id();
--   drop function if exists public.current_student_id();
--   drop function if exists public.current_mentor_id();
--   drop function if exists public.is_admin_mentor();
--   drop function if exists public.is_mentor();
--   drop type if exists public.task_status;
--   drop type if exists public.meeting_kind;
--   drop type if exists public.role_tier;
--   drop type if exists public.team_role;
--   drop extension if exists btree_gist;
--
-- Nothing later in the chain survives that, so undo 0008 back to 0002 first.

-- ---------------------------------------------------------------------------
-- 1. Extension. btree_gist lets an EXCLUDE constraint combine `=` on uuid and
--    enum columns with `&&` on a daterange (0005 role_assignments). pgcrypto is
--    preinstalled by Supabase in `extensions` (crypt, gen_salt,
--    gen_random_bytes) and is referenced schema-qualified throughout.
-- ---------------------------------------------------------------------------
create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- 2. Enum types. `create type` has no IF NOT EXISTS; the guard makes a retry
--    over a half-applied file an ordinary event.
-- ---------------------------------------------------------------------------
do $$
begin
	if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
	               where n.nspname = 'public' and t.typname = 'team_role') then
		create type public.team_role as enum (
			'lead_builder',
			'lead_programmer',
			'run_captain',
			'innovation_lead',
			'notebook_values_lead'
		);
	end if;
	if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
	               where n.nspname = 'public' and t.typname = 'role_tier') then
		create type public.role_tier as enum ('primary', 'second');
	end if;
	if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
	               where n.nspname = 'public' and t.typname = 'meeting_kind') then
		create type public.meeting_kind as enum ('friday', 'saturday');
	end if;
	if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
	               where n.nspname = 'public' and t.typname = 'task_status') then
		create type public.task_status as enum ('open', 'active', 'blocked', 'done');
	end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Identity helpers. STABLE so the planner evaluates each once per statement;
--    policies wrap them in `(select ...)` to make that an init-plan.
--
--    A deactivated mentor or student answers "nobody": deactivated_at is the
--    soft-delete stamp (0002, 0004) and the filter is stated HERE, once, so a
--    deactivated account loses every policy at the same moment.
--
--    They are LANGUAGE SQL so the planner can inline them, and a SQL body is
--    validated against the catalog when it is created -- but the tables they
--    read arrive in 0002 and 0004. check_function_bodies is switched off for
--    this section only (and restored below) so the definitions are parsed
--    but not resolved until first call, which is after the chain has built
--    the tables. 0003's policies need current_student_team_id() before
--    students (0004) exists, which is why the helpers cannot simply move.
-- ---------------------------------------------------------------------------
set check_function_bodies = off;

create or replace function public.is_mentor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1
		from public.mentors m
		where m.auth_user_id = (select auth.uid())
			and m.deactivated_at is null
	);
$$;

create or replace function public.is_admin_mentor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1
		from public.mentors m
		where m.auth_user_id = (select auth.uid())
			and m.deactivated_at is null
			and m.is_admin
	);
$$;

create or replace function public.current_mentor_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
	select m.id
	from public.mentors m
	where m.auth_user_id = (select auth.uid())
		and m.deactivated_at is null;
$$;

create or replace function public.current_student_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
	select s.id
	from public.students s
	where s.auth_user_id = (select auth.uid())
		and s.deactivated_at is null;
$$;

create or replace function public.current_student_team_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
	select s.team_id
	from public.students s
	where s.auth_user_id = (select auth.uid())
		and s.deactivated_at is null;
$$;

revoke all on function public.is_mentor() from public;
revoke all on function public.is_admin_mentor() from public;
revoke all on function public.current_mentor_id() from public;
revoke all on function public.current_student_id() from public;
revoke all on function public.current_student_team_id() from public;
grant execute on function public.is_mentor() to authenticated;
grant execute on function public.is_admin_mentor() to authenticated;
grant execute on function public.current_mentor_id() to authenticated;
grant execute on function public.current_student_id() to authenticated;
grant execute on function public.current_student_team_id() to authenticated;

reset check_function_bodies;

-- ---------------------------------------------------------------------------
-- 4. Row helpers.
-- ---------------------------------------------------------------------------

-- Server-stamps updated_at on every UPDATE. A client never sends it, which is
-- one of the properties a local-first write queue needs: replaying a queued
-- update is idempotent and the server clock, not the device clock, orders it.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	new.updated_at := now();
	return new;
end;
$$;
revoke all on function public.set_updated_at() from public;

-- Team join codes: 6 symbols from a 32-symbol alphabet with no O/0/I/1.
-- 32 = 2^5, so `byte % 32` over gen_random_bytes is exactly uniform.
-- 32^6 is ~1.07e9 codes; uniqueness is the constraint on teams.join_code
-- (0003). Private: only team_create (0003) calls it, as the definer.
create or replace function public._generate_join_code()
returns char(6)
language plpgsql
volatile
set search_path = ''
as $$
declare
	v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	v_bytes bytea := extensions.gen_random_bytes(6);
	v_code text := '';
	v_i int;
begin
	for v_i in 0..5 loop
		v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, v_i) % 32) + 1, 1);
	end loop;
	return v_code;
end;
$$;
revoke all on function public._generate_join_code() from public;

-- The base of a student's login slug: lowercased first name + last initial,
-- reduced to [a-z0-9]. student_create (0004) dedupes it within a team by
-- appending 2, 3, ... . Private for the same reason.
create or replace function public._student_slug_base(p_first_name text, p_last_initial text)
returns text
language sql
immutable
set search_path = ''
as $$
	select regexp_replace(
		lower(btrim(p_first_name)) || lower(btrim(p_last_initial)),
		'[^a-z0-9]', '', 'g'
	);
$$;
revoke all on function public._student_slug_base(text, text) from public;

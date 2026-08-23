-- 0002_mentors.sql
--
-- MENTORS: the Google-OAuth population. A row is created by a trigger on
-- auth.users at first sign-in and by nothing else; a client can only read the
-- roster and (as an admin) edit three columns of it.
--
-- Applied by the Supabase CLI, after 0001.
--
-- WHO GETS IN. The trigger is the gate for BOTH populations of one Auth
-- instance:
--
--   * an @fll.invalid address is a student account (0004). It is accepted only
--     while student_create's transaction-local flag is raised, so the public
--     signup endpoint and the dashboard cannot mint one;
--   * a Google identity on boscotech.edu becomes a mentor. The FIRST mentor row
--     is the admin, under an advisory lock so two simultaneous first sign-ins
--     cannot both win;
--   * anything else is refused, which aborts GoTrue's insert and therefore the
--     sign-in itself. The dashboard's domain restriction on the Google provider
--     is a convenience; this raise is the boundary.
--
-- WHY COLUMN-LEVEL UPDATE GRANTS. `authenticated` is one role for mentors and
-- students alike, so a grant cannot tell them apart; RLS does that. What a
-- grant CAN do is make auth_user_id, email and created_at unwritable by any
-- client at all, admin or not, and that is the cheapest guarantee available.
--
-- ===========================================================================
-- TO UNDO
-- ===========================================================================
--
--   drop trigger if exists on_auth_user_created on auth.users;
--   drop function if exists public.handle_new_auth_user();
--   drop trigger if exists mentors_guard_update on public.mentors;
--   drop function if exists public._mentors_guard_update();
--   drop trigger if exists mentors_set_updated_at on public.mentors;
--   drop table if exists public.mentors;
--
-- 0001's helpers name public.mentors inside SQL bodies that are resolved at
-- call time, so they survive the drop and simply raise until it is back. Every
-- table from 0003 on references mentors; undo those first.

-- ---------------------------------------------------------------------------
-- 1. Table.
-- ---------------------------------------------------------------------------
create table if not exists public.mentors (
	id uuid primary key default gen_random_uuid(),
	auth_user_id uuid not null unique references auth.users (id) on delete cascade,
	email text not null unique
		check (email = lower(btrim(email)) and split_part(email, '@', 2) = 'boscotech.edu'),
	display_name text not null
		check (length(btrim(display_name)) between 1 and 120),
	is_admin boolean not null default false,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	deactivated_at timestamptz
);

comment on table public.mentors is
	'One row per boscotech.edu Google account, created by the auth.users trigger only. deactivated_at is the soft-delete stamp: is_mentor() answers false past it, so every policy closes at once.';

drop trigger if exists mentors_set_updated_at on public.mentors;
create trigger mentors_set_updated_at
	before update on public.mentors
	for each row execute function public.set_updated_at();

-- An admin cannot lock themselves (or everyone) out from a client: no
-- self-demotion, no self-deactivation, and the last active admin stays one.
create or replace function public._mentors_guard_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_uid uuid := (select auth.uid());
begin
	if v_uid is null then
		-- Service-role and migration contexts carry no caller; the rule is for
		-- clients.
		return new;
	end if;
	if new.auth_user_id = v_uid then
		if old.is_admin and not new.is_admin then
			raise exception 'You cannot remove your own admin access.';
		end if;
		if old.deactivated_at is null and new.deactivated_at is not null then
			raise exception 'You cannot deactivate your own account.';
		end if;
	end if;
	if old.is_admin and old.deactivated_at is null
		and (not new.is_admin or new.deactivated_at is not null)
		and not exists (
			select 1 from public.mentors m
			where m.id <> old.id and m.is_admin and m.deactivated_at is null
		)
	then
		raise exception 'That is the last active admin. Make someone else an admin first.';
	end if;
	return new;
end;
$$;
revoke all on function public._mentors_guard_update() from public;

drop trigger if exists mentors_guard_update on public.mentors;
create trigger mentors_guard_update
	before update on public.mentors
	for each row execute function public._mentors_guard_update();

-- ---------------------------------------------------------------------------
-- 2. The sign-in gate: a trigger on auth.users.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_email text := lower(btrim(coalesce(new.email, '')));
	v_domain text := split_part(v_email, '@', 2);
	v_provider text := coalesce(new.raw_app_meta_data ->> 'provider', '');
	v_name text;
begin
	-- Students: minted only by student_create (0004), which raises this flag
	-- for the life of its own transaction before inserting.
	if v_domain = 'fll.invalid' then
		if coalesce(current_setting('fll.creating_student', true), '') <> 'on' then
			raise exception 'Student accounts are created by a mentor, not by signing up.';
		end if;
		return new;
	end if;

	-- Mentors: Google only, boscotech.edu only.
	if v_provider = 'google' and v_domain = 'boscotech.edu' then
		perform pg_advisory_xact_lock(hashtext('public.mentors.first_admin'));
		v_name := nullif(btrim(coalesce(
			new.raw_user_meta_data ->> 'full_name',
			new.raw_user_meta_data ->> 'name',
			''
		)), '');
		insert into public.mentors (auth_user_id, email, display_name, is_admin)
		values (
			new.id,
			v_email,
			coalesce(v_name, split_part(v_email, '@', 1)),
			not exists (select 1 from public.mentors)
		)
		on conflict (auth_user_id) do nothing;
		return new;
	end if;

	raise exception 'Sign-in is limited to boscotech.edu Google accounts.';
end;
$$;
revoke all on function public.handle_new_auth_user() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
	after insert on auth.users
	for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- 3. Grants and RLS. Mentors read the whole roster; admins edit three columns;
--    nobody inserts or deletes from a client; students see nothing here.
-- ---------------------------------------------------------------------------
revoke all on public.mentors from anon, authenticated;
grant all on public.mentors to service_role;
grant select on public.mentors to authenticated;
grant update (display_name, is_admin, deactivated_at) on public.mentors to authenticated;

alter table public.mentors enable row level security;

drop policy if exists "mentors read every mentor" on public.mentors;
create policy "mentors read every mentor"
	on public.mentors
	for select
	to authenticated
	using ((select public.is_mentor()));

drop policy if exists "admins update mentors" on public.mentors;
create policy "admins update mentors"
	on public.mentors
	for update
	to authenticated
	using ((select public.is_admin_mentor()))
	with check ((select public.is_admin_mentor()));

-- No INSERT or DELETE policy: the trigger is the only writer.

-- 0005_role_assignments.sql
--
-- ROLE ASSIGNMENTS: who holds each of the five team roles, at which tier
-- (primary or second), over which dates.
--
-- Applied by the Supabase CLI, after 0004.
--
-- ONE HOLDER PER (TEAM, ROLE, TIER) AT ANY INSTANT, AS A CONSTRAINT. The
-- exclusion constraint below is the rule; no application code is trusted with
-- it. Two rows conflict when they share team, role and tier and their
-- [effective_from, effective_to) ranges overlap; a null effective_to is an
-- open-ended range. A second constraint stops one student holding both tiers
-- of the same role at once. btree_gist (0001) supplies the `=` operators.
--
-- The composite foreign key (student_id, team_id) -> students (id, team_id)
-- means the named student is on the named team by construction.
--
-- ===========================================================================
-- TO UNDO
-- ===========================================================================
--
--   drop trigger if exists role_assignments_set_updated_at on public.role_assignments;
--   drop table if exists public.role_assignments;

-- ---------------------------------------------------------------------------
-- 1. Table.
-- ---------------------------------------------------------------------------
create table if not exists public.role_assignments (
	id uuid primary key default gen_random_uuid(),
	team_id uuid not null references public.teams (id),
	student_id uuid not null,
	role public.team_role not null,
	tier public.role_tier not null,
	effective_from date not null default current_date,
	effective_to date,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	foreign key (student_id, team_id) references public.students (id, team_id),
	constraint role_assignments_range_check
		check (effective_to is null or effective_to > effective_from),
	constraint role_assignments_one_holder_per_tier exclude using gist (
		team_id with =,
		role with =,
		tier with =,
		daterange(effective_from, effective_to, '[)') with &&
	),
	constraint role_assignments_one_tier_per_student exclude using gist (
		student_id with =,
		role with =,
		daterange(effective_from, effective_to, '[)') with &&
	)
);

comment on table public.role_assignments is
	'A student holding a team role at a tier over [effective_from, effective_to). Ending an assignment sets effective_to; history is kept.';

drop trigger if exists role_assignments_set_updated_at on public.role_assignments;
create trigger role_assignments_set_updated_at
	before update on public.role_assignments
	for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Grants and RLS. Mentors assign; students see their own team's roles.
-- ---------------------------------------------------------------------------
revoke all on public.role_assignments from anon, authenticated;
grant all on public.role_assignments to service_role;
grant select on public.role_assignments to authenticated;
grant insert (id, team_id, student_id, role, tier, effective_from, effective_to) on public.role_assignments to authenticated;
grant update (role, tier, effective_from, effective_to) on public.role_assignments to authenticated;
grant delete on public.role_assignments to authenticated;

alter table public.role_assignments enable row level security;

drop policy if exists "mentors read every role assignment" on public.role_assignments;
create policy "mentors read every role assignment"
	on public.role_assignments
	for select
	to authenticated
	using ((select public.is_mentor()));

drop policy if exists "students read their own team roles" on public.role_assignments;
create policy "students read their own team roles"
	on public.role_assignments
	for select
	to authenticated
	using (team_id = (select public.current_student_team_id()));

drop policy if exists "mentors insert role assignments" on public.role_assignments;
create policy "mentors insert role assignments"
	on public.role_assignments
	for insert
	to authenticated
	with check ((select public.is_mentor()));

drop policy if exists "mentors update role assignments" on public.role_assignments;
create policy "mentors update role assignments"
	on public.role_assignments
	for update
	to authenticated
	using ((select public.is_mentor()))
	with check ((select public.is_mentor()));

drop policy if exists "mentors delete role assignments" on public.role_assignments;
create policy "mentors delete role assignments"
	on public.role_assignments
	for delete
	to authenticated
	using ((select public.is_mentor()));

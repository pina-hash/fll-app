-- 0003_teams.sql
--
-- TEAMS: the four FLL teams, each with a six-symbol join code that students
-- type at the login screen.
--
-- Applied by the Supabase CLI, after 0002.
--
-- THE JOIN CODE IS AN IDENTIFIER, NOT A SECRET. It is half of a student's
-- synthetic email (`{code}-{slug}@fll.invalid`, 0004), so it is permanent for
-- the life of the team and every student on the team can read it. The PIN is
-- the secret. Rotating a code would re-mint every student address on the team;
-- this file deliberately provides no way to change it from a client.
--
-- WHY CREATION IS AN RPC AND NOT AN INSERT. The code comes from
-- _generate_join_code(), which is private and runs as the definer; a direct
-- insert would need the function granted to `authenticated`. team_create also
-- retries a (one-in-a-billion) collision, which a column default cannot.
-- Editing a team is an ordinary RLS update on the three columns a mentor may
-- change.
--
-- ===========================================================================
-- TO UNDO
-- ===========================================================================
--
--   drop function if exists public.team_create(text, integer);
--   drop trigger if exists teams_set_updated_at on public.teams;
--   drop table if exists public.teams;
--
-- Everything from 0004 on references teams; undo those first.

-- ---------------------------------------------------------------------------
-- 1. Table.
-- ---------------------------------------------------------------------------
create table if not exists public.teams (
	id uuid primary key default gen_random_uuid(),
	fll_team_number integer
		check (fll_team_number is null or fll_team_number between 1 and 999999),
	name text not null
		check (length(btrim(name)) between 1 and 80),
	join_code char(6) not null unique
		check (join_code ~ '^[A-HJ-NP-Z2-9]{6}$'),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	archived_at timestamptz
);

comment on table public.teams is
	'An FLL team. join_code is permanent (it is half of every student login on the team). archived_at is the soft-delete stamp; team_login_roster() and student_create() refuse an archived team.';

-- FIRST assigns the number; it is null until then and unique once set.
create unique index if not exists teams_fll_team_number_key
	on public.teams (fll_team_number)
	where fll_team_number is not null;

drop trigger if exists teams_set_updated_at on public.teams;
create trigger teams_set_updated_at
	before update on public.teams
	for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. team_create: the only way a client makes a team.
-- ---------------------------------------------------------------------------
create or replace function public.team_create(p_name text, p_fll_team_number integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_name text := btrim(coalesce(p_name, ''));
	v_team public.teams%rowtype;
	v_attempt int := 0;
begin
	if not public.is_mentor() then
		raise exception 'Only a mentor can create a team.';
	end if;
	if length(v_name) not between 1 and 80 then
		raise exception 'A team name is 1 to 80 characters.';
	end if;
	if p_fll_team_number is not null and p_fll_team_number not between 1 and 999999 then
		raise exception 'An FLL team number is between 1 and 999999.';
	end if;

	loop
		v_attempt := v_attempt + 1;
		begin
			insert into public.teams (name, fll_team_number, join_code)
			values (v_name, p_fll_team_number, public._generate_join_code())
			returning * into v_team;
			exit;
		exception
			when unique_violation then
				-- A join-code collision is retried; a duplicate team number is
				-- the caller's mistake.
				if exists (select 1 from public.teams t where t.fll_team_number = p_fll_team_number) then
					raise exception 'Another team already has FLL number %.', p_fll_team_number;
				end if;
				if v_attempt >= 10 then
					raise exception 'Could not mint a unique join code after % tries.', v_attempt;
				end if;
		end;
	end loop;

	return jsonb_build_object(
		'team_id', v_team.id,
		'name', v_team.name,
		'fll_team_number', v_team.fll_team_number,
		'join_code', v_team.join_code
	);
end;
$$;

revoke all on function public.team_create(text, integer) from public;
grant execute on function public.team_create(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Grants and RLS.
-- ---------------------------------------------------------------------------
revoke all on public.teams from anon, authenticated;
grant all on public.teams to service_role;
grant select on public.teams to authenticated;
grant update (fll_team_number, name, archived_at) on public.teams to authenticated;

alter table public.teams enable row level security;

drop policy if exists "mentors read every team" on public.teams;
create policy "mentors read every team"
	on public.teams
	for select
	to authenticated
	using ((select public.is_mentor()));

drop policy if exists "students read their own team" on public.teams;
create policy "students read their own team"
	on public.teams
	for select
	to authenticated
	using (id = (select public.current_student_team_id()));

drop policy if exists "mentors update teams" on public.teams;
create policy "mentors update teams"
	on public.teams
	for update
	to authenticated
	using ((select public.is_mentor()))
	with check ((select public.is_mentor()));

-- No INSERT policy (team_create is the door) and no DELETE policy (archive,
-- never delete).

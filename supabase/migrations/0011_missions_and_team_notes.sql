-- 0011_missions_and_team_notes.sql
--
-- THE BIOGLOW MISSION TABLE, ported from the standalone fll-camp app's static
-- mission config, and each team's own strategy note per mission.
--
-- Applied by the Supabase CLI, after 0010.
--
-- MISSIONS ARE GLOBAL REFERENCE DATA, NOT A TEAM ROW. All four teams play the
-- same 15 BIOGLOW missions, so `missions` carries no team_id and is seeded by
-- this migration itself (not seed.sql, which is local-only) -- the season's
-- mission list has to exist in production the same as local. The seed is an
-- idempotent upsert keyed on `code` that updates name/points_label/scoring/
-- sort_order but leaves position_x_mm/position_y_mm alone, because a mentor's
-- already-recorded mat position is real data this file must never overwrite.
--
-- WHY A TABLE AND NOT CONTENT. Every other category in the ported Skill Hub
-- (Core Values, Innovation Project, Build & Programming, the Mechanisms
-- Library, Meet the Robot, the Video & Resource Library) is editorial text
-- with no per-team state, so it lives in src/lib/content/ and is reviewed in
-- git like any other copy change. Missions are the one exception: the next
-- bundle's route planner has to reference a mission by a stable id and read
-- back a mat position a mentor set, and neither of those is something a git
-- diff can hold. The mission's descriptive text (what the model does, its
-- caveats, its strategy prompt) stays in src/lib/content/missions.ts, joined
-- to this table by `code` at render time -- only the numbers a route planner
-- needs and the position a mentor edits at runtime moved into SQL.
--
-- WHY THE NOTE IS A SEPARATE TABLE FROM MISSIONS. fll-camp kept one strategy
-- note per item per device, in that browser's local storage: every team on
-- every phone read and wrote the same note, and it vanished if the device
-- was wiped. team_mission_notes gives each team, not each device, exactly one
-- note per mission, durable in Postgres and shared by every phone on that
-- team the same way tasks and blockers already are.
--
-- ===========================================================================
-- TO UNDO
-- ===========================================================================
--
--   drop trigger if exists team_mission_notes_immutable on public.team_mission_notes;
--   drop trigger if exists team_mission_notes_set_updated_at on public.team_mission_notes;
--   drop table if exists public.team_mission_notes;
--   drop trigger if exists missions_set_updated_at on public.missions;
--   drop table if exists public.missions;

-- ---------------------------------------------------------------------------
-- 1. Missions.
-- ---------------------------------------------------------------------------
create table if not exists public.missions (
	id uuid primary key default gen_random_uuid(),
	code text not null unique check (length(btrim(code)) between 1 and 20),
	name text not null check (length(btrim(name)) between 1 and 200),
	points_label text not null check (length(btrim(points_label)) between 1 and 100),
	scoring jsonb not null default '[]'::jsonb,
	sort_order integer not null,
	position_x_mm integer check (position_x_mm is null or position_x_mm >= 0),
	position_y_mm integer check (position_y_mm is null or position_y_mm >= 0),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

comment on table public.missions is
	'The 15 BIOGLOW Robot Game missions. Global reference data, seeded by this migration and shared by every team. position_x_mm/position_y_mm are the only mentor-editable columns; everything else is the season''s mission list.';

create index if not exists missions_sort_order_idx on public.missions (sort_order);

drop trigger if exists missions_set_updated_at on public.missions;
create trigger missions_set_updated_at
	before update on public.missions
	for each row execute function public.set_updated_at();

-- Seed. `code` is the stable join key with src/lib/content/missions.ts -- never
-- renumber it. Upsert leaves position_x_mm/position_y_mm untouched on conflict.
insert into public.missions (code, name, points_label, scoring, sort_order) values
	('M01', 'Drone Survey', '20 + 10 bonus', '[{"label":"Drone is off the mat","points":20},{"label":"Bonus: LiDAR map flipped AND scan marker in the survey area","points":10,"bonus":true}]'::jsonb, 1),
	('M02', 'Exploding Seeds', '10 each seed', '[{"label":"Each seed off the stalk","points":10}]'::jsonb, 2),
	('M03', 'Flip the Rock', '20 + 10 bonus', '[{"label":"Research flag is down","points":20},{"label":"Bonus: rock returned to the start area","points":10,"bonus":true}]'::jsonb, 3),
	('M04', 'Lucky Leaves', '10, or 30 with the bonus', '[{"label":"One leaf removed","points":10},{"label":"Bonus: second leaf removed AND katydid still in its original position","points":20,"bonus":true}]'::jsonb, 4),
	('M05', 'Reaching Roots', '10 or 20', '[{"label":"Plant root partially extended","points":10},{"label":"Plant root completely extended","points":20}]'::jsonb, 5),
	('M06', 'Leafcutter Frenzy', '10 each fragment', '[{"label":"Ant touching nest AND each leaf fragment contained","points":10}]'::jsonb, 6),
	('M07', 'Humongous Fungus', '20 + up to two 10-pt bonuses', '[{"label":"Mycelium completely extended","points":20},{"label":"Bonus: connection to the opposing team''s extended root","points":10,"bonus":true}]'::jsonb, 7),
	('M08', 'Tangled', '30', '[{"label":"Vine touching the mat","points":30}]'::jsonb, 8),
	('M09', 'Research Platform', '10 + 10 + 10', '[{"label":"Platform raised","points":10},{"label":"Camera trap deployed","points":10},{"label":"Seed off the tree","points":10}]'::jsonb, 9),
	('M10', 'Fragile Microhabitats', '20', '[{"label":"Root cover down / touching the mat","points":20}]'::jsonb, 10),
	('M11', 'Window to the Past', '10 + 10', '[{"label":"Spider habitat in its original position","points":10},{"label":"Snail habitat in its original position","points":10}]'::jsonb, 11),
	('M12', 'Forest Elder', '20 + 10', '[{"label":"Cane fully raised and touching the tree","points":20},{"label":"Support tie around the post","points":10}]'::jsonb, 12),
	('M13', 'Keystone Species', '30', '[{"label":"Keystone species on the restoration platform AND young trees raised","points":30}]'::jsonb, 13),
	('M14', 'Seeds of Renewal', '5 each, +5 each bonus', '[{"label":"Each seed contained in the replantation station","points":5},{"label":"Bonus: each of those seeds also touching the mat","points":5,"bonus":true}]'::jsonb, 14),
	('M15', 'Biocentric Architecture', '10 + 10 + 10, + one 10-pt bonus', '[{"label":"Nesting canopy raised","points":10},{"label":"Garden skylight in","points":10},{"label":"Compost hatch open / touching the mat","points":10},{"label":"Bonus: environmental match to the dock (mine / city / farm)","points":10,"bonus":true}]'::jsonb, 15)
on conflict (code) do update
	set name = excluded.name,
		points_label = excluded.points_label,
		scoring = excluded.scoring,
		sort_order = excluded.sort_order;

do $$
declare
	v_count integer;
begin
	select count(*) into v_count from public.missions;
	if v_count <> 15 then
		raise exception 'Expected exactly 15 missions after seeding, found %.', v_count;
	end if;
	raise notice 'missions table holds % rows.', v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Team strategy notes, one per team per mission.
-- ---------------------------------------------------------------------------
create table if not exists public.team_mission_notes (
	id uuid primary key default gen_random_uuid(),
	team_id uuid not null references public.teams (id),
	mission_id uuid not null references public.missions (id) on delete cascade,
	note text not null default '' check (length(note) <= 4000),
	updated_at timestamptz not null default now(),
	unique (team_id, mission_id)
);

comment on table public.team_mission_notes is
	'One strategy note per team per mission. Every team keeps its own -- this is the exception to the shared, single global note fll-camp kept in browser local storage.';

create index if not exists team_mission_notes_team_idx on public.team_mission_notes (team_id);

drop trigger if exists team_mission_notes_set_updated_at on public.team_mission_notes;
create trigger team_mission_notes_set_updated_at
	before update on public.team_mission_notes
	for each row execute function public.set_updated_at();

drop trigger if exists team_mission_notes_immutable on public.team_mission_notes;
create trigger team_mission_notes_immutable
	before update on public.team_mission_notes
	for each row execute function public._immutable_columns('team_id', 'mission_id');

-- ---------------------------------------------------------------------------
-- 3. Grants and RLS.
-- ---------------------------------------------------------------------------

-- missions: everyone reads; only a mentor may move the position pin.
revoke all on public.missions from anon, authenticated;
grant all on public.missions to service_role;
grant select on public.missions to authenticated;
grant update (position_x_mm, position_y_mm) on public.missions to authenticated;

alter table public.missions enable row level security;

drop policy if exists "everyone reads missions" on public.missions;
create policy "everyone reads missions"
	on public.missions
	for select
	to authenticated
	using (true);

drop policy if exists "mentors set the mission position" on public.missions;
create policy "mentors set the mission position"
	on public.missions
	for update
	to authenticated
	using ((select public.is_mentor()))
	with check ((select public.is_mentor()));

-- team_mission_notes: mentors read/write every team's notes; a student reads
-- and writes only their own team's, same shape as tasks and blockers.
revoke all on public.team_mission_notes from anon, authenticated;
grant all on public.team_mission_notes to service_role;
grant select on public.team_mission_notes to authenticated;
grant insert (id, team_id, mission_id, note) on public.team_mission_notes to authenticated;
grant update (note) on public.team_mission_notes to authenticated;

alter table public.team_mission_notes enable row level security;

drop policy if exists "mentors read every team's mission notes" on public.team_mission_notes;
create policy "mentors read every team's mission notes"
	on public.team_mission_notes
	for select
	to authenticated
	using ((select public.is_mentor()));

drop policy if exists "students read their own team's mission notes" on public.team_mission_notes;
create policy "students read their own team's mission notes"
	on public.team_mission_notes
	for select
	to authenticated
	using (team_id = (select public.current_student_team_id()));

drop policy if exists "mentors write every team's mission notes" on public.team_mission_notes;
create policy "mentors write every team's mission notes"
	on public.team_mission_notes
	for insert
	to authenticated
	with check ((select public.is_mentor()));

drop policy if exists "students write their own team's mission notes" on public.team_mission_notes;
create policy "students write their own team's mission notes"
	on public.team_mission_notes
	for insert
	to authenticated
	with check (team_id = (select public.current_student_team_id()));

drop policy if exists "mentors update every team's mission notes" on public.team_mission_notes;
create policy "mentors update every team's mission notes"
	on public.team_mission_notes
	for update
	to authenticated
	using ((select public.is_mentor()))
	with check ((select public.is_mentor()));

drop policy if exists "students update their own team's mission notes" on public.team_mission_notes;
create policy "students update their own team's mission notes"
	on public.team_mission_notes
	for update
	to authenticated
	using (team_id = (select public.current_student_team_id()))
	with check (team_id = (select public.current_student_team_id()));

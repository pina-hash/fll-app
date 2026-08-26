-- 0024_robot_configs_and_calibrations.sql
--
-- THE TWO NUMBERS THE CODE GENERATOR CANNOT GUESS: what this team's robot IS,
-- and what this team's sensors SEE in this room. Everything else the emitter
-- needs it derives.
--
-- Applied by the Supabase CLI, after 0023.
--
-- WHY THESE ARE ROWS AND NOT A FORM THE STUDENT RETYPES. src/lib/codegen bakes
-- both into the emitted project as literals: mm to motor degrees is
-- 360 * gear_ratio / (pi * wheel_diameter_mm), evaluated at generation time and
-- written into the blocks, and the light normalisation is
-- (raw - black) / (white - black) * 100 with the calibration constants baked.
-- A generated file is therefore only as right as the row it was generated from,
-- and a team that retypes 56 as 62 at the table on Saturday gets a toolkit that
-- drives 11 percent long in every single run. It is written down once, per team,
-- and the four teams differ.
--
-- WHY CALIBRATION IS A SEPARATE TABLE AND NOT COLUMNS ON THE CONFIG. White and
-- black are properties of the ROOM, not of the robot: the practice table under
-- fluorescent light and the competition hall under stage light give different
-- readings from the same sensor on the same mat. venue_label is what makes that
-- a first-class fact rather than a value quietly overwritten on the morning of
-- a tournament, and it is why the natural key is (team, port, venue) rather
-- than (team, port). A team keeps last week's practice numbers AND today's.
--
-- WHO EDITS. strategy_can_edit(team_id), delegated to rather than re-derived,
-- exactly as 0012's team_robots does: any mentor, and the Run Captain. A robot
-- configuration is Robot Design territory and it is the same population that
-- owns the route planner. Every teammate READS both tables; no other team reads
-- a word; a board device holds neither identity and sees neither.
--
-- WHAT THIS FILE DOES NOT DO.
--
--   * It adds NO function. There is no derived answer here: the arithmetic that
--     turns these rows into motor degrees lives in src/lib/codegen/toolkit.ts,
--     for the same reason the route geometry and the mat calibration transform
--     live in TypeScript (0017) rather than having a SQL twin. It recomputes
--     under a finger while a student drags a number, and there is no second
--     implementation to drift from.
--   * It puts NEITHER table in supabase_realtime. Same reasoning as the planner
--     and the notebook: one effective editor, local-first writes, and a refetch
--     landing under a child mid-edit would clobber the field they are typing.
--   * It teaches _student_detach_from_team() nothing, because NEITHER TABLE
--     NAMES A STUDENT. A configuration belongs to the team; a student leaving
--     changes nothing about the robot they leave behind.
--   * It adds no type. yaw_axis, the ports and the movement pair are CHECK
--     constraints rather than enums, so the reversal below is two drop table
--     statements and nothing else.
--
-- THIS FILE HAS NOT BEEN APPLIED ANYWHERE. It was written to disk and
-- committed, and nothing was pushed. See docs/HISTORY.md on 0019 through 0021:
-- a migration applied outside the chain leaves the ledger disagreeing with the
-- database and nothing notices until somebody goes looking. Whoever applies
-- this by hand in the SQL editor must follow it with
-- `supabase migration repair --status applied 0024`.
--
-- ===========================================================================
-- TO UNDO
-- ===========================================================================
--
--   drop table if exists public.calibrations;
--   drop table if exists public.robot_configs;
--
-- That is the whole reversal. Both tables are leaves: nothing references
-- either one, neither carries a function, a type, a publication membership or
-- a change to an existing object, and dropping a table takes its policies,
-- grants, indexes and triggers with it. Nothing later in the chain depends on
-- this file.

-- ---------------------------------------------------------------------------
-- 1. The robot. One row per named configuration; a team may keep more than
--    one (the season base, and the heavy attachment base built in January).
--    unique (id, team_id) exists so any future child can carry the composite
--    foreign key that makes cross-team parenting impossible by CONSTRAINT.
-- ---------------------------------------------------------------------------
create table if not exists public.robot_configs (
	id uuid primary key default gen_random_uuid(),
	team_id uuid not null references public.teams (id),
	name text not null default 'Driving base' check (length(btrim(name)) between 1 and 120),

	-- Geometry. The wheel is the one number a generated file is most sensitive
	-- to: the emitter turns it into a degrees-per-mm literal in four My Blocks.
	wheel_diameter_mm numeric not null default 56
		check (wheel_diameter_mm > 0 and wheel_diameter_mm <= 200),
	track_width_mm numeric not null default 112
		check (track_width_mm > 0 and track_width_mm <= 500),
	-- Motor rotations per wheel rotation. 1 is a direct drive.
	gear_ratio numeric not null default 1
		check (gear_ratio > 0 and gear_ratio <= 20),

	-- Ports. SPIKE Prime has six, A to F.
	movement_pair text not null default 'AB'
		check (movement_pair ~ '^[A-F][A-F]$' and substr(movement_pair, 1, 1) <> substr(movement_pair, 2, 1)),
	left_motor text not null default 'A' check (left_motor ~ '^[A-F]$'),
	right_motor text not null default 'B' check (right_motor ~ '^[A-F]$'),
	attachment_motors text[] not null default array['C', 'D']::text[]
		check (attachment_motors <@ array['A', 'B', 'C', 'D', 'E', 'F']::text[]
			and cardinality(attachment_motors) <= 6),
	left_color_port text not null default 'E' check (left_color_port ~ '^[A-F]$'),
	right_color_port text not null default 'F' check (right_color_port ~ '^[A-F]$'),

	-- Which way the hub is mounted. The emitter does not yet EMIT this (the
	-- SPIKE orientation block is not in the verified shape registry, so V9
	-- refuses it and the toolkit omits it), which means anything other than
	-- 'up' is currently recorded and not honoured. It is stored now so the row
	-- does not have to change when that shape is verified.
	yaw_axis text not null default 'up'
		check (yaw_axis in ('up', 'down', 'front', 'back', 'left', 'right')),

	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),

	constraint robot_configs_drive_motors_differ_check check (left_motor <> right_motor),
	constraint robot_configs_color_ports_differ_check check (left_color_port <> right_color_port),
	unique (team_id, name),
	unique (id, team_id)
);

comment on table public.robot_configs is
	'One named robot configuration for a team: wheel and track geometry, gear ratio, and which port every motor and colour sensor is on. src/lib/codegen bakes these into the generated SPIKE project as literals, so a wrong row is a wrong .llsp3 in every run. Edited by mentors and the Run Captain (strategy_can_edit); read by the whole team.';

create index if not exists robot_configs_team_idx on public.robot_configs (team_id, name);

drop trigger if exists robot_configs_set_updated_at on public.robot_configs;
create trigger robot_configs_set_updated_at
	before update on public.robot_configs
	for each row execute function public.set_updated_at();

drop trigger if exists robot_configs_immutable on public.robot_configs;
create trigger robot_configs_immutable
	before update on public.robot_configs
	for each row execute function public._immutable_columns('team_id', 'created_at');

-- ---------------------------------------------------------------------------
-- 2. The room. One reading pair per team per sensor per venue, so the natural
--    key is what a replayed write upserts on and last week's practice numbers
--    survive today's tournament reading.
-- ---------------------------------------------------------------------------
create table if not exists public.calibrations (
	id uuid primary key default gen_random_uuid(),
	team_id uuid not null references public.teams (id),
	sensor_port text not null check (sensor_port ~ '^[A-F]$'),
	-- Raw reflectivity, as the sensor reports it: 0 to 100.
	white integer not null check (white between 0 and 100),
	black integer not null check (black between 0 and 100),
	venue_label text not null default '' check (length(venue_label) <= 60),
	-- Server-stamped, like evidence.upload_timestamp and blockers.raised_at:
	-- "when this room was measured" is a fact about the server clock, not a
	-- value a tablet four minutes fast gets to assert. No client grant.
	captured_at timestamptz not null default now(),

	-- White must read lighter than black, or the normalisation the emitter
	-- bakes in divides by a negative and reports every dark reading as bright.
	constraint calibrations_white_above_black_check check (white > black),
	unique (team_id, sensor_port, venue_label),
	unique (id, team_id)
);

comment on table public.calibrations is
	'What one colour sensor reads on white and on black, in one room. The emitter bakes (raw - black) / (white - black) * 100 into the generated project, so these two numbers decide whether a line follower works in the hall it is run in. Keyed by venue so practice and competition readings coexist rather than overwriting each other.';

create index if not exists calibrations_team_idx on public.calibrations (team_id, sensor_port);

-- ---------------------------------------------------------------------------
-- 3. Grants. Client-minted ids in both insert grants (the write queue's
--    idempotency); team_id in neither update grant (the immutability trigger
--    is the backstop, the absent grant is the boundary); created_at,
--    updated_at and captured_at in none at all.
-- ---------------------------------------------------------------------------
revoke all on public.robot_configs from anon, authenticated;
grant all on public.robot_configs to service_role;
grant select on public.robot_configs to authenticated;
grant insert (id, team_id, name, wheel_diameter_mm, track_width_mm, gear_ratio, movement_pair, left_motor, right_motor, attachment_motors, left_color_port, right_color_port, yaw_axis)
	on public.robot_configs to authenticated;
grant update (name, wheel_diameter_mm, track_width_mm, gear_ratio, movement_pair, left_motor, right_motor, attachment_motors, left_color_port, right_color_port, yaw_axis)
	on public.robot_configs to authenticated;
grant delete on public.robot_configs to authenticated;

revoke all on public.calibrations from anon, authenticated;
grant all on public.calibrations to service_role;
grant select on public.calibrations to authenticated;
grant insert (id, team_id, sensor_port, white, black, venue_label) on public.calibrations to authenticated;
grant update (white, black) on public.calibrations to authenticated;
grant delete on public.calibrations to authenticated;

-- ---------------------------------------------------------------------------
-- 4. RLS. Reads: mentors and the row's own team, the same clause every
--    team-scoped table in this schema uses. Writes: strategy_can_edit, the
--    single statement of "who owns Robot Design", called and not re-derived.
-- ---------------------------------------------------------------------------
alter table public.robot_configs enable row level security;
alter table public.calibrations enable row level security;

drop policy if exists "mentors and the team read robot configs" on public.robot_configs;
create policy "mentors and the team read robot configs"
	on public.robot_configs
	for select
	to authenticated
	using ((select public.is_mentor()) or team_id = (select public.current_student_team_id()));

drop policy if exists "strategy editors create robot configs" on public.robot_configs;
create policy "strategy editors create robot configs"
	on public.robot_configs
	for insert
	to authenticated
	with check (public.strategy_can_edit(team_id));

drop policy if exists "strategy editors update robot configs" on public.robot_configs;
create policy "strategy editors update robot configs"
	on public.robot_configs
	for update
	to authenticated
	using (public.strategy_can_edit(team_id))
	with check (public.strategy_can_edit(team_id));

drop policy if exists "strategy editors delete robot configs" on public.robot_configs;
create policy "strategy editors delete robot configs"
	on public.robot_configs
	for delete
	to authenticated
	using (public.strategy_can_edit(team_id));

drop policy if exists "mentors and the team read calibrations" on public.calibrations;
create policy "mentors and the team read calibrations"
	on public.calibrations
	for select
	to authenticated
	using ((select public.is_mentor()) or team_id = (select public.current_student_team_id()));

drop policy if exists "strategy editors create calibrations" on public.calibrations;
create policy "strategy editors create calibrations"
	on public.calibrations
	for insert
	to authenticated
	with check (public.strategy_can_edit(team_id));

drop policy if exists "strategy editors update calibrations" on public.calibrations;
create policy "strategy editors update calibrations"
	on public.calibrations
	for update
	to authenticated
	using (public.strategy_can_edit(team_id))
	with check (public.strategy_can_edit(team_id));

drop policy if exists "strategy editors delete calibrations" on public.calibrations;
create policy "strategy editors delete calibrations"
	on public.calibrations
	for delete
	to authenticated
	using (public.strategy_can_edit(team_id));

do $$
begin
	raise notice '0024: robot_configs and calibrations created, RLS on, writes gated on strategy_can_edit.';
end;
$$;

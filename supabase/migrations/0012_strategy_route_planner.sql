-- 0012_strategy_route_planner.sql
--
-- THE ROUTE PLANNER'S SCHEMA: one versioned strategy per team, made of
-- ordered launches, each with its missions and its route of waypoints, plus
-- the per-team robot profile, the mat setup singleton, and the mat photo
-- bucket.
--
-- Applied by the Supabase CLI, after 0011.
--
-- WHAT A STRATEGY IS. A team has ONE strategy, kept as versions so plans can
-- be compared: `strategies` rows share a team_id and differ by `version`, and
-- the highest version is the working copy every edit lands on. A launch is a
-- named trip out of the launch area with an attachment, an ordered list of
-- missions attempted (each with the scoring lines the team plans to score),
-- and a route: ordered waypoints in mat millimeters. The geometry that turns
-- a route into robot moves (turn N degrees, drive N cm) lives in
-- src/lib/planner/geometry.ts and NOWHERE in SQL: it must recompute live
-- under a child's finger on a tablet that may be offline, which is the one
-- place the repo's derived-answer-in-SQL rule cannot reach. There is no SQL
-- twin; the rule is still defined exactly once.
--
-- WHO EDITS. The Run Captain owns the strategy; every teammate views;
-- mentors view and edit all four teams. `strategy_can_edit()` is the one
-- statement of that rule, and it delegates WHO IS THE RUN CAPTAIN to
-- team_resolve_roles() (0009/0010) rather than re-deriving it: when the
-- current meeting has an active run captain (the covering rule), only that
-- student edits; when nobody is active (no meeting, or no one checked in),
-- the primary and second assignment holders may edit, so a captain can plan
-- from home. Every policy on every planner table calls this one function.
--
-- WHY DIRECT TABLE WRITES AND NOT RPCs. The student runtime's local-first
-- write queue replays idempotent inserts and updates against tables; these
-- tables follow 0007's divergence-from-idea-app: client-minted ids in every
-- insert grant, updated_at server-stamped, natural unique keys where a retry
-- must be an upsert. Nothing here touches auth.users, so nothing needs a
-- definer RPC except strategy_snapshot, which copies a whole tree atomically.
--
-- WHY THESE TABLES ARE NOT IN supabase_realtime. The planner is local-first:
-- while a captain drags a waypoint the client's own model is the truth, and a
-- realtime refetch landing mid-gesture would clobber the plan under their
-- finger. There is one effective editor per team by role, so the
-- collaboration realtime buys elsewhere does not exist here. Deliberate.
--
-- WHAT THIS FILE DOES NOT DO. It does not seed mission positions (the mentor
-- places those from the rulebook; inventing them was explicitly ruled out),
-- does not seed a launch area size (same reason; mat_config ships with
-- nulls), and does not add any mission artwork or mat imagery: the mat photo
-- bucket holds the club's OWN photo of its own mat, uploaded by a mentor.
--
-- ===========================================================================
-- TO UNDO
-- ===========================================================================
--
--   drop policy if exists "mat objects: mentors do everything" on storage.objects;
--   drop policy if exists "mat objects: signed-in users read the mat photo" on storage.objects;
--   delete from storage.buckets where id = 'mat';  -- refuses while objects remain; empty it first
--   drop function if exists public.strategy_snapshot(uuid, text);
--   drop table if exists public.waypoints;
--   drop table if exists public.launch_missions;
--   drop table if exists public.launches;
--   drop table if exists public.strategies;
--   drop table if exists public.team_robots;
--   drop table if exists public.mat_config;
--   drop function if exists public.strategy_can_edit(uuid);

-- ---------------------------------------------------------------------------
-- 1. The edit rule, defined once. SECURITY DEFINER so it may call the
--    private meeting resolver and team_resolve_roles; granted to
--    authenticated because every planner policy names it.
-- ---------------------------------------------------------------------------
create or replace function public.strategy_can_edit(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select public.is_mentor()
		or exists (
			select 1
			from public.team_resolve_roles(p_team_id, public._resolve_current_meeting_id()) r
			where r.role = 'run_captain'
				and case
					when r.active_student_id is not null
						then r.active_student_id = public.current_student_id()
					else public.current_student_id() in (r.primary_student_id, r.second_student_id)
				end
		);
$$;

revoke all on function public.strategy_can_edit(uuid) from public;
grant execute on function public.strategy_can_edit(uuid) to authenticated;

comment on function public.strategy_can_edit(uuid) is
	'True when the caller may edit this team''s strategy: any mentor, the active run captain while a meeting has one (team_resolve_roles'' covering rule), otherwise the run captain assignment holders. The single statement of the edit rule; every planner policy calls it.';

-- ---------------------------------------------------------------------------
-- 2. The per-team robot profile. One row per team; the queue replays writes
--    as upserts on the natural key (team_id).
-- ---------------------------------------------------------------------------
create table if not exists public.team_robots (
	id uuid primary key default gen_random_uuid(),
	team_id uuid not null unique references public.teams (id),
	width_mm integer not null default 160 check (width_mm > 0 and width_mm <= 1143),
	length_mm integer not null default 200 check (length_mm > 0 and length_mm <= 1143),
	speed_cm_s numeric not null default 30 check (speed_cm_s > 0 and speed_cm_s <= 200),
	dwell_s numeric not null default 5 check (dwell_s >= 0 and dwell_s <= 60),
	between_launches_s numeric not null default 8 check (between_launches_s >= 0 and between_launches_s <= 60),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

comment on table public.team_robots is
	'One robot profile per team: footprint (mm), speed (cm/s, spec default 30), dwell per mission attempted, and handling time between launches. The four robots differ; every number here is mentor-and-run-captain configurable.';

drop trigger if exists team_robots_set_updated_at on public.team_robots;
create trigger team_robots_set_updated_at
	before update on public.team_robots
	for each row execute function public.set_updated_at();

drop trigger if exists team_robots_immutable on public.team_robots;
create trigger team_robots_immutable
	before update on public.team_robots
	for each row execute function public._immutable_columns('team_id');

-- ---------------------------------------------------------------------------
-- 3. Strategies: one per team, versioned. unique (id, team_id) exists so
--    children can carry the composite foreign key that makes cross-team
--    parenting impossible by CONSTRAINT, before any policy is consulted.
-- ---------------------------------------------------------------------------
create table if not exists public.strategies (
	id uuid primary key default gen_random_uuid(),
	team_id uuid not null references public.teams (id),
	version integer not null check (version >= 1),
	label text check (label is null or length(btrim(label)) between 1 and 120),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (team_id, version),
	unique (id, team_id)
);

comment on table public.strategies is
	'One robot-game strategy per team, kept as versions for comparison. The highest version is the working copy; strategy_snapshot() freezes it and starts the next.';

create index if not exists strategies_team_idx on public.strategies (team_id);

drop trigger if exists strategies_set_updated_at on public.strategies;
create trigger strategies_set_updated_at
	before update on public.strategies
	for each row execute function public.set_updated_at();

drop trigger if exists strategies_immutable on public.strategies;
create trigger strategies_immutable
	before update on public.strategies
	for each row execute function public._immutable_columns('team_id', 'version');

-- ---------------------------------------------------------------------------
-- 4. Launches: an ordered trip out of the launch area.
-- ---------------------------------------------------------------------------
create table if not exists public.launches (
	id uuid primary key default gen_random_uuid(),
	strategy_id uuid not null,
	team_id uuid not null,
	name text not null default '' check (length(name) <= 120),
	attachment_name text not null default '' check (length(attachment_name) <= 120),
	sort_order integer not null default 0,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (id, team_id),
	foreign key (strategy_id, team_id) references public.strategies (id, team_id) on delete cascade
);

comment on table public.launches is
	'One launch of a strategy: a name, the attachment it carries, and (via launch_missions and waypoints) what it attempts and where it drives. Estimated duration is DERIVED in src/lib/planner/geometry.ts, never stored.';

create index if not exists launches_strategy_idx on public.launches (strategy_id);

drop trigger if exists launches_set_updated_at on public.launches;
create trigger launches_set_updated_at
	before update on public.launches
	for each row execute function public.set_updated_at();

drop trigger if exists launches_immutable on public.launches;
create trigger launches_immutable
	before update on public.launches
	for each row execute function public._immutable_columns('strategy_id', 'team_id');

-- ---------------------------------------------------------------------------
-- 5. The missions a launch attempts. scoring_lines holds the indexes of the
--    scoring lines (missions.scoring) the team plans to score, so the point
--    total is a plan, not a guess at multiplicities.
-- ---------------------------------------------------------------------------
create table if not exists public.launch_missions (
	id uuid primary key default gen_random_uuid(),
	launch_id uuid not null,
	team_id uuid not null,
	mission_id uuid not null references public.missions (id),
	sort_order integer not null default 0,
	scoring_lines integer[] not null default '{}',
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (launch_id, mission_id),
	foreign key (launch_id, team_id) references public.launches (id, team_id) on delete cascade
);

comment on table public.launch_missions is
	'One mission attempted by one launch, at most once per launch. scoring_lines indexes into missions.scoring: the lines the team plans to score.';

create index if not exists launch_missions_launch_idx on public.launch_missions (launch_id);

drop trigger if exists launch_missions_set_updated_at on public.launch_missions;
create trigger launch_missions_set_updated_at
	before update on public.launch_missions
	for each row execute function public.set_updated_at();

drop trigger if exists launch_missions_immutable on public.launch_missions;
create trigger launch_missions_immutable
	before update on public.launch_missions
	for each row execute function public._immutable_columns('launch_id', 'team_id', 'mission_id');

-- ---------------------------------------------------------------------------
-- 6. Waypoints: the route, in mat millimeters, origin at the launch area
--    corner. The checks pin every point to the physical mat.
-- ---------------------------------------------------------------------------
create table if not exists public.waypoints (
	id uuid primary key default gen_random_uuid(),
	launch_id uuid not null,
	team_id uuid not null,
	x_mm integer not null check (x_mm between 0 and 2362),
	y_mm integer not null check (y_mm between 0 and 1143),
	sort_order integer not null default 0,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	foreign key (launch_id, team_id) references public.launches (id, team_id) on delete cascade
);

comment on table public.waypoints is
	'One waypoint of a launch route, in mat millimeters (the mat is 2362 by 1143). Ordered by (sort_order, created_at, id); the movement list is derived client-side in geometry.ts.';

create index if not exists waypoints_launch_idx on public.waypoints (launch_id);

drop trigger if exists waypoints_set_updated_at on public.waypoints;
create trigger waypoints_set_updated_at
	before update on public.waypoints
	for each row execute function public.set_updated_at();

drop trigger if exists waypoints_immutable on public.waypoints;
create trigger waypoints_immutable
	before update on public.waypoints
	for each row execute function public._immutable_columns('launch_id', 'team_id');

-- ---------------------------------------------------------------------------
-- 7. The mat setup singleton: the launch area's size, measured from the
--    rulebook by a mentor. Origin IS the launch area corner by the
--    coordinate system's definition, so a width and height suffice. Ships
--    null: the planner shades nothing and skips the returns-to-base warning
--    until a mentor measures. Global like missions: all four teams play the
--    same mat.
-- ---------------------------------------------------------------------------
create table if not exists public.mat_config (
	id boolean primary key default true check (id),
	launch_area_w_mm integer check (launch_area_w_mm is null or (launch_area_w_mm > 0 and launch_area_w_mm <= 2362)),
	launch_area_h_mm integer check (launch_area_h_mm is null or (launch_area_h_mm > 0 and launch_area_h_mm <= 1143)),
	updated_at timestamptz not null default now()
);

comment on table public.mat_config is
	'The one row of mat setup shared by every team: the launch area rectangle anchored at the origin. Null until a mentor sets it from the rulebook; this file seeds no dimensions on purpose.';

insert into public.mat_config (id) values (true) on conflict (id) do nothing;

drop trigger if exists mat_config_set_updated_at on public.mat_config;
create trigger mat_config_set_updated_at
	before update on public.mat_config
	for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 8. Grants. This image's default ACL gives the API roles nothing useful, so
--    every table states its own. Client-minted ids appear in every insert
--    grant (the queue's idempotency); created_at/updated_at appear in none
--    (server-stamped).
-- ---------------------------------------------------------------------------
revoke all on public.team_robots from anon, authenticated;
grant all on public.team_robots to service_role;
grant select on public.team_robots to authenticated;
grant insert (id, team_id, width_mm, length_mm, speed_cm_s, dwell_s, between_launches_s) on public.team_robots to authenticated;
grant update (width_mm, length_mm, speed_cm_s, dwell_s, between_launches_s) on public.team_robots to authenticated;

revoke all on public.strategies from anon, authenticated;
grant all on public.strategies to service_role;
grant select on public.strategies to authenticated;
grant insert (id, team_id, version, label) on public.strategies to authenticated;
grant update (label) on public.strategies to authenticated;
grant delete on public.strategies to authenticated;

revoke all on public.launches from anon, authenticated;
grant all on public.launches to service_role;
grant select on public.launches to authenticated;
grant insert (id, strategy_id, team_id, name, attachment_name, sort_order) on public.launches to authenticated;
grant update (name, attachment_name, sort_order) on public.launches to authenticated;
grant delete on public.launches to authenticated;

revoke all on public.launch_missions from anon, authenticated;
grant all on public.launch_missions to service_role;
grant select on public.launch_missions to authenticated;
grant insert (id, launch_id, team_id, mission_id, sort_order, scoring_lines) on public.launch_missions to authenticated;
grant update (sort_order, scoring_lines) on public.launch_missions to authenticated;
grant delete on public.launch_missions to authenticated;

revoke all on public.waypoints from anon, authenticated;
grant all on public.waypoints to service_role;
grant select on public.waypoints to authenticated;
grant insert (id, launch_id, team_id, x_mm, y_mm, sort_order) on public.waypoints to authenticated;
grant update (x_mm, y_mm, sort_order) on public.waypoints to authenticated;
grant delete on public.waypoints to authenticated;

revoke all on public.mat_config from anon, authenticated;
grant all on public.mat_config to service_role;
grant select on public.mat_config to authenticated;
grant update (launch_area_w_mm, launch_area_h_mm) on public.mat_config to authenticated;

-- ---------------------------------------------------------------------------
-- 9. RLS. Reads: mentors and the row's own team. Writes: strategy_can_edit,
--    every table, every operation. Board devices hold none of these reads: a
--    board is a device, and the plan is the team's thinking, not the board's
--    scoreboard.
-- ---------------------------------------------------------------------------
alter table public.team_robots enable row level security;
alter table public.strategies enable row level security;
alter table public.launches enable row level security;
alter table public.launch_missions enable row level security;
alter table public.waypoints enable row level security;
alter table public.mat_config enable row level security;

drop policy if exists "mentors and the team read the robot profile" on public.team_robots;
create policy "mentors and the team read the robot profile"
	on public.team_robots
	for select
	to authenticated
	using ((select public.is_mentor()) or team_id = (select public.current_student_team_id()));

drop policy if exists "strategy editors create the robot profile" on public.team_robots;
create policy "strategy editors create the robot profile"
	on public.team_robots
	for insert
	to authenticated
	with check (public.strategy_can_edit(team_id));

drop policy if exists "strategy editors update the robot profile" on public.team_robots;
create policy "strategy editors update the robot profile"
	on public.team_robots
	for update
	to authenticated
	using (public.strategy_can_edit(team_id))
	with check (public.strategy_can_edit(team_id));

drop policy if exists "mentors and the team read strategies" on public.strategies;
create policy "mentors and the team read strategies"
	on public.strategies
	for select
	to authenticated
	using ((select public.is_mentor()) or team_id = (select public.current_student_team_id()));

drop policy if exists "strategy editors create strategies" on public.strategies;
create policy "strategy editors create strategies"
	on public.strategies
	for insert
	to authenticated
	with check (public.strategy_can_edit(team_id));

drop policy if exists "strategy editors update strategies" on public.strategies;
create policy "strategy editors update strategies"
	on public.strategies
	for update
	to authenticated
	using (public.strategy_can_edit(team_id))
	with check (public.strategy_can_edit(team_id));

drop policy if exists "strategy editors delete strategies" on public.strategies;
create policy "strategy editors delete strategies"
	on public.strategies
	for delete
	to authenticated
	using (public.strategy_can_edit(team_id));

drop policy if exists "mentors and the team read launches" on public.launches;
create policy "mentors and the team read launches"
	on public.launches
	for select
	to authenticated
	using ((select public.is_mentor()) or team_id = (select public.current_student_team_id()));

drop policy if exists "strategy editors create launches" on public.launches;
create policy "strategy editors create launches"
	on public.launches
	for insert
	to authenticated
	with check (public.strategy_can_edit(team_id));

drop policy if exists "strategy editors update launches" on public.launches;
create policy "strategy editors update launches"
	on public.launches
	for update
	to authenticated
	using (public.strategy_can_edit(team_id))
	with check (public.strategy_can_edit(team_id));

drop policy if exists "strategy editors delete launches" on public.launches;
create policy "strategy editors delete launches"
	on public.launches
	for delete
	to authenticated
	using (public.strategy_can_edit(team_id));

drop policy if exists "mentors and the team read launch missions" on public.launch_missions;
create policy "mentors and the team read launch missions"
	on public.launch_missions
	for select
	to authenticated
	using ((select public.is_mentor()) or team_id = (select public.current_student_team_id()));

drop policy if exists "strategy editors create launch missions" on public.launch_missions;
create policy "strategy editors create launch missions"
	on public.launch_missions
	for insert
	to authenticated
	with check (public.strategy_can_edit(team_id));

drop policy if exists "strategy editors update launch missions" on public.launch_missions;
create policy "strategy editors update launch missions"
	on public.launch_missions
	for update
	to authenticated
	using (public.strategy_can_edit(team_id))
	with check (public.strategy_can_edit(team_id));

drop policy if exists "strategy editors delete launch missions" on public.launch_missions;
create policy "strategy editors delete launch missions"
	on public.launch_missions
	for delete
	to authenticated
	using (public.strategy_can_edit(team_id));

drop policy if exists "mentors and the team read waypoints" on public.waypoints;
create policy "mentors and the team read waypoints"
	on public.waypoints
	for select
	to authenticated
	using ((select public.is_mentor()) or team_id = (select public.current_student_team_id()));

drop policy if exists "strategy editors create waypoints" on public.waypoints;
create policy "strategy editors create waypoints"
	on public.waypoints
	for insert
	to authenticated
	with check (public.strategy_can_edit(team_id));

drop policy if exists "strategy editors update waypoints" on public.waypoints;
create policy "strategy editors update waypoints"
	on public.waypoints
	for update
	to authenticated
	using (public.strategy_can_edit(team_id))
	with check (public.strategy_can_edit(team_id));

drop policy if exists "strategy editors delete waypoints" on public.waypoints;
create policy "strategy editors delete waypoints"
	on public.waypoints
	for delete
	to authenticated
	using (public.strategy_can_edit(team_id));

drop policy if exists "everyone signed in reads the mat setup" on public.mat_config;
create policy "everyone signed in reads the mat setup"
	on public.mat_config
	for select
	to authenticated
	using (true);

drop policy if exists "mentors update the mat setup" on public.mat_config;
create policy "mentors update the mat setup"
	on public.mat_config
	for update
	to authenticated
	using ((select public.is_mentor()))
	with check ((select public.is_mentor()));

-- ---------------------------------------------------------------------------
-- 10. strategy_snapshot: freeze the working copy under a label and start the
--     next version as an identical copy. The one tree-copy that must be
--     atomic, hence the one RPC in this file.
-- ---------------------------------------------------------------------------
create or replace function public.strategy_snapshot(p_team_id uuid, p_label text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_src public.strategies%rowtype;
	v_launch public.launches%rowtype;
	v_new_id uuid := gen_random_uuid();
	v_new_launch_id uuid;
begin
	if p_team_id is null then
		raise exception 'Pick a team first.';
	end if;
	if not public.strategy_can_edit(p_team_id) then
		raise exception 'Only the Run Captain or a mentor can save a strategy version.';
	end if;

	-- Serialize concurrent snapshots of one team's strategy.
	perform 1 from public.strategies s where s.team_id = p_team_id for update;

	select s.* into v_src
	from public.strategies s
	where s.team_id = p_team_id
	order by s.version desc
	limit 1;
	if not found then
		raise exception 'There is no strategy to save yet.';
	end if;

	-- The frozen version gets the name the team just gave it; the new working
	-- copy starts unlabeled.
	if p_label is not null and length(btrim(p_label)) > 0 then
		update public.strategies set label = btrim(p_label) where id = v_src.id;
	end if;

	insert into public.strategies (id, team_id, version, label)
	values (v_new_id, p_team_id, v_src.version + 1, null);

	for v_launch in
		select l.* from public.launches l
		where l.strategy_id = v_src.id
		order by l.sort_order, l.created_at, l.id
	loop
		v_new_launch_id := gen_random_uuid();
		insert into public.launches (id, strategy_id, team_id, name, attachment_name, sort_order)
		values (v_new_launch_id, v_new_id, p_team_id, v_launch.name, v_launch.attachment_name, v_launch.sort_order);

		insert into public.launch_missions (id, launch_id, team_id, mission_id, sort_order, scoring_lines)
		select gen_random_uuid(), v_new_launch_id, p_team_id, lm.mission_id, lm.sort_order, lm.scoring_lines
		from public.launch_missions lm
		where lm.launch_id = v_launch.id;

		insert into public.waypoints (id, launch_id, team_id, x_mm, y_mm, sort_order)
		select gen_random_uuid(), v_new_launch_id, p_team_id, w.x_mm, w.y_mm, w.sort_order
		from public.waypoints w
		where w.launch_id = v_launch.id;
	end loop;

	return jsonb_build_object('strategy_id', v_new_id, 'version', v_src.version + 1);
end;
$$;

revoke all on function public.strategy_snapshot(uuid, text) from public;
grant execute on function public.strategy_snapshot(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. The mat photo bucket. Private; ONE object, the club's own top-down
--     photo of its own mat, always at mat.jpg (the client converts whatever
--     the camera produced to JPEG and caps its size before upload, so every
--     device can decode it). Mentors write; anyone signed in reads through a
--     signed URL. No FIRST or LEGO artwork is ever fetched or stored here.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mat', 'mat', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
	set public = excluded.public,
		file_size_limit = excluded.file_size_limit,
		allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "mat objects: mentors do everything" on storage.objects;
create policy "mat objects: mentors do everything"
	on storage.objects
	for all
	to authenticated
	using (bucket_id = 'mat' and (select public.is_mentor()))
	with check (bucket_id = 'mat' and (select public.is_mentor()));

drop policy if exists "mat objects: signed-in users read the mat photo" on storage.objects;
create policy "mat objects: signed-in users read the mat photo"
	on storage.objects
	for select
	to authenticated
	using (bucket_id = 'mat');

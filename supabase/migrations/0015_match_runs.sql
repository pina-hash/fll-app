-- 0015_match_runs.sql
--
-- PRACTICE RUNS: the 2:30 match a team drives at the mat, what it attempted,
-- what it actually scored, and the number that goes up.
--
-- Applied by the Supabase CLI, after 0014.
--
-- THIS IS NOT THE PHASE TIMER. 0006/0009's meetings and meeting_phases run
-- the SESSION: one shared 90-minute Friday for all four teams, driven by a
-- mentor, broadcast over realtime, ticking off a server clock with the skew
-- corrected (0009's server_now rule) because a tablet four minutes fast would
-- show four minutes of phantom overrun. A match run is the opposite kind of
-- clock in every respect: 150 seconds, per team, started by whoever is
-- standing at the mat, and measured on the DEVICE. There is no server_now
-- here and there must not be: the countdown has to be exact and continuous
-- while the phone is in a gym with no signal, which a corrected server clock
-- cannot promise and a local monotonic clock can. The two never share code.
--
-- A SCORE IS COMPUTED, NEVER SENT. `match_run_scores.points` and
-- `match_runs.points` appear in NO client grant. A row says which mission and
-- which scoring line (an index into missions.scoring, 0011) and how many
-- times; a BEFORE trigger prices it from the missions table, and an AFTER
-- trigger re-totals the run. So the team's best score is a fact about the
-- mission list and what they ticked, not a number a device claimed -- which
-- matters precisely because this is the number a nine-year-old opens the app
-- to see, and a scoreboard you can type into is not a scoreboard.
--
-- WHY A RUN OPTIONALLY NAMES A STRATEGY VERSION. 0012 keeps a team's strategy
-- as versions so plans can be compared, and the question that makes versions
-- worth keeping is "did v2 actually beat v1?". match_runs.strategy_id answers
-- it, as a composite key so a run can only cite its own team's plan, and
-- nullable so a run driven with no plan at all is still loggable -- refusing
-- to record a run because nobody filled in a form is how you end up with no
-- data at all.
--
-- WHO MAY LOG ONE. Anybody on the team, plus mentors, plus the team board
-- iPad -- NOT just the Run Captain. 0012 restricts EDITING THE PLAN to the
-- captain because a plan is one team's single shared document; a run log is
-- an observation, made in three seconds by whoever has a free hand while the
-- robot is still moving. The board device gets it too because the spare iPad
-- propped on the table is the thing most likely to be within reach of the
-- mat, and because a run has no author to impersonate: logged_by_student_id
-- and logged_by_mentor_id are BOTH nullable and there is no
-- exactly-one-creator constraint here (unlike tasks, 0007), so a board logs a
-- run as the team rather than as a person.
--
-- WHAT HAPPENS TO A RUN WHEN ITS LOGGER LEAVES THE TEAM. 0013 lets a mentor
-- move a student between teams, and every row carrying (student_id, team_id)
-- has to answer for that or the composite key refuses the move. A run belongs
-- to the TEAM that drove it, so the run stays and only the attribution goes.
-- That detaching happens in 0013's _student_detach_from_team(), which this
-- file REPLACES to add one statement -- the same single-definition move the
-- rest of the chain makes when a later bundle teaches an older rule about a
-- new table. It cannot be a foreign-key action instead: Postgres accepts a
-- column list only on ON DELETE SET NULL, and a bare ON UPDATE SET NULL would
-- try to null team_id, which is NOT NULL. The mentor is NOT told about it,
-- unlike the role and task assignments the same helper clears, because a name
-- disappearing from a practice run in October changes nothing they can see.
--
-- WHAT THIS FILE DOES NOT DO. It does not publish to realtime: a run is
-- logged once, by the person holding the phone, and a live-updating history
-- while somebody is typing a note would be motion for its own sake. It does
-- not model the official scoresheet's precondition rules (equipment
-- constraints, opposing-team interactions) -- the scoring LINES come from the
-- season's mission list and a team ticks what they saw. It does not store the
-- countdown length; 150 seconds is the match, it is a constant in
-- src/lib/match/rules.ts, and nothing in SQL uses it.
--
-- ===========================================================================
-- TO UNDO
-- ===========================================================================
--
--   drop function if exists public.match_run_history(uuid);
--   -- then re-create 0013's public._student_detach_from_team(uuid) verbatim
--   -- (it knows nothing about match_runs).
--   drop trigger if exists match_run_scores_total on public.match_run_scores;
--   drop function if exists public._match_runs_total();
--   drop trigger if exists match_run_scores_price on public.match_run_scores;
--   drop function if exists public._match_run_scores_price();
--   drop table if exists public.match_run_scores;
--   drop table if exists public.match_run_launches;
--   drop table if exists public.match_runs;
--
-- Nothing later in the chain depends on this file.

-- ---------------------------------------------------------------------------
-- 1. The run. points has no client grant: section 4's triggers own it.
-- ---------------------------------------------------------------------------
create table if not exists public.match_runs (
	id uuid primary key default gen_random_uuid(),
	team_id uuid not null references public.teams (id),
	strategy_id uuid,
	started_at timestamptz not null default now(),
	elapsed_s integer check (elapsed_s is null or (elapsed_s >= 0 and elapsed_s <= 3600)),
	points integer not null default 0,
	note text not null default '' check (length(note) <= 500),
	logged_by_student_id uuid,
	logged_by_mentor_id uuid references public.mentors (id),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (id, team_id),
	foreign key (strategy_id, team_id) references public.strategies (id, team_id)
		on delete set null (strategy_id),
	foreign key (logged_by_student_id, team_id) references public.students (id, team_id)
);

comment on table public.match_runs is
	'One practice match. points is DERIVED from match_run_scores by trigger and appears in no client grant. started_at is client-supplied because the phone at the mat may be offline; elapsed_s is what the device''s own clock measured.';

comment on column public.match_runs.strategy_id is
	'The strategy version this run was driven against, so "did v2 beat v1" is answerable. Composite key: a run can only cite its own team''s plan.';

create index if not exists match_runs_team_started_idx on public.match_runs (team_id, started_at desc);

drop trigger if exists match_runs_set_updated_at on public.match_runs;
create trigger match_runs_set_updated_at
	before update on public.match_runs
	for each row execute function public.set_updated_at();

drop trigger if exists match_runs_immutable on public.match_runs;
create trigger match_runs_immutable
	before update on public.match_runs
	for each row execute function public._immutable_columns('team_id', 'created_at');

-- ---------------------------------------------------------------------------
-- 2. Which launches were attempted. `launch_id` cites the plan's launch when
--    there is one; `name` carries what the team called it either way, so a
--    deleted plan does not erase what happened.
-- ---------------------------------------------------------------------------
create table if not exists public.match_run_launches (
	id uuid primary key default gen_random_uuid(),
	run_id uuid not null,
	team_id uuid not null,
	launch_id uuid,
	name text not null default '' check (length(name) <= 120),
	attempted boolean not null default true,
	sort_order integer not null default 0,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (id, team_id),
	foreign key (run_id, team_id) references public.match_runs (id, team_id) on delete cascade,
	foreign key (launch_id, team_id) references public.launches (id, team_id)
		on delete set null (launch_id)
);

comment on table public.match_run_launches is
	'One launch of one practice run, and whether the team actually got it out. name is kept alongside launch_id so the record survives the plan being edited or deleted.';

create index if not exists match_run_launches_run_idx on public.match_run_launches (run_id);

drop trigger if exists match_run_launches_set_updated_at on public.match_run_launches;
create trigger match_run_launches_set_updated_at
	before update on public.match_run_launches
	for each row execute function public.set_updated_at();

drop trigger if exists match_run_launches_immutable on public.match_run_launches;
create trigger match_run_launches_immutable
	before update on public.match_run_launches
	for each row execute function public._immutable_columns('run_id', 'team_id');

-- ---------------------------------------------------------------------------
-- 3. What was scored. line_index indexes into missions.scoring (0011), the
--    same way launch_missions.scoring_lines does, so a plan and a result
--    speak about the same lines.
-- ---------------------------------------------------------------------------
create table if not exists public.match_run_scores (
	id uuid primary key default gen_random_uuid(),
	run_id uuid not null,
	team_id uuid not null,
	mission_id uuid not null references public.missions (id),
	line_index integer not null check (line_index >= 0 and line_index < 20),
	quantity integer not null default 1 check (quantity between 1 and 20),
	points integer not null default 0,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (run_id, mission_id, line_index),
	foreign key (run_id, team_id) references public.match_runs (id, team_id) on delete cascade
);

comment on table public.match_run_scores is
	'One scoring line achieved in one run, times how many. points is priced from missions.scoring by trigger and has no client grant: a device says WHAT it scored, never how much it is worth.';

create index if not exists match_run_scores_run_idx on public.match_run_scores (run_id);

drop trigger if exists match_run_scores_set_updated_at on public.match_run_scores;
create trigger match_run_scores_set_updated_at
	before update on public.match_run_scores
	for each row execute function public.set_updated_at();

drop trigger if exists match_run_scores_immutable on public.match_run_scores;
create trigger match_run_scores_immutable
	before update on public.match_run_scores
	for each row execute function public._immutable_columns('run_id', 'team_id', 'mission_id', 'line_index');

-- ---------------------------------------------------------------------------
-- 4. The two triggers that own every number on this surface.
-- ---------------------------------------------------------------------------

-- Prices one line from the season's mission list. Definer so the price does
-- not depend on the caller's read policies.
create or replace function public._match_run_scores_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_line jsonb;
	v_name text;
begin
	select m.scoring -> new.line_index, m.name into v_line, v_name
	from public.missions m
	where m.id = new.mission_id;

	if v_name is null then
		raise exception 'That mission is not in this season''s mission list.';
	end if;
	if v_line is null then
		raise exception '% does not have a scoring line number %.', v_name, new.line_index;
	end if;

	new.points := new.quantity * coalesce((v_line ->> 'points')::integer, 0);
	return new;
end;
$$;
revoke all on function public._match_run_scores_price() from public;

drop trigger if exists match_run_scores_price on public.match_run_scores;
create trigger match_run_scores_price
	before insert or update on public.match_run_scores
	for each row execute function public._match_run_scores_price();

-- Re-totals the run. Definer because the client holds no write grant on
-- match_runs.points, which is the point.
create or replace function public._match_runs_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_run uuid;
begin
	if tg_op = 'DELETE' then
		v_run := old.run_id;
	else
		v_run := new.run_id;
	end if;

	update public.match_runs r
	set points = coalesce(
		(select sum(s.points)::integer from public.match_run_scores s where s.run_id = v_run),
		0
	)
	where r.id = v_run;

	return null;
end;
$$;
revoke all on function public._match_runs_total() from public;

drop trigger if exists match_run_scores_total on public.match_run_scores;
create trigger match_run_scores_total
	after insert or update or delete on public.match_run_scores
	for each row execute function public._match_runs_total();

-- ---------------------------------------------------------------------------
-- 5. Grants. Client-minted ids in every insert grant (the write queue's
--    idempotency); points in none; created_at/updated_at in none.
-- ---------------------------------------------------------------------------
revoke all on public.match_runs from anon, authenticated;
grant all on public.match_runs to service_role;
grant select on public.match_runs to authenticated;
grant insert (id, team_id, strategy_id, started_at, elapsed_s, note, logged_by_student_id, logged_by_mentor_id)
	on public.match_runs to authenticated;
grant update (strategy_id, elapsed_s, note) on public.match_runs to authenticated;
grant delete on public.match_runs to authenticated;

revoke all on public.match_run_launches from anon, authenticated;
grant all on public.match_run_launches to service_role;
grant select on public.match_run_launches to authenticated;
grant insert (id, run_id, team_id, launch_id, name, attempted, sort_order)
	on public.match_run_launches to authenticated;
grant update (launch_id, name, attempted, sort_order) on public.match_run_launches to authenticated;
grant delete on public.match_run_launches to authenticated;

revoke all on public.match_run_scores from anon, authenticated;
grant all on public.match_run_scores to service_role;
grant select on public.match_run_scores to authenticated;
grant insert (id, run_id, team_id, mission_id, line_index, quantity)
	on public.match_run_scores to authenticated;
grant update (quantity) on public.match_run_scores to authenticated;
grant delete on public.match_run_scores to authenticated;

-- ---------------------------------------------------------------------------
-- 6. RLS. One rule, three readers and three writers: a mentor, the team's own
--    students, and the team's own board device. A team never sees another
--    team's runs, on any of the three tables.
-- ---------------------------------------------------------------------------
alter table public.match_runs enable row level security;
alter table public.match_run_launches enable row level security;
alter table public.match_run_scores enable row level security;

do $$
declare
	v_table text;
	v_scope constant text :=
		'((select public.is_mentor())'
		|| ' or team_id = (select public.current_student_team_id())'
		|| ' or team_id = (select public.current_board_team_id()))';
begin
	foreach v_table in array array['match_runs', 'match_run_launches', 'match_run_scores'] loop
		execute format('drop policy if exists "mentors, the team and its board read %1$s" on public.%1$I', v_table);
		execute format(
			'create policy "mentors, the team and its board read %1$s" on public.%1$I for select to authenticated using %2$s',
			v_table, v_scope
		);

		execute format('drop policy if exists "mentors, the team and its board log %1$s" on public.%1$I', v_table);
		execute format(
			'create policy "mentors, the team and its board log %1$s" on public.%1$I for insert to authenticated with check %2$s',
			v_table, v_scope
		);

		execute format('drop policy if exists "mentors, the team and its board correct %1$s" on public.%1$I', v_table);
		execute format(
			'create policy "mentors, the team and its board correct %1$s" on public.%1$I for update to authenticated using %2$s with check %2$s',
			v_table, v_scope
		);

		execute format('drop policy if exists "mentors, the team and its board remove %1$s" on public.%1$I', v_table);
		execute format(
			'create policy "mentors, the team and its board remove %1$s" on public.%1$I for delete to authenticated using %2$s',
			v_table, v_scope
		);
	end loop;
	raise notice '0015: four policies each on match_runs, match_run_launches and match_run_scores.';
end
$$;

-- ---------------------------------------------------------------------------
-- 7. 0013's _student_detach_from_team, taught about practice runs.
--
--    0013's body verbatim plus one UPDATE. It is called by student_move_team
--    before the students row's team_id changes, so the (logged_by_student_id,
--    team_id) key on this table stops naming a student who is about to be
--    somewhere else. The run itself is untouched: it belongs to the team that
--    drove it. The counts it returns are unchanged, because the console's
--    warning is about role and task assignments and this is not one.
-- ---------------------------------------------------------------------------
create or replace function public._student_detach_from_team(p_student_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
	v_roles int;
	v_tasks int;
begin
	delete from public.role_assignments ra where ra.student_id = p_student_id;
	get diagnostics v_roles = row_count;

	update public.tasks tk
	set assigned_student_id = null
	where tk.assigned_student_id = p_student_id;
	get diagnostics v_tasks = row_count;

	update public.match_runs r
	set logged_by_student_id = null
	where r.logged_by_student_id = p_student_id;

	return jsonb_build_object('roles_cleared', v_roles, 'tasks_unassigned', v_tasks);
end;
$$;
revoke all on function public._student_detach_from_team(uuid) from public;

-- ---------------------------------------------------------------------------
-- 8. match_run_history: the number that goes up, defined once.
--
--    The trendline is a RULE (best score as of each run), not a row, so it is
--    computed here rather than by three screens accumulating a running
--    maximum in JavaScript. Null -- not an error -- for a caller who may not
--    see this team, so a probe answers like a team that does not exist.
-- ---------------------------------------------------------------------------
create or replace function public.match_run_history(p_team_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	v_runs jsonb;
begin
	if p_team_id is null then
		return null;
	end if;
	-- coalesce, not a bare NOT. current_student_team_id() and
	-- current_board_team_id() are NULL for a caller who is not one of those
	-- things, so `p_team_id = null` is NULL rather than false and `not (false
	-- or null)` is NULL -- which an IF treats as "no", falling straight
	-- through the gate. In a WHERE clause (team_resolve_roles, the policies)
	-- NULL and false behave the same; inside an IF they do not.
	if not coalesce(
		public.is_mentor()
		or p_team_id = public.current_student_team_id()
		or p_team_id = public.current_board_team_id(),
		false
	) then
		return null;
	end if;

	select coalesce(jsonb_agg(to_jsonb(x) order by x.started_at desc, x.id desc), '[]'::jsonb)
	into v_runs
	from (
		select
			r.id,
			r.started_at,
			r.elapsed_s,
			r.points,
			r.note,
			r.strategy_id,
			s.version as strategy_version,
			s.label as strategy_label,
			max(r.points) over (
				order by r.started_at, r.id
				rows between unbounded preceding and current row
			) as best_so_far,
			(select count(*)::int from public.match_run_launches l
				where l.run_id = r.id and l.attempted) as launches_attempted,
			(select count(*)::int from public.match_run_scores c where c.run_id = r.id) as lines_scored
		from public.match_runs r
		left join public.strategies s on s.id = r.strategy_id
		where r.team_id = p_team_id
	) x;

	return jsonb_build_object(
		'team_id', p_team_id,
		'server_now', now(),
		'run_count', jsonb_array_length(v_runs),
		'best_points', coalesce((
			select max(r.points) from public.match_runs r where r.team_id = p_team_id
		), 0),
		'runs', v_runs
	);
end;
$$;

revoke all on function public.match_run_history(uuid) from public;
grant execute on function public.match_run_history(uuid) to authenticated;

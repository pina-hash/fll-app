-- 0009_console_accents_roles_phases.sql
--
-- WHAT THE MENTOR CONSOLE NEEDS THAT THE SCHEMA DID NOT ALREADY HAVE: a team
-- accent the stylesheet can read, one canonical answer to "who is active in
-- role R for team T today", atomic phase control, a join-code rotation that
-- also re-mints the student logins built from it, and role assignment that
-- gets past 0005's exclusion constraints instead of failing on them.
--
-- Applied by the Supabase CLI, after 0008.
--
-- ACTIVE-ROLE RESOLUTION IS DEFINED EXACTLY ONCE, HERE. The live board, task
-- routing and the roster view all ask the same question, and three
-- implementations of it would drift. team_resolve_roles() is the one
-- definition: the primary if the primary checked in to the meeting being
-- asked about, else the second if the second checked in, else nobody and the
-- role reads unfilled. It returns a SET, not the jsonb the other RPCs return,
-- because its main caller is a JOIN inside board_live_summary(); PostgREST
-- still serialises it to a JSON array for the two screens that call it
-- directly. That is a deliberate divergence from the house RPC shape.
--
-- "TODAY" IS A LOCAL DATE, NOT A UTC ONE. A Friday session runs 16:30-18:00
-- in Rosemead, which is 23:30-01:00 UTC: half of every Friday meeting falls on
-- the next UTC day. Every date in this file therefore goes through
-- _app_today() / _app_day_start(), which pin the season's timezone in one
-- place. Counts on the live board do not even use a date -- they use the
-- current meeting's own window, which is what a mentor means by "today"
-- while standing in the room.
--
-- THE ACCENT IS DATA, NOT DECORATION. teams.accent is an enum, not a hex
-- string: the stylesheet owns the colours (src/lib/design-system/
-- team-accents.css keys off `[data-accent="..."]`), the database owns which
-- team is which. A colour literal in this table would put a second palette
-- outside the design system, which the repo's visual rules forbid. It is NOT
-- unique-constrained: four accents and four teams line up today, but a fifth
-- team must still be creatable, so team_create() picks the least-used accent
-- and the console shows which are taken.
--
-- ROTATING A JOIN CODE REWRITES EVERY LOGIN ON THE TEAM. 0003 said this file
-- would not exist, on the grounds that the code is half of a student's
-- address ({code}-{slug}@fll.invalid). The console needs the operation
-- anyway, so it is done properly and in one transaction:
-- team_regenerate_join_code() updates teams.join_code, then auth.users.email
-- and auth.identities.identity_data for every student on the team, then drops
-- their sessions. PINs are untouched. There is still no client GRANT on
-- teams.join_code; the definer is the only writer.
--
-- ===========================================================================
-- TO UNDO
-- ===========================================================================
--
--   drop function if exists public.role_unassign(uuid, public.team_role, public.role_tier);
--   drop function if exists public.role_assign(uuid, uuid, public.team_role, public.role_tier);
--   drop function if exists public.team_regenerate_join_code(uuid);
--   drop function if exists public.meeting_end(uuid);
--   drop function if exists public.meeting_advance_phase(uuid);
--   drop function if exists public.meeting_start(uuid);
--   drop function if exists public.board_live_summary(uuid);
--   drop function if exists public.team_resolve_roles(uuid, uuid, date);
--   drop function if exists public.team_create(text, integer, public.team_accent);
--   -- then re-create 0003's two-argument public.team_create(text, integer) verbatim
--   drop function if exists public._next_team_accent();
--   revoke update (accent) on public.teams from authenticated;
--   alter table public.teams drop column if exists accent;
--   drop type if exists public.team_accent;
--   drop function if exists public._app_day_start(date);
--   drop function if exists public._app_today();
--   drop function if exists public._app_timezone();
--   -- then re-create 0004's public.auth_whoami() verbatim (it has no 'accent' key)
--
-- Nothing later in the chain depends on this file yet.

-- ---------------------------------------------------------------------------
-- 1. The season's clock. Private: only definer bodies in this file call them.
-- ---------------------------------------------------------------------------
create or replace function public._app_timezone()
returns text
language sql
immutable
set search_path = ''
as $$
	select 'America/Los_Angeles'::text;
$$;
revoke all on function public._app_timezone() from public;

create or replace function public._app_today()
returns date
language sql
stable
set search_path = ''
as $$
	select (now() at time zone public._app_timezone())::date;
$$;
revoke all on function public._app_today() from public;

create or replace function public._app_day_start(p_date date)
returns timestamptz
language sql
stable
set search_path = ''
as $$
	select (p_date::timestamp) at time zone public._app_timezone();
$$;
revoke all on function public._app_day_start(date) from public;

-- ---------------------------------------------------------------------------
-- 2. The team accent.
-- ---------------------------------------------------------------------------
do $$
begin
	if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
	               where n.nspname = 'public' and t.typname = 'team_accent') then
		create type public.team_accent as enum ('cyan', 'chartreuse', 'magenta', 'amber');
	end if;
end
$$;

alter table public.teams add column if not exists accent public.team_accent;

-- Backfill in creation order, cycling the four accents, so the seeded teams
-- come out distinct. Only touches rows that have no accent yet, which makes a
-- re-apply a no-op rather than a reshuffle.
do $$
declare
	v_n int;
begin
	with ordered as (
		select id, (row_number() over (order by created_at, name) - 1) % 4 as slot
		from public.teams
		where accent is null
	)
	update public.teams t
	set accent = (array['cyan', 'chartreuse', 'magenta', 'amber']::public.team_accent[])[o.slot + 1]
	from ordered o
	where o.id = t.id;
	get diagnostics v_n = row_count;
	raise notice '0009: backfilled the accent on % team(s).', v_n;
end
$$;

alter table public.teams alter column accent set default 'cyan';
alter table public.teams alter column accent set not null;

comment on column public.teams.accent is
	'Which bioluminescent accent identifies this team on the live board and in its student runtime. An enum, not a colour: the stylesheet owns the palette.';

-- The least-used accent among live teams, ties broken by enum order. Private:
-- team_create calls it as the definer.
create or replace function public._next_team_accent()
returns public.team_accent
language sql
stable
set search_path = ''
as $$
	select a.accent
	from unnest(enum_range(null::public.team_accent)) with ordinality as a(accent, ord)
	left join public.teams t on t.accent = a.accent and t.archived_at is null
	group by a.accent, a.ord
	order by count(t.id), a.ord
	limit 1;
$$;
revoke all on function public._next_team_accent() from public;

-- ---------------------------------------------------------------------------
-- 3. team_create gains an accent. THE SIGNATURE TRAP: the old two-argument
--    function is dropped at its exact argument types first, because two
--    overloads differing only by a defaulted trailing parameter leave
--    PostgREST unable to resolve either call.
-- ---------------------------------------------------------------------------
drop function if exists public.team_create(text, integer);

create or replace function public.team_create(
	p_name text,
	p_fll_team_number integer default null,
	p_accent public.team_accent default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_name text := btrim(coalesce(p_name, ''));
	v_accent public.team_accent := coalesce(p_accent, public._next_team_accent());
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
			insert into public.teams (name, fll_team_number, join_code, accent)
			values (v_name, p_fll_team_number, public._generate_join_code(), v_accent)
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
		'join_code', v_team.join_code,
		'accent', v_team.accent
	);
end;
$$;

revoke all on function public.team_create(text, integer, public.team_accent) from public;
grant execute on function public.team_create(text, integer, public.team_accent) to authenticated;

-- Mentors may now edit the accent alongside the name and number. join_code is
-- still absent from every client grant.
grant update (fll_team_number, name, archived_at, accent) on public.teams to authenticated;

-- ---------------------------------------------------------------------------
-- 4. team_resolve_roles: THE one definition of who is active in each role.
--
--    SECURITY DEFINER with the caller re-checked in the body, because it
--    calls the private _app_today() and because a set-returning invoker
--    function would need those helpers granted to `authenticated`. An
--    unauthorised caller gets zero rows, not an error: a surface a caller may
--    not see answers like one that does not exist.
--
--    p_meeting_id null means "no meeting is running", which makes every role
--    unfilled. That is the correct answer, not a missing one.
--
--    Every CTE column is prefixed (r_, h_) so no query name collides with an
--    output column of the RETURNS TABLE list.
-- ---------------------------------------------------------------------------
create or replace function public.team_resolve_roles(
	p_team_id uuid,
	p_meeting_id uuid default null,
	p_on_date date default null
)
returns table (
	role public.team_role,
	primary_student_id uuid,
	primary_name text,
	primary_present boolean,
	second_student_id uuid,
	second_name text,
	second_present boolean,
	active_student_id uuid,
	active_tier public.role_tier,
	active_name text,
	unfilled boolean,
	has_second boolean
)
language sql
stable
security definer
set search_path = ''
as $$
	with d as (
		select coalesce(p_on_date, public._app_today()) as on_date
	),
	r as (
		select unnest(enum_range(null::public.team_role)) as r_role
	),
	h as (
		select
			ra.role as h_role,
			ra.tier as h_tier,
			s.id as h_student,
			s.first_name || ' ' || s.last_initial || '.' as h_name,
			exists (
				select 1 from public.attendance a
				where a.meeting_id = p_meeting_id and a.student_id = s.id
			) as h_present
		from public.role_assignments ra
		join public.students s on s.id = ra.student_id and s.team_id = ra.team_id
		cross join d
		where ra.team_id = p_team_id
			and s.deactivated_at is null
			and ra.effective_from <= d.on_date
			and (ra.effective_to is null or ra.effective_to > d.on_date)
	)
	select
		r.r_role,
		pri.h_student,
		pri.h_name,
		coalesce(pri.h_present, false),
		sec.h_student,
		sec.h_name,
		coalesce(sec.h_present, false),
		case
			when coalesce(pri.h_present, false) then pri.h_student
			when coalesce(sec.h_present, false) then sec.h_student
		end,
		case
			when coalesce(pri.h_present, false) then 'primary'::public.role_tier
			when coalesce(sec.h_present, false) then 'second'::public.role_tier
		end,
		case
			when coalesce(pri.h_present, false) then pri.h_name
			when coalesce(sec.h_present, false) then sec.h_name
		end,
		not (coalesce(pri.h_present, false) or coalesce(sec.h_present, false)),
		sec.h_student is not null
	from r
	left join h pri on pri.h_role = r.r_role and pri.h_tier = 'primary'
	left join h sec on sec.h_role = r.r_role and sec.h_tier = 'second'
	where p_team_id is not null
		and (public.is_mentor() or p_team_id = public.current_student_team_id())
	order by r.r_role;
$$;

revoke all on function public.team_resolve_roles(uuid, uuid, date) from public;
grant execute on function public.team_resolve_roles(uuid, uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. board_live_summary: everything the live board draws, in one round trip.
--
--    The board refetches this on every realtime event and on every reconnect,
--    so it is one call rather than six, and it carries server_now so a tablet
--    with a drifting clock still shows the right minutes remaining.
--
--    p_meeting_id null resolves to the running meeting, else a meeting on
--    today's local date, else none.
-- ---------------------------------------------------------------------------
create or replace function public.board_live_summary(p_meeting_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	v_meeting public.meetings%rowtype;
	v_phase public.meeting_phases%rowtype;
	v_from timestamptz;
	v_to timestamptz;
	v_teams jsonb;
begin
	if not public.is_mentor() then
		raise exception 'Only a mentor can open the live board.';
	end if;

	if p_meeting_id is not null then
		select m.* into v_meeting from public.meetings m where m.id = p_meeting_id;
	else
		select m.* into v_meeting
		from public.meetings m
		where m.started_at is not null and m.ended_at is null
		order by m.started_at desc
		limit 1;
		if not found then
			select m.* into v_meeting
			from public.meetings m
			where m.meeting_date = public._app_today()
			order by m.planned_start_at desc
			limit 1;
		end if;
	end if;

	if v_meeting.id is not null then
		v_from := coalesce(v_meeting.started_at, v_meeting.planned_start_at);
		v_to := coalesce(v_meeting.ended_at, now());
		select mp.* into v_phase from public.meeting_phases mp where mp.id = v_meeting.current_phase_id;
	else
		v_from := public._app_day_start(public._app_today());
		v_to := now();
	end if;

	select coalesce(
		jsonb_agg(to_jsonb(x) order by
			x.open_blockers desc,
			x.roles_unfilled desc,
			x.last_task_closed_at asc nulls first,
			x.name asc),
		'[]'::jsonb)
	into v_teams
	from (
		select
			tm.id as team_id,
			tm.name,
			tm.join_code,
			tm.accent,
			tm.fll_team_number,
			(select count(*) from public.students s
				where s.team_id = tm.id and s.deactivated_at is null)::int as roster_size,
			(select count(*) from public.attendance a
				join public.students s on s.id = a.student_id
				where s.team_id = tm.id and s.deactivated_at is null
					and a.meeting_id = v_meeting.id)::int as present_count,
			(select count(*) from public.tasks tk
				where tk.team_id = tm.id and tk.created_at >= v_from and tk.created_at <= v_to)::int as tasks_opened,
			(select count(*) from public.tasks tk
				where tk.team_id = tm.id and tk.closed_at >= v_from and tk.closed_at <= v_to)::int as tasks_closed,
			(select count(*) from public.tasks tk
				where tk.team_id = tm.id and tk.status <> 'done')::int as tasks_open_now,
			(select count(*) from public.blockers b
				where b.team_id = tm.id and b.resolved_at is null)::int as open_blockers,
			rr.unfilled_count as roles_unfilled,
			rr.no_second_count as roles_without_second,
			(select max(tk.closed_at) from public.tasks tk where tk.team_id = tm.id) as last_task_closed_at
		from public.teams tm
		cross join lateral (
			select
				count(*) filter (where q.unfilled)::int as unfilled_count,
				count(*) filter (where not q.has_second)::int as no_second_count
			from public.team_resolve_roles(tm.id, v_meeting.id) q
		) rr
		where tm.archived_at is null
	) x;

	return jsonb_build_object(
		'server_now', now(),
		'window_from', v_from,
		'window_to', v_to,
		'meeting', case when v_meeting.id is null then null else jsonb_build_object(
			'id', v_meeting.id,
			'kind', v_meeting.kind,
			'meeting_date', v_meeting.meeting_date,
			'planned_start_at', v_meeting.planned_start_at,
			'planned_end_at', v_meeting.planned_end_at,
			'started_at', v_meeting.started_at,
			'ended_at', v_meeting.ended_at,
			'current_phase_id', v_meeting.current_phase_id,
			'phase_count', (select count(*) from public.meeting_phases mp where mp.meeting_id = v_meeting.id),
			'phase', case when v_phase.id is null then null else jsonb_build_object(
				'id', v_phase.id,
				'ordinal', v_phase.ordinal,
				'name', v_phase.name,
				'planned_minutes', v_phase.planned_minutes,
				'started_at', v_phase.started_at,
				'ended_at', v_phase.ended_at
			) end
		) end,
		'teams', v_teams
	);
end;
$$;

revoke all on function public.board_live_summary(uuid) from public;
grant execute on function public.board_live_summary(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Phase control. THE MOST LOAD-BEARING WRITE IN THE APP: a phase change
--    that half-lands leaves a table of nine-year-olds on the wrong task. Each
--    of these is one transaction that locks the meeting FOR UPDATE, so the
--    outgoing phase's ended_at, the incoming phase's started_at and
--    meetings.current_phase_id move together or not at all. 0008 publishes all
--    three tables, so one commit is one broadcast to every device.
--
--    Nothing here auto-advances on overrun. Running past planned_minutes is
--    shown, never acted on; the mentor decides when to move.
-- ---------------------------------------------------------------------------
create or replace function public.meeting_start(p_meeting_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_m public.meetings%rowtype;
	v_first public.meeting_phases%rowtype;
	v_now timestamptz := now();
begin
	if not public.is_mentor() then
		raise exception 'Only a mentor can start a meeting.';
	end if;

	select m.* into v_m from public.meetings m where m.id = p_meeting_id for update;
	if not found then
		raise exception 'That meeting does not exist.';
	end if;
	if v_m.ended_at is not null then
		raise exception 'That meeting has already ended.';
	end if;
	if v_m.started_at is not null then
		raise exception 'That meeting is already running.';
	end if;

	select mp.* into v_first
	from public.meeting_phases mp
	where mp.meeting_id = p_meeting_id
	order by mp.ordinal
	limit 1;
	if not found then
		raise exception 'That meeting has no phases to run.';
	end if;

	update public.meeting_phases set started_at = v_now, ended_at = null where id = v_first.id;
	update public.meetings set started_at = v_now, current_phase_id = v_first.id where id = p_meeting_id;

	return jsonb_build_object(
		'meeting_id', p_meeting_id,
		'started_at', v_now,
		'phase_id', v_first.id,
		'phase_name', v_first.name,
		'phase_ordinal', v_first.ordinal
	);
end;
$$;

revoke all on function public.meeting_start(uuid) from public;
grant execute on function public.meeting_start(uuid) to authenticated;

create or replace function public.meeting_advance_phase(p_meeting_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_m public.meetings%rowtype;
	v_cur public.meeting_phases%rowtype;
	v_next public.meeting_phases%rowtype;
	v_now timestamptz := now();
begin
	if not public.is_mentor() then
		raise exception 'Only a mentor can change the phase.';
	end if;

	select m.* into v_m from public.meetings m where m.id = p_meeting_id for update;
	if not found then
		raise exception 'That meeting does not exist.';
	end if;
	if v_m.started_at is null then
		raise exception 'Start the meeting before changing the phase.';
	end if;
	if v_m.ended_at is not null then
		raise exception 'That meeting has already ended.';
	end if;

	select mp.* into v_cur from public.meeting_phases mp where mp.id = v_m.current_phase_id for update;
	if not found then
		raise exception 'That meeting has no current phase.';
	end if;

	select mp.* into v_next
	from public.meeting_phases mp
	where mp.meeting_id = p_meeting_id and mp.ordinal > v_cur.ordinal
	order by mp.ordinal
	limit 1;
	if not found then
		raise exception 'That was the last phase. End the meeting instead.';
	end if;

	update public.meeting_phases set ended_at = v_now where id = v_cur.id;
	update public.meeting_phases set started_at = v_now, ended_at = null where id = v_next.id;
	update public.meetings set current_phase_id = v_next.id where id = p_meeting_id;

	return jsonb_build_object(
		'meeting_id', p_meeting_id,
		'at', v_now,
		'from_phase_id', v_cur.id,
		'from_phase_name', v_cur.name,
		'phase_id', v_next.id,
		'phase_name', v_next.name,
		'phase_ordinal', v_next.ordinal
	);
end;
$$;

revoke all on function public.meeting_advance_phase(uuid) from public;
grant execute on function public.meeting_advance_phase(uuid) to authenticated;

create or replace function public.meeting_end(p_meeting_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_m public.meetings%rowtype;
	v_now timestamptz := now();
	v_closed int;
begin
	if not public.is_mentor() then
		raise exception 'Only a mentor can end a meeting.';
	end if;

	select m.* into v_m from public.meetings m where m.id = p_meeting_id for update;
	if not found then
		raise exception 'That meeting does not exist.';
	end if;
	if v_m.started_at is null then
		raise exception 'That meeting has not started.';
	end if;
	if v_m.ended_at is not null then
		raise exception 'That meeting has already ended.';
	end if;

	update public.meeting_phases
	set ended_at = v_now
	where meeting_id = p_meeting_id and started_at is not null and ended_at is null;
	get diagnostics v_closed = row_count;

	update public.meetings set ended_at = v_now where id = p_meeting_id;

	return jsonb_build_object('meeting_id', p_meeting_id, 'ended_at', v_now, 'phases_closed', v_closed);
end;
$$;

revoke all on function public.meeting_end(uuid) from public;
grant execute on function public.meeting_end(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. team_regenerate_join_code. See the header: the code is half of every
--    student address on the team, so rotating it rewrites those addresses in
--    the same transaction and drops the sessions that were signed in under
--    the old one. PINs are not touched.
-- ---------------------------------------------------------------------------
create or replace function public.team_regenerate_join_code(p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_team public.teams%rowtype;
	v_code char(6);
	v_attempt int := 0;
	v_students int := 0;
	v_row record;
	v_email text;
begin
	if not public.is_mentor() then
		raise exception 'Only a mentor can change a team code.';
	end if;

	select t.* into v_team from public.teams t where t.id = p_team_id for update;
	if not found then
		raise exception 'That team does not exist.';
	end if;
	if v_team.archived_at is not null then
		raise exception 'That team is archived.';
	end if;

	loop
		v_attempt := v_attempt + 1;
		v_code := public._generate_join_code();
		exit when not exists (select 1 from public.teams t where t.join_code = v_code);
		if v_attempt >= 10 then
			raise exception 'Could not mint a unique join code after % tries.', v_attempt;
		end if;
	end loop;

	update public.teams set join_code = v_code where id = p_team_id;

	for v_row in
		select s.id, s.slug, s.auth_user_id from public.students s where s.team_id = p_team_id
	loop
		v_email := public._student_email(v_code, v_row.slug);
		update auth.users u
		set email = v_email, updated_at = now()
		where u.id = v_row.auth_user_id;
		update auth.identities i
		set identity_data = i.identity_data || jsonb_build_object('email', v_email),
			updated_at = now()
		where i.user_id = v_row.auth_user_id and i.provider = 'email';
		delete from auth.sessions x where x.user_id = v_row.auth_user_id;
		v_students := v_students + 1;
	end loop;

	return jsonb_build_object(
		'team_id', p_team_id,
		'join_code', v_code,
		'previous_join_code', v_team.join_code,
		'students_relogin', v_students
	);
end;
$$;

revoke all on function public.team_regenerate_join_code(uuid) from public;
grant execute on function public.team_regenerate_join_code(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Role assignment that gets PAST 0005's exclusion constraints.
--
--    0005 refuses two holders of one (team, role, tier) whose date ranges
--    overlap, and one student holding two tiers of the same role at once.
--    Both are correct, and both mean a naive INSERT from the console fails
--    with 23P01 whenever a mentor reassigns a role. These two functions end
--    the assignments in the way, then write the new one, in one transaction.
--
--    ENDING AN ASSIGNMENT MADE TODAY IS A DELETE, NOT A STAMP. effective_to
--    must be strictly greater than effective_from (0005's range check), so an
--    assignment that starts today cannot be closed today. Deleting it is what
--    "undo the thing I just did" means anyway; assignments from earlier days
--    keep their history and just get an effective_to.
-- ---------------------------------------------------------------------------
create or replace function public.role_assign(
	p_team_id uuid,
	p_student_id uuid,
	p_role public.team_role,
	p_tier public.role_tier
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_today date := public._app_today();
	v_existing uuid;
	v_replaced jsonb := '[]'::jsonb;
	v_row public.role_assignments%rowtype;
	v_id uuid;
begin
	if not public.is_mentor() then
		raise exception 'Only a mentor can assign a role.';
	end if;
	if p_team_id is null or p_student_id is null or p_role is null or p_tier is null then
		raise exception 'A role assignment needs a team, a student, a role and a tier.';
	end if;
	if not exists (
		select 1 from public.students s
		where s.id = p_student_id and s.team_id = p_team_id and s.deactivated_at is null
	) then
		raise exception 'That student is not on that team.';
	end if;

	select ra.id into v_existing
	from public.role_assignments ra
	where ra.team_id = p_team_id and ra.student_id = p_student_id
		and ra.role = p_role and ra.tier = p_tier
		and ra.effective_from <= v_today
		and (ra.effective_to is null or ra.effective_to > v_today);
	if found then
		return jsonb_build_object('assignment_id', v_existing, 'unchanged', true, 'replaced', v_replaced);
	end if;

	for v_row in
		select ra.* from public.role_assignments ra
		where ra.effective_from <= v_today
			and (ra.effective_to is null or ra.effective_to > v_today)
			and (
				(ra.team_id = p_team_id and ra.role = p_role and ra.tier = p_tier)
				or (ra.student_id = p_student_id and ra.role = p_role)
			)
		for update
	loop
		if v_row.effective_from < v_today then
			update public.role_assignments set effective_to = v_today where id = v_row.id;
		else
			delete from public.role_assignments where id = v_row.id;
		end if;
		v_replaced := v_replaced || jsonb_build_object(
			'assignment_id', v_row.id,
			'student_id', v_row.student_id,
			'role', v_row.role,
			'tier', v_row.tier,
			'kept_history', v_row.effective_from < v_today
		);
	end loop;

	insert into public.role_assignments (team_id, student_id, role, tier, effective_from)
	values (p_team_id, p_student_id, p_role, p_tier, v_today)
	returning id into v_id;

	return jsonb_build_object(
		'assignment_id', v_id,
		'unchanged', false,
		'effective_from', v_today,
		'replaced', v_replaced
	);
end;
$$;

revoke all on function public.role_assign(uuid, uuid, public.team_role, public.role_tier) from public;
grant execute on function public.role_assign(uuid, uuid, public.team_role, public.role_tier) to authenticated;

create or replace function public.role_unassign(
	p_team_id uuid,
	p_role public.team_role,
	p_tier public.role_tier
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_today date := public._app_today();
	v_row public.role_assignments%rowtype;
	v_ended int := 0;
begin
	if not public.is_mentor() then
		raise exception 'Only a mentor can clear a role.';
	end if;

	for v_row in
		select ra.* from public.role_assignments ra
		where ra.team_id = p_team_id and ra.role = p_role and ra.tier = p_tier
			and ra.effective_from <= v_today
			and (ra.effective_to is null or ra.effective_to > v_today)
		for update
	loop
		if v_row.effective_from < v_today then
			update public.role_assignments set effective_to = v_today where id = v_row.id;
		else
			delete from public.role_assignments where id = v_row.id;
		end if;
		v_ended := v_ended + 1;
	end loop;

	return jsonb_build_object('team_id', p_team_id, 'role', p_role, 'tier', p_tier, 'ended', v_ended);
end;
$$;

revoke all on function public.role_unassign(uuid, public.team_role, public.role_tier) from public;
grant execute on function public.role_unassign(uuid, public.team_role, public.role_tier) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. auth_whoami carries the team accent, so the student runtime can theme
--    itself from the principal it already loads. Same signature, so this is a
--    plain replace and no PostgREST overload is created.
-- ---------------------------------------------------------------------------
create or replace function public.auth_whoami()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(
		(
			select jsonb_build_object(
				'kind', 'mentor',
				'mentor_id', m.id,
				'display_name', m.display_name,
				'email', m.email,
				'is_admin', m.is_admin
			)
			from public.mentors m
			where m.auth_user_id = (select auth.uid()) and m.deactivated_at is null
		),
		(
			select jsonb_build_object(
				'kind', 'student',
				'student_id', s.id,
				'first_name', s.first_name,
				'last_initial', s.last_initial,
				'slug', s.slug,
				'grade', s.grade,
				'team_id', t.id,
				'team_name', t.name,
				'join_code', t.join_code,
				'accent', t.accent
			)
			from public.students s
			join public.teams t on t.id = s.team_id
			where s.auth_user_id = (select auth.uid()) and s.deactivated_at is null
		)
	);
$$;

revoke all on function public.auth_whoami() from public;
grant execute on function public.auth_whoami() to authenticated;

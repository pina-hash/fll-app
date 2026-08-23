-- 0010_student_runtime_board_devices.sql
--
-- WHAT THE STUDENT RUNTIME NEEDS THAT THE SCHEMA DID NOT ALREADY HAVE: one
-- shared answer to "which meeting is running", a way for a spare iPad on the
-- table to be a team's board without being a student, and the evidence rule
-- enforced where it cannot be skipped.
--
-- Applied by the Supabase CLI, after 0009.
--
-- "WHICH MEETING IS RUNNING" IS NOW DEFINED ONCE. 0009 answered it inline
-- inside board_live_summary, which was fine while the mentor console was the
-- only caller. The student screen and the team board ask the same question, so
-- the rule moves into _resolve_current_meeting_id() and board_live_summary is
-- replaced to call it. Three callers, one rule; that is the same reason
-- team_resolve_roles exists and this file does not re-answer THAT question
-- either, it just widens who may ask it.
--
-- A TEAM BOARD IS A DEVICE, NOT A PERSON. A spare iPad propped on the table
-- serves students with no device of their own, so it needs to read its team
-- and close its team's tasks -- but it must not appear on a roster, hold a
-- role, raise a blocker as somebody, or be checked in. It therefore gets its
-- own auth account (`{code}-board.device@fll.invalid`) and a row in
-- team_board_devices, NOT a students row. `board.device` contains a dot, which
-- 0004's slug alphabet ([a-z0-9]) cannot produce, so a board address can never
-- collide with a student's however the roster is named.
--
-- THE EVIDENCE RULE IS A TRIGGER, NOT A SCREEN. "A task requiring evidence
-- cannot be marked done without a photo" has to survive a queued write
-- replayed from a device that was offline when the rule was explained to it.
-- A mentor may still close such a task (they are the ones who set the flag and
-- they are standing right there); nobody else can.
--
-- ===========================================================================
-- TO UNDO
-- ===========================================================================
--
--   drop trigger if exists tasks_require_evidence on public.tasks;
--   drop function if exists public._tasks_require_evidence();
--   drop function if exists public.team_board_disable(uuid);
--   drop function if exists public.team_board_enable(uuid, text);
--   drop policy if exists "board devices close their own team tasks" on public.tasks;
--   drop policy if exists "board devices read their own team tasks" on public.tasks;
--   drop policy if exists "board devices read their own team blockers" on public.blockers;
--   drop policy if exists "board devices read their own team roles" on public.role_assignments;
--   drop policy if exists "board devices read their own team attendance" on public.attendance;
--   drop policy if exists "board devices read their own team roster" on public.students;
--   drop policy if exists "board devices read their own team" on public.teams;
--   drop policy if exists "mentors read every board device" on public.team_board_devices;
--   drop policy if exists "a board device reads its own row" on public.team_board_devices;
--   drop table if exists public.team_board_devices;
--   drop function if exists public.current_board_team_id();
--   drop function if exists public._board_email(text);
--   drop function if exists public.meeting_current();
--   drop function if exists public._resolve_current_meeting_id();
--   -- then re-create 0009's public.board_live_summary(uuid), 0009's
--   -- public.team_resolve_roles(uuid, uuid, date), 0009's public.auth_whoami()
--   -- and 0002's public.handle_new_auth_user() verbatim.
--
-- Nothing later in the chain depends on this file yet.

-- ---------------------------------------------------------------------------
-- 1. Which meeting is running: one definition, three callers.
-- ---------------------------------------------------------------------------
create or replace function public._resolve_current_meeting_id()
returns uuid
language sql
stable
set search_path = ''
as $$
	select x.id
	from (
		select m.id, 1 as tier, m.started_at as ord
		from public.meetings m
		where m.started_at is not null and m.ended_at is null
		union all
		select m.id, 2 as tier, m.planned_start_at as ord
		from public.meetings m
		where m.meeting_date = public._app_today()
	) x
	order by x.tier, x.ord desc
	limit 1;
$$;
revoke all on function public._resolve_current_meeting_id() from public;

-- The student runtime's and the team board's view of the session. Every
-- signed-in caller may already read meetings and meeting_phases (0006's
-- policies are `using (true)`), so this leaks nothing a plain select would
-- not; it exists so the RESOLUTION RULE is not re-implemented per screen.
create or replace function public.meeting_current()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	v_meeting public.meetings%rowtype;
	v_phase public.meeting_phases%rowtype;
begin
	if (select auth.uid()) is null then
		return null;
	end if;

	select m.* into v_meeting from public.meetings m where m.id = public._resolve_current_meeting_id();
	if not found then
		return jsonb_build_object('server_now', now(), 'meeting', null);
	end if;
	select mp.* into v_phase from public.meeting_phases mp where mp.id = v_meeting.current_phase_id;

	return jsonb_build_object(
		'server_now', now(),
		'meeting', jsonb_build_object(
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
		)
	);
end;
$$;

revoke all on function public.meeting_current() from public;
grant execute on function public.meeting_current() to authenticated;

-- 0009's board_live_summary, with its inline copy of the resolution rule
-- replaced by the call above. Everything else about it is unchanged.
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

	select m.* into v_meeting
	from public.meetings m
	where m.id = coalesce(p_meeting_id, public._resolve_current_meeting_id());

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
-- 2. The team board device.
-- ---------------------------------------------------------------------------
create table if not exists public.team_board_devices (
	id uuid primary key default gen_random_uuid(),
	team_id uuid not null unique references public.teams (id) on delete cascade,
	auth_user_id uuid not null unique references auth.users (id) on delete cascade,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

comment on table public.team_board_devices is
	'One kiosk account per team for the shared iPad on the table. Not a student: it holds no role, is never checked in, and appears on no roster.';

drop trigger if exists team_board_devices_set_updated_at on public.team_board_devices;
create trigger team_board_devices_set_updated_at
	before update on public.team_board_devices
	for each row execute function public.set_updated_at();

-- The kiosk address. The dot in `board.device` is outside 0004's slug
-- alphabet, so this can never be a student's address.
create or replace function public._board_email(p_join_code text)
returns text
language sql
immutable
set search_path = ''
as $$
	select lower(btrim(p_join_code)) || '-board.device@fll.invalid';
$$;
revoke all on function public._board_email(text) from public;

-- Named inside the policies below, so `authenticated` needs EXECUTE.
create or replace function public.current_board_team_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
	select d.team_id
	from public.team_board_devices d
	join public.teams t on t.id = d.team_id
	where d.auth_user_id = (select auth.uid())
		and t.archived_at is null;
$$;
revoke all on function public.current_board_team_id() from public;
grant execute on function public.current_board_team_id() to authenticated;

-- 0002's gate, widened by exactly one flag. A board address is accepted only
-- while team_board_enable's transaction-local flag is raised, for the same
-- reason a student address is: the public signup endpoint and the dashboard
-- must not be able to mint one.
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
	if v_domain = 'fll.invalid' then
		if split_part(v_email, '@', 1) like '%-board.device' then
			if coalesce(current_setting('fll.creating_board', true), '') <> 'on' then
				raise exception 'Board devices are enabled by a mentor, not by signing up.';
			end if;
			return new;
		end if;
		if coalesce(current_setting('fll.creating_student', true), '') <> 'on' then
			raise exception 'Student accounts are created by a mentor, not by signing up.';
		end if;
		return new;
	end if;

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

-- team_board_enable: mint or re-PIN the kiosk account for one team.
create or replace function public.team_board_enable(p_team_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_team public.teams%rowtype;
	v_device public.team_board_devices%rowtype;
	v_auth_id uuid := gen_random_uuid();
	v_email text;
begin
	if not public.is_mentor() then
		raise exception 'Only a mentor can set up a team board.';
	end if;
	if p_pin !~ '^[0-9]{6}$' then
		raise exception 'A board PIN is exactly 6 digits.';
	end if;

	select t.* into v_team from public.teams t where t.id = p_team_id for update;
	if not found then
		raise exception 'That team does not exist.';
	end if;
	if v_team.archived_at is not null then
		raise exception 'That team is archived.';
	end if;

	v_email := public._board_email(v_team.join_code);
	select d.* into v_device from public.team_board_devices d where d.team_id = p_team_id;

	if found then
		-- Already enabled: this is a PIN change. The address follows the join
		-- code, which team_regenerate_join_code (0009) may have rotated.
		update auth.users u
		set encrypted_password = extensions.crypt(p_pin, extensions.gen_salt('bf', 10)),
			email = v_email,
			updated_at = now()
		where u.id = v_device.auth_user_id;
		update auth.identities i
		set identity_data = i.identity_data || jsonb_build_object('email', v_email), updated_at = now()
		where i.user_id = v_device.auth_user_id and i.provider = 'email';
		delete from auth.sessions s where s.user_id = v_device.auth_user_id;
		return jsonb_build_object('team_id', p_team_id, 'board_email', v_email, 'created', false);
	end if;

	perform set_config('fll.creating_board', 'on', true);

	insert into auth.users (
		instance_id, id, aud, role, email, encrypted_password,
		email_confirmed_at, confirmation_token, recovery_token,
		email_change_token_new, email_change, email_change_token_current, email_change_confirm_status,
		phone_change, phone_change_token, reauthentication_token,
		raw_app_meta_data, raw_user_meta_data,
		is_super_admin, is_sso_user, is_anonymous, created_at, updated_at
	) values (
		'00000000-0000-0000-0000-000000000000', v_auth_id, 'authenticated', 'authenticated', v_email,
		extensions.crypt(p_pin, extensions.gen_salt('bf', 10)),
		now(), '', '', '', '', '', 0, '', '', '',
		jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'kind', 'board'),
		jsonb_build_object('kind', 'board', 'team_id', v_team.id),
		false, false, false, now(), now()
	);

	insert into auth.identities (
		id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
	) values (
		gen_random_uuid(), v_auth_id, v_auth_id::text, 'email',
		jsonb_build_object('sub', v_auth_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
		null, now(), now()
	);

	insert into public.team_board_devices (team_id, auth_user_id)
	values (v_team.id, v_auth_id);

	perform set_config('fll.creating_board', 'off', true);

	return jsonb_build_object('team_id', p_team_id, 'board_email', v_email, 'created', true);
end;
$$;

revoke all on function public.team_board_enable(uuid, text) from public;
grant execute on function public.team_board_enable(uuid, text) to authenticated;

create or replace function public.team_board_disable(p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_auth_id uuid;
begin
	if not public.is_mentor() then
		raise exception 'Only a mentor can turn off a team board.';
	end if;

	select d.auth_user_id into v_auth_id from public.team_board_devices d where d.team_id = p_team_id;
	if not found then
		raise exception 'That team has no board device.';
	end if;

	-- The device row goes with the auth user (on delete cascade).
	delete from auth.users u where u.id = v_auth_id;
	return jsonb_build_object('team_id', p_team_id, 'ok', true);
end;
$$;

revoke all on function public.team_board_disable(uuid) from public;
grant execute on function public.team_board_disable(uuid) to authenticated;

-- Grants and RLS for the device table itself. No client writes it; the two
-- RPCs above are the only doors.
revoke all on public.team_board_devices from anon, authenticated;
grant all on public.team_board_devices to service_role;
grant select on public.team_board_devices to authenticated;

alter table public.team_board_devices enable row level security;

drop policy if exists "mentors read every board device" on public.team_board_devices;
create policy "mentors read every board device"
	on public.team_board_devices
	for select
	to authenticated
	using ((select public.is_mentor()));

drop policy if exists "a board device reads its own row" on public.team_board_devices;
create policy "a board device reads its own row"
	on public.team_board_devices
	for select
	to authenticated
	using (auth_user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. What a board device may see and do. READ its own team, and CLOSE its own
--    team's tasks. Nothing else: it cannot raise a blocker as a person, check
--    anyone in, upload evidence or touch another team.
-- ---------------------------------------------------------------------------
drop policy if exists "board devices read their own team" on public.teams;
create policy "board devices read their own team"
	on public.teams
	for select
	to authenticated
	using (id = (select public.current_board_team_id()));

drop policy if exists "board devices read their own team roster" on public.students;
create policy "board devices read their own team roster"
	on public.students
	for select
	to authenticated
	using (team_id = (select public.current_board_team_id()));

drop policy if exists "board devices read their own team attendance" on public.attendance;
create policy "board devices read their own team attendance"
	on public.attendance
	for select
	to authenticated
	using (
		exists (
			select 1 from public.students s
			where s.id = attendance.student_id
				and s.team_id = (select public.current_board_team_id())
		)
	);

drop policy if exists "board devices read their own team roles" on public.role_assignments;
create policy "board devices read their own team roles"
	on public.role_assignments
	for select
	to authenticated
	using (team_id = (select public.current_board_team_id()));

drop policy if exists "board devices read their own team blockers" on public.blockers;
create policy "board devices read their own team blockers"
	on public.blockers
	for select
	to authenticated
	using (team_id = (select public.current_board_team_id()));

drop policy if exists "board devices read their own team tasks" on public.tasks;
create policy "board devices read their own team tasks"
	on public.tasks
	for select
	to authenticated
	using (team_id = (select public.current_board_team_id()));

drop policy if exists "board devices close their own team tasks" on public.tasks;
create policy "board devices close their own team tasks"
	on public.tasks
	for update
	to authenticated
	using (team_id = (select public.current_board_team_id()))
	with check (team_id = (select public.current_board_team_id()));

-- team_resolve_roles gains the board device as a caller. Same signature, so
-- this is a plain replace and no PostgREST overload appears. The rule itself
-- is untouched: this file does not re-answer that question.
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
		and (
			public.is_mentor()
			or p_team_id = public.current_student_team_id()
			or p_team_id = public.current_board_team_id()
		)
	order by r.r_role;
$$;

revoke all on function public.team_resolve_roles(uuid, uuid, date) from public;
grant execute on function public.team_resolve_roles(uuid, uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The evidence rule, where a queued write cannot get around it.
-- ---------------------------------------------------------------------------
create or replace function public._tasks_require_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.status = 'done'
		and old.status is distinct from 'done'
		and new.evidence_required
		and not public.is_mentor()
		and not exists (select 1 from public.evidence e where e.task_id = new.id)
	then
		raise exception 'That task needs a photo before it can be finished.';
	end if;
	return new;
end;
$$;
revoke all on function public._tasks_require_evidence() from public;

drop trigger if exists tasks_require_evidence on public.tasks;
create trigger tasks_require_evidence
	before update on public.tasks
	for each row execute function public._tasks_require_evidence();

-- ---------------------------------------------------------------------------
-- 5. auth_whoami learns the third population. Same signature; a plain replace.
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
		),
		(
			select jsonb_build_object(
				'kind', 'board',
				'device_id', d.id,
				'team_id', t.id,
				'team_name', t.name,
				'join_code', t.join_code,
				'accent', t.accent
			)
			from public.team_board_devices d
			join public.teams t on t.id = d.team_id
			where d.auth_user_id = (select auth.uid()) and t.archived_at is null
		)
	);
$$;

revoke all on function public.auth_whoami() from public;
grant execute on function public.auth_whoami() to authenticated;

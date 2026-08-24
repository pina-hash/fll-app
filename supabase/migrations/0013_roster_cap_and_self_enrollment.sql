-- 0013_roster_cap_and_self_enrollment.sql
--
-- THE ROSTER IS BUILT LIVE, IN THE ROOM, BY THE KIDS THEMSELVES: a per-team
-- join window a mentor opens with one tap, an anon RPC that mints an account
-- from a name and a chosen PIN, and a SIX-STUDENT CAP that is a trigger on
-- `students` rather than a rule any of the three write paths could forget.
--
-- Applied by the Supabase CLI, after 0012.
--
-- THE CAP IS A TRIGGER BECAUSE IT COUNTS ROWS. A CHECK constraint sees one
-- row; "at most six ACTIVE students on this team" is an aggregate over the
-- team, so it lives in a BEFORE INSERT OR UPDATE trigger that takes an
-- advisory lock on the team first. The lock is the whole point: twenty kids
-- enrolling from twenty phones in the same minute would otherwise each read
-- five and each insert a sixth. Being a trigger is also what makes it hold
-- against all four ways a seat gets taken -- student_create (a mentor typing),
-- student_self_enroll (a student typing), student_reactivate (an old row
-- coming back), and student_move_team (a seat taken on another team) --
-- without any of them repeating the rule. Deactivated rows hold no seat.
--
-- THE JOIN WINDOW IS DERIVED, NOT A FLAG SOMEBODY HAS TO REMEMBER TO CLEAR.
-- `teams.join_open_since` and `teams.join_open_meeting_id` are the stored
-- state; whether the window is OPEN is team_join_open(), which is false once
-- the meeting it was opened in has ended and false once the local day it was
-- opened on is over. meeting_end() clears the two columns as well, so the
-- stored state stays honest for a mentor reading the console -- but the
-- derived function is what every gate calls, so a window left open by a
-- meeting that ended some other way is still shut. That is the same shape as
-- every other derived answer here: one rule, in SQL, with the callers asking
-- rather than re-deriving.
--
-- WHY A STUDENT MAY MINT THEIR OWN AUTH USER AND WHAT STOPS THE INTERNET FROM
-- DOING IT. student_self_enroll is granted to `anon`, because the whole point
-- is a kid who has never signed in. Three gates stand in front of it: the
-- team's join code (which they can only have from a mentor), an open window
-- (seconds of a Friday, not a week), and the cap. It builds the address
-- itself from the join code and the deduplicated slug, exactly as 0004 does,
-- so no caller can name an account; and 0002/0010's auth.users trigger still
-- demands the transaction-local `fll.creating_student` flag, which only a
-- definer body in this schema can raise. It is granted to `anon` and NOT to
-- `authenticated`: somebody already signed in has a seat.
--
-- MOVING A STUDENT BETWEEN TEAMS REWRITES THEIR LOGIN, THE SAME WAY ROTATING
-- A JOIN CODE DOES. The address is `{code}-{slug}@fll.invalid`, so a move
-- changes both halves: a new code, and a slug re-deduplicated inside the new
-- team. auth.users.email and auth.identities are rewritten and every session
-- is dropped, in one transaction. The console warns first, the way it warns
-- before regenerating a join code, because the child is signed in on a tablet
-- while this happens.
--
-- WHAT A MOVE CLEARS AND WHAT IT REFUSES. Every row on the work surface
-- carries the composite key (student_id, team_id) -> students (id, team_id),
-- so a student whose team_id changes drags those rows with them or the
-- constraint refuses the update. FORWARD-LOOKING rows are cleared, and the
-- mentor is told how many: role assignments (who is meant to do what next)
-- and task assignments (unassigned, the task stays with the team that made
-- it). HISTORY is not touched and instead REFUSES the move: a blocker they
-- raised and a photo they took happened on that team, and rewriting either
-- would be a lie about what the season looked like. The mentor is told the
-- counts and told to deactivate and re-add instead, which keeps both records
-- true.
--
-- WHAT THIS FILE DOES NOT DO. It does not make the cap configurable per team
-- (six is the rule for all four teams; team_size_cap() is the one place it is
-- written). It does not add an approval queue to self-enrollment -- a queue
-- means twenty kids waiting on one adult, which is the failure this replaces.
-- It does not let a student edit their own name or grade afterwards; that is
-- the console's job.
--
-- ===========================================================================
-- TO UNDO
-- ===========================================================================
--
--   alter publication supabase_realtime drop table public.students, public.teams;
--   alter table public.students replica identity default;
--   alter table public.teams replica identity default;
--   drop function if exists public.student_move_team(uuid, uuid);
--   drop function if exists public._student_detach_from_team(uuid);
--   drop function if exists public.student_self_enroll(text, text, text, smallint, text);
--   drop function if exists public.team_roster_state();
--   drop function if exists public.team_join_window_close(uuid);
--   drop function if exists public.team_join_window_open(uuid);
--   drop function if exists public.team_join_open(uuid);
--   drop trigger if exists students_team_cap on public.students;
--   drop function if exists public._students_team_cap();
--   drop function if exists public.team_size_cap();
--   alter table public.teams drop column if exists join_open_meeting_id;
--   alter table public.teams drop column if exists join_open_since;
--   -- then re-create 0004's public._students_immutable() verbatim (it refuses
--   -- every team_id and slug change, with no moving_student escape hatch),
--   -- 0004's public.team_login_roster(text) verbatim (no join_open keys), and
--   -- 0009's public.meeting_end(uuid) verbatim (it clears no join windows).
--
-- 0014 (student_parent_access) and 0015 (match_runs) reference nothing here
-- except student_move_team's behaviour; undo them first if the intent is to
-- rebuild the roster surface.

-- ---------------------------------------------------------------------------
-- 1. The cap, written once.
--
--    Public and granted to anon as well as authenticated: the login screen
--    says "this team is full" before anybody has signed in, and the console
--    says "2 seats left" after. A number that appears on two screens is not
--    typed into either of them.
-- ---------------------------------------------------------------------------
create or replace function public.team_size_cap()
returns integer
language sql
immutable
set search_path = ''
as $$
	select 6;
$$;

revoke all on function public.team_size_cap() from public;
grant execute on function public.team_size_cap() to anon, authenticated;

comment on function public.team_size_cap() is
	'The most ACTIVE students one team may hold. The single statement of the number; _students_team_cap() enforces it and every screen that prints it asks here.';

-- ---------------------------------------------------------------------------
-- 2. The cap trigger. Counts, so it cannot be a CHECK; locks, so two devices
--    cannot both read five.
--
--    A deactivated row holds no seat, and an UPDATE that leaves an already
--    active row on the same team changes no seat at all -- a rename must not
--    pay for a lock, and must not fail on a team that is legitimately full.
-- ---------------------------------------------------------------------------
create or replace function public._students_team_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_cap integer := public.team_size_cap();
	v_taken integer;
begin
	if new.deactivated_at is not null then
		return new;
	end if;
	if tg_op = 'UPDATE'
		and old.deactivated_at is null
		and old.team_id = new.team_id
	then
		return new;
	end if;

	-- Serialise every seat count for THIS team for the rest of the
	-- transaction. Two enrollments landing in the same millisecond queue up
	-- here instead of both reading five.
	perform pg_advisory_xact_lock(hashtext('public.students.team_cap'), hashtext(new.team_id::text));

	select count(*) into v_taken
	from public.students s
	where s.team_id = new.team_id
		and s.deactivated_at is null
		and s.id <> new.id;

	if v_taken >= v_cap then
		raise exception 'That team already has % students, which is the most a team can hold. Take somebody off the team first, or use another team.', v_cap;
	end if;

	return new;
end;
$$;
revoke all on function public._students_team_cap() from public;

drop trigger if exists students_team_cap on public.students;
create trigger students_team_cap
	before insert or update on public.students
	for each row execute function public._students_team_cap();

-- ---------------------------------------------------------------------------
-- 3. The join window's stored state. No client GRANT on either column: the
--    two RPCs below and meeting_end() are the only writers.
-- ---------------------------------------------------------------------------
alter table public.teams add column if not exists join_open_since timestamptz;
alter table public.teams add column if not exists join_open_meeting_id uuid;

do $$
begin
	if not exists (
		select 1 from pg_constraint
		where conname = 'teams_join_open_meeting_fkey' and conrelid = 'public.teams'::regclass
	) then
		alter table public.teams
			add constraint teams_join_open_meeting_fkey
			foreign key (join_open_meeting_id) references public.meetings (id) on delete set null;
	end if;
end
$$;

comment on column public.teams.join_open_since is
	'When a mentor last opened this team to self-enrollment. Stored state only: whether the window is OPEN is team_join_open().';
comment on column public.teams.join_open_meeting_id is
	'The meeting that was running when the window was opened, or null if none was. The window shuts when that meeting ends.';

-- ---------------------------------------------------------------------------
-- 4. Whether the window is open: the one definition.
--
--    Two bounds, both stated here. The meeting it was opened in must still be
--    running, and the window never outlives the LOCAL day it was opened on
--    (a mentor who opens sign-ups with no meeting running still does not get
--    a team that is open all week). Dates go through _app_today() /
--    _app_timezone(), never current_date: a Friday session is 23:30-01:00 UTC
--    and current_date would shut half of it.
-- ---------------------------------------------------------------------------
create or replace function public.team_join_open(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1
		from public.teams t
		left join public.meetings m on m.id = t.join_open_meeting_id
		where t.id = p_team_id
			and t.archived_at is null
			and t.join_open_since is not null
			and (t.join_open_meeting_id is null or m.ended_at is null)
			and (t.join_open_since at time zone public._app_timezone())::date = public._app_today()
	);
$$;

revoke all on function public.team_join_open(uuid) from public;
grant execute on function public.team_join_open(uuid) to authenticated;

comment on function public.team_join_open(uuid) is
	'True while this team accepts self-enrollment: a mentor opened it, the meeting it was opened in has not ended, and the local day it was opened on has not. The single statement of the rule; student_self_enroll and team_login_roster both ask it.';

-- ---------------------------------------------------------------------------
-- 5. Opening and closing the window. One tap each, mentor only.
-- ---------------------------------------------------------------------------
create or replace function public.team_join_window_open(p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_team public.teams%rowtype;
	v_meeting_id uuid;
	v_taken integer;
begin
	if not public.is_mentor() then
		raise exception 'Only a mentor can open sign-ups.';
	end if;

	select t.* into v_team from public.teams t where t.id = p_team_id for update;
	if not found then
		raise exception 'That team does not exist.';
	end if;
	if v_team.archived_at is not null then
		raise exception 'That team is archived.';
	end if;

	-- The RUNNING meeting, not today's planned one: the window is meant to
	-- shut when the room empties.
	select m.id into v_meeting_id
	from public.meetings m
	where m.started_at is not null and m.ended_at is null
	order by m.started_at desc
	limit 1;

	update public.teams
	set join_open_since = now(), join_open_meeting_id = v_meeting_id
	where id = p_team_id;

	select count(*) into v_taken
	from public.students s
	where s.team_id = p_team_id and s.deactivated_at is null;

	return jsonb_build_object(
		'team_id', p_team_id,
		'join_code', v_team.join_code,
		'open', true,
		'meeting_id', v_meeting_id,
		'size_cap', public.team_size_cap(),
		'roster_size', v_taken,
		'seats_left', greatest(public.team_size_cap() - v_taken, 0)
	);
end;
$$;

revoke all on function public.team_join_window_open(uuid) from public;
grant execute on function public.team_join_window_open(uuid) to authenticated;

create or replace function public.team_join_window_close(p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_team public.teams%rowtype;
begin
	if not public.is_mentor() then
		raise exception 'Only a mentor can close sign-ups.';
	end if;

	select t.* into v_team from public.teams t where t.id = p_team_id for update;
	if not found then
		raise exception 'That team does not exist.';
	end if;

	update public.teams
	set join_open_since = null, join_open_meeting_id = null
	where id = p_team_id;

	return jsonb_build_object('team_id', p_team_id, 'open', false);
end;
$$;

revoke all on function public.team_join_window_close(uuid) from public;
grant execute on function public.team_join_window_close(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. meeting_end, which now shuts every window it opened.
--
--    0009's version verbatim plus the one UPDATE. Same signature, so this is
--    a plain replace and PostgREST sees no overload. The derived rule in
--    team_join_open() already refuses a window whose meeting ended; this
--    makes the STORED state say the same thing, so a mentor reading the
--    console after the meeting sees "closed" rather than a stale "open".
-- ---------------------------------------------------------------------------
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
	v_windows int;
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

	update public.teams
	set join_open_since = null, join_open_meeting_id = null
	where join_open_meeting_id = p_meeting_id;
	get diagnostics v_windows = row_count;

	return jsonb_build_object(
		'meeting_id', p_meeting_id,
		'ended_at', v_now,
		'phases_closed', v_closed,
		'join_windows_closed', v_windows
	);
end;
$$;

revoke all on function public.meeting_end(uuid) from public;
grant execute on function public.meeting_end(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. team_login_roster gains what the login screen needs to offer "I'm new
--    here". Same signature; a plain replace.
--
--    WHAT THIS ADDS TO WHAT ANON CAN SEE: two booleans and the cap, for a
--    caller who already had to know the join code. It grants nothing -- a
--    closed window and a full roster are exactly the two states the screen
--    must be able to explain instead of failing at the end of a form.
-- ---------------------------------------------------------------------------
create or replace function public.team_login_roster(p_join_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
	select jsonb_build_object(
		'team_id', t.id,
		'team_name', t.name,
		'join_code', t.join_code,
		'size_cap', public.team_size_cap(),
		'roster_size', (
			select count(*) from public.students s
			where s.team_id = t.id and s.deactivated_at is null
		),
		'roster_full', (
			select count(*) from public.students s
			where s.team_id = t.id and s.deactivated_at is null
		) >= public.team_size_cap(),
		'join_open', public.team_join_open(t.id),
		'students', coalesce((
			select jsonb_agg(
				jsonb_build_object(
					'first_name', s.first_name,
					'last_initial', s.last_initial,
					'slug', s.slug
				)
				order by s.first_name, s.last_initial, s.slug
			)
			from public.students s
			where s.team_id = t.id and s.deactivated_at is null
		), '[]'::jsonb)
	)
	from public.teams t
	where t.join_code = upper(btrim(p_join_code))
		and t.archived_at is null;
$$;

revoke all on function public.team_login_roster(text) from public;
grant execute on function public.team_login_roster(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. student_self_enroll: the kid in the room types their own name.
--
--    Granted to `anon` and to nobody else. It mints the same three rows
--    student_create mints, in the same shapes, with the same
--    fll.creating_student gate -- the differences are that the caller is
--    nobody, the PIN is theirs and is never echoed back, and the window and
--    the cap are checked in the caller's own terms before anything is
--    written.
--
--    A STALE TAB IS THE NORMAL CASE, NOT THE EDGE ONE. A phone that loaded
--    the roster twenty minutes ago still shows an open window and five
--    students. Both gates are re-read here, inside the transaction, after
--    the team row is locked; the cap trigger is the backstop under that.
-- ---------------------------------------------------------------------------
create or replace function public.student_self_enroll(
	p_join_code text,
	p_first_name text,
	p_last_initial text,
	p_grade smallint,
	p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_team public.teams%rowtype;
	v_first text := btrim(coalesce(p_first_name, ''));
	v_initial text := upper(btrim(coalesce(p_last_initial, '')));
	v_cap integer := public.team_size_cap();
	v_taken integer;
	v_base text;
	v_slug text;
	v_n int := 1;
	v_auth_id uuid := gen_random_uuid();
	v_student_id uuid;
	v_email text;
begin
	select t.* into v_team
	from public.teams t
	where t.join_code = upper(btrim(coalesce(p_join_code, '')))
		and t.archived_at is null
	for update;
	if not found then
		raise exception 'No team has that code.';
	end if;

	if not public.team_join_open(v_team.id) then
		raise exception 'Sign-ups for that team are closed. Ask a mentor to open them.';
	end if;

	-- Counted under the team row lock, so the answer cannot go stale between
	-- here and the insert. The trigger holds the same line for every other
	-- write path.
	select count(*) into v_taken
	from public.students s
	where s.team_id = v_team.id and s.deactivated_at is null;
	if v_taken >= v_cap then
		raise exception 'That team is full. A team holds % students. Ask a mentor which team to join.', v_cap;
	end if;

	if length(v_first) not between 1 and 40 then
		raise exception 'Type your first name.';
	end if;
	if v_initial !~ '^[A-Z]$' then
		raise exception 'Type the first letter of your last name.';
	end if;
	if p_grade is null or p_grade not between 1 and 12 then
		raise exception 'Pick your grade.';
	end if;
	if coalesce(p_pin, '') !~ '^[0-9]{6}$' then
		raise exception 'A PIN is exactly 6 numbers.';
	end if;

	v_base := public._student_slug_base(v_first, v_initial);
	if v_base = '' then
		raise exception 'That name has no letters or numbers to build a login from.';
	end if;
	v_slug := v_base;
	while exists (select 1 from public.students s where s.team_id = v_team.id and s.slug = v_slug) loop
		v_n := v_n + 1;
		v_slug := v_base || v_n::text;
	end loop;
	v_email := public._student_email(v_team.join_code, v_slug);

	perform set_config('fll.creating_student', 'on', true);

	insert into auth.users (
		instance_id, id, aud, role, email, encrypted_password,
		email_confirmed_at, invited_at,
		confirmation_token, confirmation_sent_at,
		recovery_token, recovery_sent_at,
		email_change_token_new, email_change, email_change_sent_at,
		email_change_token_current, email_change_confirm_status,
		phone, phone_confirmed_at, phone_change, phone_change_token, phone_change_sent_at,
		reauthentication_token, reauthentication_sent_at,
		last_sign_in_at, raw_app_meta_data, raw_user_meta_data,
		is_super_admin, is_sso_user, is_anonymous, banned_until, deleted_at,
		created_at, updated_at
	) values (
		'00000000-0000-0000-0000-000000000000', v_auth_id, 'authenticated', 'authenticated', v_email,
		extensions.crypt(p_pin, extensions.gen_salt('bf', 10)),
		now(), null,
		'', null,
		'', null,
		'', '', null,
		'', 0,
		null, null, '', '', null,
		'', null,
		null,
		jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'kind', 'student'),
		jsonb_build_object('kind', 'student', 'team_id', v_team.id, 'first_name', v_first, 'last_initial', v_initial, 'enrolled', 'self'),
		false, false, false, null, null,
		now(), now()
	);

	insert into auth.identities (
		id, user_id, provider_id, provider, identity_data,
		last_sign_in_at, created_at, updated_at
	) values (
		gen_random_uuid(), v_auth_id, v_auth_id::text, 'email',
		jsonb_build_object('sub', v_auth_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
		null, now(), now()
	);

	insert into public.students (team_id, first_name, last_initial, grade, slug, auth_user_id)
	values (v_team.id, v_first, v_initial, p_grade, v_slug, v_auth_id)
	returning id into v_student_id;

	perform set_config('fll.creating_student', 'off', true);

	return jsonb_build_object(
		'student_id', v_student_id,
		'team_id', v_team.id,
		'team_name', v_team.name,
		'join_code', v_team.join_code,
		'first_name', v_first,
		'last_initial', v_initial,
		'slug', v_slug,
		'email', v_email
	);
end;
$$;

revoke all on function public.student_self_enroll(text, text, text, smallint, text) from public;
grant execute on function public.student_self_enroll(text, text, text, smallint, text) to anon;

comment on function public.student_self_enroll(text, text, text, smallint, text) is
	'A student with the team code and an open join window minting their own account. Granted to anon only; the join code, the window and the six-student cap are the three gates, and the address is built here rather than supplied.';

-- ---------------------------------------------------------------------------
-- 9. What the console needs to draw the roster pane: seats, cap and window
--    state for every live team, in one call.
-- ---------------------------------------------------------------------------
create or replace function public.team_roster_state()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(
		jsonb_agg(
			jsonb_build_object(
				'team_id', t.id,
				'name', t.name,
				'join_code', t.join_code,
				'accent', t.accent,
				'size_cap', public.team_size_cap(),
				'roster_size', (
					select count(*) from public.students s
					where s.team_id = t.id and s.deactivated_at is null
				),
				'seats_left', greatest(public.team_size_cap() - (
					select count(*) from public.students s
					where s.team_id = t.id and s.deactivated_at is null
				), 0),
				'join_open', public.team_join_open(t.id),
				'join_open_since', t.join_open_since,
				'join_open_meeting_id', t.join_open_meeting_id
			)
			order by t.name
		),
		'[]'::jsonb
	)
	from public.teams t
	where t.archived_at is null
		and public.is_mentor();
$$;

revoke all on function public.team_roster_state() from public;
grant execute on function public.team_roster_state() to authenticated;

-- ---------------------------------------------------------------------------
-- 10. A student changes team, slug and login address ONLY through
--     student_move_team. 0004's trigger, with one transaction-local escape
--     hatch that only a definer body in this schema can raise.
-- ---------------------------------------------------------------------------
create or replace function public._students_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
	v_moving boolean := coalesce(current_setting('fll.moving_student', true), '') = 'on';
begin
	if new.auth_user_id <> old.auth_user_id then
		raise exception 'A student''s auth user cannot be changed.';
	end if;
	if not v_moving and (new.team_id <> old.team_id or new.slug <> old.slug) then
		raise exception 'A student''s team and login slug are changed by moving them to another team, not edited.';
	end if;
	return new;
end;
$$;
revoke all on function public._students_immutable() from public;

-- ---------------------------------------------------------------------------
-- 11. Detaching a student from the team they are leaving.
--
--     FORWARD-LOOKING rows only. A role assignment says who is meant to sit
--     in a seat next week and a task assignment says who is meant to finish
--     something today; both are about the team the student is leaving and
--     neither is a record of what happened. History (blockers, evidence) is
--     the caller's problem, because a move cannot rewrite it truthfully --
--     student_move_team refuses instead.
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

	return jsonb_build_object('roles_cleared', v_roles, 'tasks_unassigned', v_tasks);
end;
$$;
revoke all on function public._student_detach_from_team(uuid) from public;

-- ---------------------------------------------------------------------------
-- 12. student_move_team.
-- ---------------------------------------------------------------------------
create or replace function public.student_move_team(p_student_id uuid, p_to_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_student public.students%rowtype;
	v_from public.teams%rowtype;
	v_to public.teams%rowtype;
	v_cap integer := public.team_size_cap();
	v_taken integer;
	v_blockers integer;
	v_evidence integer;
	v_detached jsonb;
	v_base text;
	v_slug text;
	v_n int := 1;
	v_email text;
begin
	if not public.is_mentor() then
		raise exception 'Only a mentor can move a student to another team.';
	end if;

	select s.* into v_student from public.students s where s.id = p_student_id for update;
	if not found then
		raise exception 'That student does not exist.';
	end if;

	select t.* into v_to from public.teams t where t.id = p_to_team_id for update;
	if not found then
		raise exception 'That team does not exist.';
	end if;
	if v_to.archived_at is not null then
		raise exception 'That team is archived.';
	end if;
	if v_student.team_id = p_to_team_id then
		raise exception 'That student is already on that team.';
	end if;

	select t.* into v_from from public.teams t where t.id = v_student.team_id;

	-- History refuses the move, and says so with counts.
	select count(*) into v_blockers from public.blockers b where b.student_id = p_student_id;
	select count(*) into v_evidence from public.evidence e where e.uploaded_by_student_id = p_student_id;
	if v_blockers > 0 or v_evidence > 0 then
		raise exception
			'% % has % blocker(s) and % photo(s) recorded on %. That work belongs to that team and a move cannot rewrite it. Deactivate them on % and add them to % instead.',
			v_student.first_name, v_student.last_initial || '.', v_blockers, v_evidence,
			v_from.name, v_from.name, v_to.name;
	end if;

	-- The seat on the receiving team, under its own row lock. The trigger on
	-- the UPDATE below holds the same line; this one exists so the message
	-- names the team the mentor just picked.
	if v_student.deactivated_at is null then
		select count(*) into v_taken
		from public.students s
		where s.team_id = p_to_team_id and s.deactivated_at is null;
		if v_taken >= v_cap then
			raise exception '% already has % students, which is the most a team can hold.', v_to.name, v_cap;
		end if;
	end if;

	v_detached := public._student_detach_from_team(p_student_id);

	-- The slug is re-deduplicated inside the RECEIVING team: the old one may
	-- already be taken there, and the address changes anyway because the join
	-- code does.
	v_base := public._student_slug_base(v_student.first_name, v_student.last_initial);
	v_slug := v_base;
	while exists (select 1 from public.students s where s.team_id = p_to_team_id and s.slug = v_slug) loop
		v_n := v_n + 1;
		v_slug := v_base || v_n::text;
	end loop;
	v_email := public._student_email(v_to.join_code, v_slug);

	perform set_config('fll.moving_student', 'on', true);
	update public.students s
	set team_id = p_to_team_id, slug = v_slug
	where s.id = p_student_id;
	perform set_config('fll.moving_student', 'off', true);

	update auth.users u
	set email = v_email,
		raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('team_id', p_to_team_id),
		updated_at = now()
	where u.id = v_student.auth_user_id;

	update auth.identities i
	set identity_data = i.identity_data || jsonb_build_object('email', v_email), updated_at = now()
	where i.user_id = v_student.auth_user_id and i.provider = 'email';

	delete from auth.sessions x where x.user_id = v_student.auth_user_id;

	return jsonb_build_object(
		'student_id', p_student_id,
		'from_team_id', v_from.id,
		'from_team_name', v_from.name,
		'to_team_id', v_to.id,
		'to_team_name', v_to.name,
		'slug', v_slug,
		'email', v_email,
		'previous_slug', v_student.slug,
		'roles_cleared', v_detached -> 'roles_cleared',
		'tasks_unassigned', v_detached -> 'tasks_unassigned'
	);
end;
$$;

revoke all on function public.student_move_team(uuid, uuid) from public;
grant execute on function public.student_move_team(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. Realtime. The console's roster pane has to fill in as kids sign
--     themselves up, and the join-window pill has to agree across two
--     mentors' laptops. Same idempotent block as 0008; replica identity full
--     for the same reason (a DELETE with only a key cannot be filtered).
--
--     Publishing grants no read: RLS is evaluated per subscriber, so a
--     student's channel still carries only their own team's roster.
-- ---------------------------------------------------------------------------
alter table public.students replica identity full;
alter table public.teams replica identity full;

do $$
declare
	v_table text;
	v_added text[] := array[]::text[];
begin
	if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
		raise notice '0013: no supabase_realtime publication on this database; skipped.';
		return;
	end if;

	foreach v_table in array array['students', 'teams'] loop
		if not exists (
			select 1 from pg_publication_tables
			where pubname = 'supabase_realtime'
				and schemaname = 'public'
				and tablename = v_table
		) then
			execute format('alter publication supabase_realtime add table public.%I', v_table);
			v_added := v_added || v_table;
		end if;
	end loop;

	raise notice '0013: realtime added % of 2 tables (%); the rest were already published.',
		coalesce(array_length(v_added, 1), 0), coalesce(array_to_string(v_added, ', '), 'none');
end
$$;

-- ---------------------------------------------------------------------------
-- 14. Report what the cap would refuse right now, so a first apply over a
--     roster somebody already overfilled is loud rather than silent. The cap
--     binds new writes only; an existing over-cap team is left alone and
--     named here.
-- ---------------------------------------------------------------------------
do $$
declare
	v_row record;
	v_over int := 0;
begin
	for v_row in
		select t.name, count(s.id) as n
		from public.teams t
		join public.students s on s.team_id = t.id and s.deactivated_at is null
		where t.archived_at is null
		group by t.name
		having count(s.id) > public.team_size_cap()
	loop
		raise notice '0013: team "%" already holds % active students, over the cap of %. No student was removed; the cap binds new enrollments.',
			v_row.name, v_row.n, public.team_size_cap();
		v_over := v_over + 1;
	end loop;
	raise notice '0013: cap is % per team; % team(s) are over it today.', public.team_size_cap(), v_over;
end
$$;

-- 0006_meetings.sql
--
-- MEETINGS: the Friday and Saturday sessions every team attends together, the
-- timed phases inside each one, the template those phases are stamped from,
-- and attendance.
--
-- Applied by the Supabase CLI, after 0005.
--
-- MEETINGS ARE SHARED, NOT PER TEAM. All four teams meet in the same room at
-- the same time, so a meeting has no team_id and every signed-in user -- every
-- mentor and every student -- can read meetings and meeting_phases. Only
-- mentors write them; a phase change is a mentor's UPDATE of
-- meetings.current_phase_id (0008 publishes it to every connected device).
--
-- THE CURRENT PHASE BELONGS TO ITS MEETING, AS A CONSTRAINT. The composite
-- foreign key (current_phase_id, id) -> meeting_phases (id, meeting_id) makes
-- pointing a meeting at another meeting's phase impossible. When the phase row
-- goes, only the pointer is nulled (`on delete set null (current_phase_id)`,
-- Postgres 15+), never the meeting's own id.
--
-- ATTENDANCE IS WRITTEN, NEVER BACKDATED. checked_in_at has no client grant,
-- so the server clock stamps it; a student can check themselves in only while
-- the meeting is live (started and not ended), and a mentor can check anyone
-- in or correct a stamp. (meeting_id, student_id) is unique, so a queued
-- check-in replayed twice is an upsert, not a duplicate.
--
-- ===========================================================================
-- TO UNDO
-- ===========================================================================
--
--   drop function if exists public.meeting_create(public.meeting_kind, date, timestamptz, timestamptz);
--   drop table if exists public.attendance;
--   alter table public.meetings drop constraint if exists meetings_current_phase_fkey;
--   drop trigger if exists meeting_phases_set_updated_at on public.meeting_phases;
--   drop table if exists public.meeting_phases;
--   drop trigger if exists meetings_set_updated_at on public.meetings;
--   drop table if exists public.meetings;
--   drop table if exists public.phase_templates;
--
-- 0007 (tasks.meeting_id) references meetings; undo it first.

-- ---------------------------------------------------------------------------
-- 1. The phase template: one ordered list per meeting kind, copied into a new
--    meeting by meeting_create. Rows are seeded (supabase/seed.sql) and edited
--    by mentors.
-- ---------------------------------------------------------------------------
create table if not exists public.phase_templates (
	id uuid primary key default gen_random_uuid(),
	kind public.meeting_kind not null,
	ordinal smallint not null check (ordinal >= 1),
	name text not null check (length(btrim(name)) between 1 and 60),
	planned_minutes smallint not null check (planned_minutes between 1 and 600),
	unique (kind, ordinal)
);

comment on table public.phase_templates is
	'The standard phases for each meeting kind, copied into meeting_phases by meeting_create().';

-- ---------------------------------------------------------------------------
-- 2. Meetings and their phases.
-- ---------------------------------------------------------------------------
create table if not exists public.meetings (
	id uuid primary key default gen_random_uuid(),
	meeting_date date not null,
	kind public.meeting_kind not null,
	planned_start_at timestamptz not null,
	planned_end_at timestamptz not null,
	started_at timestamptz,
	ended_at timestamptz,
	current_phase_id uuid,
	created_by uuid not null references public.mentors (id),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint meetings_planned_range_check check (planned_end_at > planned_start_at),
	constraint meetings_ended_after_started_check
		check (ended_at is null or (started_at is not null and ended_at >= started_at))
);

comment on table public.meetings is
	'A Friday or Saturday session shared by every team. current_phase_id is the live pointer that 0008 broadcasts.';

drop trigger if exists meetings_set_updated_at on public.meetings;
create trigger meetings_set_updated_at
	before update on public.meetings
	for each row execute function public.set_updated_at();

create table if not exists public.meeting_phases (
	id uuid primary key default gen_random_uuid(),
	meeting_id uuid not null references public.meetings (id) on delete cascade,
	ordinal smallint not null check (ordinal >= 1),
	name text not null check (length(btrim(name)) between 1 and 60),
	planned_minutes smallint not null check (planned_minutes between 1 and 600),
	started_at timestamptz,
	ended_at timestamptz,
	updated_at timestamptz not null default now(),
	unique (meeting_id, ordinal),
	unique (id, meeting_id),
	constraint meeting_phases_ended_after_started_check
		check (ended_at is null or (started_at is not null and ended_at >= started_at))
);

comment on table public.meeting_phases is
	'The ordered, timed phases of one meeting, stamped from phase_templates at creation and editable by mentors.';

drop trigger if exists meeting_phases_set_updated_at on public.meeting_phases;
create trigger meeting_phases_set_updated_at
	before update on public.meeting_phases
	for each row execute function public.set_updated_at();

alter table public.meetings drop constraint if exists meetings_current_phase_fkey;
alter table public.meetings
	add constraint meetings_current_phase_fkey
	foreign key (current_phase_id, id) references public.meeting_phases (id, meeting_id)
	on delete set null (current_phase_id);

-- ---------------------------------------------------------------------------
-- 3. Attendance.
-- ---------------------------------------------------------------------------
create table if not exists public.attendance (
	id uuid primary key default gen_random_uuid(),
	meeting_id uuid not null references public.meetings (id) on delete cascade,
	student_id uuid not null references public.students (id),
	checked_in_at timestamptz not null default now(),
	unique (meeting_id, student_id)
);

comment on table public.attendance is
	'One row per student per meeting. checked_in_at is server-stamped: there is no client grant on the column.';

-- ---------------------------------------------------------------------------
-- 4. meeting_create: a meeting plus its phases from the template, in one
--    transaction. planned_end_at defaults to start + the template's total.
-- ---------------------------------------------------------------------------
create or replace function public.meeting_create(
	p_kind public.meeting_kind,
	p_meeting_date date,
	p_planned_start_at timestamptz,
	p_planned_end_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_mentor_id uuid := public.current_mentor_id();
	v_total_minutes int;
	v_end timestamptz;
	v_meeting_id uuid;
	v_phases int;
begin
	if v_mentor_id is null then
		raise exception 'Only a mentor can create a meeting.';
	end if;
	if p_kind is null or p_meeting_date is null or p_planned_start_at is null then
		raise exception 'A meeting needs a kind, a date and a planned start.';
	end if;

	select coalesce(sum(t.planned_minutes), 0) into v_total_minutes
	from public.phase_templates t
	where t.kind = p_kind;
	if v_total_minutes = 0 then
		raise exception 'There is no phase template for % meetings yet.', p_kind;
	end if;

	v_end := coalesce(p_planned_end_at, p_planned_start_at + make_interval(mins => v_total_minutes));
	if v_end <= p_planned_start_at then
		raise exception 'A meeting ends after it starts.';
	end if;

	insert into public.meetings (meeting_date, kind, planned_start_at, planned_end_at, created_by)
	values (p_meeting_date, p_kind, p_planned_start_at, v_end, v_mentor_id)
	returning id into v_meeting_id;

	insert into public.meeting_phases (meeting_id, ordinal, name, planned_minutes)
	select v_meeting_id, t.ordinal, t.name, t.planned_minutes
	from public.phase_templates t
	where t.kind = p_kind
	order by t.ordinal;
	get diagnostics v_phases = row_count;

	return jsonb_build_object(
		'meeting_id', v_meeting_id,
		'kind', p_kind,
		'meeting_date', p_meeting_date,
		'planned_start_at', p_planned_start_at,
		'planned_end_at', v_end,
		'phases', v_phases
	);
end;
$$;

revoke all on function public.meeting_create(public.meeting_kind, date, timestamptz, timestamptz) from public;
grant execute on function public.meeting_create(public.meeting_kind, date, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Grants and RLS.
-- ---------------------------------------------------------------------------

-- phase_templates: everyone reads, mentors write.
revoke all on public.phase_templates from anon, authenticated;
grant all on public.phase_templates to service_role;
grant select on public.phase_templates to authenticated;
grant insert (id, kind, ordinal, name, planned_minutes) on public.phase_templates to authenticated;
grant update (kind, ordinal, name, planned_minutes) on public.phase_templates to authenticated;
grant delete on public.phase_templates to authenticated;

alter table public.phase_templates enable row level security;

drop policy if exists "everyone signed in reads phase templates" on public.phase_templates;
create policy "everyone signed in reads phase templates"
	on public.phase_templates
	for select
	to authenticated
	using (true);

drop policy if exists "mentors insert phase templates" on public.phase_templates;
create policy "mentors insert phase templates"
	on public.phase_templates
	for insert
	to authenticated
	with check ((select public.is_mentor()));

drop policy if exists "mentors update phase templates" on public.phase_templates;
create policy "mentors update phase templates"
	on public.phase_templates
	for update
	to authenticated
	using ((select public.is_mentor()))
	with check ((select public.is_mentor()));

drop policy if exists "mentors delete phase templates" on public.phase_templates;
create policy "mentors delete phase templates"
	on public.phase_templates
	for delete
	to authenticated
	using ((select public.is_mentor()));

-- meetings: everyone reads, mentors write. created_by is pinned to the caller
-- on insert and unwritable afterwards.
revoke all on public.meetings from anon, authenticated;
grant all on public.meetings to service_role;
grant select on public.meetings to authenticated;
grant insert (id, meeting_date, kind, planned_start_at, planned_end_at, started_at, ended_at, current_phase_id, created_by) on public.meetings to authenticated;
grant update (meeting_date, kind, planned_start_at, planned_end_at, started_at, ended_at, current_phase_id) on public.meetings to authenticated;
grant delete on public.meetings to authenticated;

alter table public.meetings enable row level security;

drop policy if exists "everyone signed in reads meetings" on public.meetings;
create policy "everyone signed in reads meetings"
	on public.meetings
	for select
	to authenticated
	using (true);

drop policy if exists "mentors insert meetings as themselves" on public.meetings;
create policy "mentors insert meetings as themselves"
	on public.meetings
	for insert
	to authenticated
	with check (created_by = (select public.current_mentor_id()));

drop policy if exists "mentors update meetings" on public.meetings;
create policy "mentors update meetings"
	on public.meetings
	for update
	to authenticated
	using ((select public.is_mentor()))
	with check ((select public.is_mentor()));

drop policy if exists "mentors delete meetings" on public.meetings;
create policy "mentors delete meetings"
	on public.meetings
	for delete
	to authenticated
	using ((select public.is_mentor()));

-- meeting_phases: everyone reads, mentors write.
revoke all on public.meeting_phases from anon, authenticated;
grant all on public.meeting_phases to service_role;
grant select on public.meeting_phases to authenticated;
grant insert (id, meeting_id, ordinal, name, planned_minutes, started_at, ended_at) on public.meeting_phases to authenticated;
grant update (ordinal, name, planned_minutes, started_at, ended_at) on public.meeting_phases to authenticated;
grant delete on public.meeting_phases to authenticated;

alter table public.meeting_phases enable row level security;

drop policy if exists "everyone signed in reads meeting phases" on public.meeting_phases;
create policy "everyone signed in reads meeting phases"
	on public.meeting_phases
	for select
	to authenticated
	using (true);

drop policy if exists "mentors insert meeting phases" on public.meeting_phases;
create policy "mentors insert meeting phases"
	on public.meeting_phases
	for insert
	to authenticated
	with check ((select public.is_mentor()));

drop policy if exists "mentors update meeting phases" on public.meeting_phases;
create policy "mentors update meeting phases"
	on public.meeting_phases
	for update
	to authenticated
	using ((select public.is_mentor()))
	with check ((select public.is_mentor()));

drop policy if exists "mentors delete meeting phases" on public.meeting_phases;
create policy "mentors delete meeting phases"
	on public.meeting_phases
	for delete
	to authenticated
	using ((select public.is_mentor()));

-- attendance: mentors everything; students read their team and check
-- themselves in to a live meeting. checked_in_at is never in a client grant.
revoke all on public.attendance from anon, authenticated;
grant all on public.attendance to service_role;
grant select on public.attendance to authenticated;
grant insert (id, meeting_id, student_id) on public.attendance to authenticated;
grant update (checked_in_at) on public.attendance to authenticated;
grant delete on public.attendance to authenticated;

alter table public.attendance enable row level security;

drop policy if exists "mentors read every attendance row" on public.attendance;
create policy "mentors read every attendance row"
	on public.attendance
	for select
	to authenticated
	using ((select public.is_mentor()));

drop policy if exists "students read their own team attendance" on public.attendance;
create policy "students read their own team attendance"
	on public.attendance
	for select
	to authenticated
	using (
		exists (
			select 1 from public.students s
			where s.id = attendance.student_id
				and s.team_id = (select public.current_student_team_id())
		)
	);

drop policy if exists "mentors insert attendance" on public.attendance;
create policy "mentors insert attendance"
	on public.attendance
	for insert
	to authenticated
	with check ((select public.is_mentor()));

drop policy if exists "students check themselves in to a live meeting" on public.attendance;
create policy "students check themselves in to a live meeting"
	on public.attendance
	for insert
	to authenticated
	with check (
		student_id = (select public.current_student_id())
		and exists (
			select 1 from public.meetings m
			where m.id = attendance.meeting_id
				and m.started_at is not null
				and m.ended_at is null
		)
	);

drop policy if exists "mentors update attendance" on public.attendance;
create policy "mentors update attendance"
	on public.attendance
	for update
	to authenticated
	using ((select public.is_mentor()))
	with check ((select public.is_mentor()));

drop policy if exists "mentors delete attendance" on public.attendance;
create policy "mentors delete attendance"
	on public.attendance
	for delete
	to authenticated
	using ((select public.is_mentor()));

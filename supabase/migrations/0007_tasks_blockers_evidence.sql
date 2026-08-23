-- 0007_tasks_blockers_evidence.sql
--
-- THE TEAM WORK SURFACE: tasks, the blockers raised against them, and the
-- photo/video evidence attached to them, plus the private storage bucket the
-- evidence lives in.
--
-- Applied by the Supabase CLI, after 0006.
--
-- THE TEAM BOUNDARY IS A CONSTRAINT, THEN A POLICY. Every row carries team_id
-- and every student reference on it is a composite foreign key
-- (student_id, team_id) -> students (id, team_id), so a task cannot be
-- assigned across teams, a blocker cannot be raised by an outsider, and
-- evidence cannot be uploaded by one. RLS then scopes every student read and
-- write to `team_id = current_student_team_id()`; mentors see everything.
--
-- WHAT A GRANT DOES THAT A POLICY CANNOT. `authenticated` is one role for
-- mentors and students, so column privileges apply to both; what they buy is
-- that a column with no INSERT/UPDATE grant is server-owned for EVERY client:
--
--   * evidence.upload_timestamp -- the one the season's record depends on.
--     No client can set it; the default stamps it. This is the requirement
--     "never client-writable, enforced at the grant level, not by convention";
--   * tasks.closed_at and tasks.created_at, blockers.raised_at -- same idea.
--
-- Mentor-only columns that students must not touch but mentors must
-- (tasks.evidence_required) are enforced by a BEFORE UPDATE trigger that
-- raises unless is_mentor(): a grant cannot express "this role, sometimes".
--
-- WHY CLIENT-SUPPLIED IDs ARE GRANTED. Every insert grant includes `id`. A
-- local-first write queue mints the uuid on the device, so a replayed insert
-- is a no-op conflict rather than a duplicate, and a follow-up update queued
-- offline already knows the id it targets. Nothing in this file depends on a
-- server-generated key.
--
-- ===========================================================================
-- TO UNDO
-- ===========================================================================
--
--   drop policy if exists "evidence objects: students delete their own uploads" on storage.objects;
--   drop policy if exists "evidence objects: students upload into their team folder" on storage.objects;
--   drop policy if exists "evidence objects: students read their team folder" on storage.objects;
--   drop policy if exists "evidence objects: mentors do everything" on storage.objects;
--   delete from storage.buckets where id = 'evidence';  -- refuses while objects remain; empty it first
--   drop table if exists public.evidence;
--   drop trigger if exists blockers_immutable on public.blockers;
--   drop trigger if exists blockers_set_updated_at on public.blockers;
--   drop table if exists public.blockers;
--   drop trigger if exists tasks_mentor_only_columns on public.tasks;
--   drop trigger if exists tasks_immutable on public.tasks;
--   drop trigger if exists tasks_close_stamp on public.tasks;
--   drop trigger if exists tasks_set_updated_at on public.tasks;
--   drop table if exists public.tasks;
--   drop function if exists public._mentor_only_columns();
--   drop function if exists public._immutable_columns();
--   drop function if exists public._tasks_close_stamp();

-- ---------------------------------------------------------------------------
-- 1. Generic trigger functions. Both read their column list from TG_ARGV so
--    one definition serves every table.
-- ---------------------------------------------------------------------------

-- Raises if any named column changed. Used for the columns that pin a row to
-- its team and its author.
create or replace function public._immutable_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
	v_col text;
	v_old jsonb := to_jsonb(old);
	v_new jsonb := to_jsonb(new);
begin
	foreach v_col in array tg_argv loop
		if v_old -> v_col is distinct from v_new -> v_col then
			raise exception 'The column "%" on % cannot be changed.', v_col, tg_table_name;
		end if;
	end loop;
	return new;
end;
$$;
revoke all on function public._immutable_columns() from public;

-- Raises if any named column changed and the caller is not a mentor.
create or replace function public._mentor_only_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_col text;
	v_old jsonb := to_jsonb(old);
	v_new jsonb := to_jsonb(new);
begin
	if (select auth.uid()) is null or public.is_mentor() then
		return new;
	end if;
	foreach v_col in array tg_argv loop
		if v_old -> v_col is distinct from v_new -> v_col then
			raise exception 'Only a mentor can change "%" on %.', v_col, tg_table_name;
		end if;
	end loop;
	return new;
end;
$$;
revoke all on function public._mentor_only_columns() from public;

-- ---------------------------------------------------------------------------
-- 2. Tasks.
-- ---------------------------------------------------------------------------
create table if not exists public.tasks (
	id uuid primary key default gen_random_uuid(),
	team_id uuid not null references public.teams (id),
	meeting_id uuid references public.meetings (id) on delete set null,
	title text not null check (length(btrim(title)) between 1 and 200),
	detail text check (detail is null or length(detail) <= 4000),
	role public.team_role,
	status public.task_status not null default 'open',
	assigned_student_id uuid,
	evidence_required boolean not null default false,
	created_by_mentor_id uuid references public.mentors (id),
	created_by_student_id uuid references public.students (id),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	closed_at timestamptz,
	foreign key (assigned_student_id, team_id) references public.students (id, team_id),
	unique (id, team_id),
	constraint tasks_exactly_one_creator_check
		check (num_nonnulls(created_by_mentor_id, created_by_student_id) = 1),
	constraint tasks_closed_iff_done_check
		check ((status = 'done') = (closed_at is not null))
);

comment on table public.tasks is
	'A unit of team work. closed_at is server-stamped when status becomes done and cleared when it leaves done; evidence_required is mentor-only.';

create index if not exists tasks_team_status_idx on public.tasks (team_id, status);
create index if not exists tasks_meeting_idx on public.tasks (meeting_id) where meeting_id is not null;

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
	before update on public.tasks
	for each row execute function public.set_updated_at();

-- closed_at follows status, on the server clock.
create or replace function public._tasks_close_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	if new.status = 'done' then
		if new.closed_at is null then
			new.closed_at := now();
		end if;
	else
		new.closed_at := null;
	end if;
	return new;
end;
$$;
revoke all on function public._tasks_close_stamp() from public;

drop trigger if exists tasks_close_stamp on public.tasks;
create trigger tasks_close_stamp
	before insert or update on public.tasks
	for each row execute function public._tasks_close_stamp();

drop trigger if exists tasks_immutable on public.tasks;
create trigger tasks_immutable
	before update on public.tasks
	for each row execute function public._immutable_columns('team_id', 'created_by_mentor_id', 'created_by_student_id', 'created_at');

drop trigger if exists tasks_mentor_only_columns on public.tasks;
create trigger tasks_mentor_only_columns
	before update on public.tasks
	for each row execute function public._mentor_only_columns('evidence_required');

-- ---------------------------------------------------------------------------
-- 3. Blockers.
-- ---------------------------------------------------------------------------
create table if not exists public.blockers (
	id uuid primary key default gen_random_uuid(),
	team_id uuid not null references public.teams (id),
	student_id uuid not null,
	task_id uuid,
	note text not null check (length(btrim(note)) between 1 and 1000),
	raised_at timestamptz not null default now(),
	resolved_at timestamptz,
	resolved_by_mentor_id uuid references public.mentors (id),
	updated_at timestamptz not null default now(),
	foreign key (student_id, team_id) references public.students (id, team_id),
	foreign key (task_id, team_id) references public.tasks (id, team_id) on delete set null (task_id),
	constraint blockers_resolver_implies_resolved_check
		check (resolved_by_mentor_id is null or resolved_at is not null)
);

comment on table public.blockers is
	'A student saying "I am stuck", optionally on a task. A student may clear their own; a mentor resolving one records resolved_by_mentor_id.';

create index if not exists blockers_team_open_idx on public.blockers (team_id) where resolved_at is null;

drop trigger if exists blockers_set_updated_at on public.blockers;
create trigger blockers_set_updated_at
	before update on public.blockers
	for each row execute function public.set_updated_at();

drop trigger if exists blockers_immutable on public.blockers;
create trigger blockers_immutable
	before update on public.blockers
	for each row execute function public._immutable_columns('team_id', 'student_id', 'raised_at');

-- ---------------------------------------------------------------------------
-- 4. Evidence. storage_path is `{team_id}/{task_id}/{file}` and the check
--    constraint holds the path to the row's own team and task, which is also
--    what the storage policies below key on.
-- ---------------------------------------------------------------------------
create table if not exists public.evidence (
	id uuid primary key default gen_random_uuid(),
	task_id uuid not null,
	team_id uuid not null references public.teams (id),
	storage_path text not null unique
		check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[^/]{1,200}$'),
	caption text check (caption is null or length(caption) <= 500),
	uploaded_by_student_id uuid not null,
	upload_timestamp timestamptz not null default now(),
	foreign key (task_id, team_id) references public.tasks (id, team_id) on delete cascade,
	foreign key (uploaded_by_student_id, team_id) references public.students (id, team_id),
	constraint evidence_path_matches_row_check
		check (
			split_part(storage_path, '/', 1) = team_id::text
			and split_part(storage_path, '/', 2) = task_id::text
		)
);

comment on table public.evidence is
	'A file in the evidence bucket attached to a task. upload_timestamp is server-stamped: no client grant on the column, for anyone.';

create index if not exists evidence_task_idx on public.evidence (task_id);

-- ---------------------------------------------------------------------------
-- 5. Grants and RLS.
-- ---------------------------------------------------------------------------

-- tasks
revoke all on public.tasks from anon, authenticated;
grant all on public.tasks to service_role;
grant select on public.tasks to authenticated;
grant insert (id, team_id, meeting_id, title, detail, role, status, assigned_student_id, evidence_required, created_by_mentor_id, created_by_student_id) on public.tasks to authenticated;
grant update (meeting_id, title, detail, role, status, assigned_student_id, evidence_required) on public.tasks to authenticated;
grant delete on public.tasks to authenticated;

alter table public.tasks enable row level security;

drop policy if exists "mentors read every task" on public.tasks;
create policy "mentors read every task"
	on public.tasks
	for select
	to authenticated
	using ((select public.is_mentor()));

drop policy if exists "students read their own team tasks" on public.tasks;
create policy "students read their own team tasks"
	on public.tasks
	for select
	to authenticated
	using (team_id = (select public.current_student_team_id()));

drop policy if exists "mentors insert tasks as themselves" on public.tasks;
create policy "mentors insert tasks as themselves"
	on public.tasks
	for insert
	to authenticated
	with check (
		created_by_mentor_id = (select public.current_mentor_id())
		and created_by_student_id is null
	);

drop policy if exists "students insert their own team tasks as themselves" on public.tasks;
create policy "students insert their own team tasks as themselves"
	on public.tasks
	for insert
	to authenticated
	with check (
		team_id = (select public.current_student_team_id())
		and created_by_student_id = (select public.current_student_id())
		and created_by_mentor_id is null
	);

drop policy if exists "mentors update tasks" on public.tasks;
create policy "mentors update tasks"
	on public.tasks
	for update
	to authenticated
	using ((select public.is_mentor()))
	with check ((select public.is_mentor()));

drop policy if exists "students update their own team tasks" on public.tasks;
create policy "students update their own team tasks"
	on public.tasks
	for update
	to authenticated
	using (team_id = (select public.current_student_team_id()))
	with check (team_id = (select public.current_student_team_id()));

drop policy if exists "mentors delete tasks" on public.tasks;
create policy "mentors delete tasks"
	on public.tasks
	for delete
	to authenticated
	using ((select public.is_mentor()));

-- blockers
revoke all on public.blockers from anon, authenticated;
grant all on public.blockers to service_role;
grant select on public.blockers to authenticated;
grant insert (id, team_id, student_id, task_id, note) on public.blockers to authenticated;
grant update (task_id, note, resolved_at, resolved_by_mentor_id) on public.blockers to authenticated;
grant delete on public.blockers to authenticated;

alter table public.blockers enable row level security;

drop policy if exists "mentors read every blocker" on public.blockers;
create policy "mentors read every blocker"
	on public.blockers
	for select
	to authenticated
	using ((select public.is_mentor()));

drop policy if exists "students read their own team blockers" on public.blockers;
create policy "students read their own team blockers"
	on public.blockers
	for select
	to authenticated
	using (team_id = (select public.current_student_team_id()));

drop policy if exists "mentors insert blockers" on public.blockers;
create policy "mentors insert blockers"
	on public.blockers
	for insert
	to authenticated
	with check ((select public.is_mentor()));

drop policy if exists "students raise their own blockers" on public.blockers;
create policy "students raise their own blockers"
	on public.blockers
	for insert
	to authenticated
	with check (
		team_id = (select public.current_student_team_id())
		and student_id = (select public.current_student_id())
	);

drop policy if exists "mentors update blockers and resolve as themselves" on public.blockers;
create policy "mentors update blockers and resolve as themselves"
	on public.blockers
	for update
	to authenticated
	using ((select public.is_mentor()))
	with check (
		(select public.is_mentor())
		and (resolved_by_mentor_id is null or resolved_by_mentor_id = (select public.current_mentor_id()))
	);

drop policy if exists "students update their own unresolved blockers" on public.blockers;
create policy "students update their own unresolved blockers"
	on public.blockers
	for update
	to authenticated
	using (
		team_id = (select public.current_student_team_id())
		and student_id = (select public.current_student_id())
		and resolved_by_mentor_id is null
	)
	with check (
		team_id = (select public.current_student_team_id())
		and student_id = (select public.current_student_id())
		and resolved_by_mentor_id is null
	);

drop policy if exists "mentors delete blockers" on public.blockers;
create policy "mentors delete blockers"
	on public.blockers
	for delete
	to authenticated
	using ((select public.is_mentor()));

-- evidence. THE GRANT IS THE RULE: upload_timestamp appears in no insert or
-- update grant, so a client that names it is refused at the privilege check
-- before any policy or trigger runs.
revoke all on public.evidence from anon, authenticated;
grant all on public.evidence to service_role;
grant select on public.evidence to authenticated;
grant insert (id, task_id, team_id, storage_path, caption, uploaded_by_student_id) on public.evidence to authenticated;
grant update (caption) on public.evidence to authenticated;
grant delete on public.evidence to authenticated;

alter table public.evidence enable row level security;

drop policy if exists "mentors read every evidence row" on public.evidence;
create policy "mentors read every evidence row"
	on public.evidence
	for select
	to authenticated
	using ((select public.is_mentor()));

drop policy if exists "students read their own team evidence" on public.evidence;
create policy "students read their own team evidence"
	on public.evidence
	for select
	to authenticated
	using (team_id = (select public.current_student_team_id()));

drop policy if exists "mentors insert evidence" on public.evidence;
create policy "mentors insert evidence"
	on public.evidence
	for insert
	to authenticated
	with check ((select public.is_mentor()));

drop policy if exists "students attach their own evidence to their own team" on public.evidence;
create policy "students attach their own evidence to their own team"
	on public.evidence
	for insert
	to authenticated
	with check (
		team_id = (select public.current_student_team_id())
		and uploaded_by_student_id = (select public.current_student_id())
	);

drop policy if exists "mentors update evidence" on public.evidence;
create policy "mentors update evidence"
	on public.evidence
	for update
	to authenticated
	using ((select public.is_mentor()))
	with check ((select public.is_mentor()));

drop policy if exists "students caption their own evidence" on public.evidence;
create policy "students caption their own evidence"
	on public.evidence
	for update
	to authenticated
	using (uploaded_by_student_id = (select public.current_student_id()))
	with check (uploaded_by_student_id = (select public.current_student_id()));

drop policy if exists "mentors delete evidence" on public.evidence;
create policy "mentors delete evidence"
	on public.evidence
	for delete
	to authenticated
	using ((select public.is_mentor()));

drop policy if exists "students delete their own evidence" on public.evidence;
create policy "students delete their own evidence"
	on public.evidence
	for delete
	to authenticated
	using (uploaded_by_student_id = (select public.current_student_id()));

-- ---------------------------------------------------------------------------
-- 6. The evidence bucket and its object policies. Private bucket; objects are
--    keyed `{team_id}/{task_id}/{file}` and a student can only touch their
--    own team's folder. The bucket row is upserted so a re-apply keeps the
--    limits current.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
	'evidence', 'evidence', false, 15728640,
	array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'video/mp4', 'video/quicktime']
)
on conflict (id) do update
	set public = excluded.public,
		file_size_limit = excluded.file_size_limit,
		allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "evidence objects: mentors do everything" on storage.objects;
create policy "evidence objects: mentors do everything"
	on storage.objects
	for all
	to authenticated
	using (bucket_id = 'evidence' and (select public.is_mentor()))
	with check (bucket_id = 'evidence' and (select public.is_mentor()));

drop policy if exists "evidence objects: students read their team folder" on storage.objects;
create policy "evidence objects: students read their team folder"
	on storage.objects
	for select
	to authenticated
	using (
		bucket_id = 'evidence'
		and (storage.foldername(name))[1] = (select public.current_student_team_id())::text
	);

drop policy if exists "evidence objects: students upload into their team folder" on storage.objects;
create policy "evidence objects: students upload into their team folder"
	on storage.objects
	for insert
	to authenticated
	with check (
		bucket_id = 'evidence'
		and (storage.foldername(name))[1] = (select public.current_student_team_id())::text
	);

drop policy if exists "evidence objects: students delete their own uploads" on storage.objects;
create policy "evidence objects: students delete their own uploads"
	on storage.objects
	for delete
	to authenticated
	using (
		bucket_id = 'evidence'
		and owner_id = (select auth.uid())::text
		and (storage.foldername(name))[1] = (select public.current_student_team_id())::text
	);

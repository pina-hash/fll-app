-- 0014_parent_access.sql
--
-- THE PARENT VIEW: one revocable, per-student capability URL that shows a
-- parent their own child and nothing else, with no account, no password and
-- no way to write anything.
--
-- Applied by the Supabase CLI, after 0013.
--
-- PARENTS ARE NOT A FOURTH POPULATION. Every other identity in this schema is
-- a row in auth.users behind a trigger (0002/0010): mentors are Google
-- accounts on one domain, students and board devices are synthetic addresses
-- a definer RPC mints. A parent is a community member with no school account,
-- and giving thirty of them passwords would mean thirty more things to reset
-- on a Friday night. So a parent holds no identity at all: they hold a 256-bit
-- token in a URL, and `parent_view(token)` is a SECURITY DEFINER function that
-- resolves it to exactly one student's data. There is no parent session, no
-- parent role, and no write path anywhere in this file.
--
-- THE TOKEN IS STORED IN PLAINTEXT, AND THAT IS THE DIFFERENCE FROM A PIN. A
-- PIN is bcrypt from the moment it is set (0004) because a PIN authenticates a
-- PERSON who can always be told it again out loud. A parent link is a
-- CAPABILITY the mentor has to be able to reprint in March for a parent who
-- lost the card in October, and a hash would make "print the cards" mean
-- "invalidate every link on the team". So `token` is a column, readable by
-- mentors and by nobody else (RLS below; students have no read on this table
-- at all), and the mitigations are that it grants strictly read-only access to
-- one child's own record, that regenerating is one tap, and that revoking is
-- another. Do NOT copy this decision to anything that authenticates a person.
--
-- WHAT A PARENT SEES AND WHAT THEY DO NOT. Their own child's name, grade,
-- role and tier; the child's attendance history; the tasks the child
-- finished; the photos the child took; the team's name and its upcoming
-- meeting times. Of the other children on the team they see a first name and
-- a last initial, which is what a printed roster card already shows a room
-- full of parents. They see no other child's attendance, tasks, photos,
-- grade, role, login slug or PIN, no blockers, no mentor notes, and no other
-- team at all.
--
-- HOW ROLE RESOLUTION IS REUSED RATHER THAN REBUILT. "Who holds which role"
-- is team_resolve_roles() (0009/0010) and is not re-derived here. That
-- function gates itself on the CALLER (mentor, own team, own board), and a
-- parent is none of those, so this file widens the gate by exactly one
-- transaction-local flag -- `fll.parent_view` -- raised only inside
-- parent_view's own body. It is the same mechanism 0004 uses to let
-- student_create past the auth.users trigger, and it rests on the same fact:
-- a client speaking to PostgREST cannot set a GUC, because PostgREST sets
-- only its own (request.jwt.claims, request.headers, role) and JWT claims are
-- signed by GoTrue.
--
-- WHY THE PHOTOS NEED A SERVER ROUTE AND WHAT THE SERVICE ROLE IS ALLOWED TO
-- DECIDE. Evidence lives in a private storage bucket (0007) whose policies key
-- on the signed-in student's team. A parent has no session, so no storage
-- policy can ever admit them, and Postgres cannot sign a storage URL. So
-- src/routes/p/[token]/photo/[evidenceId] asks parent_photo_path() -- this
-- file, definer, anon-callable -- whether that token may see that evidence,
-- and only then uses the service role to mint a 60-second signed URL. The
-- DATABASE decides; the service role fetches bytes the database has already
-- authorised. It never chooses who may see what.
--
-- WHAT THIS FILE DOES NOT DO. It does not e-mail a link (there is no mail path
-- in this project and a printed card at pickup is the delivery mechanism the
-- season actually has). It does not expire a token on a timer -- a season-long
-- link that a mentor revokes is what was asked for, and a silent expiry is a
-- support call in February. It does not let a parent comment, acknowledge or
-- respond: there is no INSERT, UPDATE or DELETE grant anywhere on this path,
-- for any role.
--
-- ===========================================================================
-- TO UNDO
-- ===========================================================================
--
--   drop function if exists public.parent_photo_path(text, uuid);
--   drop function if exists public.parent_view(text);
--   drop function if exists public.parent_access_revoke(uuid);
--   drop function if exists public.parent_access_issue(uuid);
--   drop policy if exists "mentors read every parent link" on public.student_parent_access;
--   drop trigger if exists student_parent_access_set_updated_at on public.student_parent_access;
--   drop table if exists public.student_parent_access;
--   -- then re-create 0010's public.team_resolve_roles(uuid, uuid, date)
--   -- verbatim (its gate has no fll.parent_view clause).
--
-- Nothing later in the chain depends on this file.

-- ---------------------------------------------------------------------------
-- 1. The link. One row per student; regenerating rewrites the token in place,
--    which is what makes the old URL dead the moment a new one is printed.
--
--    The composite key is (student_id, team_id) -> students (id, team_id) like
--    every other row that names a student, with ON UPDATE CASCADE so a student
--    moved between teams (0013) takes their parent link with them: the link
--    belongs to the child, not to the team.
-- ---------------------------------------------------------------------------
create table if not exists public.student_parent_access (
	id uuid primary key default gen_random_uuid(),
	student_id uuid not null unique,
	team_id uuid not null,
	token text not null unique check (token ~ '^[0-9a-f]{64}$'),
	issued_at timestamptz not null default now(),
	issued_by_mentor_id uuid references public.mentors (id),
	revoked_at timestamptz,
	last_opened_at timestamptz,
	open_count integer not null default 0,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	foreign key (student_id, team_id) references public.students (id, team_id)
		on update cascade on delete cascade
);

comment on table public.student_parent_access is
	'One revocable parent link per student. `token` is 32 random bytes as hex and is stored in PLAINTEXT on purpose: it is a capability a mentor must be able to reprint, not a credential that authenticates a person. Mentors read it; nobody else can, and there is no client write grant.';

comment on column public.student_parent_access.token is
	'32 bytes from gen_random_bytes as 64 hex characters. The whole of /p/<token>.';
comment on column public.student_parent_access.revoked_at is
	'Set by parent_access_revoke. A revoked row keeps its token so a mentor can see the link existed; parent_view refuses it.';

create index if not exists student_parent_access_team_idx on public.student_parent_access (team_id);

drop trigger if exists student_parent_access_set_updated_at on public.student_parent_access;
create trigger student_parent_access_set_updated_at
	before update on public.student_parent_access
	for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Grants and RLS. Mentors read; students, board devices and anon hold
--    nothing. Every write is one of the two RPCs below, as the definer.
-- ---------------------------------------------------------------------------
revoke all on public.student_parent_access from anon, authenticated;
grant all on public.student_parent_access to service_role;
grant select on public.student_parent_access to authenticated;

alter table public.student_parent_access enable row level security;

drop policy if exists "mentors read every parent link" on public.student_parent_access;
create policy "mentors read every parent link"
	on public.student_parent_access
	for select
	to authenticated
	using ((select public.is_mentor()));

-- No INSERT, UPDATE or DELETE policy anywhere: with RLS on and no policy for
-- an operation, that operation is refused for every client, which is the
-- intent. parent_access_issue and parent_access_revoke are the only doors.

-- ---------------------------------------------------------------------------
-- 3. team_resolve_roles, with the parent gate. 0010's body verbatim except
--    for one added clause in the WHERE. Same signature; a plain replace.
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
		and (
			public.is_mentor()
			or p_team_id = public.current_student_team_id()
			or p_team_id = public.current_board_team_id()
			-- Raised only inside parent_view's own transaction. See the header.
			or coalesce(current_setting('fll.parent_view', true), '') = p_team_id::text
		)
	order by r.r_role;
$$;

revoke all on function public.team_resolve_roles(uuid, uuid, date) from public;
grant execute on function public.team_resolve_roles(uuid, uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Issuing and revoking. Both mentor-only; both name the student in their
--    own error messages rather than a table.
-- ---------------------------------------------------------------------------
create or replace function public.parent_access_issue(p_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_student public.students%rowtype;
	v_token text := encode(extensions.gen_random_bytes(32), 'hex');
	v_existed boolean;
begin
	if not public.is_mentor() then
		raise exception 'Only a mentor can make a parent link.';
	end if;

	select s.* into v_student from public.students s where s.id = p_student_id for update;
	if not found then
		raise exception 'That student does not exist.';
	end if;

	select true into v_existed
	from public.student_parent_access a
	where a.student_id = p_student_id;

	insert into public.student_parent_access (student_id, team_id, token, issued_by_mentor_id)
	values (p_student_id, v_student.team_id, v_token, public.current_mentor_id())
	on conflict (student_id) do update
		set token = excluded.token,
			team_id = excluded.team_id,
			issued_at = now(),
			issued_by_mentor_id = excluded.issued_by_mentor_id,
			revoked_at = null,
			last_opened_at = null,
			open_count = 0;

	return jsonb_build_object(
		'student_id', p_student_id,
		'first_name', v_student.first_name,
		'last_initial', v_student.last_initial,
		'token', v_token,
		'path', '/p/' || v_token,
		'replaced', coalesce(v_existed, false)
	);
end;
$$;

revoke all on function public.parent_access_issue(uuid) from public;
grant execute on function public.parent_access_issue(uuid) to authenticated;

create or replace function public.parent_access_revoke(p_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_name text;
begin
	if not public.is_mentor() then
		raise exception 'Only a mentor can turn off a parent link.';
	end if;

	update public.student_parent_access a
	set revoked_at = now()
	where a.student_id = p_student_id and a.revoked_at is null;
	if not found then
		raise exception 'That student has no parent link turned on.';
	end if;

	select s.first_name || ' ' || s.last_initial || '.' into v_name
	from public.students s where s.id = p_student_id;

	return jsonb_build_object('student_id', p_student_id, 'student', v_name, 'revoked', true);
end;
$$;

revoke all on function public.parent_access_revoke(uuid) from public;
grant execute on function public.parent_access_revoke(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. parent_view: the whole page, in one call, for one token.
--
--    NULL for a token that does not exist, is revoked, or belongs to a
--    deactivated student or an archived team. Null and not an error, because
--    an unknown token must answer exactly like a revoked one: probing reveals
--    nothing.
--
--    Callable by anon (the parent has no session) AND by authenticated,
--    because a mentor checking the link they just printed is signed in in
--    that same browser, and refusing them would look like a broken link.
-- ---------------------------------------------------------------------------
create or replace function public.parent_view(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_access public.student_parent_access%rowtype;
	v_student public.students%rowtype;
	v_team public.teams%rowtype;
	v_roles jsonb;
	v_out jsonb;
begin
	if coalesce(p_token, '') !~ '^[0-9a-f]{64}$' then
		return null;
	end if;

	select a.* into v_access
	from public.student_parent_access a
	where a.token = p_token and a.revoked_at is null;
	if not found then
		return null;
	end if;

	select s.* into v_student
	from public.students s
	where s.id = v_access.student_id and s.deactivated_at is null;
	if not found then
		return null;
	end if;

	select t.* into v_team
	from public.teams t
	where t.id = v_student.team_id and t.archived_at is null;
	if not found then
		return null;
	end if;

	-- Widen team_resolve_roles' gate for THIS transaction and this team only.
	perform set_config('fll.parent_view', v_team.id::text, true);

	select coalesce(
		jsonb_agg(jsonb_build_object('role', x.role, 'tier', x.tier) order by x.role),
		'[]'::jsonb
	) into v_roles
	from (
		select r.role::text as role,
			case when r.primary_student_id = v_student.id then 'primary' else 'second' end as tier
		from public.team_resolve_roles(v_team.id) r
		where r.primary_student_id = v_student.id or r.second_student_id = v_student.id
	) x;

	perform set_config('fll.parent_view', '', true);

	v_out := jsonb_build_object(
		'server_now', now(),
		'team', jsonb_build_object(
			'name', v_team.name,
			'accent', v_team.accent,
			'fll_team_number', v_team.fll_team_number
		),
		'student', jsonb_build_object(
			'first_name', v_student.first_name,
			'last_initial', v_student.last_initial,
			'grade', v_student.grade
		),
		'roles', v_roles,
		'upcoming_meetings', coalesce((
			select jsonb_agg(jsonb_build_object(
				'id', m.id,
				'kind', m.kind,
				'meeting_date', m.meeting_date,
				'planned_start_at', m.planned_start_at,
				'planned_end_at', m.planned_end_at,
				'started_at', m.started_at,
				'ended_at', m.ended_at
			) order by m.planned_start_at)
			from (
				select * from public.meetings mm
				where mm.meeting_date >= public._app_today()
				order by mm.planned_start_at
				limit 10
			) m
		), '[]'::jsonb),
		'attendance', coalesce((
			select jsonb_agg(jsonb_build_object(
				'meeting_id', x.meeting_id,
				'meeting_date', x.meeting_date,
				'kind', x.kind,
				'checked_in_at', x.checked_in_at
			) order by x.meeting_date desc)
			from (
				select a.meeting_id, m.meeting_date, m.kind, a.checked_in_at
				from public.attendance a
				join public.meetings m on m.id = a.meeting_id
				where a.student_id = v_student.id
				order by m.meeting_date desc
				limit 60
			) x
		), '[]'::jsonb),
		'tasks_done', coalesce((
			select jsonb_agg(jsonb_build_object(
				'id', x.id,
				'title', x.title,
				'closed_at', x.closed_at
			) order by x.closed_at desc)
			from (
				select tk.id, tk.title, tk.closed_at
				from public.tasks tk
				where tk.team_id = v_team.id
					and tk.assigned_student_id = v_student.id
					and tk.status = 'done'
				order by tk.closed_at desc nulls last
				limit 60
			) x
		), '[]'::jsonb),
		'photos', coalesce((
			select jsonb_agg(jsonb_build_object(
				'id', x.id,
				'caption', x.caption,
				'uploaded_at', x.upload_timestamp,
				'task_title', x.title
			) order by x.upload_timestamp desc)
			from (
				select e.id, e.caption, e.upload_timestamp, tk.title
				from public.evidence e
				join public.tasks tk on tk.id = e.task_id
				where e.uploaded_by_student_id = v_student.id
				order by e.upload_timestamp desc
				limit 60
			) x
		), '[]'::jsonb),
		-- The team roster, first name and last initial only. Nothing else
		-- about another child appears anywhere in this payload.
		'roster', coalesce((
			select jsonb_agg(jsonb_build_object(
				'first_name', s.first_name,
				'last_initial', s.last_initial,
				'is_mine', s.id = v_student.id
			) order by s.first_name, s.last_initial)
			from public.students s
			where s.team_id = v_team.id and s.deactivated_at is null
		), '[]'::jsonb)
	);

	update public.student_parent_access a
	set last_opened_at = now(), open_count = a.open_count + 1
	where a.id = v_access.id;

	return v_out;
end;
$$;

revoke all on function public.parent_view(text) from public;
grant execute on function public.parent_view(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. parent_photo_path: may THIS token see THIS photo, and if so where does
--    it live. Null for every other answer, including a photo that exists but
--    belongs to another child.
--
--    This is the whole of the authorisation for the photo route. The service
--    role that follows it signs a URL for the path this returns and does not
--    decide anything.
-- ---------------------------------------------------------------------------
create or replace function public.parent_photo_path(p_token text, p_evidence_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
	select e.storage_path
	from public.student_parent_access a
	join public.students s on s.id = a.student_id and s.deactivated_at is null
	join public.evidence e on e.uploaded_by_student_id = s.id
	where a.token = p_token
		and a.revoked_at is null
		and p_token ~ '^[0-9a-f]{64}$'
		and e.id = p_evidence_id;
$$;

revoke all on function public.parent_photo_path(text, uuid) from public;
grant execute on function public.parent_photo_path(text, uuid) to anon, authenticated;

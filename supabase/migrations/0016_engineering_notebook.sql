-- 0016_engineering_notebook.sql
--
-- THE ENGINEERING NOTEBOOK: the judged deliverable. Four sections mapped onto
-- what judges actually score (Robot Design, Innovation Project, Core Values,
-- the season summary), assembled largely from what the app already recorded
-- so a nine-year-old edits and adds reasoning instead of retyping the season.
--
-- Applied by the Supabase CLI, after 0015.
--
-- NOTHING IN HERE IS FIRST'S. The official FIRST Engineering Notebook is
-- copyrighted; this schema and every prompt in src/lib/content/notebook.ts is
-- written fresh in this repo's own words, and the app links to the official
-- PDF (already in the Library's season documents) rather than reproducing a
-- page of it. Same rule that kept mat artwork out of the route planner.
--
-- TWO TABLES, TWO KINDS OF RECORD.
--
--   notebook_entries  -- what a student WROTE: an answer to one short prompt,
--     a free note, or a Robot Design "try" (what we tried, what happened,
--     what we changed next). outcome ('worked'/'failed'/'mixed') exists so a
--     FAILED attempt is a first-class row a team is proud to keep, not a
--     thing children quietly delete: judges reward the iteration story, and
--     the iteration story is mostly failures.
--
--   meeting_recaps    -- what a session DID: one row per team per meeting,
--     whose `draft` is a frozen jsonb snapshot of what actually happened in
--     that meeting's window (who came, tasks closed, photos taken, blockers
--     raised and resolved, practice runs, strategy versions saved). The
--     Notebook Lead adds a summary in their own words and confirms it. Over
--     thirty sessions this compounds into the notebook instead of being
--     written in a panic in December.
--
-- WHY THE DRAFT IS FROZEN JSONB AND NOT A VIEW. The notebook is a RECORD. A
-- task hard-deleted in November must not erase what the October recap said
-- the team did; a live join would. The draft is regenerated (window widened,
-- late work picked up) only while the recap is unconfirmed; confirming it
-- ends regeneration, which is what "confirmed" means.
--
-- WHEN THE DRAFT IS GENERATED. meeting_advance_phase() generates every
-- team's draft when the meeting enters its LAST phase (the Close phase in
-- both templates -- the wrap-up slot is last by construction, whatever a
-- mentor renames it to), and meeting_end() regenerates unconfirmed drafts
-- over the final window, which also covers a meeting ended early. Both are
-- replaced here at the same signature; no PostgREST overload appears. The
-- migration also backfills drafts for every already-ended meeting, so the
-- season's first sessions are in the notebook from the moment this applies.
--
-- WHO EDITS. notebook_can_edit(team_id, section) is the ONE statement, built
-- exactly the way strategy_can_edit (0012) is and delegating "who holds the
-- role" to team_resolve_roles' covering rule rather than re-deriving it:
--
--   * any mentor edits every section of every team;
--   * the Notebook and Values Lead edits every section of their own team
--     (Core Values and the season summary are their role's own sections);
--   * the roles a section documents contribute to that section:
--     Robot Design takes the Lead Builder, Lead Programmer and Run Captain;
--     the Innovation Project takes the Innovation Lead.
--
-- Every teammate VIEWS everything; a board device sees none of it (the
-- notebook is the team's judged document, not the shared iPad's scoreboard),
-- and no other team can read a word of it. Recap edits gate on the
-- 'season_summary' section: the recap stream IS the season record, and that
-- is precisely the Notebook Lead's own surface.
--
-- WHY DIRECT TABLE WRITES. Same divergence as 0007/0012: the student write
-- queue replays idempotent inserts and updates against tables, with
-- client-minted ids in every insert grant. Confirmation is a client-writable
-- BOOLEAN (`confirmed`), replayable and idempotent; confirmed_at and the
-- confirmed_by columns carry no client grant and are stamped by trigger from
-- the server clock and the caller's identity, the same shape as
-- tasks.closed_at.
--
-- WHAT HAPPENS TO AN ENTRY WHEN ITS AUTHOR LEAVES THE TEAM. The same answer
-- 0015 gave for practice runs: the notebook belongs to the TEAM, so the entry
-- and the confirmation stay and only the attribution goes.
-- _student_detach_from_team() is replaced (0015's body verbatim plus two
-- statements) rather than taught anywhere else.
--
-- WHY THESE TABLES ARE NOT IN supabase_realtime. Like the planner (0012):
-- writing is local-first with one effective editor per section, and a
-- realtime refetch landing under a child mid-sentence would clobber the text
-- they are typing. Deliberate.
--
-- ===========================================================================
-- TO UNDO
-- ===========================================================================
--
--   drop function if exists public.notebook_season_stats(uuid);
--   -- then re-create 0015's public._student_detach_from_team(uuid) verbatim
--   -- (it knows nothing about the notebook),
--   -- re-create 0013's public.meeting_end(uuid) verbatim and 0009's
--   -- public.meeting_advance_phase(uuid) verbatim (they know nothing about
--   -- recaps).
--   drop function if exists public._meeting_recaps_generate(uuid);
--   drop function if exists public._meeting_recap_facts(uuid, uuid);
--   drop trigger if exists meeting_recaps_confirm_stamp on public.meeting_recaps;
--   drop function if exists public._meeting_recaps_confirm_stamp();
--   drop table if exists public.meeting_recaps;
--   drop table if exists public.notebook_entries;
--   alter table public.evidence drop constraint if exists evidence_id_team_unique;
--   drop function if exists public.notebook_can_edit(uuid, public.notebook_section);
--   drop type if exists public.notebook_outcome;
--   drop type if exists public.notebook_section;
--
-- Nothing later in the chain depends on this file.

-- ---------------------------------------------------------------------------
-- 1. Types.
-- ---------------------------------------------------------------------------
do $$
begin
	if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
	               where n.nspname = 'public' and t.typname = 'notebook_section') then
		create type public.notebook_section as enum (
			'robot_design',
			'innovation_project',
			'core_values',
			'season_summary'
		);
	end if;
	if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
	               where n.nspname = 'public' and t.typname = 'notebook_outcome') then
		create type public.notebook_outcome as enum ('worked', 'failed', 'mixed');
	end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. The edit rule, defined once. Built the way strategy_can_edit (0012) is:
--    SECURITY DEFINER so it may call the private meeting resolver, and
--    delegating active-role resolution to team_resolve_roles rather than
--    re-deriving the covering rule. team_resolve_roles itself answers zero
--    rows to a caller who may not see the team, so a rival student gets
--    `false` here without a separate gate.
-- ---------------------------------------------------------------------------
create or replace function public.notebook_can_edit(p_team_id uuid, p_section public.notebook_section)
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
			where (
					r.role = 'notebook_values_lead'
					or r.role = any (
						case p_section
							when 'robot_design'
								then array['lead_builder', 'lead_programmer', 'run_captain']::public.team_role[]
							when 'innovation_project'
								then array['innovation_lead']::public.team_role[]
							else array[]::public.team_role[]
						end
					)
				)
				and case
					when r.active_student_id is not null
						then r.active_student_id = public.current_student_id()
					else public.current_student_id() in (r.primary_student_id, r.second_student_id)
				end
		);
$$;

revoke all on function public.notebook_can_edit(uuid, public.notebook_section) from public;
grant execute on function public.notebook_can_edit(uuid, public.notebook_section) to authenticated;

comment on function public.notebook_can_edit(uuid, public.notebook_section) is
	'True when the caller may edit this section of this team''s notebook: any mentor; the Notebook and Values Lead (every section); the roles a section documents (Robot Design: builder, programmer, run captain; Innovation Project: innovation lead), all under team_resolve_roles'' covering rule. The single statement of the edit rule; every notebook policy calls it.';

-- ---------------------------------------------------------------------------
-- 3. evidence gains unique (id, team_id), so a notebook entry can cite a
--    photo through the same composite-key shape every student reference
--    uses: a cross-team citation is impossible by CONSTRAINT.
-- ---------------------------------------------------------------------------
do $$
begin
	if not exists (
		select 1 from pg_constraint c
		where c.conname = 'evidence_id_team_unique' and c.conrelid = 'public.evidence'::regclass
	) then
		alter table public.evidence add constraint evidence_id_team_unique unique (id, team_id);
	end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Notebook entries.
-- ---------------------------------------------------------------------------
create table if not exists public.notebook_entries (
	id uuid primary key default gen_random_uuid(),
	team_id uuid not null references public.teams (id),
	section public.notebook_section not null,
	-- Joins to the prompt list in src/lib/content/notebook.ts; '' is a free
	-- note. Editorial content stays in git; the student's words live here.
	prompt_key text not null default '' check (length(prompt_key) <= 60),
	title text not null default '' check (length(title) <= 200),
	body text not null default '' check (length(body) <= 8000),
	-- Robot Design "try" entries only: title = what we tried, body = what
	-- happened, change_note = what we changed next and why.
	outcome public.notebook_outcome,
	change_note text not null default '' check (length(change_note) <= 2000),
	evidence_id uuid,
	authored_by_student_id uuid,
	sort_order integer not null default 0,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (id, team_id),
	foreign key (authored_by_student_id, team_id) references public.students (id, team_id),
	foreign key (evidence_id, team_id) references public.evidence (id, team_id)
		on delete set null (evidence_id),
	constraint notebook_entries_outcome_is_robot_design_check
		check (outcome is null or section = 'robot_design')
);

comment on table public.notebook_entries is
	'One piece of a team''s engineering notebook: an answer to a prompt, a free note, or a Robot Design try (outcome worked/failed/mixed -- failed is a first-class value, because judges reward the iteration story). Written by the section''s role holders and the Notebook Lead; read by the whole team and mentors.';

create index if not exists notebook_entries_team_section_idx
	on public.notebook_entries (team_id, section, sort_order);

drop trigger if exists notebook_entries_set_updated_at on public.notebook_entries;
create trigger notebook_entries_set_updated_at
	before update on public.notebook_entries
	for each row execute function public.set_updated_at();

drop trigger if exists notebook_entries_immutable on public.notebook_entries;
create trigger notebook_entries_immutable
	before update on public.notebook_entries
	for each row execute function public._immutable_columns('team_id', 'section', 'authored_by_student_id', 'created_at');

-- ---------------------------------------------------------------------------
-- 5. Meeting recaps.
-- ---------------------------------------------------------------------------
create table if not exists public.meeting_recaps (
	id uuid primary key default gen_random_uuid(),
	meeting_id uuid not null references public.meetings (id) on delete cascade,
	team_id uuid not null references public.teams (id),
	-- The frozen snapshot of what the session did; see the header. Written
	-- only by the definer generator: no client grant on the column.
	draft jsonb not null default '{}'::jsonb,
	-- The Notebook Lead's own words. The one writing field on purpose: one
	-- short prompt, not a form.
	summary text not null default '' check (length(summary) <= 4000),
	confirmed boolean not null default false,
	confirmed_at timestamptz,
	confirmed_by_student_id uuid,
	confirmed_by_mentor_id uuid references public.mentors (id),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (meeting_id, team_id),
	unique (id, team_id),
	foreign key (confirmed_by_student_id, team_id) references public.students (id, team_id),
	constraint meeting_recaps_confirmed_iff_stamped_check
		check (confirmed = (confirmed_at is not null))
);

comment on table public.meeting_recaps is
	'One team''s recap of one meeting. draft is a frozen jsonb snapshot of what happened in the meeting window, generated at the Close phase and regenerated at meeting end while unconfirmed; summary and confirmed are the Notebook Lead''s. An unconfirmed recap is shown as unfinished, never dropped.';

create index if not exists meeting_recaps_team_idx on public.meeting_recaps (team_id);

drop trigger if exists meeting_recaps_set_updated_at on public.meeting_recaps;
create trigger meeting_recaps_set_updated_at
	before update on public.meeting_recaps
	for each row execute function public.set_updated_at();

drop trigger if exists meeting_recaps_immutable on public.meeting_recaps;
create trigger meeting_recaps_immutable
	before update on public.meeting_recaps
	for each row execute function public._immutable_columns('meeting_id', 'team_id', 'created_at');

-- confirmed_at and the confirmed_by columns follow `confirmed`, on the server
-- clock and the caller's identity: same shape as tasks.closed_at (0007). The
-- columns carry no client grant, so the trigger is their only writer.
create or replace function public._meeting_recaps_confirm_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	if new.confirmed and not old.confirmed then
		new.confirmed_at := now();
		new.confirmed_by_student_id := public.current_student_id();
		new.confirmed_by_mentor_id := public.current_mentor_id();
	elsif not new.confirmed then
		new.confirmed_at := null;
		new.confirmed_by_student_id := null;
		new.confirmed_by_mentor_id := null;
	else
		-- Still confirmed: the original stamp stands.
		new.confirmed_at := old.confirmed_at;
		new.confirmed_by_student_id := old.confirmed_by_student_id;
		new.confirmed_by_mentor_id := old.confirmed_by_mentor_id;
	end if;
	return new;
end;
$$;
revoke all on function public._meeting_recaps_confirm_stamp() from public;

drop trigger if exists meeting_recaps_confirm_stamp on public.meeting_recaps;
create trigger meeting_recaps_confirm_stamp
	before update on public.meeting_recaps
	for each row execute function public._meeting_recaps_confirm_stamp();

-- ---------------------------------------------------------------------------
-- 6. The facts of one team's session, computed from the meeting's own window
--    (started_at to ended_at-or-now: the same "today" rule the live board
--    uses). Private: only the generator calls it.
-- ---------------------------------------------------------------------------
create or replace function public._meeting_recap_facts(p_meeting_id uuid, p_team_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
	v_m public.meetings%rowtype;
	v_from timestamptz;
	v_to timestamptz;
begin
	select m.* into v_m from public.meetings m where m.id = p_meeting_id;
	if v_m.id is null or v_m.started_at is null then
		return '{}'::jsonb;
	end if;
	v_from := v_m.started_at;
	v_to := coalesce(v_m.ended_at, now());

	return jsonb_build_object(
		'generated_at', now(),
		'window_from', v_from,
		'window_to', v_to,
		'present', (
			select coalesce(jsonb_agg(s.first_name || ' ' || s.last_initial || '.' order by s.first_name, s.last_initial), '[]'::jsonb)
			from public.attendance a
			join public.students s on s.id = a.student_id
			where a.meeting_id = p_meeting_id and s.team_id = p_team_id and s.deactivated_at is null
		),
		'roster_size', (
			select count(*)::int from public.students s
			where s.team_id = p_team_id and s.deactivated_at is null
		),
		'tasks_closed', (
			select coalesce(jsonb_agg(jsonb_build_object('title', tk.title, 'role', tk.role) order by tk.closed_at), '[]'::jsonb)
			from public.tasks tk
			where tk.team_id = p_team_id and tk.closed_at >= v_from and tk.closed_at <= v_to
		),
		'tasks_opened', (
			select count(*)::int from public.tasks tk
			where tk.team_id = p_team_id and tk.created_at >= v_from and tk.created_at <= v_to
		),
		'photos', (
			select coalesce(jsonb_agg(jsonb_build_object(
				'caption', e.caption,
				'storage_path', e.storage_path,
				'task_title', tk.title
			) order by e.upload_timestamp), '[]'::jsonb)
			from public.evidence e
			join public.tasks tk on tk.id = e.task_id
			where e.team_id = p_team_id and e.upload_timestamp >= v_from and e.upload_timestamp <= v_to
		),
		'blockers_raised', (
			select coalesce(jsonb_agg(jsonb_build_object('note', b.note, 'resolved', b.resolved_at is not null) order by b.raised_at), '[]'::jsonb)
			from public.blockers b
			where b.team_id = p_team_id and b.raised_at >= v_from and b.raised_at <= v_to
		),
		'blockers_resolved', (
			select coalesce(jsonb_agg(jsonb_build_object('note', b.note) order by b.resolved_at), '[]'::jsonb)
			from public.blockers b
			where b.team_id = p_team_id and b.resolved_at >= v_from and b.resolved_at <= v_to
		),
		'runs', jsonb_build_object(
			'count', (
				select count(*)::int from public.match_runs r
				where r.team_id = p_team_id and r.started_at >= v_from and r.started_at <= v_to
			),
			'best_points', coalesce((
				select max(r.points) from public.match_runs r
				where r.team_id = p_team_id and r.started_at >= v_from and r.started_at <= v_to
			), 0)
		),
		'strategy_versions', (
			select coalesce(jsonb_agg(jsonb_build_object('version', s.version, 'label', s.label) order by s.version), '[]'::jsonb)
			from public.strategies s
			where s.team_id = p_team_id and s.created_at >= v_from and s.created_at <= v_to
		)
	);
end;
$$;
revoke all on function public._meeting_recap_facts(uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- 7. The generator: one draft per active team, upserted on (meeting_id,
--    team_id). A confirmed recap is never touched again; that is what
--    confirming means. Returns how many rows it wrote.
-- ---------------------------------------------------------------------------
create or replace function public._meeting_recaps_generate(p_meeting_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
	v_started timestamptz;
	v_rows integer;
begin
	select m.started_at into v_started from public.meetings m where m.id = p_meeting_id;
	if v_started is null then
		return 0;
	end if;

	insert into public.meeting_recaps (meeting_id, team_id, draft)
	select p_meeting_id, t.id, public._meeting_recap_facts(p_meeting_id, t.id)
	from public.teams t
	where t.archived_at is null
	on conflict (meeting_id, team_id) do update
		set draft = excluded.draft
		where meeting_recaps.confirmed = false;
	get diagnostics v_rows = row_count;
	return v_rows;
end;
$$;
revoke all on function public._meeting_recaps_generate(uuid) from public;

-- ---------------------------------------------------------------------------
-- 8. meeting_advance_phase learns to generate the drafts when the meeting
--    enters its LAST phase (the Close slot in both templates). 0009's body
--    verbatim plus the last-phase check and one PERFORM. Same signature; a
--    plain replace, no PostgREST overload.
-- ---------------------------------------------------------------------------
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
	v_recaps integer := 0;
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

	-- Entering the last phase is the Close: the session's record is drafted
	-- for every team, so the Notebook Leads can read it back while everyone
	-- is still in the room.
	if not exists (
		select 1 from public.meeting_phases mp
		where mp.meeting_id = p_meeting_id and mp.ordinal > v_next.ordinal
	) then
		v_recaps := public._meeting_recaps_generate(p_meeting_id);
	end if;

	return jsonb_build_object(
		'meeting_id', p_meeting_id,
		'at', v_now,
		'from_phase_id', v_cur.id,
		'from_phase_name', v_cur.name,
		'phase_id', v_next.id,
		'phase_name', v_next.name,
		'phase_ordinal', v_next.ordinal,
		'recaps_drafted', v_recaps
	);
end;
$$;

revoke all on function public.meeting_advance_phase(uuid) from public;
grant execute on function public.meeting_advance_phase(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. meeting_end regenerates unconfirmed drafts over the final window, which
--    also covers a meeting ended without ever reaching the Close phase.
--    0013's body verbatim plus one PERFORM. Same signature; a plain replace.
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
	v_recaps integer := 0;
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

	v_recaps := public._meeting_recaps_generate(p_meeting_id);

	return jsonb_build_object(
		'meeting_id', p_meeting_id,
		'ended_at', v_now,
		'phases_closed', v_closed,
		'join_windows_closed', v_windows,
		'recaps_drafted', v_recaps
	);
end;
$$;

revoke all on function public.meeting_end(uuid) from public;
grant execute on function public.meeting_end(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. _student_detach_from_team, taught about the notebook: 0015's body
--     verbatim plus two statements. The entry and the confirmation belong to
--     the TEAM's notebook, so they stay and only the attribution goes --
--     the same answer 0015 gave for practice runs, and for the same reason
--     it is not a foreign-key action (ON UPDATE SET NULL takes no column
--     list and would try to null team_id).
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

	update public.notebook_entries e
	set authored_by_student_id = null
	where e.authored_by_student_id = p_student_id;

	update public.meeting_recaps r
	set confirmed_by_student_id = null
	where r.confirmed_by_student_id = p_student_id;

	return jsonb_build_object('roles_cleared', v_roles, 'tasks_unassigned', v_tasks);
end;
$$;
revoke all on function public._student_detach_from_team(uuid) from public;

-- ---------------------------------------------------------------------------
-- 11. notebook_season_stats: the season's numbers for the summary page and
--     the print view, defined once instead of three screens counting rows.
--     Null -- not an error -- for a caller who may not see this team
--     (coalesce, not a bare NOT: the 0015 lesson).
-- ---------------------------------------------------------------------------
create or replace function public.notebook_season_stats(p_team_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if p_team_id is null then
		return null;
	end if;
	if not coalesce(
		public.is_mentor() or p_team_id = public.current_student_team_id(),
		false
	) then
		return null;
	end if;

	return jsonb_build_object(
		'server_now', now(),
		'team_id', p_team_id,
		'meetings_held', (
			select count(*)::int from public.meetings m where m.started_at is not null
		),
		'recaps_total', (
			select count(*)::int from public.meeting_recaps r where r.team_id = p_team_id
		),
		'recaps_confirmed', (
			select count(*)::int from public.meeting_recaps r where r.team_id = p_team_id and r.confirmed
		),
		'tasks_closed', (
			select count(*)::int from public.tasks tk where tk.team_id = p_team_id and tk.status = 'done'
		),
		'tasks_closed_by_role', (
			select coalesce(jsonb_object_agg(x.role, x.n), '{}'::jsonb)
			from (
				select tk.role::text as role, count(*)::int as n
				from public.tasks tk
				where tk.team_id = p_team_id and tk.status = 'done' and tk.role is not null
				group by tk.role
			) x
		),
		'blockers_raised', (
			select count(*)::int from public.blockers b where b.team_id = p_team_id
		),
		'blockers_resolved', (
			select count(*)::int from public.blockers b where b.team_id = p_team_id and b.resolved_at is not null
		),
		'photos', (
			select count(*)::int from public.evidence e where e.team_id = p_team_id
		),
		'runs', (
			select count(*)::int from public.match_runs r where r.team_id = p_team_id
		),
		'best_points', coalesce((
			select max(r.points) from public.match_runs r where r.team_id = p_team_id
		), 0),
		'strategy_versions', (
			select count(*)::int from public.strategies s where s.team_id = p_team_id
		)
	);
end;
$$;

revoke all on function public.notebook_season_stats(uuid) from public;
grant execute on function public.notebook_season_stats(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. Grants. Client-minted ids in the insert grant (the write queue's
--     idempotency); created_at/updated_at in none; meeting_recaps.draft and
--     the confirmation stamps in none (the generator and the trigger are
--     their only writers). No client INSERT or DELETE on meeting_recaps at
--     all: a recap exists because a session happened.
-- ---------------------------------------------------------------------------
revoke all on public.notebook_entries from anon, authenticated;
grant all on public.notebook_entries to service_role;
grant select on public.notebook_entries to authenticated;
grant insert (id, team_id, section, prompt_key, title, body, outcome, change_note, evidence_id, authored_by_student_id, sort_order)
	on public.notebook_entries to authenticated;
grant update (prompt_key, title, body, outcome, change_note, evidence_id, sort_order)
	on public.notebook_entries to authenticated;
grant delete on public.notebook_entries to authenticated;

revoke all on public.meeting_recaps from anon, authenticated;
grant all on public.meeting_recaps to service_role;
grant select on public.meeting_recaps to authenticated;
grant update (summary, confirmed) on public.meeting_recaps to authenticated;

-- ---------------------------------------------------------------------------
-- 13. RLS. Reads: mentors and the row's own team -- no board devices (see
--     the header). Writes: notebook_can_edit, with the recap stream gated on
--     the season_summary section.
-- ---------------------------------------------------------------------------
alter table public.notebook_entries enable row level security;
alter table public.meeting_recaps enable row level security;

drop policy if exists "mentors and the team read the notebook" on public.notebook_entries;
create policy "mentors and the team read the notebook"
	on public.notebook_entries
	for select
	to authenticated
	using ((select public.is_mentor()) or team_id = (select public.current_student_team_id()));

drop policy if exists "section editors write notebook entries as themselves" on public.notebook_entries;
create policy "section editors write notebook entries as themselves"
	on public.notebook_entries
	for insert
	to authenticated
	with check (
		public.notebook_can_edit(team_id, section)
		and (
			authored_by_student_id = (select public.current_student_id())
			or ((select public.is_mentor()) and authored_by_student_id is null)
		)
	);

drop policy if exists "section editors update notebook entries" on public.notebook_entries;
create policy "section editors update notebook entries"
	on public.notebook_entries
	for update
	to authenticated
	using (public.notebook_can_edit(team_id, section))
	with check (public.notebook_can_edit(team_id, section));

drop policy if exists "section editors delete notebook entries" on public.notebook_entries;
create policy "section editors delete notebook entries"
	on public.notebook_entries
	for delete
	to authenticated
	using (public.notebook_can_edit(team_id, section));

drop policy if exists "mentors and the team read recaps" on public.meeting_recaps;
create policy "mentors and the team read recaps"
	on public.meeting_recaps
	for select
	to authenticated
	using ((select public.is_mentor()) or team_id = (select public.current_student_team_id()));

drop policy if exists "the notebook lead edits and confirms recaps" on public.meeting_recaps;
create policy "the notebook lead edits and confirms recaps"
	on public.meeting_recaps
	for update
	to authenticated
	using (public.notebook_can_edit(team_id, 'season_summary'))
	with check (public.notebook_can_edit(team_id, 'season_summary'));

-- ---------------------------------------------------------------------------
-- 14. Backfill: draft a recap for every meeting that already ran, so the
--     season's first sessions are in the notebook the moment this applies.
--     The facts derive from timestamped rows, so a draft computed today says
--     what that Friday actually did.
-- ---------------------------------------------------------------------------
do $$
declare
	v_m record;
	v_meetings int := 0;
	v_rows int := 0;
begin
	for v_m in
		select m.id from public.meetings m
		where m.started_at is not null and m.ended_at is not null
		order by m.started_at
	loop
		v_rows := v_rows + public._meeting_recaps_generate(v_m.id);
		v_meetings := v_meetings + 1;
	end loop;
	raise notice '0016: backfilled recap drafts for % ended meeting(s), % team recap row(s).', v_meetings, v_rows;
end
$$;

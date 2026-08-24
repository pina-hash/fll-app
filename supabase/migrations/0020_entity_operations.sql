-- 0020_entity_operations.sql
--
-- EVERY NOUN IN THIS APP CAN NOW BE UNDONE, AND THE ONES THAT CARRY HISTORY
-- ARE NEVER DESTROYED TO DO IT. The season was built feature by feature, so
-- some rows could be made and never unmade: a mentor could not cancel a
-- meeting, restore an archived team, take back a deleted notebook paragraph,
-- reorder a phase, or regenerate a recap. This file adds the missing halves.
--
-- Applied by the Supabase CLI, after 0019.
--
-- SOFT WHERE HISTORY HANGS OFF IT, HARD WHERE THE ROW IS THE AFFORDANCE.
-- The rule is not a preference, it is a question about what else points at
-- the row:
--
--   meetings        SOFT (cancelled_at). Measured on a seeded Friday: one
--                   `delete from meetings` took 18 attendance rows and 4
--                   phases with it and detached 20 tasks, because attendance,
--                   meeting_phases and meeting_recaps all CASCADE from it
--                   (0006, 0016). Attendance is the register of who was in
--                   the room. A mentor cancelling a session that never
--                   happened must not be able to erase one that did, so
--                   there is STILL no delete: cancel hides it and restore
--                   brings it back.
--   notebook_entries SOFT (deleted_at). It is a child's own paragraph, the
--                   guard was one confirm tap, and there was no way back.
--   teams           SOFT already (archived_at, 0003) -- this file gives it
--                   the two RPCs that were missing and makes archive REFUSE
--                   rather than strand a roster.
--   phases, tasks, blockers, evidence, role assignments, attendance marks,
--   the planner tree, match runs, mat images
--                   HARD, unchanged. Nothing references them that a delete
--                   would falsify, and for several of them the delete IS the
--                   product affordance ("check them out", "clear the route").
--                   What they were missing is a confirmation that names the
--                   cascade and, where it is cheap, an undo.
--
-- A DELETE THAT LEAVES A FILE BEHIND IS NOT A DELETE, AND SQL IS THE WRONG
-- PLACE TO FIX IT. evidence and mat_images each name an object in a private
-- storage bucket. The trigger that would drop the object with the row was
-- written and thrown away: this image forbids deleting from storage.objects,
-- and the row is only metadata anyway, so the trigger would have hidden the
-- orphan rather than removed it. Section 6 sets out the whole argument and
-- names what is still not solved.
--
-- REORDERING A PHASE IS AN RPC BECAUSE (meeting_id, ordinal) IS UNIQUE.
-- Swapping two ordinals with two UPDATEs violates the constraint halfway
-- through, and the constraint is not deferrable. meeting_phase_reorder parks
-- the other row one past this meeting's highest ordinal, moves the phase into
-- the vacated ordinal, then lands the parked row. The park is COMPUTED and not
-- a constant because it has to clear three fences at once: free, >= 1 (the
-- check constraint), and inside a SMALLINT, which is what the column is. A
-- fixed park of ordinal + 1000000 clears the first two and overflows the third
-- with 22003, which is what tests/entity-operations.test.ts caught. Three
-- statements inside one function, so no client can get it half right.
--
-- THE CURRENT MEETING IS STILL RESOLVED IN EXACTLY ONE PLACE.
-- _resolve_current_meeting_id() (0010) is what meeting_current(),
-- board_live_summary(), strategy_can_edit() and notebook_can_edit() all ask,
-- so teaching THAT function to ignore a cancelled meeting is what keeps a
-- cancelled session from showing up on a student's phone, a board device, the
-- live board and the notebook's edit gate at once. Four screens, one line.
--
-- ===========================================================================
-- TO UNDO
-- ===========================================================================
--
--   drop function if exists public.meeting_recap_regenerate(uuid);
--   drop function if exists public.meeting_phase_reorder(uuid, integer);
--   drop function if exists public.meeting_reopen(uuid);
--   drop function if exists public.meeting_restore(uuid);
--   drop function if exists public.meeting_cancel(uuid);
--   drop function if exists public.team_restore(uuid);
--   drop function if exists public.team_archive(uuid);
--   drop function if exists public.notebook_entry_restore(uuid);
--   drop function if exists public.notebook_entry_delete(uuid);
--
--   -- Re-run 0010's _resolve_current_meeting_id() definition verbatim.
--
--   alter table public.notebook_entries drop column if exists deleted_at;
--   alter table public.meetings drop column if exists cancelled_at;
--   alter table public.meetings drop column if exists cancelled_by_mentor_id;
--   -- Re-run 0016's "mentors and the team read the notebook" policy verbatim.
--
-- Nothing outside this file depends on the columns it adds.

-- ---------------------------------------------------------------------------
-- 1. Meetings: cancel, restore, reopen.
-- ---------------------------------------------------------------------------
alter table public.meetings
	add column if not exists cancelled_at timestamptz,
	add column if not exists cancelled_by_mentor_id uuid references public.mentors (id);

-- Server-owned, like every other stamp in this schema: the RPCs below write
-- them and no client INSERT/UPDATE grant names them.
revoke insert (cancelled_at, cancelled_by_mentor_id) on public.meetings from authenticated;
revoke update (cancelled_at, cancelled_by_mentor_id) on public.meetings from authenticated;

-- A cancelled meeting is not the current meeting, on any of the four surfaces
-- that ask. See the header.
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
		where m.started_at is not null and m.ended_at is null and m.cancelled_at is null
		union all
		select m.id, 2 as tier, m.planned_start_at as ord
		from public.meetings m
		where m.meeting_date = public._app_today() and m.cancelled_at is null
	) x
	order by x.tier, x.ord desc
	limit 1;
$$;
revoke all on function public._resolve_current_meeting_id() from public;

create or replace function public.meeting_cancel(p_meeting_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_meeting public.meetings%rowtype;
	v_attendance integer;
	v_tasks integer;
	v_recaps integer;
begin
	if not coalesce(public.is_mentor(), false) then
		raise exception 'Only a mentor can cancel a session.';
	end if;

	select m.* into v_meeting from public.meetings m where m.id = p_meeting_id for update;
	if not found then
		raise exception 'That session is not here any more.';
	end if;
	if v_meeting.cancelled_at is not null then
		raise exception 'That session was already cancelled.';
	end if;

	select count(*) into v_attendance from public.attendance a where a.meeting_id = p_meeting_id;
	select count(*) into v_tasks from public.tasks t where t.meeting_id = p_meeting_id;
	select count(*) into v_recaps from public.meeting_recaps r where r.meeting_id = p_meeting_id;

	update public.meetings
	set cancelled_at = now(),
		cancelled_by_mentor_id = public.current_mentor_id(),
		current_phase_id = null
	where id = p_meeting_id;

	-- NOTHING IS DELETED. The counts are returned so the console can say what
	-- the session is taking off the screen with it, and so a mentor can see
	-- at a glance that a session with 18 people marked present is probably
	-- not the one they meant to cancel.
	raise notice 'cancelled meeting % (attendance %, tasks %, recaps %)', p_meeting_id, v_attendance, v_tasks, v_recaps;

	return jsonb_build_object(
		'meeting_id', p_meeting_id,
		'cancelled_at', now(),
		'attendance_kept', v_attendance,
		'tasks_kept', v_tasks,
		'recaps_kept', v_recaps
	);
end;
$$;
revoke all on function public.meeting_cancel(uuid) from public;
grant execute on function public.meeting_cancel(uuid) to authenticated;

create or replace function public.meeting_restore(p_meeting_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_meeting public.meetings%rowtype;
begin
	if not coalesce(public.is_mentor(), false) then
		raise exception 'Only a mentor can bring a session back.';
	end if;

	select m.* into v_meeting from public.meetings m where m.id = p_meeting_id for update;
	if not found then
		raise exception 'That session is not here any more.';
	end if;
	if v_meeting.cancelled_at is null then
		raise exception 'That session is not cancelled.';
	end if;

	update public.meetings
	set cancelled_at = null, cancelled_by_mentor_id = null
	where id = p_meeting_id;

	return jsonb_build_object('meeting_id', p_meeting_id, 'restored', true);
end;
$$;
revoke all on function public.meeting_restore(uuid) from public;
grant execute on function public.meeting_restore(uuid) to authenticated;

-- ENDING A MEETING BY ACCIDENT IS THE MISTAKE THIS UNDOES. meeting_end closes
-- every running phase and drafts the recaps; reopening clears the end stamp
-- and puts the last phase back in charge, and it deliberately leaves the
-- drafted recaps alone -- they are a draft, and regenerating them is its own
-- verb below.
create or replace function public.meeting_reopen(p_meeting_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_meeting public.meetings%rowtype;
	v_phase public.meeting_phases%rowtype;
begin
	if not coalesce(public.is_mentor(), false) then
		raise exception 'Only a mentor can reopen a session.';
	end if;

	select m.* into v_meeting from public.meetings m where m.id = p_meeting_id for update;
	if not found then
		raise exception 'That session is not here any more.';
	end if;
	if v_meeting.ended_at is null then
		raise exception 'That session has not ended.';
	end if;
	if exists (
		select 1 from public.meetings m
		where m.started_at is not null and m.ended_at is null and m.cancelled_at is null
	) then
		raise exception 'Another session is running. End that one first.';
	end if;

	-- The phase that was running when the meeting ended: the last one closed.
	select mp.* into v_phase
	from public.meeting_phases mp
	where mp.meeting_id = p_meeting_id and mp.started_at is not null
	order by mp.ordinal desc
	limit 1;

	if v_phase.id is not null then
		update public.meeting_phases set ended_at = null where id = v_phase.id;
	end if;

	update public.meetings
	set ended_at = null, current_phase_id = v_phase.id
	where id = p_meeting_id;

	return jsonb_build_object(
		'meeting_id', p_meeting_id,
		'reopened', true,
		'current_phase_id', v_phase.id,
		'current_phase_name', v_phase.name
	);
end;
$$;
revoke all on function public.meeting_reopen(uuid) from public;
grant execute on function public.meeting_reopen(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Phases: move one up or down without tripping (meeting_id, ordinal).
-- ---------------------------------------------------------------------------
create or replace function public.meeting_phase_reorder(p_phase_id uuid, p_direction integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_phase public.meeting_phases%rowtype;
	v_other public.meeting_phases%rowtype;
	v_meeting public.meetings%rowtype;
	v_park smallint;
begin
	if not coalesce(public.is_mentor(), false) then
		raise exception 'Only a mentor can reorder the phases.';
	end if;
	if p_direction not in (-1, 1) then
		raise exception 'A phase moves up or down by one.';
	end if;

	select mp.* into v_phase from public.meeting_phases mp where mp.id = p_phase_id for update;
	if not found then
		raise exception 'That phase is not here any more.';
	end if;

	select m.* into v_meeting from public.meetings m where m.id = v_phase.meeting_id for update;
	if v_meeting.ended_at is not null then
		raise exception 'That session has ended. Reopen it first.';
	end if;
	if v_phase.started_at is not null then
		raise exception 'That phase has already run. Only a phase that has not started can move.';
	end if;

	select mp.* into v_other
	from public.meeting_phases mp
	where mp.meeting_id = v_phase.meeting_id
		and mp.ordinal = v_phase.ordinal + p_direction
	for update;
	if not found then
		raise exception 'That phase is already %.', case when p_direction = -1 then 'first' else 'last' end;
	end if;
	if v_other.started_at is not null then
		raise exception 'The phase above it has already run.';
	end if;

	-- PARK, MOVE, LAND. (meeting_id, ordinal) is unique and the constraint is
	-- not deferrable, so a straight swap collides on its first statement.
	-- The park value has to clear THREE fences at once, which is why it is
	-- computed rather than a constant: it must be free (so, past the highest
	-- ordinal this meeting uses), it must be >= 1 (the check constraint), and
	-- it must fit in a SMALLINT, which is what `ordinal` is. A fixed park of
	-- ordinal + 1000000 satisfies the first two and overflows the third with
	-- 22003, which is exactly what tests/entity-operations.test.ts caught.
	select coalesce(max(mp.ordinal), 0) + 1 into v_park
	from public.meeting_phases mp where mp.meeting_id = v_phase.meeting_id;

	update public.meeting_phases set ordinal = v_park where id = v_other.id;
	update public.meeting_phases set ordinal = v_other.ordinal where id = v_phase.id;
	update public.meeting_phases set ordinal = v_phase.ordinal where id = v_other.id;

	return jsonb_build_object(
		'phase_id', v_phase.id,
		'ordinal', v_other.ordinal,
		'swapped_with', v_other.id
	);
end;
$$;
revoke all on function public.meeting_phase_reorder(uuid, integer) from public;
grant execute on function public.meeting_phase_reorder(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Teams: archive and restore, with the refusal that keeps a roster whole.
-- ---------------------------------------------------------------------------
create or replace function public.team_archive(p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_team public.teams%rowtype;
	v_students integer;
	v_claims integer;
begin
	if not coalesce(public.is_mentor(), false) then
		raise exception 'Only a mentor can archive a team.';
	end if;

	select t.* into v_team from public.teams t where t.id = p_team_id for update;
	if not found then
		raise exception 'That team is not here any more.';
	end if;
	if v_team.archived_at is not null then
		raise exception 'That team is already archived.';
	end if;

	select count(*) into v_students
	from public.students s where s.team_id = p_team_id and s.deactivated_at is null;
	if v_students > 0 then
		-- A MIGRATION REFUSES RATHER THAN DESTROYS, and so does this: an
		-- archived team whose children are still signed in would leave them
		-- on a team no screen lists.
		raise exception 'There are still % students on %. Move them or take them off the team first.', v_students, v_team.name;
	end if;

	select count(*) into v_claims
	from public.student_claim_codes c
	where c.team_id = p_team_id and c.claimed_at is null and c.voided_at is null;
	if v_claims > 0 then
		raise exception '% claim codes for % have not been used yet. Void them first.', v_claims, v_team.name;
	end if;

	update public.teams set archived_at = now() where id = p_team_id;

	return jsonb_build_object('team_id', p_team_id, 'name', v_team.name, 'archived_at', now());
end;
$$;
revoke all on function public.team_archive(uuid) from public;
grant execute on function public.team_archive(uuid) to authenticated;

create or replace function public.team_restore(p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_team public.teams%rowtype;
begin
	if not coalesce(public.is_mentor(), false) then
		raise exception 'Only a mentor can bring a team back.';
	end if;

	select t.* into v_team from public.teams t where t.id = p_team_id for update;
	if not found then
		raise exception 'That team is not here any more.';
	end if;
	if v_team.archived_at is null then
		raise exception 'That team is not archived.';
	end if;

	-- The colour is unique across LIVE teams only (0018), so a team coming
	-- back can collide with one that took its colour while it was away.
	if v_team.accent is not null and exists (
		select 1 from public.teams t
		where t.archived_at is null and t.accent = v_team.accent and t.id <> p_team_id
	) then
		update public.teams set archived_at = null, accent = null where id = p_team_id;
		return jsonb_build_object('team_id', p_team_id, 'name', v_team.name, 'restored', true, 'accent_cleared', true);
	end if;

	update public.teams set archived_at = null where id = p_team_id;
	return jsonb_build_object('team_id', p_team_id, 'name', v_team.name, 'restored', true, 'accent_cleared', false);
end;
$$;
revoke all on function public.team_restore(uuid) from public;
grant execute on function public.team_restore(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Notebook entries: a delete a child can take back.
-- ---------------------------------------------------------------------------
alter table public.notebook_entries
	add column if not exists deleted_at timestamptz;

revoke insert (deleted_at) on public.notebook_entries from authenticated;
revoke update (deleted_at) on public.notebook_entries from authenticated;

-- The read filter is stated WHERE THE READ IS, the way every other soft
-- delete in this schema states it: a deleted paragraph is gone from the
-- notebook, from the print sheet and from the season stats at once.
drop policy if exists "mentors and the team read the notebook" on public.notebook_entries;
create policy "mentors and the team read the notebook" on public.notebook_entries
	for select to authenticated
	using (
		deleted_at is null
		and (
			(select public.is_mentor())
			or team_id = (select public.current_student_team_id())
		)
	);

-- A mentor sees the deleted ones too, but only through this door, and only
-- to put one back.
create or replace function public.notebook_entry_delete(p_entry_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_entry public.notebook_entries%rowtype;
begin
	select e.* into v_entry from public.notebook_entries e where e.id = p_entry_id for update;
	if not found then
		raise exception 'That page is not here any more.';
	end if;
	if v_entry.deleted_at is not null then
		raise exception 'That page is already in the bin.';
	end if;
	if not coalesce(public.notebook_can_edit(v_entry.team_id, v_entry.section), false) then
		raise exception 'That part of the notebook is not yours to change right now.';
	end if;

	update public.notebook_entries set deleted_at = now() where id = p_entry_id;

	return jsonb_build_object('entry_id', p_entry_id, 'deleted_at', now(), 'title', v_entry.title);
end;
$$;
revoke all on function public.notebook_entry_delete(uuid) from public;
grant execute on function public.notebook_entry_delete(uuid) to authenticated;

create or replace function public.notebook_entry_restore(p_entry_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_entry public.notebook_entries%rowtype;
begin
	select e.* into v_entry from public.notebook_entries e where e.id = p_entry_id for update;
	if not found then
		raise exception 'That page is not here any more.';
	end if;
	if v_entry.deleted_at is null then
		raise exception 'That page is not in the bin.';
	end if;
	if not coalesce(public.notebook_can_edit(v_entry.team_id, v_entry.section), false) then
		raise exception 'That part of the notebook is not yours to change right now.';
	end if;

	update public.notebook_entries set deleted_at = null where id = p_entry_id;

	return jsonb_build_object('entry_id', p_entry_id, 'restored', true, 'title', v_entry.title);
end;
$$;
revoke all on function public.notebook_entry_restore(uuid) from public;
grant execute on function public.notebook_entry_restore(uuid) to authenticated;

-- What is in the bin, so a mentor can put it back after the undo toast is
-- long gone. Mentors only: a child gets the ten-second undo, an adult gets
-- the bin.
create or replace function public.notebook_bin(p_team_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(
		jsonb_agg(
			jsonb_build_object(
				'entry_id', e.id,
				'section', e.section,
				'title', e.title,
				'body', left(e.body, 240),
				'deleted_at', e.deleted_at
			)
			order by e.deleted_at desc
		),
		'[]'::jsonb
	)
	from public.notebook_entries e
	where e.team_id = p_team_id
		and e.deleted_at is not null
		and public.is_mentor();
$$;
revoke all on function public.notebook_bin(uuid) from public;
grant execute on function public.notebook_bin(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Recaps: draft them again on demand.
-- ---------------------------------------------------------------------------
create or replace function public.meeting_recap_regenerate(p_meeting_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_meeting public.meetings%rowtype;
	v_confirmed integer;
	v_drafted integer;
begin
	if not coalesce(public.is_mentor(), false) then
		raise exception 'Only a mentor can redraft a recap.';
	end if;

	select m.* into v_meeting from public.meetings m where m.id = p_meeting_id;
	if not found then
		raise exception 'That session is not here any more.';
	end if;
	if v_meeting.ended_at is null then
		raise exception 'That session has not ended, so there is nothing to recap yet.';
	end if;

	-- A CONFIRMED RECAP IS SOMEBODY'S WORD AND IS NOT OVERWRITTEN. The
	-- regenerate redrafts the unconfirmed ones and says how many it left
	-- alone, rather than quietly replacing a paragraph a child signed off.
	select count(*) into v_confirmed
	from public.meeting_recaps r where r.meeting_id = p_meeting_id and r.confirmed;

	delete from public.meeting_recaps r
	where r.meeting_id = p_meeting_id and not r.confirmed;

	v_drafted := public._meeting_recaps_generate(p_meeting_id);

	return jsonb_build_object(
		'meeting_id', p_meeting_id,
		'recaps_drafted', v_drafted,
		'confirmed_kept', v_confirmed
	);
end;
$$;
revoke all on function public.meeting_recap_regenerate(uuid) from public;
grant execute on function public.meeting_recap_regenerate(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. WHY THE FILE IS NOT DROPPED IN SQL, THOUGH THE ROW IS.
--
-- evidence and mat_images each name an object in a private storage bucket, and
-- deleting the row leaves that object paid for and unreachable. The obvious fix
-- is an AFTER DELETE trigger that removes the object in the same transaction as
-- the row, and it was written, applied and thrown away, for two reasons in this
-- order:
--
--   1. THIS IMAGE FORBIDS IT ON PURPOSE. storage.protect_delete() is a BEFORE
--      DELETE trigger on storage.objects that raises 42501 -- "Direct deletion
--      from storage tables is not allowed. Use the Storage API instead." --
--      unless storage.allow_delete_query is set to 'true' for the transaction.
--      It can be set. That is not a reason to set it.
--   2. THE ROW IS NOT THE FILE. storage.objects is METADATA. Deleting the row
--      removes the app's only pointer to the object while the object itself
--      stays in the backend, so the trigger would have turned a findable orphan
--      into an unfindable one and reported success. That is a worse bug than
--      the one it was fixing, and it is the reason the guard above exists.
--
-- So the pairing lives one layer up, in ONE module per bucket, and every delete
-- path calls it: src/lib/console/evidence.ts and src/lib/planner/field-image.ts
-- remove the object through the Storage API and then delete the row, and report
-- a refusal if either half does not land. A future path that deletes one of
-- these rows calls that helper or it leaks a file.
--
-- WHAT IS STILL NOT SOLVED, WRITTEN DOWN RATHER THAN HIDDEN: a task cascade
-- (evidence.task_id -> tasks ON DELETE CASCADE, 0007) deletes evidence rows in
-- the database with no client in the loop, and those objects are not removed.
-- Deleting a task with photos on it therefore still orphans them. Fixing it
-- properly needs a sweep the Storage API can run, not a trigger.
-- ---------------------------------------------------------------------------

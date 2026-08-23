-- 0008_realtime.sql
--
-- REALTIME: publish meetings, meeting_phases, tasks, blockers and attendance
-- so a phase change reaches every connected device.
--
-- Applied by the Supabase CLI, after 0007.
--
-- RLS STILL APPLIES TO THE STREAM. Realtime evaluates the subscriber's own
-- policies per row, so publishing a table grants nobody a read they did not
-- already have: a student's channel carries their team's tasks and nothing
-- else, and every signed-in device gets every meeting and phase (0006).
--
-- REPLICA IDENTITY FULL, ON PURPOSE. Mentors hard-delete tasks, attendance
-- rows and phases (there is no soft delete on the work surface), and a DELETE
-- event with only a primary key cannot be filtered by team_id or matched to a
-- team's channel. Full-row WAL on five low-volume tables is the right trade.
-- It is also what lets a client-side filter (`team_id=eq.X`) apply to UPDATE
-- and DELETE events.
--
-- IDEMPOTENT ON BOTH AXES. The publication is a platform object: it exists on
-- the local stack and on a real project, but its membership is editable from
-- the dashboard, so this file assumes neither that it exists nor that a table
-- is absent from it.
--
-- ===========================================================================
-- TO UNDO
-- ===========================================================================
--
--   alter publication supabase_realtime drop table
--     public.meetings, public.meeting_phases, public.tasks, public.blockers, public.attendance;
--   alter table public.meetings replica identity default;
--   alter table public.meeting_phases replica identity default;
--   alter table public.tasks replica identity default;
--   alter table public.blockers replica identity default;
--   alter table public.attendance replica identity default;

alter table public.meetings replica identity full;
alter table public.meeting_phases replica identity full;
alter table public.tasks replica identity full;
alter table public.blockers replica identity full;
alter table public.attendance replica identity full;

do $$
declare
	v_table text;
	v_added text[] := array[]::text[];
begin
	if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
		raise notice '0008: no supabase_realtime publication on this database; skipped.';
		return;
	end if;

	foreach v_table in array array[
		'meetings', 'meeting_phases', 'tasks', 'blockers', 'attendance'
	] loop
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

	raise notice '0008: realtime added % of 5 tables (%); the rest were already published.',
		coalesce(array_length(v_added, 1), 0), coalesce(array_to_string(v_added, ', '), 'none');
end
$$;

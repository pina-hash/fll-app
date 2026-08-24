import type { PageServerLoad } from './$types';

/**
 * TASK CREATION, ACROSS TEAMS, AND EVERY EDIT AFTER IT. The four teams largely
 * run the same plan, so the primary action here writes one task set to several
 * teams at once. The list below it is what those writes produced, so a
 * mis-aimed bulk create is visible immediately, and now editable, re-statused
 * and deletable one at a time or by the filter.
 *
 * The load carries what an EDIT needs as well as what a list needs: the detail
 * text, the assignee, the meeting, the roster to pick an assignee from, and
 * the evidence and blockers hanging off each task, because a delete takes the
 * photos with it and the confirm has to say how many.
 *
 * A cancelled meeting (0020) is left out of the picker: it is not a session
 * anybody will work, so it is not somewhere to file a task.
 */
export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	const [teamsRes, meetingsRes, tasksRes, studentsRes] = await Promise.all([
		supabase.from('teams').select('id, name, accent').is('archived_at', null).order('name'),
		supabase
			.from('meetings')
			.select('id, meeting_date, kind, started_at, ended_at')
			.is('cancelled_at', null)
			.order('meeting_date', { ascending: false })
			.limit(20),
		supabase
			.from('tasks')
			.select(
				'id, team_id, title, detail, role, status, assigned_student_id, meeting_id, evidence_required, created_at, closed_at'
			)
			.order('created_at', { ascending: false })
			.limit(400),
		supabase
			.from('students')
			.select('id, team_id, first_name, last_initial')
			.is('deactivated_at', null)
			.order('first_name')
	]);

	// Evidence and blockers are fetched for the tasks actually listed, so both
	// queries are bounded by the list above rather than by the size of a
	// season. An empty list asks for nothing at all.
	const taskIds = (tasksRes.data ?? []).map((t) => t.id);
	const [evidenceRes, blockersRes] = await Promise.all([
		taskIds.length
			? supabase
					.from('evidence')
					.select('id, task_id, team_id, caption, upload_timestamp, uploaded_by_student_id')
					.in('task_id', taskIds)
					.order('upload_timestamp', { ascending: false })
			: Promise.resolve(null),
		taskIds.length
			? supabase.from('blockers').select('id, task_id, resolved_at').in('task_id', taskIds)
			: Promise.resolve(null)
	]);

	return {
		teams: teamsRes.data ?? [],
		meetings: meetingsRes.data ?? [],
		tasks: tasksRes.data ?? [],
		students: studentsRes.data ?? [],
		evidence: evidenceRes?.data ?? [],
		blockers: blockersRes?.data ?? [],
		loadError: teamsRes.error?.message ?? tasksRes.error?.message ?? null
	};
};

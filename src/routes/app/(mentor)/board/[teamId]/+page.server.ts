import { error } from '@sveltejs/kit';
import { parseBoardSnapshot, parseResolvedRoles } from '$lib/console/types';
import type { PageServerLoad } from './$types';

/**
 * One team, opened from a card on the live board: what they are working on,
 * who is in each seat right now, and what is blocking them.
 *
 * The meeting this page reports against is whichever one `board_live_summary`
 * resolved, so the drill-in and the card it came from can never disagree about
 * which session "today" means.
 */
export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	const { data: summaryRaw } = await supabase.rpc('board_live_summary');
	const summary = parseBoardSnapshot(summaryRaw);
	const meetingId = summary?.meeting?.id ?? null;
	const card = summary?.teams.find((t) => t.team_id === params.teamId) ?? null;

	const [teamRes, rolesRes, studentsRes, tasksRes, blockersRes, attendanceRes] = await Promise.all([
		supabase
			.from('teams')
			.select('id, name, join_code, accent, fll_team_number')
			.eq('id', params.teamId)
			.maybeSingle(),
		supabase.rpc('team_resolve_roles', { p_team_id: params.teamId, p_meeting_id: meetingId ?? undefined }),
		supabase
			.from('students')
			.select('id, first_name, last_initial, grade')
			.eq('team_id', params.teamId)
			.is('deactivated_at', null)
			.order('first_name'),
		supabase
			.from('tasks')
			.select('id, title, detail, role, status, assigned_student_id, evidence_required, created_at, closed_at')
			.eq('team_id', params.teamId)
			.order('created_at', { ascending: false }),
		supabase
			.from('blockers')
			.select('id, note, student_id, task_id, raised_at')
			.eq('team_id', params.teamId)
			.is('resolved_at', null)
			.order('raised_at'),
		meetingId
			? supabase.from('attendance').select('student_id').eq('meeting_id', meetingId)
			: Promise.resolve({ data: [] as { student_id: string }[], error: null })
	]);

	if (!teamRes.data) error(404, 'No such team.');

	return {
		team: teamRes.data,
		card,
		meeting: summary?.meeting ?? null,
		roles: parseResolvedRoles(rolesRes.data),
		students: studentsRes.data ?? [],
		tasks: tasksRes.data ?? [],
		blockers: blockersRes.data ?? [],
		presentIds: (attendanceRes.data ?? []).map((a) => a.student_id)
	};
};

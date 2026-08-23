import { error } from '@sveltejs/kit';
import { parseResolvedRoles } from '$lib/console/types';
import { parseMeetingNow } from '$lib/student/types';
import type { PageServerLoad } from './$types';

/**
 * MY SCREEN, from the server, so the phone paints before the socket is up.
 * After that the page refetches this same load on every realtime event.
 *
 * Every read here is scoped by RLS to the caller's own team; the `eq(team_id)`
 * filters are for the query planner, not for safety. tests/student-isolation
 * proves the difference.
 */
export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
	const { student } = await parent();
	if (!student) error(403, 'This screen is for students.');

	const { data: nowRaw } = await supabase.rpc('meeting_current');
	const now = parseMeetingNow(nowRaw);
	const meetingId = now?.meeting?.id ?? null;

	const [rolesRes, tasksRes, evidenceRes, attendanceRes] = await Promise.all([
		supabase.rpc('team_resolve_roles', {
			p_team_id: student.teamId,
			p_meeting_id: meetingId ?? undefined
		}),
		supabase
			.from('tasks')
			.select('id, title, detail, role, status, assigned_student_id, evidence_required, created_at')
			.eq('team_id', student.teamId)
			.order('created_at', { ascending: true }),
		supabase.from('evidence').select('task_id').eq('team_id', student.teamId),
		meetingId
			? supabase.from('attendance').select('student_id').eq('meeting_id', meetingId)
			: Promise.resolve({ data: [] as { student_id: string }[], error: null })
	]);

	const evidenceCounts = new Map<string, number>();
	for (const row of evidenceRes.data ?? []) {
		evidenceCounts.set(row.task_id, (evidenceCounts.get(row.task_id) ?? 0) + 1);
	}

	const presentIds = (attendanceRes.data ?? []).map((a) => a.student_id);

	return {
		serverNow: now?.server_now ?? new Date().toISOString(),
		meeting: now?.meeting ?? null,
		roles: parseResolvedRoles(rolesRes.data),
		tasks: (tasksRes.data ?? []).map((t) => ({
			...t,
			evidence_count: evidenceCounts.get(t.id) ?? 0
		})),
		presentIds,
		checkedIn: presentIds.includes(student.studentId)
	};
};

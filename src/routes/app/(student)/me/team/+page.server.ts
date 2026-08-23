import { error } from '@sveltejs/kit';
import { parseResolvedRoles } from '$lib/console/types';
import { parseMeetingNow } from '$lib/student/types';
import type { PageServerLoad } from './$types';

/**
 * THE TEAM TAB: read-only awareness of what everyone else is doing.
 *
 * This is the peer visibility that makes roles stick. A kid who can see that
 * the Run Captain seat is empty today, or that somebody already claimed the
 * job they were about to start, behaves differently from one who cannot.
 *
 * Everything here is scoped by RLS to the caller's own team. There is no team
 * selector and no team id in the URL: there is nothing to change it to.
 */
export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
	const { student } = await parent();
	if (!student) error(403, 'This screen is for students.');

	const { data: nowRaw } = await supabase.rpc('meeting_current');
	const now = parseMeetingNow(nowRaw);
	const meetingId = now?.meeting?.id ?? null;

	const [rolesRes, tasksRes, rosterRes, attendanceRes, blockersRes] = await Promise.all([
		supabase.rpc('team_resolve_roles', {
			p_team_id: student.teamId,
			p_meeting_id: meetingId ?? undefined
		}),
		supabase
			.from('tasks')
			.select('id, title, role, status, assigned_student_id, evidence_required')
			.eq('team_id', student.teamId)
			.order('created_at', { ascending: true }),
		supabase
			.from('students')
			.select('id, first_name, last_initial')
			.eq('team_id', student.teamId)
			.is('deactivated_at', null)
			.order('first_name'),
		meetingId
			? supabase.from('attendance').select('student_id').eq('meeting_id', meetingId)
			: Promise.resolve({ data: [] as { student_id: string }[], error: null }),
		supabase
			.from('blockers')
			.select('id, note, student_id')
			.eq('team_id', student.teamId)
			.is('resolved_at', null)
	]);

	const presentIds = new Set((attendanceRes.data ?? []).map((a) => a.student_id));

	return {
		serverNow: now?.server_now ?? new Date().toISOString(),
		meeting: now?.meeting ?? null,
		roles: parseResolvedRoles(rolesRes.data),
		tasks: tasksRes.data ?? [],
		roster: (rosterRes.data ?? []).map((s) => ({ ...s, present: presentIds.has(s.id) })),
		blockers: blockersRes.data ?? []
	};
};

import { parseResolvedRoles } from '$lib/console/types';
import { parseMeetingNow } from '$lib/student/types';
import type { PageServerLoad } from './$types';

/**
 * TEAM BOARD MODE: the spare iPad propped on the table, for the students who
 * did not bring a device.
 *
 * It lives OUTSIDE /app on purpose. /app is guarded by hooks.server.ts and
 * bounces an unauthenticated request to the login screen; this route must
 * render its own sign-in instead, because the thing that must never happen is
 * a shared iPad falling back to a personal login screen in the middle of a
 * meeting.
 *
 * Signed in, the device is a `board` principal (0010): it reads its own team
 * and closes its own team's tasks, and can do nothing else. It holds no role,
 * is never checked in, and appears on no roster.
 */
export const load: PageServerLoad = async ({ locals: { principal, supabase } }) => {
	if (principal?.kind !== 'board') {
		return { board: null as null, meeting: null, roles: [], roster: [], tasks: [], serverNow: null };
	}

	const { data: nowRaw } = await supabase.rpc('meeting_current');
	const now = parseMeetingNow(nowRaw);
	const meetingId = now?.meeting?.id ?? null;

	const [rolesRes, rosterRes, tasksRes, attendanceRes] = await Promise.all([
		supabase.rpc('team_resolve_roles', {
			p_team_id: principal.teamId,
			p_meeting_id: meetingId ?? undefined
		}),
		supabase
			.from('students')
			.select('id, first_name, last_initial')
			.eq('team_id', principal.teamId)
			.is('deactivated_at', null)
			.order('first_name'),
		supabase
			.from('tasks')
			.select('id, title, role, status, assigned_student_id, evidence_required')
			.eq('team_id', principal.teamId)
			.order('created_at', { ascending: true }),
		meetingId
			? supabase.from('attendance').select('student_id').eq('meeting_id', meetingId)
			: Promise.resolve({ data: [] as { student_id: string }[], error: null })
	]);

	const present = new Set((attendanceRes.data ?? []).map((a) => a.student_id));

	return {
		board: principal,
		serverNow: now?.server_now ?? new Date().toISOString(),
		meeting: now?.meeting ?? null,
		roles: parseResolvedRoles(rolesRes.data),
		roster: (rosterRes.data ?? []).map((s) => ({ ...s, present: present.has(s.id) })),
		tasks: tasksRes.data ?? []
	};
};

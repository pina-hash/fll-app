import { error } from '@sveltejs/kit';
import { parseResolvedRoles } from '$lib/console/types';
import { parseRosterState } from '$lib/console/roster';
import type { PageServerLoad } from './$types';

/**
 * One team's provisioning pane.
 *
 * Role holders come from `team_resolve_roles` with no meeting, which is the
 * same function the live board uses. Without a meeting nobody is present, so
 * the `active_*` columns are empty and only the primary/second ASSIGNMENTS
 * come back, which is exactly what this screen edits. Asking a second query
 * for "who is assigned" would be the second implementation the migration's
 * header warns about.
 *
 * Seats, the cap and whether sign-ups are open likewise come from ONE rpc
 * (team_roster_state, 0013), not from counting rows here: "is this team open"
 * has two bounds in it (the meeting it was opened in, and the local day) and
 * neither belongs in a page load.
 *
 * Parent links are read straight off student_parent_access, which mentors and
 * only mentors may select (0014). The token is in that select on purpose: it
 * is what the printable card prints, and unlike a PIN it is meant to be
 * reprintable.
 */
export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	const [teamRes, studentsRes, rolesRes, boardRes, stateRes, parentRes] = await Promise.all([
		supabase
			.from('teams')
			.select('id, name, join_code, accent, fll_team_number, archived_at')
			.eq('id', params.teamId)
			.maybeSingle(),
		supabase
			.from('students')
			.select('id, first_name, last_initial, grade, slug, deactivated_at')
			.eq('team_id', params.teamId)
			.order('first_name')
			.order('last_initial'),
		supabase.rpc('team_resolve_roles', { p_team_id: params.teamId }),
		supabase.from('team_board_devices').select('id, created_at').eq('team_id', params.teamId).maybeSingle(),
		supabase.rpc('team_roster_state'),
		supabase
			.from('student_parent_access')
			.select('student_id, token, issued_at, revoked_at, last_opened_at, open_count')
			.eq('team_id', params.teamId)
	]);

	if (!teamRes.data) error(404, 'No such team.');

	const states = parseRosterState(stateRes.data);

	return {
		team: teamRes.data,
		students: studentsRes.data ?? [],
		roles: parseResolvedRoles(rolesRes.data),
		rolesError: rolesRes.error?.message ?? null,
		boardDevice: boardRes.data ?? null,
		rosterStates: states,
		rosterState: states.find((s) => s.team_id === params.teamId) ?? null,
		parentLinks: parentRes.data ?? []
	};
};

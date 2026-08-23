import { error } from '@sveltejs/kit';
import { parseResolvedRoles } from '$lib/console/types';
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
 */
export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	const [teamRes, studentsRes, rolesRes, boardRes] = await Promise.all([
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
		supabase.from('team_board_devices').select('id, created_at').eq('team_id', params.teamId).maybeSingle()
	]);

	if (!teamRes.data) error(404, 'No such team.');

	return {
		team: teamRes.data,
		students: studentsRes.data ?? [],
		roles: parseResolvedRoles(rolesRes.data),
		rolesError: rolesRes.error?.message ?? null,
		boardDevice: boardRes.data ?? null
	};
};

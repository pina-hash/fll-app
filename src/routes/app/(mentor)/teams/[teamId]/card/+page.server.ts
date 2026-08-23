import { error } from '@sveltejs/kit';
import { parseResolvedRoles } from '$lib/console/types';
import type { PageServerLoad } from './$types';

/** The paper fallback: one printable card per team. */
export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	const [teamRes, studentsRes, rolesRes] = await Promise.all([
		supabase
			.from('teams')
			.select('id, name, join_code, accent, fll_team_number')
			.eq('id', params.teamId)
			.maybeSingle(),
		supabase
			.from('students')
			.select('id, first_name, last_initial, grade, slug')
			.eq('team_id', params.teamId)
			.is('deactivated_at', null)
			.order('first_name')
			.order('last_initial'),
		supabase.rpc('team_resolve_roles', { p_team_id: params.teamId })
	]);

	if (!teamRes.data) error(404, 'No such team.');

	return {
		team: teamRes.data,
		students: studentsRes.data ?? [],
		roles: parseResolvedRoles(rolesRes.data)
	};
};

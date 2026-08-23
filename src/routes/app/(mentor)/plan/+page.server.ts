import type { PageServerLoad } from './$types';

/**
 * The planner's team picker: four tiles, one per live team. Sits inside the
 * (mentor) group, so a student never reaches it; the pages below re-ask the
 * database anyway.
 */
export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	const { data } = await supabase
		.from('teams')
		.select('id, name, accent, fll_team_number')
		.is('archived_at', null)
		.order('name');
	return { teams: data ?? [] };
};

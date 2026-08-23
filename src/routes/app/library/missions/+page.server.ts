import type { PageServerLoad } from './$types';

/**
 * The 15 BIOGLOW missions, from the database (see
 * supabase/migrations/0011_missions_and_team_notes.sql), plus the two
 * match-wide scoring items that are not mission models and so are not a
 * database row (Equipment Inspection, Precision Tokens -- see
 * src/lib/content/missions.ts MATCH_BASICS).
 */
export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	const { data, error } = await supabase
		.from('missions')
		.select('id, code, name, points_label, position_x_mm, position_y_mm, sort_order')
		.order('sort_order');

	return {
		missions: data ?? [],
		missionsError: error?.message ?? null
	};
};

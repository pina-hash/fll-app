import type { PageServerLoad } from './$types';

/**
 * The code generator's team picker: one tile per live team, the same shape as
 * the planner's and the notebook's rather than a new idea about how a mentor
 * picks a team.
 *
 * WHY A MENTOR NEEDS AN ENTRY POINT AT ALL. The database has always allowed
 * this: `strategy_can_edit()` returns true for any mentor, and 0024's read
 * policy names mentors explicitly. Only the route was student-scoped, so a
 * mentor could be told by the database that they may edit a team's robot and
 * have nowhere to do it. This is the missing door, not a new permission.
 *
 * Sits inside the (mentor) group, so a student never reaches it; the page below
 * re-asks the database anyway.
 */
export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	const { data } = await supabase
		.from('teams')
		.select('id, name, accent, fll_team_number')
		.is('archived_at', null)
		.order('name');
	return { teams: data ?? [] };
};

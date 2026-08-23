import { error } from '@sveltejs/kit';
import { loadPlannerData } from '$lib/planner/data';
import type { PageServerLoad } from './$types';

/**
 * THE ROUTE PLANNER, student side. Every teammate can look; whether this
 * student can EDIT is the database's own answer (strategy_can_edit), fetched
 * inside loadPlannerData, so the affordance can never disagree with the
 * enforcement. There is no team id in the URL: a student plans for their own
 * team and there is nothing to change that to.
 */
export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
	const { student } = await parent();
	if (!student) error(403, 'This screen is for students.');

	return { planner: await loadPlannerData(supabase, student.teamId) };
};

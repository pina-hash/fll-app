import { error } from '@sveltejs/kit';
import { loadMatchData } from '$lib/match/data';
import type { PageServerLoad } from './$types';

/**
 * THE MATCH TIMER, student side. Anybody on the team may log a run -- unlike
 * the route planner, which is the Run Captain's document (0012). A run is an
 * observation made in three seconds by whoever has a free hand while the robot
 * is still moving, so gating it on a role would mean runs going unlogged.
 *
 * There is no team id in the URL: a student runs their own team's robot and
 * there is nothing to change that to.
 */
export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
	const { student } = await parent();
	if (!student) error(403, 'This screen is for students.');

	return { match: await loadMatchData(supabase, student.teamId) };
};

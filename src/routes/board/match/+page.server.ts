import { redirect } from '@sveltejs/kit';
import { loadMatchData } from '$lib/match/data';
import type { PageServerLoad } from './$types';

/**
 * THE MATCH TIMER ON THE TEAM BOARD IPAD. It lives outside /app for the same
 * reason /board does: /app bounces an unauthenticated request to the personal
 * login screen, and a kiosk must never do that mid-meeting. A device that is
 * not signed in as a board goes back to /board, which carries the kiosk's own
 * sign-in.
 *
 * A board logs a run as the TEAM, not as a person: 0015 leaves both
 * logged_by_* columns null and has no exactly-one-creator constraint, because
 * a shared iPad has no author to name.
 */
export const load: PageServerLoad = async ({ locals: { principal, supabase } }) => {
	if (principal?.kind !== 'board') redirect(303, '/board');
	return { board: principal, match: await loadMatchData(supabase, principal.teamId) };
};

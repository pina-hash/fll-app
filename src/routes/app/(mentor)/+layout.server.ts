import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

/**
 * THE MENTOR CONSOLE IS REFUSED TO A STUDENT, NOT HIDDEN FROM ONE. Every route
 * in this group runs this load first, so a student session that types the URL
 * gets a 403 page rather than an empty screen. That is the outer of two
 * boundaries: the inner one is the database, where `board_live_summary` and
 * every provisioning RPC re-check `is_mentor()` in their own body and where
 * RLS scopes a student to their own team no matter what the page asked for.
 * Neither is trusted alone.
 */
export const load: LayoutServerLoad = async ({ locals: { principal } }) => {
	if (!principal || principal.kind !== 'mentor') {
		error(403, 'The mentor console is for mentors.');
	}
	return { mentor: principal };
};

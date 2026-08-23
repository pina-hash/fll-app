import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * THE LIVE BOARD HARNESS. Renders only under `vite dev`; in a production build
 * `dev` is false and this load throws 404, which is the same answer the router
 * gives for a route that does not exist. Nothing on this path signs in, reads a
 * session or calls Supabase: the page's own load returns an empty object and
 * the component below it is fed fixtures. (The ROOT layout still runs, as it
 * does for every route in a SvelteKit app; with no session cookie it resolves
 * to `principal: null` without a round trip.)
 *
 * WHY IT EXISTS. The board's hard states -- overrun, blockers, a role with
 * nobody in the seat, a team quiet for half an hour -- need a meeting, four
 * teams, attendance and a stopwatch to reproduce against a real database. Here
 * they are props. The component underneath is the REAL LiveBoard.svelte, not a
 * copy of its markup, so a change to the board shows up here or the harness is
 * lying.
 */
export const load: PageServerLoad = async () => {
	if (!dev) error(404, 'Not found.');
	return {};
};

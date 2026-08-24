import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * THE MATCH TIMER HARNESS. Renders only under `vite dev`; a production build
 * has `dev === false` and this load throws 404, the same answer the router
 * gives for a route that does not exist. Nothing on this path signs in, reads
 * a session or calls Supabase.
 *
 * WHY IT EXISTS. The states worth staring at are the ones that are awkward to
 * reach live: the last thirty seconds, an overrun, a team with a trendline
 * behind it and a team with nothing. Here they are props, the component
 * underneath is the REAL MatchTimer.svelte, and every run it would have queued
 * lands in a visible persist log instead, which is the round trip the harness
 * proves.
 */
export const load: PageServerLoad = async () => {
	if (!dev) error(404, 'Not found.');
	return {};
};

import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * THE ROUTE PLANNER HARNESS. Renders only under `vite dev`; a production
 * build has `dev === false` and this load throws 404, the same answer the
 * router gives for a route that does not exist. Nothing on this path signs
 * in, reads a session or calls Supabase.
 *
 * WHY IT EXISTS. The planner's states worth staring at are awkward to reach
 * live: a viewer who may not edit, an editor with a plan that busts the
 * match clock, a mentor placing markers. Here they are props, the component
 * underneath is the REAL RoutePlanner.svelte, and every op it would have
 * queued lands in a visible persist log instead, which is the round trip the
 * harness proves.
 */
export const load: PageServerLoad = async () => {
	if (!dev) error(404, 'Not found.');
	return {};
};

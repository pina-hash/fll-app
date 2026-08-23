import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * THE STUDENT SCREEN HARNESS. Renders only under `vite dev`; a production
 * build has `dev === false` and this load throws 404, the same answer the
 * router gives for a route that does not exist. Nothing on this path signs in,
 * reads a session or calls Supabase.
 *
 * WHY IT EXISTS. The states that matter most on this screen are the awkward
 * ones: a kid who is COVERING and does not know it, a task that will not close
 * without a photo, the wifi down with three writes still on the device, a
 * write the server refused. Reproducing those against a live stack means a
 * meeting, attendance, a role assignment and a severed connection. Here they
 * are props, and the component underneath is the REAL StudentScreen.svelte.
 */
export const load: PageServerLoad = async () => {
	if (!dev) error(404, 'Not found.');
	return {};
};

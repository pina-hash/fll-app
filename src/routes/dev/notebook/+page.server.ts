import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * THE NOTEBOOK HARNESS. Renders only under `vite dev`; a production build
 * has `dev === false` and this load throws 404, the same answer the router
 * gives for a route that does not exist. Nothing on this path signs in,
 * reads a session or calls Supabase.
 *
 * WHY IT EXISTS. The notebook's states worth staring at are awkward to reach
 * live: a builder who may write only Robot Design, a viewer who may write
 * nothing, a recap waiting to be confirmed, and the print document. Here they
 * are props, the components underneath are the REAL Notebook.svelte and
 * NotebookPrint.svelte, and every op the notebook would have queued lands in
 * a visible persist log instead, which is the round trip the harness proves.
 */
export const load: PageServerLoad = async () => {
	if (!dev) error(404, 'Not found.');
	return {};
};

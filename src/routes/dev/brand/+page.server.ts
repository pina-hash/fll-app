import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * THE BRAND HARNESS. Renders only under `vite dev`; a production build has
 * `dev === false` and this load throws 404, the same answer the router gives
 * for a route that does not exist. Nothing on this path signs in, reads a
 * session or calls Supabase.
 *
 * WHY IT EXISTS. The logo rules are enforced by BrandLogo.svelte, and a rule
 * enforced by a component can only be PROVED by rendering that component and
 * asking it to break the rule. This page does exactly that: it mounts the
 * REAL BrandLogo with deliberately violating props next to legal ones, so
 * "the icon alone is refused" is something a person can see and a browser
 * check can assert, rather than a sentence in a comment.
 */
export const load: PageServerLoad = async () => {
	if (!dev) error(404, 'Not found.');
	return {};
};

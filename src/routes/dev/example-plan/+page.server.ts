import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * THE EXAMPLE PLAN HARNESS. Renders only under `vite dev`; a production
 * build answers 404, the same as a route that does not exist. The component
 * underneath is the REAL ExamplePlan.svelte with its real content module:
 * the example needs no fixtures because it IS content, so what this page
 * shows is byte for byte what a signed-in student or mentor sees at
 * /app/me/plan/example and /app/plan/example.
 */
export const load: PageServerLoad = async () => {
	if (!dev) error(404, 'Not found.');
	return {};
};

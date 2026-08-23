import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

/**
 * hooks.server.ts already redirects an unauthenticated or seatless request
 * away from /app; this narrows the type for every page beneath it.
 */
export const load: LayoutServerLoad = async ({ locals: { principal } }) => {
	if (!principal) redirect(303, '/login');
	return { principal };
};

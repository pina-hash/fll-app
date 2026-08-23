import type { LayoutServerLoad } from './$types';

/**
 * Hands the session down once, from the server: the verified claims, who the
 * session is in this app (resolved in hooks.server.ts), and the cookies the
 * universal load needs to build its own client during SSR.
 */
export const load: LayoutServerLoad = async ({ locals: { claims, principal }, cookies }) => {
	return { claims, principal, cookies: cookies.getAll() };
};

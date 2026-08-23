import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * /app is the door every population comes through, and none of them stay. A
 * mentor's console starts on the live board; a student starts on their own
 * screen; a board device belongs on the shared-iPad route, not in here.
 */
export const load: PageServerLoad = async ({ locals: { principal } }) => {
	if (principal?.kind === 'mentor') redirect(303, '/app/board');
	if (principal?.kind === 'student') redirect(303, '/app/me');
	if (principal?.kind === 'board') redirect(303, '/board');
	return {};
};

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * /app is the door both populations come through. A mentor's console starts on
 * the live board, which is what they need within a second of unlocking the
 * phone; a student stays here until the team board ships.
 */
export const load: PageServerLoad = async ({ locals: { principal } }) => {
	if (principal?.kind === 'mentor') redirect(303, '/app/board');
	return {};
};

import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * The worked example, student side. It is content, not data: nothing is
 * loaded beyond the guard, and nothing on it can be written.
 */
export const load: PageServerLoad = async ({ parent }) => {
	const { student } = await parent();
	if (!student) error(403, 'This screen is for students.');
	return {};
};

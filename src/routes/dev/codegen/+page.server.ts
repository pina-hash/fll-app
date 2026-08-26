import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** Dev only, 404 otherwise, like every other harness under /dev. */
export const load: PageServerLoad = async () => {
	if (!dev) error(404, 'Not found');
	return {};
};

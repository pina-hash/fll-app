import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** The root is a switchboard: signed in with a seat goes to the shell, anyone else to the login screen. */
export const load: PageServerLoad = async ({ locals: { principal } }) => {
	redirect(303, principal ? '/app' : '/login');
};

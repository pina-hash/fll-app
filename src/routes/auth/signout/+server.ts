import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** POST only: a sign-out is a state change, never a GET a prefetch could trigger. */
export const POST: RequestHandler = async ({ locals: { supabase } }) => {
	await supabase.auth.signOut();
	redirect(303, '/login');
};

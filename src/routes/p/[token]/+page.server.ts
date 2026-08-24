import { error } from '@sveltejs/kit';
import { parseParentView } from '$lib/parent/types';
import type { PageServerLoad } from './$types';

/**
 * THE PARENT VIEW. `/p/<token>` and nothing else: no sign-in, no account, no
 * cookie of their own.
 *
 * It lives OUTSIDE /app on purpose, like /board. /app is guarded by
 * hooks.server.ts and bounces an unauthenticated request to the personal login
 * screen; a parent who lands there would be told to sign in with a Google
 * account they do not have.
 *
 * One RPC does all of it. parent_view is SECURITY DEFINER and resolves the
 * token to exactly one child; this load adds no filtering of its own, because
 * a second place that decides what a parent may see is a second place to get
 * it wrong.
 *
 * A bad, revoked or unknown token all answer the same 404. Probing reveals
 * nothing: a link that was turned off reads exactly like one that never was.
 */
export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	const { data, error: rpcError } = await supabase.rpc('parent_view', { p_token: params.token });
	if (rpcError) error(503, 'We could not load this page just now. Try again in a minute.');

	const view = parseParentView(data);
	if (!view) {
		error(404, 'This link is not working any more. Ask a mentor for a new one.');
	}

	return { view, token: params.token };
};

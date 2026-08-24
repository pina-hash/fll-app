import { error, redirect } from '@sveltejs/kit';
import { serviceClient } from '$lib/server/service-client';
import type { RequestHandler } from './$types';

/**
 * ONE PHOTO, FOR ONE PARENT LINK.
 *
 * THE DATABASE DECIDES; THE SERVICE ROLE ONLY FETCHES. parent_photo_path
 * (0014) answers with a storage path only when the token's own child took that
 * photo, and null for every other case -- another child's photo, a revoked
 * link, a deactivated student, a token that never existed. Only then does the
 * service role sign a URL for the path that came back. It never chooses.
 *
 * A SIGNED URL AND NOT A PROXY. The evidence bucket allows files up to 15MB
 * and a parent may open a dozen in a row; streaming those through this
 * function would hold each one in memory for no benefit. Sixty seconds is long
 * enough for the browser to follow the redirect and short enough that a URL
 * copied out of devtools is stale before it is useful.
 */
const SIGNED_URL_SECONDS = 60;

export const GET: RequestHandler = async ({ params, locals: { supabase } }) => {
	const { data: path, error: rpcError } = await supabase.rpc('parent_photo_path', {
		p_token: params.token,
		p_evidence_id: params.evidenceId
	});
	// Not authorised and does not exist answer identically, on purpose.
	if (rpcError || !path) error(404, 'Not found.');

	const service = serviceClient();
	if (!service) error(503, 'Photos are not available on this server.');

	const signed = await service.storage.from('evidence').createSignedUrl(path, SIGNED_URL_SECONDS);
	if (signed.error || !signed.data?.signedUrl) error(404, 'Not found.');

	redirect(302, signed.data.signedUrl);
};

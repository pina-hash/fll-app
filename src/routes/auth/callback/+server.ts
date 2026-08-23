import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Google OAuth (PKCE) callback. GoTrue redirects here with `code`, which is
 * exchanged for a session; the cookies are written by the server client in
 * hooks.server.ts.
 *
 * A sign-in the database refused (a non-boscotech.edu account: 0002's trigger
 * aborts GoTrue's insert) arrives here with `error` query params instead of a
 * code, and is shown as a rejection rather than a generic failure.
 */
export const GET: RequestHandler = async ({ url, locals: { supabase } }) => {
	const next = safeNext(url.searchParams.get('next'));
	const code = url.searchParams.get('code');

	if (url.searchParams.has('error')) {
		const description = (url.searchParams.get('error_description') ?? '').toLowerCase();
		const rejected = description.includes('database error') || description.includes('boscotech');
		redirect(303, `/login?reason=${rejected ? 'rejected' : 'failed'}`);
	}

	if (code) {
		const { error } = await supabase.auth.exchangeCodeForSession(code);
		if (!error) redirect(303, next);
	}
	redirect(303, '/login?reason=failed');
};

function safeNext(raw: string | null): string {
	if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/app';
	return raw;
}

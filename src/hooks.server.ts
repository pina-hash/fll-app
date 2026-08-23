import { createServerClient } from '@supabase/ssr';
import { type Handle, type HandleServerError, redirect } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import type { Database } from '$lib/supabase/database.types';
import { fetchPrincipal } from '$lib/auth/principal';

/**
 * One server-side Supabase client per request, holding the session cookies.
 * This and src/routes/+layout.ts are the only two places a client is created.
 */
const supabase: Handle = async ({ event, resolve }) => {
	event.locals.supabase = createServerClient<Database>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
		cookies: {
			getAll: () => event.cookies.getAll(),
			setAll: (cookiesToSet) => {
				cookiesToSet.forEach(({ name, value, options }) => {
					event.cookies.set(name, value, { ...options, path: '/' });
				});
			}
		}
	});

	return resolve(event, {
		filterSerializedResponseHeaders(name) {
			return name === 'content-range' || name === 'x-supabase-api-version';
		}
	});
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * getClaims() verifies the JWT locally on projects with asymmetric signing
 * keys and falls back to a live getUser() round trip on HS256 projects (the
 * local stack). That round trip can fail transiently, so a genuine error is
 * retried; a clean "no session" is not.
 */
async function resolveClaims(client: App.Locals['supabase']): Promise<App.Claims | null> {
	for (let attempt = 0; attempt < 3; attempt++) {
		const { data, error } = await client.auth.getClaims();
		if (data?.claims) return data.claims as App.Claims;
		if (!error) return null;
		if (attempt < 2) await sleep(150);
	}
	return null;
}

/** Routes that need a signed-in identity. Everything else is public. */
const authedPrefixes = ['/app'];

const authGuard: Handle = async ({ event, resolve }) => {
	event.locals.claims = await resolveClaims(event.locals.supabase);
	event.locals.principal = event.locals.claims ? await fetchPrincipal(event.locals.supabase) : null;

	const { pathname } = event.url;
	const needsAuth = authedPrefixes.some((p) => pathname === p || pathname.startsWith(p + '/'));
	if (needsAuth) {
		if (!event.locals.claims) redirect(303, `/login?next=${encodeURIComponent(pathname)}`);
		// Signed in to Auth but nobody here: a deactivated mentor or student.
		if (!event.locals.principal) redirect(303, '/auth/error?reason=no-access');
	}
	return resolve(event);
};

export const handle = sequence(supabase, authGuard);

export const handleError: HandleServerError = ({ error, event, status, message }) => {
	const id = crypto.randomUUID();
	console.error(
		`[error ${id}] ${status} ${event.request.method} ${event.url.pathname} route=${event.route.id ?? 'none'}`,
		error
	);
	return { message: status === 500 ? 'Something went wrong on our side.' : message, id };
};

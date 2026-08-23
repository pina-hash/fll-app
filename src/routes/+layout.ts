import { createBrowserClient, createServerClient, isBrowser } from '@supabase/ssr';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import type { Database } from '$lib/supabase/database.types';
import type { LayoutLoad } from './$types';

/**
 * The universal client: a browser client after hydration, a cookie-backed
 * server client during SSR. `depends('supabase:auth')` is what the root
 * layout's onAuthStateChange invalidates, so a sign-in or sign-out re-runs
 * every load that touched the session.
 */
export const load: LayoutLoad = async ({ fetch, data, depends }) => {
	depends('supabase:auth');

	const supabase = isBrowser()
		? createBrowserClient<Database>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, { global: { fetch } })
		: createServerClient<Database>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
				global: { fetch },
				cookies: {
					getAll() {
						return data.cookies;
					}
				}
			});

	return { supabase, claims: data.claims, principal: data.principal };
};

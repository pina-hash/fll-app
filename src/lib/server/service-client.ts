/**
 * THE ONLY READER OF SUPABASE_SERVICE_ROLE_KEY IN THIS REPO.
 *
 * CLAUDE.md said this module would exist the day something needed it and that
 * there would be exactly one of it. This is that day: a parent has no session,
 * so no storage policy on the evidence bucket (0007) can ever admit them, and
 * Postgres cannot sign a storage URL.
 *
 * WHAT IT IS ALLOWED TO DECIDE: NOTHING. The one caller
 * (src/routes/p/[token]/photo/[evidenceId]) asks the DATABASE first --
 * parent_photo_path(token, evidence_id), which returns a path only when that
 * token's child took that photo -- and uses this client solely to sign a
 * short-lived URL for the path the database already authorised. If this module
 * ever grows a caller that chooses who may see what, that caller is wrong.
 *
 * It lives under $lib/server so SvelteKit refuses to bundle it into anything
 * the browser downloads, which is what makes the boundary real rather than a
 * naming convention. The key is read through $env/dynamic/private so a build
 * with no key still builds and the failure is a readable 503 at request time.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import type { Database } from '$lib/supabase/database.types';

let cached: SupabaseClient<Database> | null = null;

/** Null when no service key is configured; every caller must handle that. */
export function serviceClient(): SupabaseClient<Database> | null {
	const key = env.SUPABASE_SERVICE_ROLE_KEY;
	if (!key) return null;
	if (!cached) {
		cached = createClient<Database>(PUBLIC_SUPABASE_URL, key, {
			auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
		});
	}
	return cached;
}

import { redirect } from '@sveltejs/kit';
import {
	DEVICE_TEAM_COOKIE,
	forgetDeviceTeam,
	rememberedJoinCode
} from '$lib/auth/device-team';
import type { Actions, PageServerLoad } from './$types';

/**
 * A signed-in user with a seat has no business on the login screen.
 *
 * THE ROSTER IS FETCHED HERE, NOT IN THE BROWSER. When this device already
 * knows its team, the list of names is in the HTML of the first response, so a
 * returning child taps their own name on the screen that loads rather than on
 * the one that arrives after a round trip. On a school hall's wifi that round
 * trip is the whole difference.
 */
export const load: PageServerLoad = async ({ locals: { supabase, principal }, url, cookies }) => {
	if (principal) redirect(303, safeNext(url.searchParams.get('next')));

	const remembered = rememberedJoinCode(cookies.get(DEVICE_TEAM_COOKIE));
	let roster: unknown = null;

	if (remembered) {
		const { data } = await supabase.rpc('team_login_roster', { p_join_code: remembered });
		roster = data ?? null;
		/**
		 * A MEMORY THAT NO LONGER NAMES A TEAM IS FORGOTTEN, NOT SHOWN. The code
		 * a mentor regenerated (`team_regenerate_join_code`) and the team a mentor
		 * archived both answer null here, and a device that kept insisting on
		 * either would offer a child a screen with nothing on it and no way off
		 * except a button they have to know to look for.
		 */
		if (!roster) forgetDeviceTeam(cookies);
	}

	return { next: safeNext(url.searchParams.get('next')), roster };
};

export const actions = {
	/**
	 * "Not my team". A shared iPad moves between tables, so this exists and is
	 * one tap.
	 *
	 * A PLAIN FORM POST, for the same reason sign-out is: a state change must
	 * never be a GET that a prefetch or a browser's history restore can fire. It
	 * also means the escape works with no JavaScript at all, which is the one
	 * thing on this screen that has to work when everything else has not loaded.
	 */
	forget: async ({ cookies, url }) => {
		forgetDeviceTeam(cookies);
		const next = url.searchParams.get('next');
		redirect(303, next ? `/login?next=${encodeURIComponent(safeNext(next))}` : '/login');
	}
} satisfies Actions;

/** Only same-origin paths; never an absolute URL somebody pasted into the query. */
function safeNext(raw: string | null): string {
	if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/app';
	return raw;
}

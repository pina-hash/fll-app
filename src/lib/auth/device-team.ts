/**
 * WHICH TEAM THIS IPAD BELONGS TO. Not who is using it.
 *
 * THE PROBLEM THIS SOLVES. A child joins with a seat code from a printed card.
 * The card's code is spent the moment they use it, and the JOIN code -- the one
 * the sign-in screen asks for -- is a different code they have never been shown.
 * So next Friday they type the spent seat code into the team-code box, are told
 * no team has it, try the seat-code door, are told the seat is taken, and end up
 * asking a mentor for a third code. `student_claim_seat` already returns the
 * join code; before this it went out of scope one line after it arrived.
 *
 * WHY THIS IS NOT PART OF THE SESSION, which is the whole point. On a shared
 * iPad, handing over to the next child means signing out, and signing out is
 * correct: the next child is a different person. Anything that lives in the
 * session dies with it. The team the iPad sits next to does not change when the
 * child holding it does, so it is remembered separately and survives sign-out.
 *
 * ===========================================================================
 * WHY A SERVER-SET COOKIE AND NOT localStorage
 * ===========================================================================
 *
 * This app is a Safari tab on iPadOS: there is no manifest, no service worker
 * and nothing installed to a home screen (`static/` holds `robots.txt` and the
 * brand marks and nothing else). That decides it.
 *
 *   1. SAFARI DELETES SCRIPT-WRITABLE STORAGE AFTER SEVEN DAYS. localStorage,
 *      IndexedDB and cookies written from page script are all in that category,
 *      and the clock is seven days of Safari use without interacting with this
 *      site. THESE TEAMS MEET ONCE A WEEK. A memory with a seven-day life and a
 *      seven-day refresh interval is a memory that works until the week somebody
 *      is off sick. A cookie set by this server in an HTTP response is not
 *      script-writable storage and is not in that sweep.
 *   2. The login page is server rendered, so a cookie is readable BEFORE the
 *      first paint. The roster arrives in the HTML rather than after a round
 *      trip on school wifi, which is the difference between a child tapping
 *      their name immediately and a child watching a spinner.
 *   3. `httpOnly` costs nothing here, because no page script needs to read
 *      this. It is one fewer thing an XSS could rewrite, and rewriting it is
 *      the only thing it could usefully do.
 *
 * WHAT IT DOES NOT SURVIVE, stated rather than hoped: Settings, Safari, Clear
 * History and Website Data wipes it like everything else, and a private tab
 * never has it. Both land the child back on the team-code field, which is the
 * screen that exists for exactly that. It also does not follow a child to a
 * different iPad, which is correct: it is the iPad's memory, not theirs.
 *
 * ===========================================================================
 * WHY IT IS SAFE TO KEEP
 * ===========================================================================
 *
 * The value is a JOIN CODE and nothing else. A join code is already public to
 * everyone on the team -- it is on the roster card, mentors read it aloud, and
 * `team_login_roster` is granted to `anon` on purpose. Holding one lets a device
 * show a list of first names and last initials. It authenticates nobody: the PIN
 * does that, it is bcrypt in `auth.users` from the moment it is set, and it is
 * never in this cookie or anywhere near it.
 *
 * DO NOT EXTEND THIS TO MENTORS. Mentors are Google-only on a boscotech.edu
 * domain and hold no PIN anywhere in this schema; a remembered team means
 * nothing to a console that spans all four teams. Only a STUDENT principal
 * writes this cookie.
 */

import type { Cookies } from '@sveltejs/kit';
import { isValidJoinCode, normalizeJoinCode } from './student-identity';

export const DEVICE_TEAM_COOKIE = 'fll-device-team';

/**
 * 400 days: the ceiling browsers now cap `Max-Age` at, so asking for more is
 * asking for a number that gets silently reduced. A season is nine months.
 */
export const DEVICE_TEAM_MAX_AGE = 400 * 24 * 60 * 60;

/**
 * `sameSite: 'lax'` because this cookie is only ever read on a top-level
 * navigation to this app's own login screen. `secure` follows the scheme so a
 * developer on http://localhost keeps working and production never sends it in
 * the clear.
 */
export function deviceTeamCookieOptions(secure: boolean) {
	return {
		path: '/',
		httpOnly: true,
		sameSite: 'lax' as const,
		secure,
		maxAge: DEVICE_TEAM_MAX_AGE
	};
}

/**
 * The join code this device remembers, or null.
 *
 * VALIDATED ON THE WAY OUT, not trusted because it came from a cookie. A cookie
 * is client-supplied input whatever flag it carries, and this one is handed
 * straight to a database function; anything that is not six symbols of the join
 * alphabet is treated as no memory at all.
 */
export function rememberedJoinCode(raw: string | undefined | null): string | null {
	if (!raw) return null;
	return isValidJoinCode(raw) ? normalizeJoinCode(raw) : null;
}

/**
 * Write the memory, but only when it actually changed.
 *
 * A `Set-Cookie` on every single response is a header on every page, every
 * navigation, for a value that changes about once a season. Comparing first
 * keeps it to the request where a child signed in on a device that had been
 * somewhere else.
 */
export function rememberDeviceTeam(cookies: Cookies, joinCode: string, secure: boolean): void {
	const next = normalizeJoinCode(joinCode);
	if (!isValidJoinCode(next)) return;
	if (rememberedJoinCode(cookies.get(DEVICE_TEAM_COOKIE)) === next) return;
	cookies.set(DEVICE_TEAM_COOKIE, next, deviceTeamCookieOptions(secure));
}

/** The escape. A shared iPad moves between teams, so this has to be one tap. */
export function forgetDeviceTeam(cookies: Cookies): void {
	cookies.delete(DEVICE_TEAM_COOKIE, { path: '/' });
}

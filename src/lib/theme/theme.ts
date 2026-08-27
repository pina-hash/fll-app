/**
 * THE GROUND IS A DEVICE SETTING WITH THREE STATES, RESOLVED IN ONE PLACE.
 *
 * `system` follows the operating system, `light` and `dark` override it. The
 * choice lives in localStorage, so it is PER DEVICE: the propped iPad on the
 * team table and a mentor's laptop are different rooms with different light,
 * and a preference synced between them would be wrong on one of them.
 *
 * WHY A SCRIPT RESOLVES IT AND NOT A MEDIA QUERY. The dark palette is
 * declared ONCE, on `:root[data-theme='dark']`. A `prefers-color-scheme`
 * copy of it would be a second statement of the same rule, and the two would
 * drift within a season. So the three-state preference is collapsed to a
 * concrete `light` or `dark` before first paint, by the blocking script in
 * src/app.html, and CSS only ever sees the concrete answer.
 *
 * The cost of that is that a browser with JavaScript disabled gets the light
 * ground whatever its system setting says. That is the fully measured default
 * ground, and this app does not run without JavaScript anyway: the student
 * runtime's write queue is IndexedDB, the live board is a realtime
 * subscription, and both clocks tick in the browser.
 *
 * THIS FILE IS PURE. It holds the storage key, the states, the resolver and
 * the exact source of the blocking script, so tests/theme-toggle.test.ts can
 * execute the real script against a stubbed browser rather than a copy of it.
 */

export const THEME_STORAGE_KEY = 'fll-theme';

/** What the user chose. */
export type ThemePreference = 'system' | 'light' | 'dark';
/** What that resolves to, which is the only thing CSS ever sees. */
export type Ground = 'light' | 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'] as const;

/** The attribute the palette keys on, and the one that remembers the choice. */
export const GROUND_ATTRIBUTE = 'data-theme';
export const PREFERENCE_ATTRIBUTE = 'data-theme-pref';

export function isThemePreference(value: unknown): value is ThemePreference {
	return value === 'system' || value === 'light' || value === 'dark';
}

/**
 * The three states collapsed to the two grounds.
 *
 * `system` RESOLVES TO DARK, NOT TO THE OPERATING SYSTEM, and that is the one
 * thing about this resolver that is not obvious. The dark ground IS the IDEA
 * identity: it is where the green ramp, the mint and the bone live, and a
 * child opening this app is meant to see green before they see anything else.
 * A device in light mode following its own setting would open the app on the
 * paper sheet, which is the PRINT ground and a deliberately quiet one.
 *
 * The light option has not gone anywhere. It is an explicit choice on the
 * toggle, it resolves to the paper ground, and it is the same ground a run
 * sheet prints on, so choosing it is a preview of the printout rather than a
 * second theme to maintain.
 */
export function resolveGround(preference: ThemePreference, systemPrefersDark: boolean): Ground {
	if (preference === 'light') return 'light';
	return 'dark';
}

/* What each option says on the toggle. Fourth-grade reading level: the
   students using this are nine. The labels say what the option DOES. `system` no longer follows the device,
   so calling it "Match my device" would be a sentence a nine-year-old could
   test and find untrue. It is the app's own ground, which is the green one. */
export const THEME_LABELS: Record<ThemePreference, string> = {
	system: 'App colours',
	light: 'Paper',
	dark: 'Dark'
};

export const THEME_SHORT_LABELS: Record<ThemePreference, string> = {
	system: 'App',
	light: 'Paper',
	dark: 'Dark'
};

/**
 * THE BLOCKING SCRIPT, VERBATIM, AS THE ONE COPY OF ITSELF.
 *
 * It is pasted into src/app.html inside the <head>, ABOVE everything, so it
 * runs while the document head is still parsing -- before the stylesheet has
 * been applied and long before the body exists. That is what makes there be
 * no flash of the wrong ground: the attribute the palette keys on is already
 * on <html> when the first pixel is painted.
 *
 * It is deliberately tiny, synchronous, dependency-free and wrapped in
 * try/catch: localStorage THROWS rather than returning null in a Safari
 * private window and under a "block all cookies" setting, and an exception
 * here would abort head parsing and take the whole page down. On any failure
 * it falls back to the light ground, which is the measured default.
 *
 * tests/theme-toggle.test.ts reads src/app.html, pulls this script out of it
 * and RUNS it against a stubbed document for all six combinations of the
 * three preferences and the two system settings, so app.html and this
 * constant cannot drift apart without something going red.
 */
export const THEME_BOOT_SCRIPT = `(function () {
	try {
		var stored = localStorage.getItem('fll-theme');
		var pref = stored === 'light' || stored === 'dark' ? stored : 'system';
		document.documentElement.setAttribute('data-theme', pref === 'light' ? 'light' : 'dark');
		document.documentElement.setAttribute('data-theme-pref', pref);
	} catch (e) {
		document.documentElement.setAttribute('data-theme', 'dark');
		document.documentElement.setAttribute('data-theme-pref', 'system');
	}
})();`;

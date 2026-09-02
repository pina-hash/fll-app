/**
 * Values shared by more than one route file.
 *
 * A leading underscore marks this as infrastructure rather than a route spec:
 * the loader in `../../routes.mjs` skips any `_`-prefixed file when it reads
 * this directory, the same escape hatch a SvelteKit `+server.ts` uses for a
 * non-route export. A route file imports from here with `./_shared.mjs`.
 */

/**
 * THE TWO WIDTHS EVERY CLAIM IN THIS REPO IS MEASURED AT.
 *
 * CLAUDE.md: "The Live Board is phone-first; every other console surface is
 * desktop-first master-detail. Both ends are checked regardless: a pass at
 * 1440px is not a pass at 375px." The student runtime is 375px first and the
 * console is 1440px first, so neither number is the primary one and both are
 * always run.
 */
export const WIDTHS = [375, 1440];

/**
 * THE GROUND IS SET ON THE ROOT BEFORE FIRST PAINT AND IS PER DEVICE.
 *
 * `src/app.html`'s blocking script reads `localStorage['fll-theme']` and
 * stamps `data-theme` on `<html>`; `resolveGround('system')` answers `dark`
 * whatever the device prefers (CLAUDE.md: "THE DEFAULT GROUND IS THE APP'S
 * OWN, NOT THE OPERATING SYSTEM"). So a harness run measures the DARK ground
 * unless it says otherwise, and a spec that wants the light one sets it in a
 * `prepare` step rather than by emulating `prefers-color-scheme`, which this
 * app deliberately ignores.
 *
 * The step writes the key AND stamps the attribute, because the blocking
 * script has already run by the time any step fires.
 */
export const setGround = (ground) => `() => {
	const g = ${JSON.stringify(ground)};
	try { localStorage.setItem('fll-theme', g); } catch {}
	document.documentElement.setAttribute('data-theme', g);
	return 'ground set to ' + g;
}`;

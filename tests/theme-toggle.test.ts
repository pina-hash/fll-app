/**
 * THE NO-FLASH PROOF, RUN RATHER THAN ASSERTED.
 *
 * "No flash of the wrong ground" is a claim about what is on <html> at the
 * moment the first pixel is painted. What makes it true is that a BLOCKING
 * script in the head of src/app.html has already stamped the attribute the
 * palette keys on. So this file does not read the source and nod at it: it
 * pulls that script out of app.html, runs it against a stubbed document,
 * localStorage and matchMedia, and checks the attribute it leaves behind for
 * every combination of the three preferences and the two system settings.
 *
 * It also asserts the script is where it has to be -- inside <head>, before
 * %sveltekit.head%, with no defer, async or type=module -- because each of
 * those would move it after first paint and the six behaviour cases would all
 * still pass.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
	GROUND_ATTRIBUTE,
	PREFERENCE_ATTRIBUTE,
	THEME_BOOT_SCRIPT,
	THEME_PREFERENCES,
	THEME_STORAGE_KEY,
	isThemePreference,
	resolveGround
} from '../src/lib/theme/theme';

const APP_HTML = readFileSync(fileURLToPath(new URL('../src/app.html', import.meta.url)), 'utf8');

/** Comments are stripped first: app.html explains itself at length, and a
 *  placeholder NAMED in a comment is not a placeholder in the document. */
const HEAD = APP_HTML.slice(APP_HTML.indexOf('<head>'), APP_HTML.indexOf('</head>')).replace(
	/<!--[\s\S]*?-->/g,
	''
);
const SCRIPT_OPEN = /<script(?<attrs>[^>]*)>/.exec(HEAD);
const SCRIPT_BODY = HEAD.slice(HEAD.indexOf('<script>') + '<script>'.length, HEAD.indexOf('</script>'));

/** Run the script from app.html against a browser that does not exist. */
function boot(options: {
	stored?: string | null;
	systemPrefersDark?: boolean;
	storageThrows?: boolean;
}): Record<string, string> {
	const attributes: Record<string, string> = {};
	const sandbox = {
		localStorage: {
			getItem(key: string) {
				if (options.storageThrows) throw new DOMException('denied', 'SecurityError');
				return key === THEME_STORAGE_KEY ? (options.stored ?? null) : null;
			}
		},
		window: {
			matchMedia(query: string) {
				return { matches: query.includes('dark') ? !!options.systemPrefersDark : false };
			}
		},
		document: {
			documentElement: {
				setAttribute(name: string, value: string) {
					attributes[name] = value;
				}
			}
		},
		DOMException
	};
	vm.createContext(sandbox);
	vm.runInContext(SCRIPT_BODY, sandbox);
	return attributes;
}

describe('the boot script is placed so that it runs before first paint', () => {
	it('is inside <head>', () => {
		expect(HEAD).toContain('<script>');
	});

	it('runs BEFORE %sveltekit.head%, so no stylesheet has been applied yet', () => {
		expect(HEAD.indexOf('<script>')).toBeLessThan(HEAD.indexOf('%sveltekit.head%'));
	});

	it('names neither SvelteKit placeholder anywhere except as itself', () => {
		// The placeholders are substituted by a plain string replace, comments
		// included, and the markup injected for the head carries comments of
		// its own -- whose closing delimiter ends any comment that named the
		// placeholder, spilling the rest of that comment onto the page as body
		// text. So each placeholder may appear exactly once in the file, as
		// the real thing.
		const count = (needle: string) => APP_HTML.split(needle).length - 1;
		expect(count('%sveltekit.head%'), 'the head placeholder appears more than once').toBe(1);
		expect(count('%sveltekit.body%'), 'the body placeholder appears more than once').toBe(1);
	});

	it('is blocking: no defer, no async, no type=module', () => {
		const attrs = SCRIPT_OPEN?.groups?.attrs ?? '';
		expect(attrs.trim(), 'the theme script must be a bare <script>').toBe('');
	});

	it('is the same script as THEME_BOOT_SCRIPT, whitespace aside', () => {
		const strip = (s: string) => s.replace(/\s+/g, ' ').trim();
		expect(strip(SCRIPT_BODY)).toBe(strip(THEME_BOOT_SCRIPT));
	});
});

describe('the ground it stamps, for every state the device can be in', () => {
	const cases: { stored: string | null; systemPrefersDark: boolean; ground: string; pref: string }[] =
		[
			// `system` NO LONGER FOLLOWS THE DEVICE. The dark ground IS the IDEA
			// identity, and a child opening this app is meant to see green before
			// they see anything else; a light-mode iPad following its own setting
			// would open on the paper sheet, which is the PRINT ground. Both rows
			// below therefore answer 'dark', and the control underneath is what
			// proves the explicit choices still override.
			{ stored: null, systemPrefersDark: false, ground: 'dark', pref: 'system' },
			{ stored: null, systemPrefersDark: true, ground: 'dark', pref: 'system' },
			{ stored: 'light', systemPrefersDark: false, ground: 'light', pref: 'light' },
			{ stored: 'light', systemPrefersDark: true, ground: 'light', pref: 'light' },
			{ stored: 'dark', systemPrefersDark: false, ground: 'dark', pref: 'dark' },
			{ stored: 'dark', systemPrefersDark: true, ground: 'dark', pref: 'dark' }
		];

	it.each(cases)(
		'stored=$stored systemPrefersDark=$systemPrefersDark -> $ground',
		({ stored, systemPrefersDark, ground, pref }) => {
			const attributes = boot({ stored, systemPrefersDark });
			expect(attributes[GROUND_ATTRIBUTE]).toBe(ground);
			expect(attributes[PREFERENCE_ATTRIBUTE]).toBe(pref);
		}
	);

	it('the control: an explicit choice still overrides the default', () => {
		// The default is now 'dark' whatever the device says, so the case that
		// carries weight is 'light': if the stored preference were ignored, every
		// row above would still pass and the toggle would be decoration.
		expect(boot({ stored: 'light', systemPrefersDark: true })[GROUND_ATTRIBUTE]).toBe('light');
		expect(boot({ stored: 'light', systemPrefersDark: false })[GROUND_ATTRIBUTE]).toBe('light');
		expect(boot({ stored: 'dark', systemPrefersDark: false })[GROUND_ATTRIBUTE]).toBe('dark');
	});

	it('a value nobody wrote is ignored rather than trusted', () => {
		const attributes = boot({ stored: 'midnight-neon', systemPrefersDark: false });
		// Falls back to `system`, which since the IDEA ground layer landed means
		// the app's own dark ground rather than the operating system's answer.
		expect(attributes[GROUND_ATTRIBUTE]).toBe('dark');
		expect(attributes[PREFERENCE_ATTRIBUTE]).toBe('system');
	});

	it('storage that THROWS still leaves a ground on the page', () => {
		// Safari in a private window, and any browser set to block site data,
		// throw from getItem rather than returning null. An exception here
		// would abort head parsing and take the page down with it.
		const attributes = boot({ storageThrows: true, systemPrefersDark: true });
		// The catch branch lands on the IDENTITY ground, not on paper. A device
		// that cannot remember still opens the app looking like the app.
		expect(attributes[GROUND_ATTRIBUTE]).toBe('dark');
		expect(attributes[PREFERENCE_ATTRIBUTE]).toBe('system');
	});
});

describe('the resolver the app and the script agree on', () => {
	it('resolves the three states the same way the boot script does', () => {
		for (const preference of THEME_PREFERENCES) {
			for (const systemPrefersDark of [false, true]) {
				const stored = preference === 'system' ? null : preference;
				expect(resolveGround(preference, systemPrefersDark)).toBe(
					boot({ stored, systemPrefersDark })[GROUND_ATTRIBUTE]
				);
			}
		}
	});

	it('only the three known preferences are accepted', () => {
		expect(THEME_PREFERENCES).toEqual(['system', 'light', 'dark']);
		for (const p of THEME_PREFERENCES) expect(isThemePreference(p)).toBe(true);
		for (const p of ['', 'auto', 'DARK', null, undefined, 0]) expect(isThemePreference(p)).toBe(false);
	});
});

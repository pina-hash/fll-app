/**
 * THE PREFERENCE, AS STATE. One instance per document, created lazily.
 *
 * It does not decide the ground at load: src/app.html already did, before
 * first paint. This reads back what the script decided so the toggle shows
 * the right option, and it owns the ground from then on.
 *
 * IT KEEPS LISTENING. Under `system` the operating system can change under
 * the app -- iPadOS switches at sunset, macOS on a schedule -- and a Friday
 * session runs 16:30 to 18:00, straight through it. The media-query listener
 * is what makes the board on the table follow the room instead of stopping
 * on whatever it was at 16:30.
 */
import { browser } from '$app/environment';
import {
	GROUND_ATTRIBUTE,
	PREFERENCE_ATTRIBUTE,
	THEME_STORAGE_KEY,
	isThemePreference,
	resolveGround,
	type Ground,
	type ThemePreference
} from './theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

class ThemeState {
	/** Starts at the server's answer and is corrected on mount from the
	 *  attribute the blocking script wrote. The GROUND never flickers either
	 *  way: nothing here paints it, the attribute already does. */
	preference = $state<ThemePreference>('system');
	systemPrefersDark = $state(false);

	get ground(): Ground {
		return resolveGround(this.preference, this.systemPrefersDark);
	}

	/** Reads back what src/app.html decided, then follows the system. */
	start(): () => void {
		if (!browser) return () => {};
		const stored = readStoredPreference();
		this.preference = stored;
		const media = window.matchMedia(DARK_QUERY);
		this.systemPrefersDark = media.matches;
		const onChange = (event: MediaQueryListEvent) => {
			this.systemPrefersDark = event.matches;
			this.apply();
		};
		media.addEventListener('change', onChange);
		this.apply();
		return () => media.removeEventListener('change', onChange);
	}

	set(preference: ThemePreference): void {
		this.preference = preference;
		if (!browser) return;
		try {
			// `system` is stored as an ABSENCE, not as the string "system": a
			// device that has never been told anything and a device told to
			// follow its system are the same device, and writing the word
			// would make "clear site data" mean something different from
			// "never chose".
			if (preference === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
			else localStorage.setItem(THEME_STORAGE_KEY, preference);
		} catch {
			// A private window refuses to store. The choice still applies for
			// this session; it just will not survive the tab.
		}
		this.apply();
	}

	/** The only writer of the two attributes after the boot script. */
	private apply(): void {
		if (!browser) return;
		document.documentElement.setAttribute(GROUND_ATTRIBUTE, this.ground);
		document.documentElement.setAttribute(PREFERENCE_ATTRIBUTE, this.preference);
	}
}

function readStoredPreference(): ThemePreference {
	try {
		const stored = localStorage.getItem(THEME_STORAGE_KEY);
		return isThemePreference(stored) ? stored : 'system';
	} catch {
		return 'system';
	}
}

let instance: ThemeState | null = null;

/** The document's theme state. One per document; the toggle appears once per
 *  surface but the setting is a property of the device, not of the screen. */
export function theme(): ThemeState {
	instance ??= new ThemeState();
	return instance;
}

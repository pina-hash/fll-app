/**
 * PINs THE MENTOR HAS SEEN, FOR AS LONG AS THIS TAB IS OPEN.
 *
 * A PIN is bcrypt-hashed into `auth.users.encrypted_password` the moment it is
 * minted (0004), so THE DATABASE CANNOT TELL YOU WHAT A STUDENT'S PIN IS. That
 * is the correct design and it is not going to change. The consequence is that
 * a printable roster card can only show a PIN that this browser tab watched
 * being created or reset.
 *
 * So: `student_create` and `student_reset_pin` hand the new PIN back exactly
 * once, and that value is parked in sessionStorage keyed by student id. The
 * roster and the printable card read it from there. sessionStorage, not
 * localStorage, deliberately: closing the tab is the end of it, and it never
 * travels to another tab, another window or another day.
 *
 * `forgetPins()` is the button that empties it early.
 */

const KEY = 'fll.console.pins';

function read(): Record<string, string> {
	if (typeof sessionStorage === 'undefined') return {};
	try {
		const raw = sessionStorage.getItem(KEY);
		const parsed = raw ? JSON.parse(raw) : null;
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
	} catch {
		return {};
	}
}

function write(map: Record<string, string>): void {
	if (typeof sessionStorage === 'undefined') return;
	try {
		sessionStorage.setItem(KEY, JSON.stringify(map));
	} catch {
		// A full or blocked sessionStorage costs a reprint, not a failure.
	}
}

export function rememberPin(studentId: string, pin: string): void {
	const map = read();
	map[studentId] = pin;
	write(map);
}

export function knownPins(): Record<string, string> {
	return read();
}

export function forgetPins(): void {
	if (typeof sessionStorage === 'undefined') return;
	sessionStorage.removeItem(KEY);
}

/**
 * A fresh 6-digit PIN. Six is GoTrue's minimum password length, which is why
 * 0004 fixed on it. `crypto.getRandomValues` rather than Math.random: this is
 * a credential, even a small one.
 */
export function mintPin(): string {
	const bytes = new Uint32Array(1);
	crypto.getRandomValues(bytes);
	return String(bytes[0] % 1_000_000).padStart(6, '0');
}

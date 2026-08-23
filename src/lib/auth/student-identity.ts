/**
 * The student's synthetic identity, as the CLIENT computes it.
 *
 * These are pure functions and they MIRROR the database: `studentEmail` must
 * produce byte-for-byte what `public._student_email(join_code, slug)` (0004)
 * produces, because the login screen builds the address from the join code the
 * student typed and the slug `team_login_roster` returned, and hands it to
 * signInWithPassword. tests/student-identity.test.ts holds the two together by
 * asking the database for the same value.
 *
 * Nothing here is a security boundary. The PIN is the secret; the address is
 * public knowledge to everyone on the team.
 */

/** The 32-symbol join-code alphabet: A-Z without O and I, 2-9 (no 0 or 1). */
export const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const JOIN_CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
const PIN_RE = /^[0-9]{6}$/;
const SLUG_RE = /^[a-z0-9]{1,48}$/;

/** Upper-cases and trims what the student typed. Does not validate. */
export function normalizeJoinCode(raw: string): string {
	return raw.trim().toUpperCase();
}

/** True for exactly six symbols of the join-code alphabet (after normalizing). */
export function isValidJoinCode(raw: string): boolean {
	return JOIN_CODE_RE.test(normalizeJoinCode(raw));
}

/** True for exactly six ASCII digits. GoTrue's 6-character minimum is why it is not 4. */
export function isValidPin(raw: string): boolean {
	return PIN_RE.test(raw);
}

/** True for the slug shape the database stores (0004's check constraint). */
export function isValidSlug(raw: string): boolean {
	return SLUG_RE.test(raw);
}

/**
 * The base of a login slug: lowercased first name + last initial, reduced to
 * [a-z0-9]. The database dedupes within a team by appending 2, 3, ...; the
 * client never derives a slug for login (it uses the one the roster returned),
 * so this exists for previews and tests only.
 */
export function slugBase(firstName: string, lastInitial: string): string {
	return (firstName.trim().toLowerCase() + lastInitial.trim().toLowerCase()).replace(/[^a-z0-9]/g, '');
}

/**
 * `{join_code lowercased}-{slug}@fll.invalid`. `.invalid` is the RFC 2606
 * reserved TLD: the address can never deliver, by definition.
 */
export function studentEmail(joinCode: string, slug: string): string {
	return `${normalizeJoinCode(joinCode).toLowerCase()}-${slug}@fll.invalid`;
}

/** "Alex P." for a roster tile. */
export function displayName(firstName: string, lastInitial: string): string {
	return `${firstName} ${lastInitial}.`;
}

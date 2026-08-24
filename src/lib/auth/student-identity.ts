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

// Built from the alphabet itself rather than written out a second time: a
// claim code has no shape of its own, it borrows this one. See the block
// comment on normalizeClaimCode for why that is not the same as being one.
const CLAIM_CODE_RE = new RegExp(`^[${JOIN_CODE_ALPHABET}]{6}$`);

/** Upper-cases and trims what the student typed. Does not validate. */
export function normalizeJoinCode(raw: string): string {
	return raw.trim().toUpperCase();
}

/** True for exactly six symbols of the join-code alphabet (after normalizing). */
export function isValidJoinCode(raw: string): boolean {
	return JOIN_CODE_RE.test(normalizeJoinCode(raw));
}

/**
 * A CLAIM CODE IS THE SAME SHAPE AS A JOIN CODE AND A DIFFERENT THING.
 *
 * A join code names a TEAM. It is on the roster card, everybody on that team
 * types it all season, and it stays live until a mentor regenerates it. A
 * claim code names ONE SEAT on one team: a mentor hands it to one child on one
 * card, it is spent once, and it stops working the second it is spent. The
 * login screen calls it a SEAT code, because that is the word a nine-year-old
 * can act on.
 *
 * They share the 32 symbols because they share the room. `_generate_claim_code`
 * (0019) draws from the same alphabet `_generate_join_code` (0001) does: a code
 * is read aloud across a noisy room and typed by a nine-year-old on an iPad, so
 * a character that is two characters depending on the font is a support call.
 * O and 0, I and 1 are out of both.
 *
 * They are two pairs of functions here rather than one because the login screen
 * asks two different questions with them -- "which team is this" and "which
 * seat is this" -- and only the alphabet is promised to stay shared. Neither
 * pair says whether a code is LIVE, only whether it is the right shape: which
 * team a code belongs to, whether a seat has been spent, voided or is still
 * waiting for its child is the database's answer and `student_claim_seat` is
 * the one that gives it.
 */

/** Upper-cases and trims what the student typed off their card. Does not validate. */
export function normalizeClaimCode(raw: string): string {
	return raw.trim().toUpperCase();
}

/** True for exactly six symbols of the shared alphabet (after normalizing). */
export function isValidClaimCode(raw: string): boolean {
	return CLAIM_CODE_RE.test(normalizeClaimCode(raw));
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

/**
 * The TEAM BOARD device's address: `{join_code lowercased}-board.device@fll.invalid`.
 * Mirrors `public._board_email(join_code)` (0010).
 *
 * The dot in `board.device` is deliberate. A student slug is `[a-z0-9]` only
 * (0004), so no roster, however it is named, can ever produce this address.
 */
export function boardEmail(joinCode: string): string {
	return `${normalizeJoinCode(joinCode).toLowerCase()}-board.device@fll.invalid`;
}

/** "Alex P." for a roster tile. */
export function displayName(firstName: string, lastInitial: string): string {
	return `${firstName} ${lastInitial}.`;
}

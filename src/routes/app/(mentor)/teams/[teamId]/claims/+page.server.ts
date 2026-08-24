import { error } from '@sveltejs/kit';
import { parseRosterState } from '$lib/console/roster';
import type { PageServerLoad } from './$types';

/**
 * THE SEAT CARDS: one claim code per seat, minted by a mentor and spent once
 * by the child holding the card.
 *
 * WHAT REPLACED THE JOIN WINDOW. Sign-ups used to be a window a mentor opened
 * and the room typed itself in through; a seat is now a card, and the card is
 * the whole permission. That means the console has a thing to print and a
 * thing to take back, which a window never had.
 *
 * THE LIST IS ONE RPC, NOT A SELECT. `team_claim_codes` (0019) states what a
 * seat's STATE is -- open, claimed, voided -- as a case over two timestamps,
 * and joins the child who spent it. Deriving that here from raw rows would be
 * the second implementation of a rule that already lives in SQL, and it would
 * disagree with `team_roster_state` the first time somebody voids a card in
 * another tab.
 *
 * THE SEAT COUNTS COME FROM `team_roster_state`, THE SAME PLACE THE TEAM PAGE
 * READS THEM. "Seats left" is the cap minus the students on the roster minus
 * the cards nobody has spent yet, and that subtraction is stated once.
 *
 * A CLAIM CODE IS NOT A PIN. It authenticates nobody: it is a one-time
 * permission to take a seat, readable by mentors, printable, and dead the
 * moment it is spent or voided. That is why this page may show it at all,
 * and why voiding is one tap.
 */

export type ClaimState = 'open' | 'claimed' | 'voided';

export interface ClaimRow {
	claim_id: string;
	code: string;
	state: ClaimState;
	created_at: string | null;
	claimed_at: string | null;
	voided_at: string | null;
	student_id: string | null;
	first_name: string | null;
	last_initial: string | null;
}

function obj(v: unknown): Record<string, unknown> | null {
	return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function str(v: unknown): string {
	return typeof v === 'string' ? v : '';
}
function maybeStr(v: unknown): string | null {
	return typeof v === 'string' && v.length > 0 ? v : null;
}
function state(v: unknown): ClaimState {
	return v === 'claimed' || v === 'voided' ? v : 'open';
}

/** An empty list for a payload that is not one, including the "not a mentor" empty. */
function parseClaims(raw: unknown): ClaimRow[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.map((row): ClaimRow | null => {
			const r = obj(row);
			const id = r && maybeStr(r.claim_id);
			if (!r || !id) return null;
			return {
				claim_id: id,
				code: str(r.code),
				state: state(r.state),
				created_at: maybeStr(r.created_at),
				claimed_at: maybeStr(r.claimed_at),
				voided_at: maybeStr(r.voided_at),
				student_id: maybeStr(r.student_id),
				first_name: maybeStr(r.first_name),
				last_initial: maybeStr(r.last_initial)
			};
		})
		.filter((row): row is ClaimRow => row !== null);
}

export const load: PageServerLoad = async ({ params, url, locals: { supabase } }) => {
	const [teamRes, claimsRes, stateRes] = await Promise.all([
		supabase
			.from('teams')
			.select('id, name, short_name, join_code, accent, fll_team_number')
			.eq('id', params.teamId)
			.maybeSingle(),
		supabase.rpc('team_claim_codes', { p_team_id: params.teamId }),
		supabase.rpc('team_roster_state')
	]);

	if (!teamRes.data) error(404, 'No such team.');

	const states = parseRosterState(stateRes.data);

	return {
		team: teamRes.data,
		claims: parseClaims(claimsRes.data),
		claimsError: claimsRes.error?.message ?? null,
		rosterState: states.find((s) => s.team_id === params.teamId) ?? null,
		// The address a child types, without its scheme: shorter to read off
		// paper, and every phone keyboard puts the https back.
		loginAddress: `${url.origin.replace(/^https?:\/\//, '')}/login`
	};
};

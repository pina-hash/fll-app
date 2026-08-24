import { error } from '@sveltejs/kit';
import { parentUrl, qrSvg } from '$lib/parent/qr';
import type { PageServerLoad } from './$types';

/**
 * THE PARENT CARDS: one printable card per student, with the link and a QR
 * code, to hand to a parent at pickup.
 *
 * THE QR IS RENDERED HERE, ON THE SERVER, ONCE. It is a deterministic function
 * of the URL, so computing it in the browser would just be the same work done
 * later on a slower machine, and rendering it server-side means the print
 * dialog never races a client-side draw.
 *
 * THE TOKEN IS SELECTED, DELIBERATELY. Unlike a PIN -- which is bcrypt from
 * the moment it is set and can only ever be shown once (0004, and the roster
 * card's whole apology) -- a parent link is a capability a mentor must be able
 * to reprint in March for a parent who lost the card in October. 0014's RLS
 * lets mentors and nobody else read `token`, which is what makes this page
 * possible and also what keeps it from being a leak.
 */
export const load: PageServerLoad = async ({ params, url, locals: { supabase } }) => {
	const [teamRes, studentsRes, linksRes] = await Promise.all([
		supabase
			.from('teams')
			.select('id, name, join_code, accent, fll_team_number')
			.eq('id', params.teamId)
			.maybeSingle(),
		supabase
			.from('students')
			.select('id, first_name, last_initial, grade')
			.eq('team_id', params.teamId)
			.is('deactivated_at', null)
			.order('first_name')
			.order('last_initial'),
		supabase
			.from('student_parent_access')
			.select('student_id, token, issued_at, revoked_at, open_count')
			.eq('team_id', params.teamId)
	]);

	if (!teamRes.data) error(404, 'No such team.');

	const links = new Map((linksRes.data ?? []).map((row) => [row.student_id, row]));

	return {
		team: teamRes.data,
		cards: (studentsRes.data ?? []).map((student) => {
			const link = links.get(student.id);
			const live = link && !link.revoked_at ? link : null;
			const href = live ? parentUrl(url.origin, live.token) : null;
			return {
				student,
				href,
				// The printed URL without its scheme: shorter to read off paper,
				// and every phone keyboard adds the https back.
				display: href ? href.replace(/^https?:\/\//, '') : null,
				qr: href ? qrSvg(href) : null,
				openCount: live?.open_count ?? 0,
				revoked: Boolean(link?.revoked_at)
			};
		})
	};
};

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** A signed-in user with a seat has no business on the login screen. */
export const load: PageServerLoad = async ({ locals: { principal }, url }) => {
	if (principal) redirect(303, safeNext(url.searchParams.get('next')));
	return { next: safeNext(url.searchParams.get('next')) };
};

/** Only same-origin paths; never an absolute URL somebody pasted into the query. */
function safeNext(raw: string | null): string {
	if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/app';
	return raw;
}

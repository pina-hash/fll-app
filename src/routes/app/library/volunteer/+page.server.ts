import { redirect } from '@sveltejs/kit';

// The guide is public at /volunteer so a volunteer needs no sign-in.
export const load = () => redirect(308, '/volunteer');

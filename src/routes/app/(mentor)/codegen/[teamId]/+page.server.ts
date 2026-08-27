import { error } from '@sveltejs/kit';
import { loadCodegenData } from '$lib/codegen/storage';
import type { PageServerLoad } from './$types';

/**
 * One team's code generator, mentor side. Same shape as the planner's
 * `[teamId]` load, and the same two boundaries: the (mentor) group's layout has
 * already answered 403 to anyone who is not a mentor, and RLS repeats the
 * answer for every row underneath.
 *
 * THE GATE IS HERE, AT THE LOAD, NOT ONLY IN THE MARKUP. A team that does not
 * exist, or one that has been archived, is a 404 from this function, before any
 * component is chosen and before any prop is built. A page that renders and
 * then decides what to show has already leaked the shape of what it decided
 * about, and a mentor who bookmarked an archived team should be told so rather
 * than handed an empty form pointed at a row nobody can write.
 *
 * WHAT IS NOT GATED HERE IS WHETHER THIS MENTOR MAY WRITE, because that is
 * `strategy_can_edit()`'s answer and not this route's. It comes back from the
 * write itself, as a refusal naming who can. An affordance that predicts
 * enforcement is an affordance that can disagree with it.
 */
export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	const [teamRes, teamsRes] = await Promise.all([
		supabase
			.from('teams')
			.select('id, name, accent')
			.eq('id', params.teamId)
			.is('archived_at', null)
			.maybeSingle(),
		supabase.from('teams').select('id, name, accent').is('archived_at', null).order('name')
	]);

	if (!teamRes.data) error(404, 'No such team.');

	return {
		team: teamRes.data,
		teams: teamsRes.data ?? [],
		codegen: await loadCodegenData(supabase, teamRes.data.id)
	};
};

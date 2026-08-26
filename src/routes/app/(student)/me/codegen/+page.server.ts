import { error } from '@sveltejs/kit';
import { loadCodegenData } from '$lib/codegen/storage';
import type { PageServerLoad } from './$types';

/**
 * THE CODE GENERATOR, student side. Same shape as the route planner's load:
 * no team id in the URL, because a student generates for their own team and
 * there is nothing to change that to, and every read is scoped by RLS to
 * current_student_team_id() rather than by the eq() filter inside.
 *
 * Whether this student may SAVE is the database's answer (strategy_can_edit,
 * the same rule the planner uses), and it is discovered by asking for the row
 * back from the write rather than by predicting it here: an affordance that
 * predicts enforcement is an affordance that can disagree with it.
 *
 * GENERATING needs neither a row nor a role. The emitter runs in the browser
 * over whatever is in the form, so a team with nothing saved still gets a
 * toolkit, and a team whose database has not had 0024 applied still gets one.
 */
export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
	const { student } = await parent();
	if (!student) error(403, 'This screen is for students.');

	return { codegen: await loadCodegenData(supabase, student.teamId) };
};

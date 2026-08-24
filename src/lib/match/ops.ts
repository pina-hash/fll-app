/**
 * MATCH RUN WRITE OPS: how one logged practice run becomes PostgREST calls,
 * and how the answers are judged. The WriteQueue delegates every match op
 * here, exactly as it delegates planner ops to $lib/planner/ops.
 *
 * A RUN IS LOGGED AT THE MAT, WHICH IS THE WORST PLACE FOR WIFI. That is the
 * whole reason it goes through the queue rather than straight down the wire:
 * the run is on the device's disk before anything is attempted, and it stays
 * there until the server has actually taken it. A gym with no signal must cost
 * a team nothing.
 *
 * ONE RUN IS ONE OP, AND REPLAYING IT IS A NO-OP. `match_run_log` writes the
 * run, then its launches, then its scoring lines, every row carrying an id
 * this device minted. A replay after a half-landed attempt therefore collides
 * on the primary key, which classifyPostgrest counts as success, so the second
 * attempt fills in exactly the rows the first one missed. Splitting it into
 * three queued ops would let a run exist with no score, which is worse than
 * either extreme.
 *
 * THE ZERO-ROWS RULE APPLIES HERE TOO. An UPDATE or DELETE that RLS filters
 * comes back 204 with no error, so every one asks for its rows back and probes
 * when it gets none: still visible means refused, gone means already done.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/database.types';
import { classifyPostgrest, type ApplyResult } from '$lib/student/postgrest';

type Client = SupabaseClient<Database>;

export interface MatchRunLaunchDraft {
	/** Client-minted; the row's primary key. */
	id: string;
	launchId: string | null;
	name: string;
	attempted: boolean;
	sortOrder: number;
}

export interface MatchRunScoreDraft {
	id: string;
	missionId: string;
	lineIndex: number;
	quantity: number;
}

export type MatchOp =
	| {
			kind: 'match_run_log';
			runId: string;
			teamId: string;
			strategyId: string | null;
			startedAt: string;
			elapsedS: number | null;
			note: string;
			loggedByStudentId: string | null;
			loggedByMentorId: string | null;
			launches: MatchRunLaunchDraft[];
			lines: MatchRunScoreDraft[];
	  }
	| { kind: 'match_run_note'; runId: string; note: string }
	| { kind: 'match_run_delete'; runId: string };

const MATCH_KINDS = new Set(['match_run_log', 'match_run_note', 'match_run_delete']);

export function isMatchOp(op: { kind: string }): op is MatchOp {
	return MATCH_KINDS.has(op.kind);
}

const REFUSED = 'The server did not accept this run.';

export async function applyMatchOp(sb: Client, op: MatchOp): Promise<ApplyResult> {
	try {
		if (op.kind === 'match_run_log') {
			const run = await sb.from('match_runs').insert({
				id: op.runId,
				team_id: op.teamId,
				strategy_id: op.strategyId,
				started_at: op.startedAt,
				elapsed_s: op.elapsedS,
				note: op.note,
				logged_by_student_id: op.loggedByStudentId,
				logged_by_mentor_id: op.loggedByMentorId
			});
			const runResult = classifyPostgrest(run.error);
			if (runResult !== 'done') return runResult;

			if (op.launches.length > 0) {
				const launches = await sb.from('match_run_launches').insert(
					op.launches.map((l) => ({
						id: l.id,
						run_id: op.runId,
						team_id: op.teamId,
						launch_id: l.launchId,
						name: l.name,
						attempted: l.attempted,
						sort_order: l.sortOrder
					}))
				);
				const result = classifyPostgrest(launches.error);
				if (result !== 'done') return result;
			}

			if (op.lines.length > 0) {
				const lines = await sb.from('match_run_scores').insert(
					op.lines.map((s) => ({
						id: s.id,
						run_id: op.runId,
						team_id: op.teamId,
						mission_id: s.missionId,
						line_index: s.lineIndex,
						quantity: s.quantity
					}))
				);
				const result = classifyPostgrest(lines.error);
				if (result !== 'done') return result;
			}
			return 'done';
		}

		if (op.kind === 'match_run_note') {
			const res = await sb.from('match_runs').update({ note: op.note }).eq('id', op.runId).select('id');
			if (res.error) return classifyPostgrest(res.error);
			if ((res.data ?? []).length > 0) return 'done';
			// Zero rows: refused, or the run is gone (somebody deleted it, and
			// there is nothing left to annotate either way).
			const probe = await sb.from('match_runs').select('id').eq('id', op.runId).maybeSingle();
			if (probe.error) return classifyPostgrest(probe.error);
			return probe.data ? { message: REFUSED } : 'done';
		}

		const res = await sb.from('match_runs').delete().eq('id', op.runId).select('id');
		if (res.error) return classifyPostgrest(res.error);
		if ((res.data ?? []).length > 0) return 'done';
		const probe = await sb.from('match_runs').select('id').eq('id', op.runId).maybeSingle();
		if (probe.error) return classifyPostgrest(probe.error);
		return probe.data ? { message: REFUSED } : 'done';
	} catch {
		// fetch threw: the request never reached the server.
		return 'transient';
	}
}

/**
 * PLANNER WRITE OPS: how one queued route-planner edit becomes one PostgREST
 * call, and how the answer is judged. The WriteQueue delegates every planner
 * op kind here, and the offline-replay tests drive this function directly
 * with a real signed-in client, so the code path under test is the code path
 * the app runs.
 *
 * THE RULE THIS FILE EXISTS TO HONOR: an RLS-filtered write is NOT an error.
 * An UPDATE or DELETE whose rows RLS excludes comes back 204 with zero rows
 * and error === null, and a client that reports success from the absence of
 * an error tells a student their plan saved when it did not. So every update
 * asks for its rows back and treats an empty answer as a refusal -- unless
 * the target row is genuinely gone, which for a replayed edit is the
 * idempotency working. A zero-row DELETE probes the same way: if the row is
 * still visible the delete was refused; if it is not, it is already done.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/database.types';
import type { TablesInsert, TablesUpdate } from '$lib/supabase/database.types';
import { classifyPostgrest, isDuplicate, type ApplyResult } from '$lib/student/postgrest';

type Client = SupabaseClient<Database>;

/** The four strategy tables the planner writes as plain rows. */
export type PlannerTable = 'strategies' | 'launches' | 'launch_missions' | 'waypoints';

export type PlannerOp =
	| { kind: 'planner_insert'; table: PlannerTable; row: Record<string, unknown> }
	| { kind: 'planner_update'; table: PlannerTable; id: string; patch: Record<string, unknown> }
	| { kind: 'planner_delete'; table: PlannerTable; id: string }
	/** A mentor dragging a mission marker; writes missions.position_x_mm/_y_mm.
	 * Null clears the placement (the undo of a first placement). */
	| { kind: 'mission_position'; missionId: string; xMm: number | null; yMm: number | null }
	/** Upsert of the team's robot profile on its natural key (team_id). */
	| { kind: 'robot_profile'; teamId: string; row: Record<string, unknown> }
	/** A mentor setting the launch area rectangle on the mat_config singleton. */
	| { kind: 'mat_setup'; patch: { launch_area_w_mm?: number | null; launch_area_h_mm?: number | null } };

const PLANNER_KINDS = new Set([
	'planner_insert',
	'planner_update',
	'planner_delete',
	'mission_position',
	'robot_profile',
	'mat_setup'
]);

export function isPlannerOp(op: { kind: string }): op is PlannerOp {
	return PLANNER_KINDS.has(op.kind);
}

/** Typed builders so call sites keep the generated row types. */
export function plannerInsert<T extends PlannerTable>(table: T, row: TablesInsert<T>): PlannerOp {
	return { kind: 'planner_insert', table, row: row as Record<string, unknown> };
}
export function plannerUpdate<T extends PlannerTable>(table: T, id: string, patch: TablesUpdate<T>): PlannerOp {
	return { kind: 'planner_update', table, id, patch: patch as Record<string, unknown> };
}
export function plannerDelete(table: PlannerTable, id: string): PlannerOp {
	return { kind: 'planner_delete', table, id };
}

const REFUSED = 'The server did not accept this change.';

type WriteBack = {
	error: { code?: string | null; message?: string } | null;
	data: { id: string }[] | null;
};

/**
 * Zero rows back from a write is ambiguous: the row may be gone (a replay, or
 * someone else deleted it -- nothing left to save) or RLS may have filtered
 * the write (a refusal that must be SHOWN). Probing the row through the
 * caller's own read policies tells the two apart: still visible means
 * refused.
 */
async function judgeWrite(
	sb: Client,
	table: PlannerTable | 'missions',
	id: string,
	res: WriteBack,
	zeroRowsWhenGone: 'done' | { message: string }
): Promise<ApplyResult> {
	if (res.error) return classifyPostgrest(res.error);
	if ((res.data ?? []).length > 0) return 'done';
	const probe = await sb.from(table).select('id').eq('id', id).maybeSingle();
	if (probe.error) return classifyPostgrest(probe.error);
	return probe.data ? { message: REFUSED } : zeroRowsWhenGone;
}

/**
 * Applies one planner op. Returns 'done' when the server holds the edit (or
 * provably already held it), 'transient' when the request never reached the
 * server, and a message when the server refused.
 */
export async function applyPlannerOp(sb: Client, op: PlannerOp): Promise<ApplyResult> {
	try {
		if (op.kind === 'planner_insert') {
			// A refused insert ERRORS (42501 / with-check violation); a replayed
			// insert is a duplicate key, which classifyPostgrest counts as done.
			const { error } = await sb.from(op.table).insert(op.row as never);
			return classifyPostgrest(error);
		}

		if (op.kind === 'planner_update') {
			const res = await sb
				.from(op.table)
				.update(op.patch as never)
				.eq('id', op.id)
				.select('id');
			return judgeWrite(sb, op.table, op.id, res, 'done');
		}

		if (op.kind === 'planner_delete') {
			const res = await sb.from(op.table).delete().eq('id', op.id).select('id');
			// Zero rows with the row gone is a delete that already happened.
			return judgeWrite(sb, op.table, op.id, res, 'done');
		}

		if (op.kind === 'mission_position') {
			const res = await sb
				.from('missions')
				.update({ position_x_mm: op.xMm, position_y_mm: op.yMm })
				.eq('id', op.missionId)
				.select('id');
			return judgeWrite(sb, 'missions', op.missionId, res, 'done');
		}

		if (op.kind === 'robot_profile') {
			// Update on the natural key first; insert the row if the team has no
			// profile yet. A concurrent insert makes ours a duplicate, so the
			// update is retried once and its answer stands.
			const { id: _id, team_id: _teamId, ...patch } = op.row as { id?: unknown; team_id?: unknown };
			const upd = await sb.from('team_robots').update(patch as never).eq('team_id', op.teamId).select('id');
			if (upd.error) return classifyPostgrest(upd.error);
			if ((upd.data ?? []).length > 0) return 'done';
			const ins = await sb.from('team_robots').insert(op.row as never);
			if (!ins.error) return 'done';
			if (isDuplicate(ins.error)) {
				const retry = await sb.from('team_robots').update(patch as never).eq('team_id', op.teamId).select('id');
				if (retry.error) return classifyPostgrest(retry.error);
				// The row provably exists (our insert collided), so zero rows back
				// can only be a refusal.
				return (retry.data ?? []).length > 0 ? 'done' : { message: REFUSED };
			}
			return classifyPostgrest(ins.error);
		}

		// mat_setup: the singleton always exists, so zero rows is a refusal.
		const res = await sb.from('mat_config').update(op.patch).eq('id', true).select('id');
		if (res.error) return classifyPostgrest(res.error);
		return (res.data ?? []).length > 0 ? 'done' : { message: REFUSED };
	} catch {
		// fetch threw: the request never reached the server.
		return 'transient';
	}
}

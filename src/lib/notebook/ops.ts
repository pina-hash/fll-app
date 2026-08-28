/**
 * NOTEBOOK WRITE OPS: how one queued notebook edit becomes one PostgREST
 * call, and how the answer is judged. The WriteQueue delegates every notebook
 * op here, exactly as it delegates planner ops to $lib/planner/ops, and the
 * offline-replay test drives this function directly against the real stack.
 *
 * A notebook entry is a child's own words, written in a room whose wifi
 * drops: it goes to IndexedDB before the wire, replays with a client-minted
 * id so a retry collides instead of duplicating, and honors the repo's
 * zero-rows rule -- an UPDATE that RLS filtered comes back 204 with no error,
 * so every update asks for its rows back and probes when it gets none: still
 * visible means refused (SHOW it), gone means already done.
 *
 * A REFUSAL IS A SENTENCE, NEVER A SQLSTATE. Two shapes reach a child here.
 * An RLS-filtered write comes back 204 with no rows and no error, which is
 * why every update below asks for its rows back; the sentence for that case
 * is REFUSED, and it names what to do next because "42501" does not. A
 * trigger refusal (the recap confirm gate, 0026) comes back as a real error
 * whose MESSAGE is already a sentence this schema wrote on purpose, so
 * classifyPostgrest passes it through untouched rather than replacing it with
 * something vaguer.
 *
 * DELETING A PAGE IS A SOFT DELETE (0020), AND IT IS AN RPC, NOT A DELETE.
 * `notebook_entry_delete` stamps `deleted_at`, the read policy stops showing
 * the row, and `notebook_entry_restore` puts it back -- which is what makes
 * the ten-second undo in Notebook.svelte and the mentor's bin possible at
 * all. Both RPCs REFUSE a second attempt ("already in the bin", "not in the
 * bin"), so a replay whose answer was lost on the wire would otherwise be
 * shown to a child as a failure. The same probe as above tells the two
 * apart: the read policy hides a deleted row, so whether the entry is still
 * visible answers "did my delete land" without trusting the error text.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, TablesInsert, TablesUpdate } from '$lib/supabase/database.types';
import { classifyPostgrest, type ApplyResult } from '$lib/student/postgrest';

type Client = SupabaseClient<Database>;

export type NotebookOp =
	| { kind: 'notebook_insert'; row: Record<string, unknown> }
	| { kind: 'notebook_update'; id: string; patch: Record<string, unknown> }
	/** Soft delete via notebook_entry_delete (0020); the row stays, stamped. */
	| { kind: 'notebook_delete'; id: string }
	/** The undo, and the mentor's bin: notebook_entry_restore (0020). */
	| { kind: 'notebook_restore'; id: string }
	/** A recap edit: the summary text, which anyone on the team may write, or
	 * the confirmed flag, which only the Notebook and Values Lead and mentors
	 * may move (notebook_can_confirm, 0026, enforced by a BEFORE UPDATE
	 * trigger that raises a sentence). confirmed_at and the confirmed_by
	 * columns are server-stamped and carry no grant. */
	| { kind: 'recap_update'; id: string; patch: { summary?: string; confirmed?: boolean } };

const NOTEBOOK_KINDS = new Set([
	'notebook_insert',
	'notebook_update',
	'notebook_delete',
	'notebook_restore',
	'recap_update'
]);

export function isNotebookOp(op: { kind: string }): op is NotebookOp {
	return NOTEBOOK_KINDS.has(op.kind);
}

/** Typed builders so call sites keep the generated row types. */
export function notebookInsert(row: TablesInsert<'notebook_entries'>): NotebookOp {
	return { kind: 'notebook_insert', row: row as Record<string, unknown> };
}
export function notebookUpdate(id: string, patch: TablesUpdate<'notebook_entries'>): NotebookOp {
	return { kind: 'notebook_update', id, patch: patch as Record<string, unknown> };
}
export function notebookDelete(id: string): NotebookOp {
	return { kind: 'notebook_delete', id };
}
export function notebookRestore(id: string): NotebookOp {
	return { kind: 'notebook_restore', id };
}
export function recapUpdate(id: string, patch: { summary?: string; confirmed?: boolean }): NotebookOp {
	return { kind: 'recap_update', id, patch };
}

/**
 * The sentence for a write RLS filtered while the row is still readable. 0026
 * left NO caller in that position on these two tables (reading the notebook
 * and writing it are now the same permission), so this branch is currently
 * unreachable in the app and is kept rather than deleted: it is the honest
 * answer the moment any notebook rule narrows again, and the alternative is
 * reporting a silent success. It names what to do next, because "42501" does
 * not.
 */
const REFUSED =
	'The server did not save that. Try again in a minute, and tell a mentor if it keeps happening.';

type WriteBack = {
	error: { code?: string | null; message?: string } | null;
	data: { id: string }[] | null;
};

/**
 * Zero rows back from a write is ambiguous: the row may be gone (a replay, or
 * someone deleted it) or RLS may have filtered the write (a refusal that must
 * be SHOWN). Probing through the caller's own read policies tells the two
 * apart: still visible means refused.
 */
async function judgeWrite(
	sb: Client,
	table: 'notebook_entries' | 'meeting_recaps',
	id: string,
	res: WriteBack
): Promise<ApplyResult> {
	if (res.error) return classifyPostgrest(res.error);
	if ((res.data ?? []).length > 0) return 'done';
	const probe = await sb.from(table).select('id').eq('id', id).maybeSingle();
	if (probe.error) return classifyPostgrest(probe.error);
	return probe.data ? { message: REFUSED } : 'done';
}

/**
 * Judges a soft delete or a restore. The RPC's own error sentence is the one
 * a child reads (this schema raises sentences, not codes), but only after the
 * entry itself has been asked: the read policy hides a deleted row, so
 * `visible` is the whole answer to "which state is it in now". `wantVisible`
 * is what the op was trying to achieve -- false for a delete, true for a
 * restore -- and reaching it, however it got there, is success.
 */
async function judgeSoftDelete(
	sb: Client,
	id: string,
	error: { code?: string | null; message?: string } | null,
	wantVisible: boolean
): Promise<ApplyResult> {
	if (!error) return 'done';
	const verdict = classifyPostgrest(error);
	// A request that never reached the server stays queued and is retried.
	if (verdict === 'transient') return 'transient';
	const probe = await sb.from('notebook_entries').select('id').eq('id', id).maybeSingle();
	if (probe.error) return classifyPostgrest(probe.error);
	const visible = probe.data !== null;
	return visible === wantVisible ? 'done' : verdict;
}

/**
 * Applies one notebook op. 'done' when the server holds the edit (or provably
 * already held it), 'transient' when the request never reached the server,
 * and a message when the server refused.
 */
export async function applyNotebookOp(sb: Client, op: NotebookOp): Promise<ApplyResult> {
	try {
		if (op.kind === 'notebook_insert') {
			// A refused insert ERRORS (42501 / with-check violation); a replayed
			// insert is a duplicate key, which classifyPostgrest counts as done.
			const { error } = await sb.from('notebook_entries').insert(op.row as never);
			return classifyPostgrest(error);
		}

		if (op.kind === 'notebook_update') {
			const res = await sb
				.from('notebook_entries')
				.update(op.patch as never)
				.eq('id', op.id)
				.select('id');
			return judgeWrite(sb, 'notebook_entries', op.id, res);
		}

		if (op.kind === 'notebook_delete') {
			const { error } = await sb.rpc('notebook_entry_delete', { p_entry_id: op.id });
			return judgeSoftDelete(sb, op.id, error, false);
		}

		if (op.kind === 'notebook_restore') {
			const { error } = await sb.rpc('notebook_entry_restore', { p_entry_id: op.id });
			return judgeSoftDelete(sb, op.id, error, true);
		}

		// recap_update. A recap is generated by the server, never inserted by a
		// client, so a gone row means the meeting itself was deleted: nothing
		// left to annotate, and nothing to scare a child with.
		const res = await sb
			.from('meeting_recaps')
			.update(op.patch)
			.eq('id', op.id)
			.select('id');
		return judgeWrite(sb, 'meeting_recaps', op.id, res);
	} catch {
		// fetch threw: the request never reached the server.
		return 'transient';
	}
}

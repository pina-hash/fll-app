/**
 * How a PostgREST answer is classified for replay. Shared by the write queue
 * and the planner ops so the transient-versus-permanent rule (see
 * queue.svelte.ts's header) has exactly one implementation.
 */

/** Postgres says "you already have this row". For a replay that is success. */
export const DUPLICATE = '23505';

export type ApplyResult = 'done' | 'transient' | { message: string };

/** A SQLSTATE from Postgres means the server decided; anything else is the wire. */
export function isPermanent(error: { code?: string | null; message?: string } | null): boolean {
	const code = error?.code ?? '';
	return /^[0-9A-Z]{5}$/.test(code) && code !== DUPLICATE;
}

export function isDuplicate(error: { code?: string | null } | null): boolean {
	return error?.code === DUPLICATE;
}

export function classifyPostgrest(
	error: { code?: string | null; message?: string } | null
): ApplyResult {
	if (!error) return 'done';
	if (isDuplicate(error)) return 'done';
	if (isPermanent(error)) return { message: error.message ?? 'The server refused this.' };
	return 'transient';
}

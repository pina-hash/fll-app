/**
 * A refetch that cannot take the screen away from a student.
 *
 * WHY THIS EXISTS, MEASURED. Calling `invalidateAll()` with the connection
 * down re-runs the server load, that request never lands, and SvelteKit falls
 * back to a full document reload. On a phone in a room whose wifi just dropped
 * that means the student's screen goes white and comes back empty, losing the
 * one thing this runtime promises to keep. It was reproduced by severing
 * `window.fetch` and tapping Done.
 *
 * So: never refetch while we know we are offline, and never let a refetch
 * failure escape. The queue is the source of truth for what this device did;
 * the server catches up when it can.
 */
import { invalidateAll } from '$app/navigation';

/**
 * Whether the SERVER is reachable, which is not the same question as
 * `navigator.onLine`. A phone joined to an access point with no uplink says it
 * is online; the write queue is the only thing that actually knows, because it
 * is the only thing that has tried. It sets this.
 */
let reachable = true;

export function setReachable(next: boolean): void {
	reachable = next;
}

export function isReachable(): boolean {
	return reachable;
}

export async function safeInvalidateAll(): Promise<void> {
	if (!reachable) return;
	if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
	try {
		await invalidateAll();
	} catch {
		// Keep the last good render. The write is on disk either way, and the
		// next successful flush will turn `reachable` back on.
		reachable = false;
	}
}

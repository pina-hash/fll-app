/**
 * The session clock a student screen ticks off.
 *
 * WHY IT IS NOT `Date.now()`. The countdown is the number a whole table of
 * kids is looking at, and a tablet whose clock is four minutes fast would tell
 * them they are four minutes into overrun when they are not. Every payload
 * that carries `server_now` re-syncs the offset, so the drift is corrected on
 * every refetch rather than accumulating all session.
 */
export class SessionClock {
	nowMs = $state(Date.now());

	#skew = 0;
	#timer: ReturnType<typeof setInterval> | null = null;

	constructor(serverNow?: string | null) {
		if (serverNow) this.sync(serverNow);
		this.nowMs = Date.now() + this.#skew;
	}

	/** Re-derives the offset from a fresh server timestamp. */
	sync(serverNow: string | null | undefined, fetchedAtMs = Date.now()): void {
		if (!serverNow) return;
		const server = Date.parse(serverNow);
		if (!Number.isFinite(server)) return;
		this.#skew = server - fetchedAtMs;
		this.nowMs = Date.now() + this.#skew;
	}

	/** Call from onMount; returns the teardown. */
	start(): () => void {
		this.#timer = setInterval(() => {
			this.nowMs = Date.now() + this.#skew;
		}, 1000);
		return () => {
			if (this.#timer) clearInterval(this.#timer);
			this.#timer = null;
		};
	}
}

/**
 * THE LIVE BOARD'S CONNECTION. One realtime channel over the five published
 * tables (0008), one debounced refetch of `board_live_summary` (0009), and a
 * one-second ticker for the phase clock.
 *
 * REFETCH, DO NOT PATCH. Every event just schedules a refetch of the whole
 * snapshot rather than applying the row it carries. The board is four rows of
 * derived counts; recomputing them in the browser from a stream of INSERTs,
 * UPDATEs and DELETEs would be a second implementation of 0009's SQL, and the
 * two would drift. A redundant fetch costs a few hundred bytes.
 *
 * ON REGAINING CONNECTIVITY, REFETCH. A missed phase change leaves a table of
 * nine-year-olds on the wrong task for twenty minutes, so nothing here assumes
 * the subscription caught up: coming back from CHANNEL_ERROR, from the browser
 * `online` event, or from a backgrounded tab all trigger a fetch, not a hope.
 */
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/database.types';
import { skewMs } from './clock';
import { parseBoardSnapshot, type BoardSnapshot } from './types';

export type ConnectionState = 'live' | 'reconnecting' | 'offline';

/** The tables whose changes can move a number on the board. */
const WATCHED = ['meetings', 'meeting_phases', 'tasks', 'blockers', 'attendance'] as const;

const REFETCH_DEBOUNCE_MS = 250;
const TICK_MS = 1000;

export class BoardFeed {
	snapshot = $state<BoardSnapshot | null>(null);
	connection = $state<ConnectionState>('reconnecting');
	/** Server-corrected wall clock, in milliseconds. */
	nowMs = $state(Date.now());
	/** Set when a refetch failed, so the page can say so instead of going stale silently. */
	error = $state<string | null>(null);

	#supabase: SupabaseClient<Database>;
	#meetingId: string | null;
	#skew = 0;
	#channel: RealtimeChannel | null = null;
	#timer: ReturnType<typeof setInterval> | null = null;
	#debounce: ReturnType<typeof setTimeout> | null = null;
	#inFlight = false;
	#stopped = false;

	constructor(
		supabase: SupabaseClient<Database>,
		initial: BoardSnapshot | null,
		meetingId: string | null = null
	) {
		this.#supabase = supabase;
		this.#meetingId = meetingId;
		if (initial) {
			this.snapshot = initial;
			this.#skew = skewMs(initial, Date.now());
		}
		this.nowMs = Date.now() + this.#skew;
	}

	/** Call from onMount. Returns the teardown for the same effect. */
	start(): () => void {
		this.#stopped = false;
		this.#timer = setInterval(() => {
			this.nowMs = Date.now() + this.#skew;
		}, TICK_MS);

		this.#subscribe();

		const onOnline = () => this.refetch();
		const onOffline = () => {
			this.connection = 'offline';
		};
		const onVisible = () => {
			if (document.visibilityState === 'visible') this.refetch();
		};
		window.addEventListener('online', onOnline);
		window.addEventListener('offline', onOffline);
		document.addEventListener('visibilitychange', onVisible);

		// The initial payload came from the server load, which may already be a
		// few hundred milliseconds old by the time the socket is up.
		this.refetch();

		return () => {
			this.#stopped = true;
			window.removeEventListener('online', onOnline);
			window.removeEventListener('offline', onOffline);
			document.removeEventListener('visibilitychange', onVisible);
			if (this.#timer) clearInterval(this.#timer);
			if (this.#debounce) clearTimeout(this.#debounce);
			if (this.#channel) this.#supabase.removeChannel(this.#channel);
			this.#channel = null;
		};
	}

	#subscribe() {
		const channel = this.#supabase.channel('console-live-board');
		for (const table of WATCHED) {
			channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => this.#schedule());
		}
		channel.subscribe((status) => {
			if (this.#stopped) return;
			if (status === 'SUBSCRIBED') {
				this.connection = 'live';
				// Anything that happened while the socket was down is invisible to
				// this channel, so the snapshot is refetched rather than trusted.
				this.refetch();
			} else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
				this.connection = navigator.onLine === false ? 'offline' : 'reconnecting';
			}
		});
		this.#channel = channel;
	}

	#schedule() {
		if (this.#debounce) clearTimeout(this.#debounce);
		this.#debounce = setTimeout(() => this.refetch(), REFETCH_DEBOUNCE_MS);
	}

	/** Pulls a whole new snapshot. Safe to call as often as you like. */
	async refetch(): Promise<void> {
		if (this.#stopped || this.#inFlight) return;
		this.#inFlight = true;
		const at = Date.now();
		const { data, error } = await this.#supabase.rpc('board_live_summary', {
			p_meeting_id: this.#meetingId ?? undefined
		});
		this.#inFlight = false;
		if (this.#stopped) return;
		if (error) {
			this.error = error.message;
			if (this.connection === 'live') this.connection = 'reconnecting';
			return;
		}
		const parsed = parseBoardSnapshot(data);
		if (!parsed) {
			this.error = 'The board came back in a shape this screen does not understand.';
			return;
		}
		this.error = null;
		this.snapshot = parsed;
		this.#skew = skewMs(parsed, at);
		this.nowMs = Date.now() + this.#skew;
		if (this.connection !== 'live' && navigator.onLine !== false && this.#channel?.state === 'joined') {
			this.connection = 'live';
		}
	}
}

/**
 * The plain version, for the console surfaces that are not the live board: one
 * channel over the named tables, calling `onChange` on any event and again on
 * every (re)subscribe. The caller usually passes `invalidateAll`.
 *
 * Same rule as the board: a reconnect refetches rather than assuming the
 * socket caught up.
 */
export function watchTables(
	supabase: SupabaseClient<Database>,
	tables: readonly string[],
	channelName: string,
	onChange: () => void
): () => void {
	const channel = supabase.channel(channelName);
	for (const table of tables) {
		channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => onChange());
	}
	channel.subscribe((status) => {
		if (status === 'SUBSCRIBED') onChange();
	});
	const onOnline = () => onChange();
	window.addEventListener('online', onOnline);
	return () => {
		window.removeEventListener('online', onOnline);
		supabase.removeChannel(channel);
	};
}

/**
 * Clock and formatting helpers for the console. Pure: every function takes the
 * current time as an argument so the dev harness can freeze it and so nothing
 * here reads Date.now() during SSR, where it would differ from the value the
 * browser then hydrates with.
 *
 * WHY THE SERVER'S CLOCK WINS. The phase clock is the one number a mentor
 * trusts in the room, and a tablet that is four minutes fast would show four
 * minutes of phantom overrun. Every snapshot carries `server_now`; `skewMs()`
 * turns that into the offset to add to the device clock.
 */
import type { BoardPhase, BoardSnapshot } from './types';

const MINUTE = 60_000;

/**
 * The season's timezone, stated once on this side of the wire. It mirrors
 * 0009's `_app_timezone()`; the two are changed together or not at all.
 */
export const SEASON_TZ = 'America/Los_Angeles';

/** How far the device clock is BEHIND the database clock, in milliseconds. */
export function skewMs(snapshot: Pick<BoardSnapshot, 'server_now'>, fetchedAtMs: number): number {
	const server = Date.parse(snapshot.server_now);
	if (!Number.isFinite(server)) return 0;
	return server - fetchedAtMs;
}

export interface PhaseClock {
	/** Milliseconds since the phase started; 0 before it starts. */
	elapsedMs: number;
	/** Planned length in milliseconds. */
	plannedMs: number;
	/** Planned minus elapsed. NEGATIVE once the phase runs long. */
	remainingMs: number;
	overrun: boolean;
	/** 0 to 1, clamped, for the progress bar. */
	fraction: number;
}

export function phaseClock(phase: BoardPhase | null, nowMs: number): PhaseClock | null {
	if (!phase) return null;
	const startedAt = phase.started_at ? Date.parse(phase.started_at) : NaN;
	const plannedMs = Math.max(0, phase.planned_minutes) * MINUTE;
	if (!Number.isFinite(startedAt)) {
		return { elapsedMs: 0, plannedMs, remainingMs: plannedMs, overrun: false, fraction: 0 };
	}
	const endedAt = phase.ended_at ? Date.parse(phase.ended_at) : NaN;
	const upTo = Number.isFinite(endedAt) ? endedAt : nowMs;
	const elapsedMs = Math.max(0, upTo - startedAt);
	const remainingMs = plannedMs - elapsedMs;
	return {
		elapsedMs,
		plannedMs,
		remainingMs,
		overrun: remainingMs < 0,
		fraction: plannedMs === 0 ? 1 : Math.min(1, elapsedMs / plannedMs)
	};
}

/** `12:04`, and `+3:20` once the phase has run long. Never a bare minus sign. */
export function formatClock(ms: number): string {
	const over = ms < 0;
	const total = Math.floor(Math.abs(ms) / 1000);
	const minutes = Math.floor(total / 60);
	const seconds = total % 60;
	return `${over ? '+' : ''}${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** How long since something last happened, as a mentor would say it out loud. */
export function formatSince(iso: string | null, nowMs: number): string {
	if (!iso) return 'never';
	const then = Date.parse(iso);
	if (!Number.isFinite(then)) return 'never';
	const minutes = Math.floor(Math.max(0, nowMs - then) / MINUTE);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}

/** Minutes of idle time, for sorting and for the "quiet for 20m" line. */
export function idleMinutes(iso: string | null, nowMs: number): number | null {
	if (!iso) return null;
	const then = Date.parse(iso);
	if (!Number.isFinite(then)) return null;
	return Math.floor(Math.max(0, nowMs - then) / MINUTE);
}

const TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
	hour: 'numeric',
	minute: '2-digit',
	timeZone: SEASON_TZ
});

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
	weekday: 'short',
	month: 'short',
	day: 'numeric',
	timeZone: SEASON_TZ
});

/** Wall-clock time in the season's timezone, matching 0009's `_app_timezone`. */
export function formatTime(iso: string | null): string {
	if (!iso) return '';
	const t = Date.parse(iso);
	return Number.isFinite(t) ? TIME_FORMAT.format(t) : '';
}

export function formatDay(iso: string | null): string {
	if (!iso) return '';
	// A bare `2026-09-11` parses as UTC midnight, which is the previous evening
	// in Los Angeles, so a date-only string is read as a local date.
	const value = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso;
	const t = Date.parse(value);
	return Number.isFinite(t) ? DATE_FORMAT.format(t) : '';
}

/** Today in the season's timezone, as `YYYY-MM-DD`, for a date input default. */
export function seasonToday(nowMs: number): string {
	const parts = new Intl.DateTimeFormat('en-CA', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		timeZone: SEASON_TZ
	}).format(nowMs);
	return parts;
}

/** How far the season's zone is ahead of UTC at this instant, in minutes. */
function zoneOffsetMinutes(utcMs: number): number {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-US', {
			timeZone: SEASON_TZ,
			hour12: false,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		})
			.formatToParts(utcMs)
			.map((p) => [p.type, p.value])
	);
	const asIfUtc = Date.UTC(
		Number(parts.year),
		Number(parts.month) - 1,
		Number(parts.day),
		Number(parts.hour) % 24,
		Number(parts.minute),
		Number(parts.second)
	);
	return (asIfUtc - utcMs) / 60_000;
}

/**
 * A wall-clock date and time IN THE SEASON'S TIMEZONE, as an instant.
 *
 * WHY NOT JUST PARSE "2026-09-11T16:30". That reads the string in the
 * BROWSER's zone. A mentor scheduling from a laptop still set to Eastern would
 * create a 4:30 meeting that starts at 1:30 in the room. The two passes below
 * settle the two hours a year when the offset changes between the guess and
 * the answer.
 */
export function seasonInstant(date: string, time: string): string {
	const [y, m, d] = date.split('-').map(Number);
	const [hh, mm] = time.split(':').map(Number);
	if ([y, m, d, hh, mm].some((n) => !Number.isFinite(n))) return '';
	const naive = Date.UTC(y, m - 1, d, hh, mm);
	const first = naive - zoneOffsetMinutes(naive) * 60_000;
	const settled = naive - zoneOffsetMinutes(first) * 60_000;
	return new Date(settled).toISOString();
}

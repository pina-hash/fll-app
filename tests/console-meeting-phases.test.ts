// tests/console-meeting-phases.test.ts
//
// THE PHASE CHANGE IS THE MOST LOAD-BEARING WRITE IN THE APP. A change that
// half-lands leaves a table of nine-year-olds on the wrong task for twenty
// minutes, so 0009's meeting_start / meeting_advance_phase / meeting_end each
// move three things at once: the outgoing phase's ended_at, the incoming
// phase's started_at, and meetings.current_phase_id. This file asserts they
// move TOGETHER, and that the refusals a mentor can hit mid-session are
// sentences rather than SQLSTATEs.
//
// Nothing here auto-advances on overrun; a phase running past planned_minutes
// is the mentor's call. The last test proves the overrun is reported and NOT
// acted on.

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { cleanupRun, closeDb, createTeam, seedMentor, sql, type SeededMentor } from './db/harness';

let mentor: SeededMentor;

interface PhaseRow {
	id: string;
	ordinal: number;
	name: string;
	planned_minutes: number;
	started_at: string | null;
	ended_at: string | null;
}

async function newMeeting(): Promise<string> {
	const [{ today }] = await sql<{ today: string }[]>`
		select to_char((now() at time zone 'America/Los_Angeles')::date, 'YYYY-MM-DD') as today`;
	const { data, error } = await mentor.client.rpc('meeting_create', {
		p_kind: 'friday',
		p_meeting_date: today,
		p_planned_start_at: new Date().toISOString()
	});
	if (error) throw new Error(`meeting_create failed: ${error.message}`);
	return (data as unknown as { meeting_id: string }).meeting_id;
}

const phases = (meetingId: string) =>
	sql<PhaseRow[]>`
		select id, ordinal, name, planned_minutes, started_at, ended_at
		from public.meeting_phases where meeting_id = ${meetingId} order by ordinal`;

const meetingRow = (meetingId: string) =>
	sql<{ started_at: string | null; ended_at: string | null; current_phase_id: string | null }[]>`
		select started_at, ended_at, current_phase_id from public.meetings where id = ${meetingId}`;

beforeAll(async () => {
	mentor = await seedMentor('phases');
	// A team exists so cleanupRun has something run-tagged to match on.
	await createTeam(mentor.client, 'phases');
}, 60_000);

afterAll(async () => {
	await cleanupRun();
	await closeDb();
});

describe('meeting_create stamps the template', () => {
	test('a friday meeting arrives with the four seeded phases and none of them running', async () => {
		const id = await newMeeting();
		const rows = await phases(id);
		expect(rows.map((p) => [p.ordinal, p.name, p.planned_minutes])).toEqual([
			[1, 'Huddle', 10],
			[2, 'Role Blocks', 60],
			[3, 'Mat Run', 15],
			[4, 'Close', 5]
		]);
		expect(rows.every((p) => p.started_at === null && p.ended_at === null)).toBe(true);

		const [m] = await meetingRow(id);
		expect({ started: m.started_at, current: m.current_phase_id }).toEqual({ started: null, current: null });
	});
});

describe('start, advance, end', () => {
	test('meeting_start opens phase 1 and points the meeting at it, in one commit', async () => {
		const id = await newMeeting();
		const { error } = await mentor.client.rpc('meeting_start', { p_meeting_id: id });
		expect(error).toBeNull();

		const rows = await phases(id);
		const [m] = await meetingRow(id);
		expect(m.started_at).not.toBeNull();
		expect(m.current_phase_id).toBe(rows[0].id);
		expect(rows[0].started_at).not.toBeNull();
		expect(rows[0].ended_at).toBeNull();
		expect(rows.slice(1).every((p) => p.started_at === null)).toBe(true);
	});

	test('advancing closes the outgoing phase, opens the incoming one and moves the pointer', async () => {
		const id = await newMeeting();
		await mentor.client.rpc('meeting_start', { p_meeting_id: id });

		const { data, error } = await mentor.client.rpc('meeting_advance_phase', { p_meeting_id: id });
		expect(error).toBeNull();
		expect((data as unknown as { phase_name: string }).phase_name).toBe('Role Blocks');

		const rows = await phases(id);
		const [m] = await meetingRow(id);
		// All three facts, from one call: this is the whole point of the RPC.
		expect(rows[0].ended_at).not.toBeNull();
		expect(rows[1].started_at).not.toBeNull();
		expect(rows[1].ended_at).toBeNull();
		expect(m.current_phase_id).toBe(rows[1].id);
		// The outgoing phase closed at or after the incoming one opened: one clock.
		expect(Date.parse(rows[1].started_at!)).toBeGreaterThanOrEqual(Date.parse(rows[0].started_at!));
	});

	test('meeting_end closes the running phase and the meeting', async () => {
		const id = await newMeeting();
		await mentor.client.rpc('meeting_start', { p_meeting_id: id });
		await mentor.client.rpc('meeting_advance_phase', { p_meeting_id: id });

		const { data, error } = await mentor.client.rpc('meeting_end', { p_meeting_id: id });
		expect(error).toBeNull();
		expect((data as unknown as { phases_closed: number }).phases_closed).toBe(1);

		const rows = await phases(id);
		const [m] = await meetingRow(id);
		expect(m.ended_at).not.toBeNull();
		expect(rows.filter((p) => p.started_at && !p.ended_at)).toHaveLength(0);
		// Phases that never ran are left alone rather than back-stamped.
		expect(rows.slice(2).every((p) => p.started_at === null && p.ended_at === null)).toBe(true);
	});

	test('walking the whole meeting leaves every phase with a start and an end', async () => {
		const id = await newMeeting();
		await mentor.client.rpc('meeting_start', { p_meeting_id: id });
		await mentor.client.rpc('meeting_advance_phase', { p_meeting_id: id });
		await mentor.client.rpc('meeting_advance_phase', { p_meeting_id: id });
		await mentor.client.rpc('meeting_advance_phase', { p_meeting_id: id });
		await mentor.client.rpc('meeting_end', { p_meeting_id: id });

		const rows = await phases(id);
		expect(rows.every((p) => p.started_at !== null && p.ended_at !== null)).toBe(true);
	});
});

describe('the refusals a mentor can hit mid-session', () => {
	test('advancing past the last phase says so instead of ending the meeting for you', async () => {
		const id = await newMeeting();
		await mentor.client.rpc('meeting_start', { p_meeting_id: id });
		await mentor.client.rpc('meeting_advance_phase', { p_meeting_id: id });
		await mentor.client.rpc('meeting_advance_phase', { p_meeting_id: id });
		await mentor.client.rpc('meeting_advance_phase', { p_meeting_id: id });

		const { error } = await mentor.client.rpc('meeting_advance_phase', { p_meeting_id: id });
		expect(error?.message).toBe('That was the last phase. End the meeting instead.');

		// Positive control: nothing moved, so the session is still on phase 4.
		const [m] = await meetingRow(id);
		const rows = await phases(id);
		expect(m.current_phase_id).toBe(rows[3].id);
		expect(m.ended_at).toBeNull();
	});

	test('advancing a meeting that has not started is refused', async () => {
		const id = await newMeeting();
		const { error } = await mentor.client.rpc('meeting_advance_phase', { p_meeting_id: id });
		expect(error?.message).toBe('Start the meeting before changing the phase.');
	});

	test('starting twice is refused, and starting an ended meeting is refused', async () => {
		const id = await newMeeting();
		await mentor.client.rpc('meeting_start', { p_meeting_id: id });
		const twice = await mentor.client.rpc('meeting_start', { p_meeting_id: id });
		expect(twice.error?.message).toBe('That meeting is already running.');

		await mentor.client.rpc('meeting_end', { p_meeting_id: id });
		const afterEnd = await mentor.client.rpc('meeting_start', { p_meeting_id: id });
		expect(afterEnd.error?.message).toBe('That meeting has already ended.');
		const advanceAfterEnd = await mentor.client.rpc('meeting_advance_phase', { p_meeting_id: id });
		expect(advanceAfterEnd.error?.message).toBe('That meeting has already ended.');
	});

	test('a meeting that does not exist answers in the caller terms, not in SQLSTATE', async () => {
		const { error } = await mentor.client.rpc('meeting_start', {
			p_meeting_id: '00000000-0000-4000-8000-0000000000ff'
		});
		expect(error?.message).toBe('That meeting does not exist.');
	});
});

describe('overrun is reported, never acted on', () => {
	test('a phase left running past its planned minutes stays the current phase', async () => {
		const id = await newMeeting();
		await mentor.client.rpc('meeting_start', { p_meeting_id: id });
		const before = await phases(id);

		// Backdate the running phase so it is 25 minutes into a 10 minute Huddle.
		await sql`
			update public.meeting_phases set started_at = now() - interval '25 minutes'
			where id = ${before[0].id}`;

		const { data, error } = await mentor.client.rpc('board_live_summary', { p_meeting_id: id });
		expect(error).toBeNull();
		const summary = data as unknown as {
			server_now: string;
			meeting: { current_phase_id: string; phase: { name: string; planned_minutes: number; started_at: string } };
		};
		const elapsedMinutes = (Date.parse(summary.server_now) - Date.parse(summary.meeting.phase.started_at)) / 60_000;

		expect(summary.meeting.phase.name).toBe('Huddle');
		expect(summary.meeting.phase.planned_minutes).toBe(10);
		expect(elapsedMinutes).toBeGreaterThan(20);
		// The pointer has not moved on its own.
		expect(summary.meeting.current_phase_id).toBe(before[0].id);
	});
});

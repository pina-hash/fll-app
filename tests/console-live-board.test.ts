// tests/console-live-board.test.ts
//
// THE BOARD'S NUMBERS AND ITS ORDER ARE THE DATABASE'S, NOT THE BROWSER'S.
// board_live_summary (0009) returns one payload per fetch and sorts it by who
// needs the mentor most: open blockers, then roles with nobody in the seat,
// then the team quiet longest. The component renders that order as given, so
// if the SQL is wrong nothing downstream corrects it. This file is where that
// order is pinned.
//
// The counts are scoped to the MEETING'S OWN WINDOW rather than to a calendar
// day, which is the correction that matters: a Friday session runs 16:30-18:00
// in Rosemead, which straddles midnight UTC. A task closed at 17:45 belongs to
// that session no matter which UTC date it landed on. The last test proves a
// task created before the meeting started is excluded, which is the same rule
// seen from the other side.

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
	cleanupRun,
	closeDb,
	createStudent,
	createTeam,
	seedMentor,
	sql,
	type SeededMentor,
	type SeededStudent,
	type SeededTeam
} from './db/harness';

let mentor: SeededMentor;
let quiet: SeededTeam; // nothing wrong, but has closed nothing
let blocked: SeededTeam; // has an open blocker
let short: SeededTeam; // has a role with nobody in the seat
let busy: SeededTeam; // everything covered, closing work
let meetingId: string;
const students: Record<string, SeededStudent> = {};

interface TeamCard {
	team_id: string;
	name: string;
	accent: string;
	roster_size: number;
	present_count: number;
	tasks_opened: number;
	tasks_closed: number;
	tasks_open_now: number;
	open_blockers: number;
	roles_unfilled: number;
	roles_without_second: number;
	last_task_closed_at: string | null;
}

interface Summary {
	server_now: string;
	window_from: string;
	window_to: string;
	meeting: { id: string; phase: { name: string } | null; phase_count: number } | null;
	teams: TeamCard[];
}

async function board(): Promise<Summary> {
	const { data, error } = await mentor.client.rpc('board_live_summary', { p_meeting_id: meetingId });
	if (error) throw new Error(`board_live_summary failed: ${error.message}`);
	return data as unknown as Summary;
}

const cardFor = (s: Summary, team: SeededTeam) => s.teams.find((t) => t.team_id === team.teamId)!;

async function addTask(team: SeededTeam, title: string) {
	const { data, error } = await mentor.client
		.from('tasks')
		.insert({
			team_id: team.teamId,
			meeting_id: meetingId,
			title,
			created_by_mentor_id: mentor.mentorId
		})
		.select('id')
		.single();
	if (error) throw new Error(`task insert failed: ${error.message}`);
	return data.id;
}

beforeAll(async () => {
	mentor = await seedMentor('board');
	quiet = await createTeam(mentor.client, 'board-quiet');
	blocked = await createTeam(mentor.client, 'board-blocked');
	short = await createTeam(mentor.client, 'board-short');
	busy = await createTeam(mentor.client, 'board-busy');

	for (const [key, team] of Object.entries({ quiet, blocked, short, busy })) {
		students[key] = await createStudent(mentor.client, team, key === 'quiet' ? 'Quinn' : 'Robin', 'X');
	}

	const [{ today }] = await sql<{ today: string }[]>`
		select to_char((now() at time zone 'America/Los_Angeles')::date, 'YYYY-MM-DD') as today`;
	const { data } = await mentor.client.rpc('meeting_create', {
		p_kind: 'friday',
		p_meeting_date: today,
		p_planned_start_at: new Date().toISOString()
	});
	meetingId = (data as unknown as { meeting_id: string }).meeting_id;
	await mentor.client.rpc('meeting_start', { p_meeting_id: meetingId });
}, 90_000);

afterAll(async () => {
	await cleanupRun();
	await closeDb();
});

describe('the payload', () => {
	test('one call carries the meeting, its phase, the server clock and a card per live team', async () => {
		const summary = await board();
		expect(summary.meeting?.id).toBe(meetingId);
		expect(summary.meeting?.phase?.name).toBe('Huddle');
		expect(summary.meeting?.phase_count).toBe(4);
		expect(Number.isFinite(Date.parse(summary.server_now))).toBe(true);

		// This run's four teams are all present; other files' teams may be too,
		// which is why every assertion in this file is scoped by team id.
		const mine = [quiet, blocked, short, busy].map((t) => cardFor(summary, t));
		expect(mine.every(Boolean)).toBe(true);
		// A team's accent is one of the eleven it may CHOOSE, or null before it
		// has chosen (0018). Both are real; a string outside the enum is not.
		const PALETTE = [
			'bark', 'orange', 'olive', 'lime', 'green', 'sage',
			'teal', 'violet', 'purple', 'orchid', 'magenta'
		];
		expect(mine.every((c) => c.accent === null || PALETTE.includes(c.accent))).toBe(true);
	});

	test('present over roster counts only active students checked in to THIS meeting', async () => {
		const before = cardFor(await board(), busy);
		expect({ here: before.present_count, roster: before.roster_size }).toEqual({ here: 0, roster: 1 });

		await mentor.client.from('attendance').insert({ meeting_id: meetingId, student_id: students.busy.studentId });
		const after = cardFor(await board(), busy);
		expect({ here: after.present_count, roster: after.roster_size }).toEqual({ here: 1, roster: 1 });
	});

	test('closed over opened counts the work of THIS session, not of all time', async () => {
		const a = await addTask(busy, 'Square the wheels');
		await addTask(busy, 'Label the cables');
		const opened = cardFor(await board(), busy);
		expect({ opened: opened.tasks_opened, closed: opened.tasks_closed, openNow: opened.tasks_open_now }).toEqual({
			opened: 2,
			closed: 0,
			openNow: 2
		});

		await mentor.client.from('tasks').update({ status: 'done' }).eq('id', a);
		const closed = cardFor(await board(), busy);
		expect({ opened: closed.tasks_opened, closed: closed.tasks_closed, openNow: closed.tasks_open_now }).toEqual({
			opened: 2,
			closed: 1,
			openNow: 1
		});
		expect(closed.last_task_closed_at).not.toBeNull();
	});

	test('a task created BEFORE the meeting started is not counted as opened this session', async () => {
		// Inserted with a backdated created_at rather than updated into one:
		// 0007's tasks_immutable trigger refuses to let created_at change, for
		// the service role too, so the only way to have an older task is to have
		// created one.
		await sql`
			insert into public.tasks (team_id, title, created_by_mentor_id, created_at)
			values (${quiet.teamId}, 'Planned last week', ${mentor.mentorId}, now() - interval '3 days')`;

		const card = cardFor(await board(), quiet);
		expect(card.tasks_opened).toBe(0);
		// It is still open work, which is what tasks_open_now is for.
		expect(card.tasks_open_now).toBe(1);
	});
});

describe('the sort is "who needs me most"', () => {
	test('blockers outrank unfilled roles, which outrank a long quiet spell', async () => {
		// blocked: one open blocker, roles covered.
		await mentor.client.from('blockers').insert({
			team_id: blocked.teamId,
			student_id: students.blocked.studentId,
			note: 'The gear will not seat.'
		});
		await mentor.client
			.from('attendance')
			.insert({ meeting_id: meetingId, student_id: students.blocked.studentId });
		for (const role of [
			'lead_builder',
			'lead_programmer',
			'run_captain',
			'innovation_lead',
			'notebook_values_lead'
		] as const) {
			await mentor.client.rpc('role_assign', {
				p_team_id: blocked.teamId,
				p_student_id: students.blocked.studentId,
				p_role: role,
				p_tier: 'primary'
			});
		}

		// short: no blockers, but nobody assigned at all, so five unfilled roles.
		// busy: everything covered.
		for (const role of [
			'lead_builder',
			'lead_programmer',
			'run_captain',
			'innovation_lead',
			'notebook_values_lead'
		] as const) {
			await mentor.client.rpc('role_assign', {
				p_team_id: busy.teamId,
				p_student_id: students.busy.studentId,
				p_role: role,
				p_tier: 'primary'
			});
		}

		const summary = await board();
		const mine = summary.teams.filter((t) => [quiet, blocked, short, busy].some((x) => x.teamId === t.team_id));
		const order = mine.map((t) => t.team_id);

		expect(order[0]).toBe(blocked.teamId);
		// quiet and short both have five unfilled roles; the tie is broken by the
		// team that has been quiet longest, and neither has closed anything.
		expect(order.slice(1, 3).sort()).toEqual([quiet.teamId, short.teamId].sort());
		// busy has closed work most recently and has nothing wrong, so it is last.
		expect(order[3]).toBe(busy.teamId);

		expect(cardFor(summary, blocked).open_blockers).toBe(1);
		expect(cardFor(summary, blocked).roles_unfilled).toBe(0);
		expect(cardFor(summary, short).roles_unfilled).toBe(5);
		expect(cardFor(summary, busy).roles_unfilled).toBe(0);
	});

	test('resolving the blocker drops that team down the list', async () => {
		await mentor.client
			.from('blockers')
			.update({ resolved_at: new Date().toISOString(), resolved_by_mentor_id: mentor.mentorId })
			.eq('team_id', blocked.teamId);

		const summary = await board();
		const mine = summary.teams.filter((t) => [quiet, blocked, short, busy].some((x) => x.teamId === t.team_id));
		expect(cardFor(summary, blocked).open_blockers).toBe(0);
		// With no blockers and no unfilled roles it is no longer first.
		expect(mine[0].team_id).not.toBe(blocked.teamId);
	});

	test('roles_without_second counts the seats with no backup, which is the failure waiting to happen', async () => {
		const summary = await board();
		// blocked has a primary on all five roles and a second on none.
		expect(cardFor(summary, blocked).roles_without_second).toBe(5);
		expect(cardFor(summary, blocked).roles_unfilled).toBe(0);
	});
});

describe('with no meeting', () => {
	test('the board still answers, with nobody present and every role unfilled', async () => {
		const { data, error } = await mentor.client.rpc('board_live_summary', {
			p_meeting_id: '00000000-0000-4000-8000-0000000000ff'
		});
		expect(error).toBeNull();
		const summary = data as unknown as Summary;
		expect(summary.meeting).toBeNull();
		const card = cardFor(summary, busy);
		expect({ here: card.present_count, unfilled: card.roles_unfilled }).toEqual({ here: 0, unfilled: 5 });
	});
});

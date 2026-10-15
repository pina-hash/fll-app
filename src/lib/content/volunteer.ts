// ---------------------------------------------------------------------------
// VOLUNTEER GUIDE -- what a volunteer needs on a phone at the table.
//
// Two kinds of content live here and they have different owners:
//
//  1. THE SHEETS. The Game Plan, the Iteration Log and More Rounds are the
//     club's own printed worksheets (Mr. Pina's), so their purpose and the
//     "what a finished one looks like" checks are ours to write. A team that
//     stays on these sheets makes steady progress; a team that drifts off them
//     stops documenting and falls apart. The volunteer's job is to keep teams
//     on them, so everything below is phrased as something to LOOK FOR or ASK.
//
//  2. THE RULES. Mission rules are FIRST's. Nothing here paraphrases them: a
//     mission points at the official Robot Game Rulebook and at the page its
//     rules sit on. The page numbers were read from the real 20-page rulebook
//     PDF on 2026-10-14 (mission map p8; Missions 01-04 p9, 05-08 p10, 09-12
//     p11, 13-15 p12). The rulebook can be reissued, so
//     tests/volunteer-guide.test.ts pins the table's shape, and the page
//     numbers are re-read against the PDF whenever FIRST posts a new one.
//
// LINK ONLY, same rule as the rest of the Skill Hub (CLAUDE.md, "Skill Hub
// content"): no FIRST text, artwork or mission images are copied in.
// ---------------------------------------------------------------------------

import { SEASON_DOC_TIER1 } from './seasonDocs';

export interface VolunteerSheet {
	id: string;
	name: string;
	/** One line: who has it and when it comes out. */
	when: string;
	/** What the sheet is for, in a sentence a 4th grader's helper can repeat. */
	purpose: string;
	/** What a filled-in sheet looks like. Each line is something to look for. */
	lookFor: string[];
	/** Questions a volunteer can ask a team holding this sheet. */
	ask: string[];
}

export const VOLUNTEER_SHEETS: VolunteerSheet[] = [
	{
		id: 'game-plan',
		name: 'Game Plan',
		when: 'One per team. Front of the binder. Pencil, because it changes all season.',
		purpose: 'Shows every launch the team runs in a match, drawn on the mat, with its score.',
		lookFor: [
			'Every launch is a separate line, a new color for each, with its number where it starts.',
			'There is an X wherever the robot lines up on a wall or a line.',
			'Each launch has a strip: missions circled, start left or right, attachment, what it lines up on, points.',
			'Each strip has a "Works __/10" number and the Iteration Log number it came from.',
			'A change to the plan is ONE line in "Plan changes", not a new sheet.',
			'The full match practice box has a best score in it.'
		],
		ask: [
			'Which launch is this one, and where does it line up?',
			'What is its Works number, and which log did it come from?',
			'What did you change in the plan since last time, and did the score go up?'
		]
	},
	{
		id: 'iteration-log',
		name: 'Iteration Log',
		when: 'One per launch. Lives in the binder with the Engineering Notebook.',
		purpose:
			'Records every change to the robot or code and every test of it, so the team can prove what works.',
		lookFor: [
			'Section 1 has the missions this launch tries circled, and the launch number.',
			'Every change to the robot or the code is a new version row (V1, V2, V3), with BUILD or CODE circled and WHY it changed.',
			'Each version has a photo or a saved program, named like TEAM-L2-V3. No drawings.',
			'Ideas to try are written down, and only ONE gets tested at a time.',
			'Each test round names the ONE thing that changed, and has Try 1, 2 and 3 filled in.',
			'A check mark means all worked. A miss is written as the mission number, like 07.',
			'After 3 clean tries, the team ran 7 more and wrote the total out of 10 under PROVE IT.',
			'The best version and its out-of-10 went onto the Game Plan and notebook page 30.'
		],
		ask: [
			'What is the ONE thing you changed this round?',
			'Did the battery, start spot, program and model setup stay the same?',
			'Where is the photo or saved program for this version?',
			'It worked 3 times. What happened on the other 7?'
		]
	},
	{
		id: 'more-rounds',
		name: 'More Rounds',
		when: 'Handed out when an Iteration Log runs out of rows.',
		purpose: 'Extra test rows, so a team never stops logging because the page is full.',
		lookFor: [
			'"For Log #" is filled in, and the sheet is stapled behind that log.',
			'Round numbers keep counting from the last row of the log, not starting over at 1.',
			'The same rules hold: one change per round, three tries, PROVE IT out of 10.'
		],
		ask: ['Which log does this belong to, and what round are you on?']
	}
];

/** The two-minute check a volunteer runs on a team. Order is the order a
 *  struggling team usually breaks in: plan first, then the log, then proof. */
export const TEAM_CHECK: { id: string; text: string }[] = [
	{ id: 'plan-drawn', text: 'Game Plan is out and every launch is drawn.' },
	{ id: 'log-per-launch', text: 'Every launch has its own Iteration Log.' },
	{ id: 'versions-logged', text: 'Every robot or code change is a version with a photo or saved program.' },
	{ id: 'one-change', text: 'Each test changes only ONE thing.' },
	{ id: 'three-tries', text: 'Each test has 3 tries written down, with misses marked by mission number.' },
	{ id: 'prove-it', text: 'Launches that passed 3 tries have a 10-run PROVE IT total.' },
	{ id: 'feeds-back', text: 'Best versions are copied to the Game Plan and the notebook.' }
];

// ---------------------------------------------------------------------------
// MISSION LOOKUP
// ---------------------------------------------------------------------------

const RGR = SEASON_DOC_TIER1.find((d) => d.id === 'sd-rgr');
const RGR_INTERACTIVE = SEASON_DOC_TIER1.find((d) => d.id === 'sd-rgr-interactive');
const UPDATES = SEASON_DOC_TIER1.find((d) => d.id === 'sd-updates');

if (!RGR || !RGR_INTERACTIVE || !UPDATES) {
	// A renamed season-doc id would otherwise produce a page of dead links.
	throw new Error('volunteer.ts: season doc ids sd-rgr, sd-rgr-interactive, sd-updates changed');
}

export const RULEBOOK_URL = RGR.url;
export const RULEBOOK_INTERACTIVE_URL = RGR_INTERACTIVE.url;
export const CHALLENGE_UPDATES_URL = UPDATES.url;

/** PDF page of the Robot Game Rulebook where each mission's own rules begin.
 *  Read from the real PDF on 2026-10-14. Keyed by the missions table code. */
export const MISSION_RULEBOOK_PAGE: Record<string, number> = {
	M01: 9,
	M02: 9,
	M03: 9,
	M04: 9,
	M05: 10,
	M06: 10,
	M07: 10,
	M08: 10,
	M09: 11,
	M10: 11,
	M11: 11,
	M12: 11,
	M13: 12,
	M14: 12,
	M15: 12
};

/** The page with the whole mat, every mission's position, and the equipment
 *  inspection and precision token rules. */
export const RULEBOOK_MAP_PAGE = 8;

/** A link that opens the official rulebook PDF at a page. `#page=` is honored
 *  by the browser PDF viewers; where it is not, the link still opens the
 *  rulebook itself, which is the safe failure. */
export function rulebookLink(page: number): string {
	return `${RULEBOOK_URL}#page=${page}`;
}

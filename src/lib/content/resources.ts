// ---------------------------------------------------------------------------
// EXTERNAL RESOURCES -- the single source of truth for every external link in
// the Skill Hub, ported from fll-camp's src/state/resources.js.
//
// Each resource is referenced by id from a HubItem's `resourceId` /
// `secondaryResourceId`, from the Resource Library page's topic bands, or from
// the mentor console's reference list. Nothing here is duplicated elsewhere.
//
// COPYRIGHT: link only. Never fetch, mirror, or rehost PrimeLessons, FLL
// Tutorials, or Baby Sharks content -- these URLs point at the original
// publisher, same as fll-camp did.
//
// LINK POLICY -- the Baby Sharks PDFs sit on a Wix "premium files" bucket that
// rejects a default curl/headless user agent but serves normally to a browser
// one. A failed automated fetch against those three URLs is a user-agent
// problem, not a dead link: verify those three in an actual browser, never by
// curl. See CLAUDE.md.
// ---------------------------------------------------------------------------

import type { Resource } from './types';

const FLLT = 'https://flltutorials.com';
const PRIME = 'https://primelessons.org/en/ProgrammingLessons';

// Baby Sharks (FTC Team 33574) shared these three free course PDFs directly;
// Mr. Garza has committed our teams to using them. Link only -- never copy,
// mirror, or rehost their PDF content.
const BABY_SHARKS_RIPPLE_EFFECT = 'https://team33574.wixsite.com/baby-sharks/blank-2';
const BABY_SHARKS_FLL_CODING_URL =
	'https://09e0be48-dba0-4a4d-93a7-079640fadf32.filesusr.com/ugd/e1c871_fc3d87da85384e85bbffaee4a890b2ce.pdf';
const BABY_SHARKS_PYTHON_URL =
	'https://09e0be48-dba0-4a4d-93a7-079640fadf32.filesusr.com/ugd/e1c871_4116b158b7db46a3b4d0467a7f71e08c.pdf';
const BABY_SHARKS_ENGINEERING_URL =
	'https://09e0be48-dba0-4a4d-93a7-079640fadf32.filesusr.com/ugd/e1c871_970cff19b9ad47da8d72263a262fef4b.pdf';

/** Where the team's feedback form for the Baby Sharks courses lives (embedded
 *  on their Ripple Effect page -- there is no separate form URL). */
export const BABY_SHARKS_FEEDBACK_URL = BABY_SHARKS_RIPPLE_EFFECT;

export { BABY_SHARKS_FLL_CODING_URL, BABY_SHARKS_PYTHON_URL, BABY_SHARKS_ENGINEERING_URL };

/** The 225-step competition robot build manual. Self-hosted out of
 *  static/build/ (this repo's own copy, same file fll-camp already
 *  downloaded and shipped from its public/build/) -- not a FIRST publication,
 *  so the link-only rule for PrimeLessons / FLL Tutorials / Baby Sharks does
 *  not apply to it. */
export const COMP_BOT_MANUAL_URL = '/build/comp-bot-manual.pdf';

/** Browse topics, in display order, for the Resource Library's topic bands. */
export const TOPICS = [
	{ key: 'new-to-fll', label: 'New to FLL?' },
	{ key: 'driving', label: 'Driving & Turning' },
	{ key: 'sensors', label: 'Sensors & Lines' },
	{ key: 'building', label: 'Building & Attachments' },
	{ key: 'missions', label: 'The Missions' },
	{ key: 'strategy', label: 'Strategy & Reliability' }
];

/** id -> resource. The one place external links live. */
export const RESOURCES: Record<string, Resource> = {
	'intro-fll': {
		id: 'intro-fll',
		title: 'What is FLL and how a match works',
		blurb: 'The big picture: the season, the robot game, and how scoring works.',
		source: 'FLL Tutorials',
		url: `${FLLT}/translations/en-us/Worksheets/IntrotoFLL.pdf`,
		topics: ['new-to-fll'],
		audience: 'student'
	},
	'block-guide': {
		id: 'block-guide',
		title: 'Drive straight and the basics',
		blurb: 'Your first program: the blocks that make the robot move.',
		source: 'PrimeLessons',
		url: `${PRIME}/SP3BlockGuide.pdf`,
		topics: ['driving', 'building'],
		audience: 'student'
	},
	'accurate-turning': {
		id: 'accurate-turning',
		title: 'Turn exactly 90 degrees',
		blurb: 'Make clean, repeatable turns instead of guessing.',
		source: 'PrimeLessons',
		url: `${PRIME}/SP3AccurateTurning.pdf`,
		topics: ['driving'],
		audience: 'student'
	},
	'line-follower': {
		id: 'line-follower',
		title: 'Follow a line with the color sensor',
		blurb: 'Use the color sensor to track a line across the mat.',
		source: 'PrimeLessons',
		url: `${PRIME}/SP3LineFollower.pdf`,
		topics: ['sensors'],
		audience: 'student'
	},
	'droidbot-m': {
		id: 'droidbot-m',
		title: 'Build the DroidBot training robot',
		blurb: 'A solid one-kit robot to learn on and test attachments with.',
		source: 'FLL Tutorials',
		url: `${FLLT}/en/robotgame/building/one%20kit%20build/2020/07/06/DroidBotMSP.html`,
		topics: ['building'],
		audience: 'student'
	},
	'learn-missions': {
		id: 'learn-missions',
		title: 'Learn the missions',
		blurb: 'How to read a mission and work out what scores points.',
		source: 'FLL Tutorials',
		url: `${FLLT}/en/worksheets/2020/07/15/Learn-the-Missions.html`,
		topics: ['missions'],
		audience: 'student'
	},
	'mission-models': {
		id: 'mission-models',
		title: 'Build and set up the mission models',
		blurb: 'Assemble the field models and set the mat up correctly.',
		source: 'FLL Tutorials',
		url: `${FLLT}/en/worksheets/2020/07/15/Mission-Model-Building-Guide.html`,
		topics: ['missions'],
		audience: 'student'
	},
	// TODO verify-link: the original page (2020/07/16/Guided-Mission.html)
	// 404s as of 2026-08-23. Pointed at the category index per CLAUDE.md's link
	// policy until a replacement worksheet is found.
	reliability: {
		id: 'reliability',
		title: 'Make your runs repeat every time',
		blurb: 'Techniques so a run that worked once works every time.',
		source: 'FLL Tutorials',
		url: `${FLLT}/category.html`,
		topics: ['strategy'],
		audience: 'student'
	},
	brainstorming: {
		id: 'brainstorming',
		title: 'Plan which missions to attempt',
		blurb: 'Pick the missions worth your time and put them in order.',
		source: 'FLL Tutorials',
		url: `${FLLT}/en/worksheets/2020/07/15/Mission-Brainstorming.html`,
		topics: ['strategy'],
		audience: 'student'
	},

	// ---- Closing "More" group: the two index pages ----
	'prime-index': {
		id: 'prime-index',
		title: 'Browse all skill lessons',
		blurb: 'Every PrimeLessons SPIKE lesson in one index.',
		source: 'PrimeLessons',
		url: 'https://primelessons.org/en/Lessons.html',
		topics: ['more'],
		audience: 'student'
	},
	'fllt-index': {
		id: 'fllt-index',
		title: 'Browse all FLL tutorials',
		blurb: 'Every FLL Tutorials guide, grouped by category.',
		source: 'FLL Tutorials',
		url: `${FLLT}/category.html`,
		topics: ['more'],
		audience: 'student'
	},

	// ---- Item-only deep links (not surfaced on the browse page) ----
	'comp-bot-manual': {
		id: 'comp-bot-manual',
		title: 'Official competition bot build manual',
		blurb: '225 steps: drivetrain, attachment motors, SPIKE Prime hub, and framing.',
		source: 'Season Build Manual',
		url: COMP_BOT_MANUAL_URL,
		topics: [],
		audience: 'student'
	},
	'robot-designs': {
		id: 'robot-designs',
		title: 'Robot design and mechanism examples',
		blurb: 'Worked examples of gears, linkages, lifts, and grabbers.',
		source: 'PrimeLessons',
		url: 'https://primelessons.org/en/RobotDesigns.html',
		deeplinkLabel: 'More training designs',
		topics: [],
		audience: 'student'
	},
	'moving-straight': {
		id: 'moving-straight',
		title: 'Moving Straight',
		blurb: 'Tune your robot so it drives a true straight line.',
		source: 'PrimeLessons',
		url: `${PRIME}/SP3MovingStraight.pdf`,
		topics: [],
		audience: 'student'
	},

	// ---- Baby Sharks (FTC Team 33574) -- free course library, shared directly ----
	'baby-sharks-fll-coding': {
		id: 'baby-sharks-fll-coding',
		title: 'Baby Sharks FLL Coding Course',
		blurb:
			'Free SPIKE Prime word-block course from FTC Team 33574 -- beginner to advanced, with mini challenges throughout.',
		source: 'Baby Sharks (Team 33574)',
		url: BABY_SHARKS_FLL_CODING_URL,
		topics: ['driving', 'sensors', 'strategy'],
		audience: 'student'
	},
	'baby-sharks-l2-driving': {
		id: 'baby-sharks-l2-driving',
		title: 'Baby Sharks: L2 Basic Movement + L9 Gyro Straight',
		blurb: 'Driving and turning, from the Baby Sharks FLL Coding Course.',
		source: 'Baby Sharks (Team 33574)',
		url: `${BABY_SHARKS_FLL_CODING_URL}#page=9`,
		deeplinkLabel: 'Baby Sharks lesson',
		topics: [],
		audience: 'student'
	},
	'baby-sharks-l5-sensors': {
		id: 'baby-sharks-l5-sensors',
		title: 'Baby Sharks: L5 Sensors + L9 Line Following',
		blurb: 'Sensors and lines, from the Baby Sharks FLL Coding Course.',
		source: 'Baby Sharks (Team 33574)',
		url: `${BABY_SHARKS_FLL_CODING_URL}#page=15`,
		deeplinkLabel: 'Baby Sharks lesson',
		topics: [],
		audience: 'student'
	},
	'baby-sharks-l5-5-reliability': {
		id: 'baby-sharks-l5-5-reliability',
		title: 'Baby Sharks: L5.5 Robot Consistency + Troubleshooting',
		blurb: 'Consistency and reliability, from the Baby Sharks FLL Coding Course.',
		source: 'Baby Sharks (Team 33574)',
		url: `${BABY_SHARKS_FLL_CODING_URL}#page=19`,
		deeplinkLabel: 'Baby Sharks lesson',
		topics: [],
		audience: 'student'
	},
	// Optional, NOT FLL season content -- kept out of every topic band so they
	// never read as part of the season skill path.
	'baby-sharks-python': {
		id: 'baby-sharks-python',
		title: 'Baby Sharks Intro to Python Course',
		blurb:
			'Optional, not FLL content. 13 lessons, variables through try/except, ending in a from-scratch project -- runs free in the browser at online-python.com, no install.',
		source: 'Baby Sharks (Team 33574)',
		url: BABY_SHARKS_PYTHON_URL,
		topics: [],
		audience: 'student'
	},
	'baby-sharks-engineering': {
		id: 'baby-sharks-engineering',
		title: 'Baby Sharks Basic Engineering Course',
		blurb:
			'Optional, not FLL content. Design process, the five robot subsystems, gears and torque, simple machines, logic and pseudocode, a final design challenge, and a glossary -- aimed at late elementary and middle school.',
		source: 'Baby Sharks (Team 33574)',
		url: BABY_SHARKS_ENGINEERING_URL,
		topics: [],
		audience: 'student'
	},

	// ---- Mentor-only references ----
	'coachs-guide': {
		id: 'coachs-guide',
		title: "Coach's Guide",
		blurb: 'Season overview and coaching notes for mentors.',
		source: 'FLL Tutorials',
		url: `${FLLT}/en/worksheets/2020/07/17/Unofficial-Guide.html`,
		topics: [],
		audience: 'mentor'
	}
};

/** Resource ids shown in the mentor console's "Mentor-only references" section. */
export const MENTOR_LINK_IDS = ['coachs-guide', 'prime-index', 'fllt-index'];

/** Resource ids for the Resource Library's "Extra Learning" group -- optional,
 *  not FLL season content. */
export const EXTRA_LEARNING_IDS = ['baby-sharks-python', 'baby-sharks-engineering'];

export const ATTRIBUTION =
	'Skill lessons by PrimeLessons.org (CC-BY-NC-SA). Mission tutorials by FLL Tutorials. ' +
	'FLL Coding, Python, and Engineering courses by Baby Sharks, FTC Team 33574, linked with their permission, never copied.';

/** The resource behind an item's `resourceId`, or null. Returns the canonical
 *  entry with a derived `label` for the "Go deeper" affordance. */
export function resourceById(id: string | undefined): (Resource & { label: string }) | null {
	const res = id ? RESOURCES[id] : null;
	if (!res) return null;
	return { ...res, label: `${res.title} -- ${res.source}` };
}

/** Resources shown in the Resource Library's "Extra Learning" group. */
export function extraLearningResources(): Resource[] {
	return EXTRA_LEARNING_IDS.map((id) => RESOURCES[id]).filter((r): r is Resource => Boolean(r));
}

/** An item's deep links, PRIMARY FIRST: `resourceId`, then the optional
 *  `secondaryResourceId`. */
export function itemResources(item: {
	resourceId?: string;
	secondaryResourceId?: string;
}): (Resource & { label: string })[] {
	return [item.resourceId, item.secondaryResourceId]
		.map(resourceById)
		.filter((r): r is Resource & { label: string } => Boolean(r));
}

/** Library: student resources tagged with a given topic key, in insertion order. */
export function resourcesForTopic(topicKey: string): Resource[] {
	return Object.values(RESOURCES).filter(
		(r) => r.audience === 'student' && r.topics.includes(topicKey)
	);
}

/** The mentor console's mentor-only references, resolved to resource objects. */
export function mentorLinks(): Resource[] {
	return MENTOR_LINK_IDS.map((id) => RESOURCES[id]).filter((r): r is Resource => Boolean(r));
}

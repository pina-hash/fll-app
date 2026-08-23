// ---------------------------------------------------------------------------
// BIOGLOW 2026-2027 Robot Game -- mission editorial content, ported from
// fll-camp's src/state/missions.js.
//
// Source: official BIOGLOW Robot Game Rulebook (released 2026-08-04).
//
// WHAT LIVES HERE VS THE DATABASE. The mission's numbers (name, points,
// scoring lines, mat position) live in the `missions` table -- see
// supabase/migrations/0011_missions_and_team_notes.sql -- because a mentor
// edits the mat position at runtime and the next bundle's route planner
// references a mission by database id. Everything here is prose that never
// changes at runtime: the plain-language description, the conditions that cap
// or zero a score, and the strategy-notes prompt. Joined to the database row
// by `code`, which must never be renumbered.
// ---------------------------------------------------------------------------

import type { MatchBasicItem, MissionContent } from './types';

export const MISSION_CONTENT: MissionContent[] = [
	{
		code: 'M01',
		title: 'Drone Survey',
		description:
			'Get the drone completely off the mat, and, for the bonus, flip the LiDAR map and put the scan marker in the survey area.',
		caveats: [],
		prompt: 'How do you lift the drone clear? Same launch as the LiDAR map, or separate?'
	},
	{
		code: 'M02',
		title: 'Exploding Seeds',
		description: 'Knock or pull seeds off the stalk. Every seed that comes off scores.',
		caveats: [],
		prompt: 'One pass or several? What shape of attachment sweeps the most seeds at once?'
	},
	{
		code: 'M03',
		title: 'Flip the Rock',
		description: 'Put the research flag down. Bring the rock back to your start area for the bonus.',
		caveats: [],
		prompt: 'Can you carry the rock home on the same trip, or does it need its own launch?'
	},
	{
		code: 'M04',
		title: 'Lucky Leaves',
		description:
			'Remove a leaf for the base points; remove the second leaf and leave the katydid where it started for the bonus.',
		caveats: ['Scores ZERO if the katydid leaves the habitat area.'],
		prompt: 'How do you take leaves without nudging the katydid? Practise this one slowly.'
	},
	{
		code: 'M05',
		title: 'Reaching Roots',
		description: 'Extend the plant root. Partly out scores; all the way out scores double.',
		caveats: ['Only one of the two scores -- you get 10 OR 20, not both.'],
		prompt: 'What pushes the root all the way? Test how far "completely" really is.'
	},
	{
		code: 'M06',
		title: 'Leafcutter Frenzy',
		description:
			'Get leaf fragments contained with the ant touching the nest -- every contained fragment scores.',
		caveats: ['The ant must be touching the nest for any fragment to count.'],
		prompt: 'Where do the fragments end up? Plan the ant first, then deliver fragments.'
	},
	{
		code: 'M07',
		title: 'Humongous Fungus',
		description:
			"Extend the mycelium completely. Connecting to the opposing team's extended root adds a bonus, and two bonuses are possible.",
		caveats: ['Two bonuses are possible -- the other team has to extend their root too.'],
		prompt: 'This one needs the other team. What do you ask them for before the match?'
	},
	{
		code: 'M08',
		title: 'Tangled',
		description: 'Get the vine touching the mat.',
		caveats: [],
		prompt: '30 points in one action -- worth a dedicated attachment. What pulls the vine down?'
	},
	{
		code: 'M09',
		title: 'Research Platform',
		description:
			'Three separate scores at one model: raise the platform, deploy the camera trap, and get the seed off the tree.',
		caveats: [],
		prompt: 'Can one attachment take all three? Which order costs the least time?'
	},
	{
		code: 'M10',
		title: 'Fragile Microhabitats',
		description: 'Get the root cover down and touching the mat.',
		caveats: [],
		prompt: 'A simple push? Check what the robot might knock on the way in.'
	},
	{
		code: 'M11',
		title: 'Window to the Past',
		description: 'Both habitats score separately, and only if they stay exactly where they started.',
		caveats: ['Points are for NOT disturbing them -- plan a path that stays clear.'],
		prompt: 'Which of your runs drives near this model? Route around it.'
	},
	{
		code: 'M12',
		title: 'Forest Elder',
		description: 'Raise the cane so it touches the tree, and get the support tie around the post.',
		caveats: [],
		prompt: 'Two different actions. Same trip, or split them across launches?'
	},
	{
		code: 'M13',
		title: 'Keystone Species',
		description:
			'Get the keystone species onto the restoration platform with the young trees raised. All of it, or nothing.',
		caveats: ['All-or-nothing -- both conditions must be true.'],
		prompt: '30 points, but strict. What is your reliable delivery method?'
	},
	{
		code: 'M14',
		title: 'Seeds of Renewal',
		description:
			'Deliver seeds into the replantation station. Each seed also touching the mat scores an extra 5.',
		caveats: [],
		prompt: 'How many seeds can you carry in one trip? Do they land flat on the mat?'
	},
	{
		code: 'M15',
		title: 'Biocentric Architecture',
		description:
			'Three building actions, plus one bonus for matching the environment to the dock (mine, city, or farm).',
		caveats: ['Only ONE environmental match bonus is possible.'],
		prompt: 'Which environment are you matching, and who decides that before the match?'
	}
];

/** Editorial content for a mission `code`, or null. */
export function missionContent(code: string): MissionContent | null {
	return MISSION_CONTENT.find((m) => m.code === code) ?? null;
}

/** Match-wide points that are not a mission model. Same card treatment, but
 *  not a database row -- there is no mat position and no route-planner
 *  reference for these. */
export const MATCH_BASICS: MatchBasicItem[] = [
	{
		id: 'INSPECT',
		num: 'INSPECT',
		title: 'Equipment Inspection',
		pointsLabel: '20',
		description:
			'Everything you bring must fit inside one launch area and stay under 12 inches (about 30 cm) tall.',
		scoring: [{ label: 'All equipment fits in one launch area, under 12 in height', points: 20 }],
		caveats: [],
		prompt: 'List everything you bring to the table. Does it all fit? Measure it at practice.'
	},
	{
		id: 'TOKENS',
		num: 'TOKENS',
		title: 'Precision Tokens',
		pointsLabel: 'up to 50',
		description:
			'You start with 6 tokens worth 50 points. Every time you interrupt the robot outside home, you lose one. Score by how many you have left.',
		scoring: [
			{ label: '6 tokens left', points: 50 },
			{ label: '5 tokens left', points: 50 },
			{ label: '4 tokens left', points: 35 },
			{ label: '3 tokens left', points: 25 },
			{ label: '2 tokens left', points: 15 },
			{ label: '1 token left', points: 10 }
		],
		caveats: ['The first interruption is free -- the drop from 5 to 4 tokens is where it hurts.'],
		prompt: 'Which runs are risky enough to cost a token? Rehearse those until they are not.'
	}
];

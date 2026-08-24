// ---------------------------------------------------------------------------
// THE NOTEBOOK'S EDITORIAL CONTENT: the four judged sections, the prompts a
// nine-year-old answers, and what judges reward, all in this club's OWN
// words.
//
// COPYRIGHT. The official FIRST Engineering Notebook is copyrighted and
// nothing in this file is taken from it -- not a prompt, not a heading, not a
// layout. These sections map onto what judging SCORES (Robot Design, the
// Innovation Project, Core Values, and the season as a whole), which is a
// fact about the competition, not FIRST's prose. The app links to the
// official document through the Library's season documents and never
// reproduces a page of it.
//
// WRITING RULES (the readers are 9 to 13, many below grade level): a prompt
// asks for ONE thing, in one short sentence, with one short hint under it.
// No walls of text anywhere.
// ---------------------------------------------------------------------------

import type { TeamRole } from '$lib/console/types';

export type NotebookSectionId =
	| 'robot_design'
	| 'innovation_project'
	| 'core_values'
	| 'season_summary';

export interface NotebookPrompt {
	key: string;
	/** The question. One thing, asked plainly. */
	label: string;
	/** One short line of help under the question. */
	hint: string;
}

export interface NotebookSectionDef {
	id: NotebookSectionId;
	title: string;
	/** Short label for the phone-width tab bar. */
	short: string;
	/** One sentence to the student about what lives here. */
	lede: string;
	/** What judges reward, in our own words. */
	judgeNote: string;
	/** Roles that write here besides the Notebook and Values Lead. */
	contributorRoles: TeamRole[];
	prompts: NotebookPrompt[];
}

export const NOTEBOOK_SECTIONS: NotebookSectionDef[] = [
	{
		id: 'robot_design',
		title: 'Robot Design',
		short: 'Robot',
		lede: 'Tell the story of your robot: what you tried, what broke, and what you did next.',
		judgeNote:
			'Judges give points for showing HOW your robot got better. A try that failed and taught you something is worth writing down. Do not hide it!',
		contributorRoles: ['lead_builder', 'lead_programmer', 'run_captain'],
		prompts: [
			{
				key: 'rd-robot',
				label: 'Describe your robot.',
				hint: 'What does it look like? What parts does it use?'
			},
			{
				key: 'rd-attachment',
				label: 'Pick one attachment. How does it work?',
				hint: 'What mission is it for? What makes it grab or push?'
			},
			{
				key: 'rd-code',
				label: 'How does your robot know where to go?',
				hint: 'Sensors? Counting wheel turns? Tell us about one program.'
			},
			{
				key: 'rd-plan',
				label: 'What is your plan for the 2:30 match?',
				hint: 'Which missions first? Why that order?'
			}
		]
	},
	{
		id: 'innovation_project',
		title: 'Innovation Project',
		short: 'Project',
		lede: 'Your team found a real problem and invented a way to help. Write that story here.',
		judgeNote:
			'Judges want to see that you talked to real people and that your idea CHANGED after you listened. Show the before and the after.',
		contributorRoles: ['innovation_lead'],
		prompts: [
			{
				key: 'ip-problem',
				label: 'What problem did your team find?',
				hint: 'Who has this problem? Where did you see it?'
			},
			{
				key: 'ip-idea',
				label: 'What is your idea to help?',
				hint: 'Say it the way you would say it to a friend.'
			},
			{
				key: 'ip-asked',
				label: 'Who did you ask about it?',
				hint: 'An expert, a teacher, or someone who has the problem.'
			},
			{
				key: 'ip-better',
				label: 'How did your idea get better?',
				hint: 'What did you change after someone gave you feedback?'
			},
			{
				key: 'ip-shared',
				label: 'How did you share your idea?',
				hint: 'A poster, a model, a talk. Who saw it?'
			}
		]
	},
	{
		id: 'core_values',
		title: 'Core Values',
		short: 'Values',
		lede: 'How your team treats each other counts as much as the robot does.',
		judgeNote:
			'Judges watch how you work as a team all day, not just in the judging room. True stories about helping each other beat big words.',
		contributorRoles: [],
		prompts: [
			{
				key: 'cv-teamwork',
				label: 'Tell about a time your team worked together.',
				hint: 'What were you doing? Who did what?'
			},
			{
				key: 'cv-stuck',
				label: 'Tell about a time you got stuck and asked for help.',
				hint: 'Getting help is a skill. Who helped you?'
			},
			{
				key: 'cv-include',
				label: 'How does everyone on your team get a turn?',
				hint: 'Driving, building, coding, talking. How do you share?'
			},
			{
				key: 'cv-fun',
				label: 'What has been the most fun so far?',
				hint: 'One moment. Why was it fun?'
			}
		]
	},
	{
		id: 'season_summary',
		title: 'Season Summary',
		short: 'Season',
		lede: 'The whole season on one page: the numbers, the wins, and what you learned.',
		judgeNote:
			'The session recaps below fill this in as you go, so December is easy. Judges love a team that can say what they learned.',
		contributorRoles: [],
		prompts: [
			{
				key: 'ss-proud',
				label: 'What is your team most proud of?',
				hint: 'One thing. It does not have to be the robot.'
			},
			{
				key: 'ss-hard',
				label: 'What was the hardest part of the season?',
				hint: 'And how did you get through it?'
			},
			{
				key: 'ss-next',
				label: 'What would you do differently next time?',
				hint: 'Every good team has an answer to this.'
			}
		]
	}
];

export function sectionDef(id: NotebookSectionId): NotebookSectionDef {
	return NOTEBOOK_SECTIONS.find((s) => s.id === id) ?? NOTEBOOK_SECTIONS[0];
}

/** The three answers to "what happened?" on a Robot Design try. */
export const OUTCOME_LABEL = {
	worked: 'It worked',
	failed: 'It failed',
	mixed: 'Half worked'
} as const;

/** Shown beside the failed option so nobody is shy about picking it. */
export const FAILED_ENCOURAGEMENT = 'Failures score points with judges. Write it down!';

/** The recap prompt: the ONE writing field on a session recap. */
export const RECAP_PROMPT = 'What should the notebook remember about today?';
export const RECAP_HINT = 'One or two sentences in your own words.';

/** Where the official document lives: the Library, never a rehosted copy. */
export const OFFICIAL_DOC_NOTE = 'Want the official FIRST notebook guide? It is in the Library under season documents.';

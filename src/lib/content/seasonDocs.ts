// ---------------------------------------------------------------------------
// OFFICIAL FIRST SEASON DOCUMENTS -- BIOGLOW 2026-27, ported from fll-camp's
// src/state/resources.js. Scope is deliberately narrow: FOUNDERS EDITION,
// GRADES 4-8 (CHALLENGE) only. Our four teams are Founders Edition Challenge
// teams -- do NOT add FLL Explore or Future Edition materials here.
//
// LINK ONLY. Never download, mirror, rehost, or reproduce FIRST content into
// this app -- same rule as PrimeLessons / FLL Tutorials / Baby Sharks.
//
// Tier 1 is the alert-worthy four documents a team needs in hand all season.
// Tier 2 is everything else, grouped. The Challenge Updates document overrides
// the Rulebook and FIRST revises it during the season -- `warn` on that entry
// is what renders it in the alert treatment; list position alone is not
// enough. On a dead Tier 2 link, point that one entry at
// SEASON_DOCS_SOURCE_URL rather than collapsing the whole block.
// ---------------------------------------------------------------------------

import type { SeasonDoc, SeasonDocGroup } from './types';

const FIRST_2026 = 'https://firstinspires.blob.core.windows.net/fll/challenge/2026-27';

/** The FIRST season materials index -- footer link only; every document above
 *  it is a direct link, so nobody has to go through here. */
export const SEASON_DOCS_SOURCE_URL =
	'https://www.firstinspires.org/resources/library/fll/season-materials';

/** Tier 1: always visible, no expand. The four documents a team actually
 *  needs in hand during the season. */
export const SEASON_DOC_TIER1: SeasonDoc[] = [
	{
		id: 'sd-rgr',
		title: 'Robot Game Rulebook',
		note: 'The rules of the robot game, mission by mission.',
		url: `${FIRST_2026}/fll-challenge-bioglow-rgr.pdf`,
		kind: 'pdf'
	},
	{
		id: 'sd-rgr-interactive',
		title: 'Robot Game Rulebook -- interactive version',
		note: 'The same rulebook as a browsable website, not a PDF.',
		url: `${FIRST_2026}/interactive-rgr/index.html`,
		kind: 'web'
	},
	{
		id: 'sd-updates',
		title: 'Challenge Updates',
		note: 'Last updated 8/04/26.',
		url: `${FIRST_2026}/fll-challenge-bioglow-updates.pdf`,
		kind: 'pdf',
		warn:
			'Rule corrections that override the Rulebook. FIRST changes this file ' +
			'during the season, re-check it before every tournament.'
	},
	{
		id: 'sd-en',
		title: 'Engineering Notebook',
		note: 'Where the team records the Innovation Project and robot design.',
		url: `${FIRST_2026}/fll-challenge-bioglow-en.pdf`,
		kind: 'pdf'
	}
];

/** Model building instruction books 1-13. Generated from the URL pattern so
 *  the two-digit zero padding can never drift. */
const MODEL_BOOKS: SeasonDoc[] = Array.from({ length: 13 }, (_, i) => {
	const n = String(i + 1).padStart(2, '0');
	return {
		id: `sd-bi-book-${n}`,
		title: `Model ${i + 1}`,
		url: `${FIRST_2026}/fll-challenge-bioglow-bi-enus-book-${n}.pdf`,
		kind: 'pdf' as const
	};
});

/** Tier 2: everything else, grouped and collapsed under its heading. */
export const SEASON_DOC_GROUPS: SeasonDocGroup[] = [
	{
		id: 'sdg-rules',
		label: 'Rules and participation',
		docs: [
			{
				id: 'sd-participation',
				title: 'Participation Rules',
				url: `${FIRST_2026}/fll-challenge-bioglow-participation-rules.pdf`,
				kind: 'pdf'
			},
			{
				id: 'sd-season-overview',
				title: 'Season Overview',
				url: `${FIRST_2026}/fll-challenge-bioglow-season-overview.pdf`,
				kind: 'pdf'
			},
			{
				id: 'sd-tmg',
				title: 'Team Meeting Guide',
				url: `${FIRST_2026}/fll-challenge-bioglow-tmg.pdf`,
				kind: 'pdf'
			}
		]
	},
	{
		id: 'sdg-judging',
		label: 'Judging and awards',
		docs: [
			{
				id: 'sd-rubrics-color',
				title: 'Rubrics -- color',
				url: `${FIRST_2026}/fll-challenge-bioglow-rubrics-color.pdf`,
				kind: 'pdf'
			},
			{
				id: 'sd-rubrics-grayscale',
				title: 'Rubrics -- grayscale, for printing',
				url: `${FIRST_2026}/fll-challenge-bioglow-rubrics-grayscale.pdf`,
				kind: 'pdf'
			},
			{
				id: 'sd-judging-flowchart',
				title: 'Judging Session Flow Chart',
				url: `${FIRST_2026}/fll-challenge-bioglow-judging-session-flowchart.pdf`,
				kind: 'pdf'
			},
			{
				id: 'sd-awards',
				title: 'Awards',
				url: `${FIRST_2026}/fll-challenge-bioglow-awards.pdf`,
				kind: 'pdf'
			}
		]
	},
	{
		id: 'sdg-field',
		label: 'Field and table setup',
		docs: [
			{
				id: 'sd-field-setup',
				title: 'Field Set-Up Reference Guide',
				url: `${FIRST_2026}/fll-challenge-bioglow-field-setup-reference-guide.pdf`,
				kind: 'pdf'
			},
			{
				id: 'sd-table-building',
				title: 'Robot Game Table Building Instructions',
				url: `${FIRST_2026}/fll-challenge-bioglow-table-building-instructions.pdf`,
				kind: 'pdf'
			},
			{
				id: 'sd-wireframe',
				title: 'Wireframe and Grid',
				url: `${FIRST_2026}/fll-challenge-bioglow-wireframe-grid.pdf`,
				kind: 'pdf'
			}
		]
	},
	{
		id: 'sdg-models',
		label: 'Mission model building instructions (English)',
		note:
			'Sort the LEGO bags by the bag number printed on them first, then open one ' +
			'model at a time, mixing elements between models is what costs a team hours.',
		docs: [
			{
				id: 'sd-bi-eop',
				title: 'Element Overview',
				url: `${FIRST_2026}/fll-challenge-bioglow-bi-enus-eop.pdf`,
				kind: 'pdf'
			},
			{
				id: 'sd-bi-prepack',
				title: 'Prepack Overview',
				url: `${FIRST_2026}/fll-challenge-bioglow-bi-enus-prepack.pdf`,
				kind: 'pdf'
			},
			...MODEL_BOOKS
		]
	},
	{
		id: 'sdg-scoring',
		label: 'Scoring',
		docs: [
			{
				id: 'sd-software-scoresheet',
				title: 'Robot Game Software Scoresheet',
				url: `${FIRST_2026}/fll-challenge-bioglow-software-scoresheet.pdf`,
				kind: 'pdf'
			},
			{
				id: 'sd-classpack-scoresheet',
				title: 'Class Pack Scoresheet',
				url: `${FIRST_2026}/fll-challenge-bioglow-classpack-scoresheet.pdf`,
				kind: 'pdf'
			},
			{
				id: 'sd-score-calculator',
				title: 'Online Score Calculator',
				url: 'https://eventhub.firstinspires.org/scoresheet',
				kind: 'web'
			}
		]
	},
	{
		id: 'sdg-videos',
		label: 'Videos',
		docs: [
			{
				id: 'sd-vid-missions',
				title: 'Robot Game Missions Video',
				url: 'https://youtu.be/uhZZ8O1StiQ',
				kind: 'video'
			},
			{
				id: 'sd-vid-field-setup',
				title: 'Field Set-Up Video',
				url: 'https://youtu.be/wDan0826cn0',
				kind: 'video'
			},
			{
				id: 'sd-vid-event',
				title: 'Preparing for your Event Video',
				url: 'https://youtu.be/9TMFtLKYT6o',
				kind: 'video'
			}
		]
	}
];

export const FIRST_ATTRIBUTION =
	'Official FIRST LEGO League publications (Founders Edition, Grades 4-8 ' +
	'Challenge). Linked directly, never copied.';

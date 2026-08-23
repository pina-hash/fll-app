// ---------------------------------------------------------------------------
// SKILL HUB CONTENT TYPES.
//
// Shared shapes for src/lib/content/*.ts, ported from fll-camp's src/state/
// content.js and resources.js. Typed modules (not JSON) so svelte-check
// catches a malformed entry at build time instead of at render time.
// ---------------------------------------------------------------------------

/** A resource-library source, drives the source chip on a resource card. */
export type ResourceSource =
	| 'PrimeLessons'
	| 'FLL Tutorials'
	| 'Season Build Manual'
	| 'Baby Sharks (Team 33574)';

export type ResourceAudience = 'student' | 'mentor';

export interface Resource {
	id: string;
	title: string;
	blurb: string;
	source: ResourceSource;
	url: string;
	topics: string[];
	audience: ResourceAudience;
	/** Overrides the "Go deeper" / "Also see" line on an item's detail sheet. */
	deeplinkLabel?: string;
}

/** A skill-hub item: one lesson card + one detail sheet, in a category whose
 *  `kind` is 'items'. */
export interface HubItem {
	id: string;
	num: string;
	title: string;
	description: string;
	lesson: string;
	/** "Missions this fits" -- ties a general skill back to specific missions. */
	fits?: string;
	prompt: string;
	resourceId?: string;
	secondaryResourceId?: string;
}

export interface HubCategoryItems {
	id: string;
	kind: 'items';
	label: string;
	short: string;
	icon: string;
	tagline: string;
	intro: string;
	items: HubItem[];
}

export interface HubCategoryMedia {
	id: string;
	kind: 'media';
	label: string;
	short: string;
	icon: string;
	tagline: string;
	intro: string;
}

export type HubCategory = HubCategoryItems | HubCategoryMedia;

/** One scoring line for a mission or match-wide item, in rulebook order. */
export interface ScoringLine {
	label: string;
	points: number;
	bonus?: boolean;
}

/** Editorial mission content -- everything about a mission that is prose, not
 *  a number a route planner reads. Joined to the `missions` database table by
 *  `code` at render time; see supabase/migrations/0011_missions_and_team_notes.sql. */
export interface MissionContent {
	code: string;
	title: string;
	description: string;
	caveats: string[];
	prompt: string;
}

/** A match-wide scoring item that is not a mission model (Equipment
 *  Inspection, Precision Tokens). Same card treatment as a mission, but not a
 *  database row -- there is nothing here a route planner needs to reference. */
export interface MatchBasicItem {
	id: string;
	num: string;
	title: string;
	pointsLabel: string;
	description: string;
	scoring: ScoringLine[];
	caveats: string[];
	prompt: string;
}

export type MediaKind = 'video' | 'guide';

export interface MediaItem {
	id: string;
	kind: MediaKind;
	title: string;
	subtitle?: string;
	source: string;
	url: string;
	topics: string[];
	series?: string;
	step?: number;
}

export interface MediaTopic {
	key: string;
	label: string;
}

export interface MediaSeries {
	id: string;
	label: string;
	note: string;
}

export type SeasonDocKind = 'pdf' | 'web' | 'video';

export interface SeasonDoc {
	id: string;
	title: string;
	url: string;
	kind: SeasonDocKind;
	note?: string;
	/** Renders the row in the alert treatment -- a rule change that overrides
	 *  the Rulebook, not just another document in the list. */
	warn?: string;
}

export interface SeasonDocGroup {
	id: string;
	label: string;
	note?: string;
	docs: SeasonDoc[];
}

export interface BabySharksLessonRow {
	num: string;
	title: string;
	page: number;
	note?: string;
}

export interface BabySharksCourse {
	id: string;
	badge: string;
	index: BabySharksLessonRow[];
}

/**
 * The shapes the notebook reads, and the defensive parsers that turn the
 * database's rows and jsonb payloads into them. Defensive for the same
 * reason console/types.ts is: a payload this code cannot understand must
 * degrade to "nothing to show", never throw under a child's finger.
 */
import type { TeamRole, MeetingKind } from '$lib/console/types';
import { TEAM_ROLES } from '$lib/console/types';
import type { NotebookSectionId } from '$lib/content/notebook';

export type NotebookOutcome = 'worked' | 'failed' | 'mixed';

export const NOTEBOOK_SECTION_IDS: NotebookSectionId[] = [
	'robot_design',
	'innovation_project',
	'core_values',
	'season_summary'
];

export interface NotebookEntryModel {
	id: string;
	teamId: string;
	section: NotebookSectionId;
	promptKey: string;
	title: string;
	body: string;
	outcome: NotebookOutcome | null;
	changeNote: string;
	evidenceId: string | null;
	authoredByStudentId: string | null;
	sortOrder: number;
	createdAt: string;
}

/**
 * One page in the bin: an entry a soft delete (0020) stamped, listed by
 * `notebook_bin` for MENTORS only. A child gets the ten-second undo; an
 * adult, who hears about it on Tuesday, gets this.
 */
export interface NotebookBinEntry {
	entryId: string;
	section: NotebookSectionId;
	title: string;
	body: string;
	deletedAt: string | null;
}

/** One photo from the season, offered to entries and shown in recaps. */
export interface SeasonPhoto {
	id: string;
	storagePath: string;
	caption: string | null;
}

export interface RecapFacts {
	generatedAt: string | null;
	present: string[];
	rosterSize: number;
	tasksClosed: { title: string; role: TeamRole | null }[];
	tasksOpened: number;
	photos: { caption: string | null; storagePath: string; taskTitle: string }[];
	blockersRaised: { note: string; resolved: boolean }[];
	blockersResolved: { note: string }[];
	runsCount: number;
	runsBest: number;
	strategyVersions: { version: number; label: string | null }[];
}

export interface MeetingRecapModel {
	id: string;
	meetingId: string;
	teamId: string;
	facts: RecapFacts | null;
	summary: string;
	confirmed: boolean;
	confirmedAt: string | null;
	confirmedByStudentId: string | null;
	meetingDate: string;
	meetingKind: MeetingKind;
}

export interface SeasonStats {
	meetingsHeld: number;
	recapsTotal: number;
	recapsConfirmed: number;
	tasksClosed: number;
	tasksClosedByRole: Partial<Record<TeamRole, number>>;
	blockersRaised: number;
	blockersResolved: number;
	photos: number;
	runs: number;
	bestPoints: number;
	strategyVersions: number;
}

function obj(v: unknown): Record<string, unknown> | null {
	return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function str(v: unknown): string | null {
	return typeof v === 'string' && v.length > 0 ? v : null;
}
function num(v: unknown): number {
	return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
function role(v: unknown): TeamRole | null {
	return TEAM_ROLES.includes(v as TeamRole) ? (v as TeamRole) : null;
}

/**
 * `notebook_bin`'s jsonb array. Defensive like every parser here: a payload
 * this code cannot read shows an empty bin, never a stack trace under a
 * mentor's finger.
 */
export function parseNotebookBin(raw: unknown): NotebookBinEntry[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.map((item) => {
			const o = obj(item);
			const id = o && str(o.entryId ?? o.entry_id);
			const section = o && str(o.section);
			if (!o || !id || !section || !NOTEBOOK_SECTION_IDS.includes(section as NotebookSectionId)) {
				return null;
			}
			return {
				entryId: id,
				section: section as NotebookSectionId,
				title: str(o.title) ?? '',
				body: str(o.body) ?? '',
				deletedAt: str(o.deleted_at)
			};
		})
		.filter((e): e is NotebookBinEntry => e !== null);
}

/** Null when the payload is not a recap draft at all (an empty `{}` is one). */
export function parseRecapFacts(raw: unknown): RecapFacts | null {
	const r = obj(raw);
	if (!r) return null;
	return {
		generatedAt: str(r.generated_at),
		present: Array.isArray(r.present) ? r.present.filter((p): p is string => typeof p === 'string') : [],
		rosterSize: num(r.roster_size),
		tasksClosed: Array.isArray(r.tasks_closed)
			? r.tasks_closed
					.map((t) => {
						const o = obj(t);
						return o ? { title: str(o.title) ?? '', role: role(o.role) } : null;
					})
					.filter((t): t is { title: string; role: TeamRole | null } => t !== null)
			: [],
		tasksOpened: num(r.tasks_opened),
		photos: Array.isArray(r.photos)
			? r.photos
					.map((p) => {
						const o = obj(p);
						const path = o && str(o.storage_path);
						return o && path
							? { caption: str(o.caption), storagePath: path, taskTitle: str(o.task_title) ?? '' }
							: null;
					})
					.filter((p): p is { caption: string | null; storagePath: string; taskTitle: string } => p !== null)
			: [],
		blockersRaised: Array.isArray(r.blockers_raised)
			? r.blockers_raised
					.map((b) => {
						const o = obj(b);
						return o ? { note: str(o.note) ?? '', resolved: o.resolved === true } : null;
					})
					.filter((b): b is { note: string; resolved: boolean } => b !== null)
			: [],
		blockersResolved: Array.isArray(r.blockers_resolved)
			? r.blockers_resolved
					.map((b) => {
						const o = obj(b);
						return o ? { note: str(o.note) ?? '' } : null;
					})
					.filter((b): b is { note: string } => b !== null)
			: [],
		runsCount: num(obj(r.runs)?.count),
		runsBest: num(obj(r.runs)?.best_points),
		strategyVersions: Array.isArray(r.strategy_versions)
			? r.strategy_versions
					.map((s) => {
						const o = obj(s);
						return o ? { version: num(o.version), label: str(o.label) } : null;
					})
					.filter((s): s is { version: number; label: string | null } => s !== null)
			: []
	};
}

export function parseSeasonStats(raw: unknown): SeasonStats | null {
	const r = obj(raw);
	if (!r) return null;
	const byRole: Partial<Record<TeamRole, number>> = {};
	const byRoleRaw = obj(r.tasks_closed_by_role);
	if (byRoleRaw) {
		for (const [k, v] of Object.entries(byRoleRaw)) {
			const rr = role(k);
			if (rr) byRole[rr] = num(v);
		}
	}
	return {
		meetingsHeld: num(r.meetings_held),
		recapsTotal: num(r.recaps_total),
		recapsConfirmed: num(r.recaps_confirmed),
		tasksClosed: num(r.tasks_closed),
		tasksClosedByRole: byRole,
		blockersRaised: num(r.blockers_raised),
		blockersResolved: num(r.blockers_resolved),
		photos: num(r.photos),
		runs: num(r.runs),
		bestPoints: num(r.best_points),
		strategyVersions: num(r.strategy_versions)
	};
}

/** Only camera formats a printed page can show; videos stay in the app. */
export function isImagePath(path: string): boolean {
	return /\.(jpe?g|png|webp)$/i.test(path);
}

export function bySortThenCreated(
	a: { sortOrder: number; createdAt: string },
	b: { sortOrder: number; createdAt: string }
): number {
	return a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt);
}

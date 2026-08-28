/**
 * The one loader for everything the notebook needs, used by the mentor
 * console pages, the student page and both print views alike. Every read is
 * scoped by RLS; the eq(team_id) filters are for the query planner, not for
 * safety (tests/notebook-isolation proves the difference).
 *
 * `canEdit` is answered by the DATABASE (notebook_can_edit, the same function
 * every notebook policy calls), once per section, so the UI affordance and
 * the enforcement can never drift apart. Since 0026 that answer is the same
 * for all four sections for a given caller (any mentor, any student on the
 * team), and it is still asked per section because the section parameter is
 * the seam a future section-level rule would come back through.
 *
 * `canConfirm` is the second, narrower answer, from notebook_can_confirm
 * (0026): finishing a session recap or reopening one stays with the Notebook
 * and Values Lead and mentors, because a confirmed recap stops regenerating
 * and the word has to keep meaning something. Everyone writes the summary;
 * one person says it is finished.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/database.types';
import { parseResolvedRoles, type ResolvedRole } from '$lib/console/types';
import type { NotebookSectionId } from '$lib/content/notebook';
import {
	NOTEBOOK_SECTION_IDS,
	bySortThenCreated,
	isImagePath,
	parseRecapFacts,
	parseSeasonStats,
	type MeetingRecapModel,
	type NotebookEntryModel,
	type SeasonPhoto,
	type SeasonStats
} from './types';

type Client = SupabaseClient<Database>;

export interface NotebookData {
	entries: NotebookEntryModel[];
	recaps: MeetingRecapModel[];
	canEdit: Record<NotebookSectionId, boolean>;
	/** May this caller mark a session recap finished, or reopen one? */
	canConfirm: boolean;
	stats: SeasonStats | null;
	roles: ResolvedRole[];
	/** id -> "First L." for bylines. */
	studentNames: Record<string, string>;
	/** The season's photos, offered to entries and shown in recaps. */
	photos: SeasonPhoto[];
	/** Signed URL per storage_path, for every image the notebook can show. */
	photoUrls: Record<string, string>;
}

/** Print wants a page that outlives the judging queue; the app can be shorter. */
const SIGNED_URL_SECONDS = 60 * 60 * 8;

export async function loadNotebookData(supabase: Client, teamId: string): Promise<NotebookData> {
	const [
		entriesRes,
		recapsRes,
		statsRes,
		rolesRes,
		studentsRes,
		evidenceRes,
		canConfirmRes,
		...canEditRes
	] = await Promise.all([
		supabase
			.from('notebook_entries')
			.select(
				'id, team_id, section, prompt_key, title, body, outcome, change_note, evidence_id, authored_by_student_id, sort_order, created_at'
			)
			.eq('team_id', teamId),
		supabase
			.from('meeting_recaps')
			.select(
				'id, meeting_id, team_id, draft, summary, confirmed, confirmed_at, confirmed_by_student_id, meetings (meeting_date, kind, started_at)'
			)
			.eq('team_id', teamId),
		supabase.rpc('notebook_season_stats', { p_team_id: teamId }),
		supabase.rpc('team_resolve_roles', { p_team_id: teamId }),
		supabase
			.from('students')
			.select('id, first_name, last_initial')
			.eq('team_id', teamId)
			.is('deactivated_at', null),
		supabase
			.from('evidence')
			.select('id, storage_path, caption, upload_timestamp')
			.eq('team_id', teamId)
			.order('upload_timestamp', { ascending: false })
			.limit(200),
		supabase.rpc('notebook_can_confirm', { p_team_id: teamId }),
		...NOTEBOOK_SECTION_IDS.map((section) =>
			supabase.rpc('notebook_can_edit', { p_team_id: teamId, p_section: section })
		)
	]);

	const entries: NotebookEntryModel[] = (entriesRes.data ?? [])
		.map((e) => ({
			id: e.id,
			teamId: e.team_id,
			section: e.section as NotebookSectionId,
			promptKey: e.prompt_key,
			title: e.title,
			body: e.body,
			outcome: e.outcome,
			changeNote: e.change_note,
			evidenceId: e.evidence_id,
			authoredByStudentId: e.authored_by_student_id,
			sortOrder: e.sort_order,
			createdAt: e.created_at
		}))
		.sort(bySortThenCreated);

	const recaps: MeetingRecapModel[] = (recapsRes.data ?? [])
		.map((r) => ({
			id: r.id,
			meetingId: r.meeting_id,
			teamId: r.team_id,
			facts: parseRecapFacts(r.draft),
			summary: r.summary,
			confirmed: r.confirmed,
			confirmedAt: r.confirmed_at,
			confirmedByStudentId: r.confirmed_by_student_id,
			meetingDate: r.meetings?.meeting_date ?? '',
			meetingKind: (r.meetings?.kind ?? 'friday') as MeetingRecapModel['meetingKind'],
			startedAt: r.meetings?.started_at ?? null
		}))
		.sort((a, b) => (b.startedAt ?? b.meetingDate).localeCompare(a.startedAt ?? a.meetingDate))
		.map(({ startedAt: _startedAt, ...recap }) => recap);

	const canEdit = Object.fromEntries(
		NOTEBOOK_SECTION_IDS.map((section, i) => [section, canEditRes[i]?.data === true])
	) as Record<NotebookSectionId, boolean>;

	const studentNames: Record<string, string> = {};
	for (const s of studentsRes.data ?? []) {
		studentNames[s.id] = `${s.first_name} ${s.last_initial}.`;
	}

	const photos: SeasonPhoto[] = (evidenceRes.data ?? [])
		.filter((e) => isImagePath(e.storage_path))
		.map((e) => ({ id: e.id, storagePath: e.storage_path, caption: e.caption }));

	// One batch call signs every image the notebook can show: entry photos,
	// recap photos and the picker thumbnails all read from this map.
	const recapPaths = recaps.flatMap((r) => (r.facts?.photos ?? []).map((p) => p.storagePath));
	const allPaths = [...new Set([...photos.map((p) => p.storagePath), ...recapPaths])].filter(isImagePath);
	const photoUrls: Record<string, string> = {};
	if (allPaths.length > 0) {
		const { data: signed } = await supabase.storage
			.from('evidence')
			.createSignedUrls(allPaths, SIGNED_URL_SECONDS);
		for (const s of signed ?? []) {
			if (s.path && s.signedUrl && !s.error) photoUrls[s.path] = s.signedUrl;
		}
	}

	return {
		entries,
		recaps,
		canEdit,
		canConfirm: canConfirmRes.data === true,
		stats: parseSeasonStats(statsRes.data),
		roles: parseResolvedRoles(rolesRes.data),
		studentNames,
		photos,
		photoUrls
	};
}

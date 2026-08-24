<script lang="ts">
	/**
	 * Fixtures for the real Notebook and NotebookPrint components. The persist
	 * log at the bottom is the harness's reason to exist: every op the
	 * notebook would have queued is appended there, so a tap on Save
	 * observably becomes a `notebook_insert` line. That is the sentinel round
	 * trip.
	 */
	import { page } from '$app/state';
	import Notebook from '$lib/notebook/Notebook.svelte';
	import NotebookPrint from '$lib/notebook/NotebookPrint.svelte';
	import type { NotebookOp } from '$lib/notebook/ops';
	import type { MeetingRecapModel, NotebookEntryModel, SeasonStats } from '$lib/notebook/types';
	import type { NotebookSectionId } from '$lib/content/notebook';
	import type { ResolvedRole } from '$lib/console/types';
	import type { ConnectionState } from '$lib/student/queue.svelte';

	type Scenario = 'lead' | 'builder' | 'viewer' | 'mentor';
	type View = 'app' | 'print';
	// ?view=print&scenario=builder preselects a state, so the print document
	// is reachable by URL (headless print-to-PDF drives it that way).
	let scenario = $state<Scenario>(
		(['lead', 'builder', 'viewer', 'mentor'] as const).find((s) => s === page.url.searchParams.get('scenario')) ?? 'lead'
	);
	let view = $state<View>(page.url.searchParams.get('view') === 'print' ? 'print' : 'app');
	let connection = $state<ConnectionState>('online');
	let log = $state<string[]>([]);

	function record(op: NotebookOp) {
		const detail =
			op.kind === 'notebook_update' || op.kind === 'notebook_delete' || op.kind === 'recap_update'
				? `${op.kind} ${op.id.slice(0, 8)}`
				: op.kind;
		log = [...log, `${log.length + 1}. ${detail}`];
	}

	const TEAM = { id: 'fixture-team', name: 'Green Team' };

	// A photo that needs no network: the data URI stands in for a signed
	// storage URL, so the image path renders in the harness and in its PDF.
	const PHOTO_PATH = 'fixture-team/fixture-task/fixture-photo.jpg';
	const PHOTO_URI =
		'data:image/svg+xml;utf8,' +
		encodeURIComponent(
			'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#9be89b"/><text x="160" y="120" text-anchor="middle" font-family="sans-serif" font-size="20">scoop + rock</text></svg>'
		);
	const PHOTOS = [{ id: 'fx-evidence-1', storagePath: PHOTO_PATH, caption: 'The scoop holding the rock.' }];
	const PHOTO_URLS = { [PHOTO_PATH]: PHOTO_URI };

	const LEAD_ID = 'fixture-lead';
	const BUILDER_ID = 'fixture-builder';
	const VIEWER_ID = 'fixture-viewer';

	const STUDENT_NAMES: Record<string, string> = {
		[LEAD_ID]: 'Noa V.',
		[BUILDER_ID]: 'Ben B.',
		[VIEWER_ID]: 'Cara C.'
	};

	const E = (
		id: string,
		section: NotebookSectionId,
		promptKey: string,
		title: string,
		body: string,
		outcome: 'worked' | 'failed' | 'mixed' | null,
		changeNote: string,
		author: string | null
	): NotebookEntryModel => ({
		id,
		teamId: TEAM.id,
		section,
		promptKey,
		title,
		body,
		outcome,
		changeNote,
		evidenceId: null,
		authoredByStudentId: author,
		sortOrder: 0,
		createdAt: '2026-08-01T00:00:00Z'
	});

	const ENTRIES: NotebookEntryModel[] = [
		E(
			'fx-try-1',
			'robot_design',
			'',
			'A claw arm for the rock mission',
			'The claw grabbed the rock but dropped it on the turn. It fell off three runs in a row.',
			'failed',
			'We swapped the claw for a scoop, because a scoop cannot drop what it never grips.',
			BUILDER_ID
		),
		{
			...E(
				'fx-try-2',
				'robot_design',
				'',
				'The scoop attachment',
				'The scoop carried the rock home every run today. Ten out of ten tries.',
				'worked',
				'',
				BUILDER_ID
			),
			evidenceId: 'fx-evidence-1'
		},
		E(
			'fx-rd-1',
			'robot_design',
			'rd-robot',
			'',
			'Our robot is a two-motor box bot with a color sensor at the front. We call it Glowbug.',
			null,
			'',
			BUILDER_ID
		),
		E(
			'fx-ip-1',
			'innovation_project',
			'ip-problem',
			'',
			'Fireflies are disappearing near our school because the field lights stay on all night.',
			null,
			'',
			LEAD_ID
		),
		E(
			'fx-cv-1',
			'core_values',
			'cv-stuck',
			'',
			'Our program kept turning the wrong way. We asked the Blue Team and they showed us the gyro trick.',
			null,
			'',
			LEAD_ID
		),
		E(
			'fx-ss-1',
			'season_summary',
			'ss-proud',
			'',
			'We are most proud that everyone on the team drove the robot at least once.',
			null,
			'',
			LEAD_ID
		)
	];

	const RECAPS: MeetingRecapModel[] = [
		{
			id: 'fx-recap-2',
			meetingId: 'fx-meeting-2',
			teamId: TEAM.id,
			facts: {
				generatedAt: '2026-08-21T01:00:00Z',
				present: ['Ben B.', 'Cara C.', 'Noa V.'],
				rosterSize: 6,
				tasksClosed: [
					{ title: 'Build the scoop attachment', role: 'lead_builder' },
					{ title: 'Test the rock run three times', role: 'run_captain' }
				],
				tasksOpened: 1,
				photos: [{ caption: 'The scoop holding the rock.', storagePath: PHOTO_PATH, taskTitle: 'Build the scoop attachment' }],
				blockersRaised: [{ note: 'The motor cable keeps popping out.', resolved: true }],
				blockersResolved: [{ note: 'The motor cable keeps popping out.' }],
				runsCount: 3,
				runsBest: 85,
				strategyVersions: [{ version: 2, label: 'Scoop first' }]
			},
			summary: '',
			confirmed: false,
			confirmedAt: null,
			confirmedByStudentId: null,
			meetingDate: '2026-08-20',
			meetingKind: 'friday'
		},
		{
			id: 'fx-recap-1',
			meetingId: 'fx-meeting-1',
			teamId: TEAM.id,
			facts: {
				generatedAt: '2026-08-15T01:00:00Z',
				present: ['Ben B.', 'Noa V.'],
				rosterSize: 6,
				tasksClosed: [{ title: 'Sketch the claw arm', role: 'lead_builder' }],
				tasksOpened: 2,
				photos: [],
				blockersRaised: [],
				blockersResolved: [],
				runsCount: 0,
				runsBest: 0,
				strategyVersions: []
			},
			summary: 'We planned the claw and split up the missions.',
			confirmed: true,
			confirmedAt: '2026-08-15T01:10:00Z',
			confirmedByStudentId: LEAD_ID,
			meetingDate: '2026-08-14',
			meetingKind: 'friday'
		}
	];

	const STATS: SeasonStats = {
		meetingsHeld: 2,
		recapsTotal: 2,
		recapsConfirmed: 1,
		tasksClosed: 3,
		tasksClosedByRole: { lead_builder: 2, run_captain: 1 },
		blockersRaised: 1,
		blockersResolved: 1,
		photos: 0,
		runs: 3,
		bestPoints: 85,
		strategyVersions: 2
	};

	const R = (
		role: ResolvedRole['role'],
		primaryId: string | null,
		primaryName: string | null,
		secondName: string | null
	): ResolvedRole => ({
		role,
		primary_student_id: primaryId,
		primary_name: primaryName,
		primary_present: false,
		second_student_id: null,
		second_name: secondName,
		second_present: false,
		active_student_id: null,
		active_tier: null,
		active_name: null,
		unfilled: primaryName === null,
		has_second: secondName !== null
	});

	const ROLES: ResolvedRole[] = [
		R('lead_builder', BUILDER_ID, 'Ben B.', 'Cara C.'),
		R('lead_programmer', null, 'Maya K.', null),
		R('run_captain', null, 'Leo P.', null),
		R('innovation_lead', null, 'Sam D.', null),
		R('notebook_values_lead', LEAD_ID, 'Noa V.', null)
	];

	const ALL = { robot_design: true, innovation_project: true, core_values: true, season_summary: true };
	const NONE = { robot_design: false, innovation_project: false, core_values: false, season_summary: false };

	let canEdit = $derived(
		scenario === 'lead' || scenario === 'mentor'
			? ALL
			: scenario === 'builder'
				? { ...NONE, robot_design: true }
				: NONE
	);
	let myStudentId = $derived(scenario === 'mentor' ? null : scenario === 'lead' ? LEAD_ID : scenario === 'builder' ? BUILDER_ID : VIEWER_ID);
</script>

<svelte:head><title>Notebook harness</title></svelte:head>

<div class="hz">
	<header class="hz__bar">
		<strong>Notebook harness</strong>
		<label class="hz__ctl">
			<span>Scenario</span>
			<select bind:value={scenario}>
				<option value="lead">Notebook Lead</option>
				<option value="builder">Lead Builder</option>
				<option value="viewer">No role</option>
				<option value="mentor">Mentor</option>
			</select>
		</label>
		<label class="hz__ctl">
			<span>View</span>
			<select bind:value={view}>
				<option value="app">App</option>
				<option value="print">Print</option>
			</select>
		</label>
		<label class="hz__ctl">
			<span>Connection</span>
			<select bind:value={connection}>
				<option value="online">online</option>
				<option value="syncing">syncing</option>
				<option value="offline">offline</option>
			</select>
		</label>
	</header>

	{#key scenario + view}
		{#if view === 'print'}
			<NotebookPrint
				team={{ name: TEAM.name, fllTeamNumber: 60660 }}
				entries={ENTRIES}
				recaps={RECAPS}
				stats={STATS}
				roles={ROLES}
				studentNames={STUDENT_NAMES}
				photos={PHOTOS}
				photoUrls={PHOTO_URLS}
				backHref="/dev/notebook"
			/>
		{:else}
			<div class="hz__app" data-accent="chartreuse">
				<Notebook
					team={TEAM}
					isMentor={scenario === 'mentor'}
					{myStudentId}
					{canEdit}
					entries={ENTRIES}
					recaps={RECAPS}
					stats={STATS}
					roles={ROLES}
					studentNames={STUDENT_NAMES}
					photos={PHOTOS}
					photoUrls={PHOTO_URLS}
					{connection}
					pendingCount={connection === 'offline' ? 2 : 0}
					failed={[]}
					printHref="/dev/notebook"
					onPersist={record}
					onDismissFailure={() => {}}
				/>
			</div>
		{/if}
	{/key}

	<section class="hz__log" aria-label="Persist log">
		<strong>Persist log</strong>
		{#if log.length === 0}
			<p class="hz__quiet">No ops yet. Edit something above.</p>
		{/if}
		<ol class="hz__lines">
			{#each log as line, i (i)}
				<li>{line}</li>
			{/each}
		</ol>
	</section>
</div>

<style>
	.hz {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3);
		background: var(--surface-0);
	}
	.hz__bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--boundary);
		border-radius: var(--radius-control);
	}
	.hz__ctl {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--text-2);
	}
	.hz__app {
		min-width: 0;
	}
	.hz__log {
		border: 1px dashed var(--boundary);
		border-radius: var(--radius-control);
		padding: var(--space-3);
		color: var(--text-2);
	}
	.hz__quiet {
		margin: var(--space-2) 0 0;
		color: var(--text-3);
	}
	.hz__lines {
		margin: var(--space-2) 0 0;
		padding-left: 1.4rem;
		font-family: var(--font-mono);
	}
	/* Printing the harness prints only the document under test. */
	@media print {
		.hz {
			padding: 0;
			background: #ffffff;
		}
		.hz__bar,
		.hz__log {
			display: none;
		}
	}
</style>

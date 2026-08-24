<script lang="ts">
	/**
	 * MY SCREEN. Everything a nine-to-thirteen year old sees on their own phone
	 * during a session, and the only screen most of them will ever open.
	 *
	 * ONE QUESTION PER SCREEN: what am I doing right now. The phase and its
	 * countdown are the top third because that is the thing that changes under
	 * them. Their role is next, in words, because a kid who does not know they
	 * are covering will not do the job. Their queue is below that, and I'M
	 * STUCK is pinned to the bottom where a thumb already is.
	 *
	 * PURE PROPS, NO DATA ACCESS. Nothing here touches Supabase, the session,
	 * the write queue or the clock: the page above owns all four, and
	 * /dev/student-screen mounts THIS component with fixtures. That is what
	 * makes the harness a test of the real screen rather than of a copy.
	 *
	 * READING LEVEL. Short sentences, no jargon, no word a fourth grader would
	 * stumble on. "Nobody is in this seat" rather than "role unfilled".
	 */
	import { formatClock, phaseClock } from '$lib/console/clock';
	import { ROLE_LABEL, type BoardMeeting, type TeamAccent } from '$lib/console/types';
	import { STUCK_REASONS, type MyRole, type StudentTask } from './types';
	import type { ConnectionState } from './queue.svelte';

	interface Props {
		team: { name: string; accent: TeamAccent | null; joinCode: string };
		me: { studentId: string; firstName: string; lastInitial: string };
		meeting: BoardMeeting | null;
		/** Server-corrected wall clock, in milliseconds. */
		nowMs: number;
		checkedIn: boolean;
		myRole: MyRole | null;
		tasks: StudentTask[];
		connection: ConnectionState;
		pendingCount: number;
		failed?: { id: string; message: string }[];
		busy?: string;
		onCheckIn?: () => void;
		onClaim?: (taskId: string) => void;
		onDone?: (taskId: string) => void;
		onEvidence?: (taskId: string, file: File, caption: string) => void;
		onStuck?: (note: string, taskId: string | null) => void;
		onDismissFailure?: (id: string) => void;
		teamHref?: string;
		planHref?: string;
		matchHref?: string;
		notebookHref?: string;
		libraryHref?: string;
	}

	let {
		team,
		me,
		meeting,
		nowMs,
		checkedIn,
		myRole,
		tasks,
		connection,
		pendingCount,
		failed = [],
		busy = '',
		onCheckIn,
		onClaim,
		onDone,
		onEvidence,
		onStuck,
		onDismissFailure,
		teamHref = '/app/me/team',
		planHref = '/app/me/plan',
		matchHref = '/app/me/match',
		notebookHref = '/app/me/notebook',
		libraryHref = '/app/library'
	}: Props = $props();

	let running = $derived(Boolean(meeting?.started_at && !meeting?.ended_at));
	let phase = $derived(meeting?.phase ?? null);
	let clock = $derived(phaseClock(phase, nowMs));

	// --- I'm stuck -----------------------------------------------------------
	let stuckOpen = $state(false);
	let stuckNote = $state('');
	let stuckTaskId = $state<string | null>(null);

	function openStuck(taskId: string | null) {
		stuckTaskId = taskId;
		stuckNote = '';
		stuckOpen = true;
	}
	function sendStuck(note: string) {
		const text = note.trim();
		if (!text) return;
		onStuck?.(text, stuckTaskId);
		stuckOpen = false;
		stuckNote = '';
	}

	// --- evidence ------------------------------------------------------------
	let evidenceFor = $state<StudentTask | null>(null);
	let caption = $state('');
	let chosen = $state<File | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);

	function openEvidence(task: StudentTask) {
		evidenceFor = task;
		caption = '';
		chosen = null;
		// Opening the camera is a user gesture, so it has to happen inside the
		// click handler chain, not in an effect.
		queueMicrotask(() => fileInput?.click());
	}
	function pickFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		chosen = input.files?.[0] ?? null;
	}
	function sendEvidence() {
		if (!evidenceFor || !chosen) return;
		onEvidence?.(evidenceFor.id, chosen, caption.trim());
		evidenceFor = null;
		chosen = null;
		caption = '';
	}

	const connectionCopy = {
		online: 'Saved',
		syncing: 'Saving',
		offline: 'No wifi'
	} as const;

	function canFinish(task: StudentTask): boolean {
		return !task.evidence_required || task.evidence_count > 0;
	}
</script>

<div class="sr" data-accent={team.accent}>
	<header class="sr__top">
		<span class="sr__team">{team.name}</span>
		<span class="sr__who">{me.firstName} {me.lastInitial}.</span>
		<span class="sr__net" data-state={connection}>
			<span class="sr__netdot" aria-hidden="true"></span>
			{connectionCopy[connection]}{#if pendingCount > 0}&nbsp;{pendingCount}{/if}
		</span>
	</header>

	{#if failed.length > 0}
		<section class="sr__failed" role="alert">
			<h2>Something did not save</h2>
			{#each failed as f (f.id)}
				<p class="sr__failedrow">
					<span>{f.message}</span>
					<button class="btn btn--ghost btn--small" onclick={() => onDismissFailure?.(f.id)}>OK</button>
				</p>
			{/each}
		</section>
	{/if}

	{#if !meeting || !running}
		<!-- No meeting: say so and show nothing else. -->
		<section class="sr__empty">
			<p class="sr__bighello">Hi, {me.firstName}!</p>
			<p class="sr__emptymsg">No meeting is running right now.</p>
			<p class="sr__emptysub">Come back when your mentor starts the session.</p>
		</section>
	{:else if !checkedIn}
		<!-- Check in: one question, one button, nothing else on the screen. -->
		<section class="sr__checkin">
			<p class="sr__bighello">Hi, {me.firstName}!</p>
			<p class="sr__emptysub">Tap to tell your mentor you are here.</p>
			<button class="sr__checkbtn" disabled={busy === 'checkin'} onclick={() => onCheckIn?.()}>
				{busy === 'checkin' ? 'One moment' : "I'm here"}
			</button>
		</section>
	{:else}
		<section class="sr__phase" aria-label="What is happening now">
			<p class="sr__phasename">{phase?.name ?? 'Session'}</p>
			{#if clock}
				<p class="sr__clock" class:sr__clock--over={clock.overrun}>{formatClock(clock.remainingMs)}</p>
				<p class="sr__phasesub">
					{#if clock.overrun}
						Running long. Keep going until your mentor says.
					{:else}
						minutes left
					{/if}
				</p>
			{/if}
		</section>

		<section class="sr__role" aria-label="My job">
			{#if myRole}
				<p class="sr__rolelabel">My job today</p>
				<p class="sr__rolename">{ROLE_LABEL[myRole.role]}</p>
				{#if myRole.covering}
					<p class="sr__covering">
						You are covering this job today because {myRole.primaryName ?? 'the usual person'} is not here. It is yours.
					</p>
				{:else if myRole.tier === 'second'}
					<p class="sr__rolesub">You are the second. {myRole.primaryName ?? 'The primary'} has it today.</p>
				{:else}
					<p class="sr__rolesub">You have this job.</p>
				{/if}
			{:else}
				<p class="sr__rolelabel">My job today</p>
				<p class="sr__rolename">Helper</p>
				<p class="sr__rolesub">You do not have a job yet. Ask your mentor, and pick anything below.</p>
			{/if}
		</section>

		<section class="sr__queue" aria-label="My tasks">
			<h2 class="sr__queuehead">
				{#if myRole}{ROLE_LABEL[myRole.role]} jobs{:else}Jobs you can pick up{/if}
			</h2>
			{#if tasks.length === 0}
				<p class="sr__none">Nothing here right now. Ask your mentor what to do.</p>
			{:else}
				<ul class="sr__tasks">
					{#each tasks as task (task.id)}
						<li class="tk" class:tk--mine={task.assigned_student_id === me.studentId}>
							<p class="tk__title">{task.title}</p>
							{#if task.detail}<p class="tk__detail">{task.detail}</p>{/if}

							<p class="tk__tags">
								{#if task.assigned_student_id === me.studentId}
									<span class="tk__tag tk__tag--mine">Mine</span>
								{:else if task.assigned_student_id}
									<span class="tk__tag">Someone else has this</span>
								{/if}
								{#if task.evidence_required}
									<span class="tk__tag tk__tag--photo">
										{task.evidence_count > 0 ? 'Photo added' : 'Needs a photo'}
									</span>
								{/if}
							</p>

							<div class="tk__actions">
								{#if task.assigned_student_id !== me.studentId}
									<button
										class="btn2 btn2--pick"
										disabled={busy === `claim:${task.id}`}
										onclick={() => onClaim?.(task.id)}>I'll do this</button
									>
								{/if}
								{#if task.evidence_required && task.evidence_count === 0}
									<button class="btn2 btn2--photo" onclick={() => openEvidence(task)}>Take a photo</button>
								{/if}
								<button
									class="btn2 btn2--done"
									disabled={busy === `done:${task.id}` || !canFinish(task)}
									onclick={() => onDone?.(task.id)}
								>
									{canFinish(task) ? 'Done' : 'Photo first'}
								</button>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
			<a class="sr__teamlink" href={teamHref}>See what my team is doing</a>
			<a class="sr__teamlink" href={planHref}>Plan our robot runs</a>
			<a class="sr__teamlink" href={matchHref}>Time a practice run</a>
			<a class="sr__teamlink" href={notebookHref}>Write in our notebook</a>
				<a class="sr__teamlink" href={libraryHref}>Look something up</a>
		</section>

		<div class="sr__stuckbar">
			<button class="sr__stuck" onclick={() => openStuck(null)}>I'M STUCK</button>
		</div>
	{/if}
</div>

<!-- The camera. `capture` opens the rear camera on iPad Safari and Android
     Chrome; without a camera it falls back to the photo library, which is the
     correct behaviour on a laptop. -->
<input
	class="sr__file"
	type="file"
	accept="image/*"
	capture="environment"
	bind:this={fileInput}
	onchange={pickFile}
/>

{#if evidenceFor}
	<div class="sheet" role="dialog" aria-label="Add a photo">
		<div class="sheet__panel" data-accent={team.accent}>
			<h2>Photo for: {evidenceFor.title}</h2>
			{#if chosen}
				<p class="sheet__ok">Got it: {chosen.name}</p>
			{:else}
				<p class="muted">No photo yet.</p>
				<button class="btn2 btn2--photo" onclick={() => fileInput?.click()}>Open the camera</button>
			{/if}
			<label class="field">
				<span>What is this a photo of?</span>
				<input class="input" bind:value={caption} maxlength="200" placeholder="The finished arm" />
			</label>
			<div class="sheet__actions">
				<button class="btn2 btn2--done" disabled={!chosen} onclick={sendEvidence}>Add it</button>
				<button class="btn2" onclick={() => (evidenceFor = null)}>Not now</button>
			</div>
		</div>
	</div>
{/if}

{#if stuckOpen}
	<div class="sheet" role="dialog" aria-label="Tell a mentor you are stuck">
		<div class="sheet__panel" data-accent={team.accent}>
			<h2>What is going on?</h2>
			<p class="muted">Tap one. Your mentor will come over.</p>
			<div class="sheet__reasons">
				{#each STUCK_REASONS as reason (reason)}
					<button class="reason" onclick={() => sendStuck(reason)}>{reason}</button>
				{/each}
			</div>
			<label class="field">
				<span>Or say it yourself</span>
				<input class="input" bind:value={stuckNote} maxlength="200" placeholder="Type here" />
			</label>
			<div class="sheet__actions">
				<button class="btn2 btn2--done" disabled={!stuckNote.trim()} onclick={() => sendStuck(stuckNote)}>Send</button
				>
				<button class="btn2" onclick={() => (stuckOpen = false)}>Never mind</button>
			</div>
		</div>
	</div>
{/if}

<style>
	/* THE WHOLE SCREEN IS THE TEAM'S COLOUR. The accent is the wash behind
	   everything, not a stripe on a card: a kid glancing at a table of phones
	   should be able to tell whose is whose. */
	.sr {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-3) 6.5rem;
		background:
			radial-gradient(120% 60% at 50% 0%, var(--team-accent-wash), transparent 70%),
			var(--surface-0);
	}

	.sr__top {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.sr__team {
		font-family: var(--font-display);
		font-weight: var(--fw-black);
		font-size: var(--fs-h2);
		color: var(--team-accent);
	}
	.sr__who {
		color: var(--text-2);
		font-size: var(--fs-small);
	}
	.sr__net {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: 0.25rem 0.6rem;
		border-radius: 999px;
		border: 1px solid var(--boundary);
		font-size: var(--fs-small);
		font-weight: var(--fw-bold);
		color: var(--text-2);
	}
	.sr__netdot {
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 999px;
		background: var(--success);
	}
	.sr__net[data-state='syncing'] {
		color: var(--warning);
		border-color: var(--warning);
	}
	.sr__net[data-state='syncing'] .sr__netdot {
		background: var(--warning);
	}
	.sr__net[data-state='offline'] {
		color: var(--danger-text);
		border-color: var(--danger);
	}
	.sr__net[data-state='offline'] .sr__netdot {
		background: var(--danger);
	}

	.sr__failed {
		border: 2px solid var(--danger);
		border-radius: var(--radius-card);
		padding: var(--space-3);
		background: rgba(255, 111, 125, 0.12);
	}
	.sr__failed h2 {
		margin: 0 0 var(--space-2);
		font-size: var(--fs-h3);
		color: var(--danger-text);
	}
	.sr__failedrow {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		margin: 0 0 var(--space-2);
	}

	/* --- the two "nothing else on screen" states -------------------------- */
	.sr__empty,
	.sr__checkin {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		gap: var(--space-3);
	}
	.sr__bighello {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--fs-hero);
		font-weight: var(--fw-black);
		color: var(--team-accent);
		line-height: 1.05;
	}
	.sr__emptymsg {
		margin: 0;
		font-size: var(--fs-h2);
		font-weight: var(--fw-bold);
	}
	.sr__emptysub {
		margin: 0;
		color: var(--text-2);
		font-size: var(--fs-h3);
		max-width: 20rem;
	}
	.sr__checkbtn {
		margin-top: var(--space-4);
		min-height: 7rem;
		width: min(100%, 20rem);
		border-radius: var(--radius-card);
		border: none;
		background: var(--team-accent);
		color: var(--team-accent-ink);
		font-family: var(--font-display);
		font-size: var(--fs-hero);
		font-weight: var(--fw-black);
		box-shadow: var(--shadow-raised);
		cursor: pointer;
	}
	.sr__checkbtn:active {
		transform: translateY(2px);
	}

	/* --- phase ------------------------------------------------------------ */
	.sr__phase {
		text-align: center;
		padding: var(--space-4) var(--space-3);
		border-radius: var(--radius-card);
		border: 2px solid var(--team-accent);
		background: var(--surface-1);
	}
	.sr__phasename {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--fs-h1);
		font-weight: var(--fw-black);
		color: var(--team-accent);
	}
	.sr__clock {
		margin: var(--space-1) 0 0;
		font-family: var(--font-mono);
		font-size: var(--fs-hero);
		font-weight: var(--fw-bold);
		font-variant-numeric: tabular-nums;
		line-height: 1;
	}
	.sr__clock--over {
		color: var(--warning);
	}
	.sr__phasesub {
		margin: var(--space-1) 0 0;
		color: var(--text-2);
	}

	/* --- role ------------------------------------------------------------- */
	.sr__role {
		padding: var(--space-4) var(--space-3);
		border-radius: var(--radius-card);
		background: var(--surface-1);
		border: 1px solid var(--boundary);
	}
	.sr__rolelabel {
		margin: 0;
		font-size: var(--fs-label);
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		color: var(--text-3);
	}
	.sr__rolename {
		margin: var(--space-1) 0;
		font-family: var(--font-display);
		font-size: var(--fs-h1);
		font-weight: var(--fw-black);
	}
	.sr__rolesub {
		margin: 0;
		color: var(--text-2);
	}
	/* Covering is the sentence that has to be impossible to miss. */
	.sr__covering {
		margin: var(--space-2) 0 0;
		padding: var(--space-3);
		border-radius: var(--radius-control);
		background: rgba(255, 197, 107, 0.16);
		border: 2px solid var(--warning);
		color: var(--warning);
		font-size: var(--fs-h3);
		font-weight: var(--fw-bold);
	}

	/* --- queue ------------------------------------------------------------ */
	.sr__queuehead {
		margin: 0 0 var(--space-2);
		font-size: var(--fs-h3);
	}
	.sr__none {
		color: var(--text-2);
		font-size: var(--fs-h3);
	}
	.sr__tasks {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-3);
	}
	.tk {
		padding: var(--space-3);
		border-radius: var(--radius-card);
		background: var(--surface-1);
		border: 1px solid var(--boundary);
	}
	.tk--mine {
		border-color: var(--team-accent);
	}
	.tk__title {
		margin: 0;
		font-size: var(--fs-h3);
		font-weight: var(--fw-bold);
	}
	.tk__detail {
		margin: var(--space-1) 0 0;
		color: var(--text-2);
	}
	.tk__tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: var(--space-2) 0 0;
	}
	.tk__tag {
		padding: 0.15rem 0.55rem;
		border-radius: 999px;
		border: 1px solid var(--hairline);
		font-size: var(--fs-small);
		color: var(--text-2);
	}
	.tk__tag--mine {
		border-color: var(--team-accent);
		color: var(--team-accent);
		font-weight: var(--fw-bold);
	}
	.tk__tag--photo {
		border-color: var(--warning);
		color: var(--warning);
	}
	.tk__actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-3);
	}

	/* Every student-facing button is a 56px slab. These are nine-year-olds
	   tapping while holding a robot. */
	.btn2 {
		flex: 1 1 8rem;
		min-height: 3.5rem;
		padding: 0 var(--space-3);
		border-radius: var(--radius-control);
		border: 2px solid var(--boundary);
		background: var(--surface-2);
		color: var(--text-1);
		font: inherit;
		font-size: var(--fs-h3);
		font-weight: var(--fw-bold);
		cursor: pointer;
	}
	.btn2:active {
		transform: translateY(2px);
	}
	.btn2:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.btn2--pick {
		border-color: var(--team-accent);
		color: var(--team-accent);
	}
	.btn2--photo {
		border-color: var(--warning);
		color: var(--warning);
	}
	.btn2--done {
		background: var(--success);
		border-color: var(--success);
		color: var(--accent-ink);
	}

	/* A link a nine-year-old taps is a button, not a line of text. */
	.sr__teamlink {
		display: flex;
		align-items: center;
		justify-content: center;
		margin-top: var(--space-4);
		min-height: 3.5rem;
		border-radius: var(--radius-control);
		border: 2px solid var(--boundary);
		background: var(--surface-1);
		color: var(--text-1);
		text-decoration: none;
		font-size: var(--fs-h3);
		font-weight: var(--fw-bold);
	}

	/* --- I'm stuck -------------------------------------------------------- */
	.sr__stuckbar {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		padding: var(--space-3);
		background: linear-gradient(to top, var(--surface-0) 60%, transparent);
	}
	.sr__stuck {
		width: 100%;
		min-height: 4.5rem;
		border-radius: var(--radius-card);
		border: 3px solid var(--warning);
		background: rgba(255, 197, 107, 0.18);
		color: var(--warning);
		font-family: var(--font-display);
		font-size: var(--fs-h1);
		font-weight: var(--fw-black);
		letter-spacing: var(--track-wide);
		cursor: pointer;
	}
	.sr__stuck:active {
		transform: translateY(2px);
	}

	/* --- sheets ----------------------------------------------------------- */
	.sheet {
		position: fixed;
		inset: 0;
		z-index: 10;
		display: flex;
		align-items: flex-end;
		background: rgba(3, 7, 15, 0.75);
	}
	.sheet__panel {
		width: 100%;
		max-height: 92dvh;
		overflow-y: auto;
		padding: var(--space-4) var(--space-3) var(--space-5);
		border-top: 4px solid var(--team-accent);
		border-radius: var(--radius-card) var(--radius-card) 0 0;
		background: var(--surface-1);
	}
	.sheet__panel h2 {
		margin-top: 0;
	}
	.sheet__reasons {
		display: grid;
		gap: var(--space-2);
		margin-bottom: var(--space-3);
	}
	.reason {
		min-height: 4rem;
		padding: var(--space-3);
		border-radius: var(--radius-control);
		border: 2px solid var(--boundary);
		background: var(--surface-2);
		color: var(--text-1);
		font: inherit;
		font-size: var(--fs-h3);
		font-weight: var(--fw-semibold);
		text-align: left;
		cursor: pointer;
	}
	.sheet__actions {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-3);
	}
	.sheet__ok {
		color: var(--success-text);
		font-weight: var(--fw-bold);
	}
	.sr__file {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}

	/* Desktop is not the target, but it has to be correct: the phone column is
	   centred rather than stretched into an unreadable line length. */
	@media (min-width: 40rem) {
		.sr {
			max-width: 34rem;
			margin: 0 auto;
			padding-bottom: 7rem;
		}
		.sr__stuckbar {
			max-width: 34rem;
			margin: 0 auto;
		}
		.sheet__panel {
			max-width: 34rem;
			margin: 0 auto;
			border-radius: var(--radius-card);
		}
		.sheet {
			align-items: center;
			padding: var(--space-4);
		}
	}
</style>

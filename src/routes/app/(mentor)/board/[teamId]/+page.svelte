<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { formatSince } from '$lib/console/clock';
	import { ROLE_LABEL, type TaskStatus } from '$lib/console/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type BlockerRow = PageData['blockers'][number];

	let busy = $state('');
	let message = $state('');
	let good = $state('');

	interface Say {
		/** Shown when PostgREST answered with an error of its own. */
		failed: string;
		/** Shown when the write was accepted and matched no rows. */
		refused: string;
		ok?: string;
	}
	type WriteResult = { data: unknown[] | null; error: { message: string } | null };

	/**
	 * EVERY WRITE ON THIS SCREEN GOES THROUGH HERE, AND EVERY ONE ASKS FOR ITS
	 * ROWS BACK. An update or a delete whose rows RLS excludes comes back 204
	 * with no rows and `error === null`, so reporting success from the absence
	 * of an error would tell a mentor a blocker was cleared while it sat there
	 * unchanged. An empty array is a refusal and is said out loud. The
	 * PostgREST message is never shown: it names a table and a policy, and
	 * neither is something a mentor between two tables can act on.
	 */
	async function write(key: string, run: () => Promise<WriteResult>, say: Say) {
		busy = key;
		message = '';
		good = '';
		const res = await run();
		busy = '';
		if (res.error) {
			message = say.failed;
			return false;
		}
		if (!res.data || res.data.length === 0) {
			message = say.refused;
			return false;
		}
		good = say.ok ?? '';
		return true;
	}

	/** A write that landed is followed by a refetch, never by a patch. */
	async function writeThenRefetch(key: string, run: () => Promise<WriteResult>, say: Say) {
		const okay = await write(key, run, say);
		if (okay) await invalidateAll();
		return okay;
	}

	let mentorId = $derived(data.principal.kind === 'mentor' ? data.principal.mentorId : null);

	let nameOf = $derived(
		new Map(data.students.map((s) => [s.id, `${s.first_name} ${s.last_initial}.`]))
	);
	let present = $derived(new Set(data.presentIds));
	let absent = $derived(data.students.filter((s) => !present.has(s.id)));

	// Open work first, then what is blocked, then the day's closes.
	const RANK: Record<TaskStatus, number> = { blocked: 0, active: 1, open: 2, done: 3 };
	let tasks = $derived([...data.tasks].sort((a, b) => RANK[a.status] - RANK[b.status]));

	const now = Date.now();

	function plural(n: number) {
		return n === 1 ? '' : 's';
	}

	// --- blockers -------------------------------------------------------------
	let showResolved = $state(false);
	let editingBlocker = $state('');
	let noteDraft = $state('');
	let taskDraft = $state('');
	let confirmBlocker = $state('');

	let openBlockers = $derived(data.blockers.filter((b) => !b.resolved_at));
	// Oldest open first (that is the triage order), then the cleared ones with
	// the most recently cleared at the top.
	let clearedBlockers = $derived([...data.blockers.filter((b) => b.resolved_at)].reverse());
	let blockersShown = $derived(showResolved ? [...openBlockers, ...clearedBlockers] : openBlockers);

	function startEditBlocker(blocker: BlockerRow) {
		editingBlocker = blocker.id;
		noteDraft = blocker.note;
		taskDraft = blocker.task_id ?? '';
		confirmBlocker = '';
		message = '';
		good = '';
	}

	async function saveBlocker(id: string) {
		if (!noteDraft.trim()) {
			message = 'A blocker needs a note saying what is stuck.';
			return;
		}
		const okay = await writeThenRefetch(
			`blocker:${id}`,
			async () =>
				data.supabase
					.from('blockers')
					.update({ note: noteDraft.trim(), task_id: taskDraft || null })
					.eq('id', id)
					.select('id'),
			{
				failed: 'That blocker was not saved. Check the note and try again.',
				refused: 'That edit was refused. The blocker may have been deleted while this page was open.',
				ok: 'Blocker saved.'
			}
		);
		if (okay) editingBlocker = '';
	}

	function resolveBlocker(id: string) {
		return writeThenRefetch(
			`blocker:${id}`,
			async () =>
				data.supabase
					.from('blockers')
					.update({ resolved_at: new Date().toISOString(), resolved_by_mentor_id: mentorId })
					.eq('id', id)
					.select('id'),
			{
				failed: 'That blocker was not cleared. Try it again.',
				refused: 'Clearing that blocker was refused. Reload the page and look at it again.',
				ok: 'Cleared. It is still listed under "show cleared ones" if that was the wrong one.'
			}
		);
	}

	/** Cleared the wrong one: put it back, open, with nobody credited. */
	function unresolveBlocker(id: string) {
		return writeThenRefetch(
			`blocker:${id}`,
			async () =>
				data.supabase
					.from('blockers')
					.update({ resolved_at: null, resolved_by_mentor_id: null })
					.eq('id', id)
					.select('id'),
			{
				failed: 'That blocker was not put back. Try it again.',
				refused: 'Putting that blocker back was refused. Reload the page and look at it again.',
				ok: 'Back on the list.'
			}
		);
	}

	async function removeBlocker(id: string) {
		if (confirmBlocker !== id) {
			confirmBlocker = id;
			return;
		}
		confirmBlocker = '';
		const okay = await writeThenRefetch(
			`blocker:${id}`,
			async () => data.supabase.from('blockers').delete().eq('id', id).select('id'),
			{
				failed: 'That blocker was not deleted. Try it again.',
				refused: 'That delete was refused. The blocker may already be gone: reload the page.',
				ok: 'Blocker deleted.'
			}
		);
		if (okay && editingBlocker === id) editingBlocker = '';
	}

	// --- tasks ----------------------------------------------------------------
	function setTaskStatus(id: string, status: TaskStatus) {
		// closed_at is stamped by the trigger in 0007; the client never sends it.
		return writeThenRefetch(
			`task:${id}`,
			async () => data.supabase.from('tasks').update({ status }).eq('id', id).select('id'),
			{
				failed: 'That task did not change. Try it again.',
				refused: 'That change was refused. The task may have been deleted while this page was open.',
				ok: status === 'done' ? 'Closed.' : 'Reopened.'
			}
		);
	}

	// --- attendance -----------------------------------------------------------
	// A check-out is a DELETE, so it is offered with its undo: the row goes
	// back with one tap, on a fresh check-in time. checked_in_at is stamped by
	// the server on insert and appears in no client grant.
	let undoId = $state('');
	let undoName = $state('');

	async function checkIn(studentId: string) {
		const meetingId = data.meeting?.id;
		if (!meetingId) return;
		const okay = await writeThenRefetch(
			`att:${studentId}`,
			async () =>
				data.supabase
					.from('attendance')
					.insert({ id: crypto.randomUUID(), meeting_id: meetingId, student_id: studentId })
					.select('student_id'),
			{
				failed: `${nameOf.get(studentId) ?? 'That student'} was not checked in. They may already be here: reload the page.`,
				refused: 'That check-in was refused. Reload the page and try again.',
				ok: `${nameOf.get(studentId) ?? 'Checked in'} is here.`
			}
		);
		if (okay && undoId === studentId) {
			undoId = '';
			undoName = '';
		}
	}

	async function checkOut(studentId: string) {
		const meetingId = data.meeting?.id;
		if (!meetingId) return;
		const name = nameOf.get(studentId) ?? 'That student';
		const okay = await writeThenRefetch(
			`att:${studentId}`,
			async () =>
				data.supabase
					.from('attendance')
					.delete()
					.eq('meeting_id', meetingId)
					.eq('student_id', studentId)
					.select('student_id'),
			{
				failed: `${name} was not checked out. Try it again.`,
				refused: `${name} was not checked out: the row was refused. Reload the page.`,
				ok: `${name} is checked out.`
			}
		);
		if (okay) {
			undoId = studentId;
			undoName = name;
		}
	}

	function toggleAttendance(studentId: string) {
		return present.has(studentId) ? checkOut(studentId) : checkIn(studentId);
	}

	/** The Friday shortcut: everybody walked in together, so say so once. */
	async function markAllPresent() {
		const meetingId = data.meeting?.id;
		if (!meetingId) return;
		const rows = absent.map((s) => ({
			id: crypto.randomUUID(),
			meeting_id: meetingId,
			student_id: s.id
		}));
		if (rows.length === 0) {
			message = '';
			good = 'Everybody on this team is already checked in.';
			return;
		}
		await writeThenRefetch(
			'att:all',
			async () => data.supabase.from('attendance').insert(rows).select('student_id'),
			{
				failed: 'Nobody was checked in. Somebody may have been checked in already: reload the page.',
				refused: 'That check-in was refused. Reload the page and try again.',
				ok: `Checked in ${rows.length} student${plural(rows.length)}.`
			}
		);
		undoId = '';
		undoName = '';
	}
</script>

<svelte:head><title>{data.team.name}</title></svelte:head>

<div class="detail" data-accent={data.team.accent}>
	<header class="detail__head">
		<a class="btn btn--ghost btn--small" href="/app/board">Back to board</a>
		<h1 class="detail__name">{data.team.name}</h1>
		<p class="muted small">
			Code <code>{data.team.join_code}</code>
			{#if data.team.fll_team_number}· FLL #{data.team.fll_team_number}{/if}
			{#if data.card}· {data.card.present_count} of {data.card.roster_size} here{/if}
		</p>
	</header>

	{#if message}
		<p class="error" role="alert">{message}</p>
	{/if}
	{#if good}
		<p class="notice" role="status">{good}</p>
	{/if}
	{#if !data.meeting}
		<p class="notice" role="status">No meeting today, so nobody can be here and every role reads unfilled.</p>
	{/if}

	<section class="card detail__block">
		<h2>Blockers</h2>
		<div class="bar">
			<p class="muted small">
				{openBlockers.length} open, {clearedBlockers.length} cleared.
			</p>
			<button class="btn btn--ghost btn--small" type="button" onclick={() => (showResolved = !showResolved)}>
				{showResolved ? 'Hide the cleared ones' : 'Show the cleared ones'}
			</button>
		</div>

		{#if blockersShown.length === 0}
			<p class="muted">{showResolved ? 'No blockers at all yet.' : 'Nothing is blocked.'}</p>
		{:else}
			<ul class="rows">
				{#each blockersShown as blocker (blocker.id)}
					<li class="row" class:row--alarm={!blocker.resolved_at} class:row--quiet={Boolean(blocker.resolved_at)}>
						<span class="row__main">
							<strong>{nameOf.get(blocker.student_id) ?? 'Someone'}</strong>
							{#if editingBlocker === blocker.id}
								<label class="field">
									<span>What is stuck</span>
									<textarea class="input" bind:value={noteDraft} rows="2" maxlength="2000"></textarea>
								</label>
								<label class="field">
									<span>On which task</span>
									<select class="input" bind:value={taskDraft}>
										<option value="">Not tied to a task</option>
										{#each tasks as task (task.id)}
											<option value={task.id}>{task.title}</option>
										{/each}
									</select>
								</label>
							{:else}
								<span>{blocker.note}</span>
								<span class="muted small">
									Raised {formatSince(blocker.raised_at, now)}{#if blocker.task_id}
										· on {tasks.find((t) => t.id === blocker.task_id)?.title ?? 'a task'}{:else}
										· not tied to a task{/if}{#if blocker.resolved_at}
										· cleared {formatSince(blocker.resolved_at, now)}{/if}
								</span>
							{/if}
							{#if confirmBlocker === blocker.id}
								<span class="notice small">
									This deletes what {nameOf.get(blocker.student_id) ?? 'they'} raised, and the record that it
									happened at all. Nothing else goes with it, and it cannot be brought back. Clear it instead
									if it is simply sorted.
								</span>
							{/if}
						</span>
						<span class="row__actions">
							{#if editingBlocker === blocker.id}
								<button
									class="btn btn--primary btn--small"
									type="button"
									disabled={busy === `blocker:${blocker.id}`}
									onclick={() => saveBlocker(blocker.id)}>Save</button
								>
								<button class="btn btn--ghost btn--small" type="button" onclick={() => (editingBlocker = '')}>
									Cancel
								</button>
							{:else if confirmBlocker === blocker.id}
								<button
									class="btn btn--danger btn--small"
									type="button"
									disabled={busy === `blocker:${blocker.id}`}
									onclick={() => removeBlocker(blocker.id)}>Yes, delete it</button
								>
								<button class="btn btn--ghost btn--small" type="button" onclick={() => (confirmBlocker = '')}>
									Keep it
								</button>
							{:else}
								{#if blocker.resolved_at}
									<button
										class="btn btn--secondary btn--small"
										type="button"
										disabled={busy === `blocker:${blocker.id}`}
										onclick={() => unresolveBlocker(blocker.id)}>Put it back</button
									>
								{:else}
									<button
										class="btn btn--primary btn--small"
										type="button"
										disabled={busy === `blocker:${blocker.id}`}
										onclick={() => resolveBlocker(blocker.id)}>Resolve</button
									>
								{/if}
								<button class="btn btn--ghost btn--small" type="button" onclick={() => startEditBlocker(blocker)}>
									Edit
								</button>
								<button class="btn btn--ghost btn--small" type="button" onclick={() => removeBlocker(blocker.id)}>
									Delete
								</button>
							{/if}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="card detail__block">
		<h2>Roles today</h2>
		<p class="muted small">
			Who is actually in the seat: the primary if they checked in, else the second if they did, else nobody.
		</p>
		<ul class="rows">
			{#each data.roles as role (role.role)}
				<li class="row" class:row--warn={role.unfilled}>
					<span class="row__main">
						<strong>{ROLE_LABEL[role.role]}</strong>
						{#if role.unfilled}
							<span class="warn">Nobody in the seat</span>
						{:else}
							<span>{role.active_name} <span class="muted small">({role.active_tier})</span></span>
						{/if}
						<span class="muted small">
							Primary {role.primary_name ?? 'unassigned'}{role.primary_present ? ' (here)' : ''} · Second
							{role.second_name ?? 'none'}{role.second_present ? ' (here)' : ''}
						</span>
					</span>
					{#if !role.has_second}
						<span class="pill pill--warn">No second</span>
					{/if}
				</li>
			{/each}
		</ul>
		<p class="muted small">Assign and change these in <a href="/app/teams/{data.team.id}">Teams</a>.</p>
	</section>

	<section class="card detail__block">
		<h2>Roster</h2>
		<p class="muted small">
			{#if data.meeting}
				Tap a name to check them in or out of today's meeting. Checked somebody out by mistake? Tap them again
				and the row goes back, on a fresh check-in time.
			{:else}
				Check-in needs a meeting.
			{/if}
		</p>

		{#if data.meeting && data.students.length > 0}
			<div class="bar">
				<button
					class="btn btn--secondary btn--small"
					type="button"
					disabled={busy === 'att:all' || absent.length === 0}
					onclick={markAllPresent}
				>
					{absent.length === 0
						? 'Everybody is here'
						: `Mark the whole team present (${absent.length} to add)`}
				</button>
				{#if undoId && !present.has(undoId)}
					<button
						class="btn btn--ghost btn--small"
						type="button"
						disabled={busy === `att:${undoId}`}
						onclick={() => checkIn(undoId)}
					>
						Put {undoName} back in
					</button>
				{/if}
			</div>
		{/if}

		<ul class="chips">
			{#each data.students as student (student.id)}
				<li>
					<button
						class="chip"
						class:chip--on={present.has(student.id)}
						type="button"
						disabled={!data.meeting || busy === `att:${student.id}`}
						onclick={() => toggleAttendance(student.id)}
					>
						<span>{student.first_name} {student.last_initial}.</span>
						<span class="muted small">
							{present.has(student.id) ? 'Here. Tap to check out.' : 'Out. Tap to check in.'}
						</span>
					</button>
				</li>
			{:else}
				<li class="muted">No students yet. Add them in <a href="/app/teams/{data.team.id}">Teams</a>.</li>
			{/each}
		</ul>
	</section>

	<section class="card detail__block">
		<h2>Tasks</h2>
		{#if tasks.length === 0}
			<p class="muted">No tasks yet. Create them in <a href="/app/tasks">Tasks</a>.</p>
		{:else}
			<ul class="rows">
				{#each tasks as task (task.id)}
					<li class="row" class:row--done={task.status === 'done'}>
						<span class="row__main">
							<strong>{task.title}</strong>
							<span class="muted small">
								<span class="pill">{task.status}</span>
								{#if task.role}<span class="pill">{ROLE_LABEL[task.role]}</span>{/if}
								{#if task.evidence_required}<span class="pill">evidence</span>{/if}
								{#if task.assigned_student_id}· {nameOf.get(task.assigned_student_id) ?? 'assigned'}{/if}
							</span>
						</span>
						<span class="row__actions">
							{#if task.status === 'done'}
								<button
									class="btn btn--ghost btn--small"
									type="button"
									disabled={busy === `task:${task.id}`}
									onclick={() => setTaskStatus(task.id, 'open')}>Reopen</button
								>
							{:else}
								<button
									class="btn btn--primary btn--small"
									type="button"
									disabled={busy === `task:${task.id}`}
									onclick={() => setTaskStatus(task.id, 'done')}>Done</button
								>
							{/if}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
		<p class="muted small">
			Editing a task, moving it to another meeting or deleting it is in <a href="/app/tasks">Tasks</a>.
		</p>
	</section>
</div>

<style>
	.detail {
		display: grid;
		gap: var(--space-4);
		min-width: 0;
	}
	.detail__head {
		display: grid;
		gap: var(--space-2);
		justify-items: start;
	}
	.detail__name {
		margin: 0;
		color: var(--team-accent);
	}
	.detail__block {
		border-left: 4px solid var(--team-accent);
		min-width: 0;
	}
	.detail__block h2 {
		margin-bottom: var(--space-2);
	}

	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-3);
	}
	.bar p {
		margin: 0;
	}

	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-2);
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		flex-wrap: wrap;
		padding: var(--space-3);
		border-radius: var(--radius-control);
		border: 1px solid var(--hairline);
		background: var(--surface-2);
	}
	.row--alarm {
		border-color: var(--danger);
	}
	.row--warn {
		border-color: var(--warning);
	}
	/* A cleared blocker is history, not work: it steps back rather than
	   striking through a child's name the way a closed task strikes a title. */
	.row--quiet {
		background: var(--surface-1);
		color: var(--text-muted);
	}
	.row--done strong {
		color: var(--text-3);
		text-decoration: line-through;
	}
	.row__main {
		display: grid;
		gap: var(--space-1);
		min-width: 12rem;
		flex: 1 1 14rem;
		overflow-wrap: anywhere;
	}
	.row__main .field {
		margin-bottom: 0;
	}
	.row__actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.warn {
		color: var(--warning);
		font-weight: var(--fw-bold);
	}

	.pill {
		display: inline-block;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		border: 1px solid var(--hairline);
		background: var(--surface-1);
		font-size: var(--fs-label);
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		color: var(--text-2);
	}
	.pill--warn {
		border-color: var(--warning);
		color: var(--warning);
	}

	.chips {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.chip {
		display: grid;
		gap: 0.125rem;
		min-height: 2.75rem;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-control);
		border: 1px solid var(--boundary);
		background: var(--surface-2);
		color: var(--text-2);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.chip--on {
		border-color: var(--team-accent);
		color: var(--team-accent);
		background: var(--team-accent-wash);
		font-weight: var(--fw-bold);
	}
	.chip:disabled {
		opacity: 0.55;
		cursor: default;
	}

	@media (min-width: 60rem) {
		.detail {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			align-items: start;
		}
		.detail__head {
			grid-column: 1 / -1;
		}
	}
</style>

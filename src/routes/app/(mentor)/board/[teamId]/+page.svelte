<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { formatSince } from '$lib/console/clock';
	import { ROLE_LABEL, type TaskStatus } from '$lib/console/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let busy = $state('');
	let message = $state('');

	let nameOf = $derived(
		new Map(data.students.map((s) => [s.id, `${s.first_name} ${s.last_initial}.`]))
	);
	let present = $derived(new Set(data.presentIds));

	// Open work first, then what is blocked, then the day's closes.
	const RANK: Record<TaskStatus, number> = { blocked: 0, active: 1, open: 2, done: 3 };
	let tasks = $derived([...data.tasks].sort((a, b) => RANK[a.status] - RANK[b.status]));

	const now = Date.now();

	async function run(key: string, fn: () => Promise<{ error: { message: string } | null }>) {
		busy = key;
		message = '';
		const { error } = await fn();
		busy = '';
		if (error) {
			message = error.message;
			return;
		}
		await invalidateAll();
	}

	function resolveBlocker(id: string) {
		return run(`blocker:${id}`, async () =>
			data.supabase
				.from('blockers')
				.update({
					resolved_at: new Date().toISOString(),
					resolved_by_mentor_id: data.principal.kind === 'mentor' ? data.principal.mentorId : null
				})
				.eq('id', id)
		);
	}

	function setTaskStatus(id: string, status: TaskStatus) {
		// closed_at is stamped by the trigger in 0007; the client never sends it.
		return run(`task:${id}`, async () => data.supabase.from('tasks').update({ status }).eq('id', id));
	}

	function toggleAttendance(studentId: string) {
		const meetingId = data.meeting?.id;
		if (!meetingId) return;
		if (present.has(studentId)) {
			return run(`att:${studentId}`, async () =>
				data.supabase.from('attendance').delete().eq('meeting_id', meetingId).eq('student_id', studentId)
			);
		}
		return run(`att:${studentId}`, async () =>
			data.supabase.from('attendance').insert({ meeting_id: meetingId, student_id: studentId })
		);
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
	{#if !data.meeting}
		<p class="notice" role="status">No meeting today, so nobody can be here and every role reads unfilled.</p>
	{/if}

	<section class="card detail__block">
		<h2>Blockers</h2>
		{#if data.blockers.length === 0}
			<p class="muted">Nothing is blocked.</p>
		{:else}
			<ul class="rows">
				{#each data.blockers as blocker (blocker.id)}
					<li class="row row--alarm">
						<span class="row__main">
							<strong>{nameOf.get(blocker.student_id) ?? 'Someone'}</strong>
							<span>{blocker.note}</span>
							<span class="muted small">Raised {formatSince(blocker.raised_at, now)}</span>
						</span>
						<button
							class="btn btn--primary btn--small"
							disabled={busy === `blocker:${blocker.id}`}
							onclick={() => resolveBlocker(blocker.id)}>Resolve</button
						>
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
			{#if data.meeting}Tap a name to check them in or out of today's meeting.{:else}Check-in needs a meeting.{/if}
		</p>
		<ul class="chips">
			{#each data.students as student (student.id)}
				<li>
					<button
						class="chip"
						class:chip--on={present.has(student.id)}
						disabled={!data.meeting || busy === `att:${student.id}`}
						onclick={() => toggleAttendance(student.id)}
					>
						{student.first_name}
						{student.last_initial}.
						<span class="muted small">{present.has(student.id) ? 'here' : 'out'}</span>
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
									disabled={busy === `task:${task.id}`}
									onclick={() => setTaskStatus(task.id, 'open')}>Reopen</button
								>
							{:else}
								<button
									class="btn btn--primary btn--small"
									disabled={busy === `task:${task.id}`}
									onclick={() => setTaskStatus(task.id, 'done')}>Done</button
								>
							{/if}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

<style>
	.detail {
		display: grid;
		gap: var(--space-4);
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
	}
	.detail__block h2 {
		margin-bottom: var(--space-2);
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
	.row--done strong {
		color: var(--text-3);
		text-decoration: line-through;
	}
	.row__main {
		display: grid;
		gap: var(--space-1);
		min-width: 12rem;
		flex: 1 1 14rem;
	}
	.row__actions {
		display: flex;
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
		min-height: 2.75rem;
		padding: 0 var(--space-3);
		border-radius: var(--radius-control);
		border: 1px solid var(--boundary);
		background: var(--surface-2);
		color: var(--text-2);
		font: inherit;
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

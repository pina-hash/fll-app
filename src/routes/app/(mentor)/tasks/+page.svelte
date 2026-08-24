<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { formatDay, formatTime } from '$lib/console/clock';
	import {
		ROLE_LABEL,
		TASK_STATUSES,
		TEAM_ROLES,
		type TaskStatus,
		type TeamRole
	} from '$lib/console/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type TaskRow = PageData['tasks'][number];

	/** The database's four status words, said the way a mentor says them. */
	const STATUS_LABEL: Record<TaskStatus, string> = {
		open: 'To do',
		active: 'Active',
		blocked: 'Blocked',
		done: 'Done'
	};

	/** Open work first, then what is blocked, then the day's closes. */
	const STATUS_RANK: Record<TaskStatus, number> = { blocked: 0, active: 1, open: 2, done: 3 };

	/** One place to decide whether a count takes an "s". */
	function plural(n: number) {
		return n === 1 ? '' : 's';
	}

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
	 * with no rows and no error, so "no error" is not "it landed": an empty
	 * array is a refusal and is reported as one. The PostgREST message itself
	 * is never shown either, because "new row violates row-level security
	 * policy for table tasks" names a policy and a table, and neither is
	 * something a mentor standing in a room can act on.
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
		await invalidateAll();
		return true;
	}

	// --- create ---------------------------------------------------------------
	let title = $state('');
	let detail = $state('');
	let role = $state<TeamRole | ''>('');
	let meetingId = $state('');
	let evidenceRequired = $state(false);
	let targets = $state<string[]>([]);

	// Default to every team: the common case is one plan for all four.
	$effect(() => {
		if (targets.length === 0 && data.teams.length > 0) {
			targets = data.teams.map((t) => t.id);
		}
	});

	let allSelected = $derived(targets.length === data.teams.length);

	function toggleTeam(id: string) {
		targets = targets.includes(id) ? targets.filter((t) => t !== id) : [...targets, id];
	}

	function toggleAll() {
		targets = allSelected ? [] : data.teams.map((t) => t.id);
	}

	async function create(event: SubmitEvent) {
		event.preventDefault();
		message = '';
		good = '';
		if (!title.trim()) {
			message = 'A task needs a title.';
			return;
		}
		if (targets.length === 0) {
			message = 'Pick at least one team.';
			return;
		}
		if (data.principal.kind !== 'mentor') return;

		const mentorId = data.principal.mentorId;
		const rows = targets.map((teamId) => ({
			team_id: teamId,
			title: title.trim(),
			detail: detail.trim() || null,
			role: role || null,
			meeting_id: meetingId || null,
			evidence_required: evidenceRequired,
			created_by_mentor_id: mentorId
		}));

		busy = 'create';
		// One statement, so four teams either all get the task or none do. The
		// rows are asked for regardless: a count is the only honest report.
		const { data: made, error } = await data.supabase.from('tasks').insert(rows).select('id');
		busy = '';
		if (error) {
			message = 'That task was not created. A title is 1 to 200 characters; check it and try again.';
			return;
		}
		const landed = made?.length ?? 0;
		if (landed === 0) {
			message = 'The server refused that task. Sign out and back in, then try again.';
			return;
		}
		if (landed < rows.length) {
			message = `Only ${landed} of ${rows.length} teams took that task. Check the list below before creating it again.`;
			await invalidateAll();
			return;
		}
		good = `Created on ${landed} team${plural(landed)}.`;
		title = '';
		detail = '';
		await invalidateAll();
	}

	// --- what the list is showing --------------------------------------------
	let fTeam = $state('');
	let fRole = $state<TeamRole | ''>('');
	let fStatus = $state<TaskStatus | ''>('');
	let fText = $state('');
	let sortKey = $state('when');

	let teamName = $derived(new Map(data.teams.map((t) => [t.id, t.name])));
	let teamAccent = $derived(new Map(data.teams.map((t) => [t.id, t.accent])));
	let teamOrder = $derived(new Map(data.teams.map((t, i) => [t.id, i])));
	let studentName = $derived(
		new Map(data.students.map((s) => [s.id, `${s.first_name} ${s.last_initial}.`]))
	);
	let meetingIds = $derived(new Set(data.meetings.map((m) => m.id)));
	let meetingLabel = $derived(
		new Map(data.meetings.map((m) => [m.id, `${formatDay(m.meeting_date)} ${m.kind}`]))
	);

	function countByTask(rows: { task_id: string | null }[]) {
		const out = new Map<string, number>();
		for (const row of rows) {
			if (!row.task_id) continue;
			out.set(row.task_id, (out.get(row.task_id) ?? 0) + 1);
		}
		return out;
	}
	let photoCount = $derived(countByTask(data.evidence));
	let blockerCount = $derived(countByTask(data.blockers));

	function roleRank(r: TeamRole | null) {
		return r ? TEAM_ROLES.indexOf(r) : TEAM_ROLES.length;
	}
	function newestFirst(a: TaskRow, b: TaskRow) {
		return b.created_at.localeCompare(a.created_at);
	}

	let shown = $derived.by(() => {
		const q = fText.trim().toLowerCase();
		const rows = data.tasks.filter((t) => {
			if (fTeam && t.team_id !== fTeam) return false;
			if (fRole && t.role !== fRole) return false;
			if (fStatus && t.status !== fStatus) return false;
			if (q && !`${t.title} ${t.detail ?? ''}`.toLowerCase().includes(q)) return false;
			return true;
		});
		return rows.sort((a, b) => {
			switch (sortKey) {
				case 'team':
					return (
						(teamOrder.get(a.team_id) ?? 99) - (teamOrder.get(b.team_id) ?? 99) || newestFirst(a, b)
					);
				case 'role':
					return roleRank(a.role) - roleRank(b.role) || newestFirst(a, b);
				case 'status':
					return STATUS_RANK[a.status] - STATUS_RANK[b.status] || newestFirst(a, b);
				case 'title':
					return a.title.localeCompare(b.title);
				default:
					return newestFirst(a, b);
			}
		});
	});

	let filtering = $derived(Boolean(fTeam || fRole || fStatus || fText.trim()));
	let shownPhotos = $derived(shown.reduce((n, t) => n + (photoCount.get(t.id) ?? 0), 0));
	let shownBlockers = $derived(shown.reduce((n, t) => n + (blockerCount.get(t.id) ?? 0), 0));

	function clearFilters() {
		fTeam = '';
		fRole = '';
		fStatus = '';
		fText = '';
		confirmBulk = false;
	}

	// --- the one task being edited -------------------------------------------
	let selectedId = $state('');
	let editTitle = $state('');
	let editDetail = $state('');
	let editRole = $state<TeamRole | ''>('');
	let editAssignee = $state('');
	let editMeetingId = $state('');
	let editEvidence = $state(false);
	let confirmTask = $state('');
	let confirmPhoto = $state('');
	let confirmBulk = $state(false);

	let selected = $derived(data.tasks.find((t) => t.id === selectedId) ?? null);
	let selectedRoster = $derived.by(() => {
		const task = selected;
		return task ? data.students.filter((s) => s.team_id === task.team_id) : [];
	});
	let selectedPhotos = $derived.by(() => {
		const task = selected;
		return task ? data.evidence.filter((e) => e.task_id === task.id) : [];
	});
	let selectedPhotoCount = $derived(photoCount.get(selectedId) ?? 0);
	let selectedBlockerCount = $derived(blockerCount.get(selectedId) ?? 0);

	/**
	 * The form is seeded from whichever task is selected, and re-seeded when the
	 * load comes back, so what is on screen after a save is what the database
	 * holds rather than what was typed at it.
	 */
	$effect(() => {
		const task = selected;
		if (!task) return;
		editTitle = task.title;
		editDetail = task.detail ?? '';
		editRole = task.role ?? '';
		editAssignee = task.assigned_student_id ?? '';
		editMeetingId = task.meeting_id ?? '';
		editEvidence = task.evidence_required;
	});

	function pick(id: string) {
		selectedId = selectedId === id ? '' : id;
		confirmTask = '';
		confirmPhoto = '';
		message = '';
		good = '';
	}

	function saveTask(event: SubmitEvent) {
		event.preventDefault();
		const task = selected;
		if (!task) return;
		if (!editTitle.trim()) {
			message = 'A task needs a title.';
			return;
		}
		return write(
			`save:${task.id}`,
			async () =>
				data.supabase
					.from('tasks')
					.update({
						title: editTitle.trim(),
						detail: editDetail.trim() || null,
						role: editRole || null,
						assigned_student_id: editAssignee || null,
						meeting_id: editMeetingId || null,
						evidence_required: editEvidence
					})
					.eq('id', task.id)
					.select('id'),
			{
				failed: 'That edit was not saved. Check the title and the assignee, then try again.',
				refused: 'That edit was refused. The task may have been deleted while this page was open.',
				ok: 'Task saved.'
			}
		);
	}

	/**
	 * Status is set directly, including back off done. `closed_at` follows
	 * status on the server clock (0007's trigger clears it), so reopening a
	 * task is one write and the client never sends a time.
	 */
	function setStatus(id: string, status: TaskStatus) {
		return write(
			`status:${id}`,
			async () => data.supabase.from('tasks').update({ status }).eq('id', id).select('id'),
			{
				failed: 'That status did not save. Try it again.',
				refused: 'That status was refused. The task may have been deleted while this page was open.',
				ok: status === 'done' ? 'Closed.' : `Set to ${STATUS_LABEL[status].toLowerCase()}.`
			}
		);
	}

	async function removeTask(id: string) {
		if (confirmTask !== id) {
			confirmTask = id;
			return;
		}
		confirmTask = '';
		const okay = await write(
			`del:${id}`,
			async () => data.supabase.from('tasks').delete().eq('id', id).select('id'),
			{
				failed: 'That task was not deleted. Try it again.',
				refused: 'That delete was refused. The task may already be gone: reload the page.',
				ok: 'Task deleted.'
			}
		);
		if (okay && selectedId === id) selectedId = '';
	}

	async function removeShown() {
		if (!confirmBulk) {
			confirmBulk = true;
			return;
		}
		confirmBulk = false;
		const ids = shown.map((t) => t.id);
		if (ids.length === 0) return;
		const okay = await write(
			'bulk',
			async () => data.supabase.from('tasks').delete().in('id', ids).select('id'),
			{
				failed: 'Those tasks were not deleted. Try it again.',
				refused: 'That delete was refused. Nothing was removed.',
				ok: `Deleted ${ids.length} task${plural(ids.length)}.`
			}
		);
		if (okay && ids.includes(selectedId)) selectedId = '';
	}

	/**
	 * Deleting the row is enough: 0020 hangs an AFTER DELETE trigger off
	 * `evidence` that drops the object out of the bucket, so the file cannot
	 * outlive the row it was named by.
	 */
	async function removePhoto(id: string) {
		if (confirmPhoto !== id) {
			confirmPhoto = id;
			return;
		}
		confirmPhoto = '';
		await write(
			`photo:${id}`,
			async () => data.supabase.from('evidence').delete().eq('id', id).select('id'),
			{
				failed: 'That photo was not deleted. Try it again.',
				refused: 'That delete was refused. The photo may already be gone: reload the page.',
				ok: 'Photo deleted.'
			}
		);
	}
</script>

<svelte:head><title>Tasks</title></svelte:head>

<div class="tasks">
	<section class="card">
		<p class="eyebrow">Tasks</p>
		<h1>Create work</h1>
		{#if message}
			<p class="error" role="alert">{message}</p>
		{/if}
		{#if good}
			<p class="notice" role="status">{good}</p>
		{/if}
		{#if data.loadError}
			<p class="error">Some of this page did not load. Reload it before creating anything.</p>
		{/if}

		<form onsubmit={create}>
			<label class="field">
				<span>Title</span>
				<input class="input" bind:value={title} maxlength="200" required />
			</label>
			<label class="field">
				<span>Detail</span>
				<textarea class="input" bind:value={detail} rows="3" maxlength="4000"></textarea>
			</label>

			<div class="grid2">
				<label class="field">
					<span>Role queue</span>
					<select class="input" bind:value={role}>
						<option value="">Anyone on the team</option>
						{#each TEAM_ROLES as r (r)}
							<option value={r}>{ROLE_LABEL[r]}</option>
						{/each}
					</select>
				</label>
				<label class="field">
					<span>Meeting</span>
					<select class="input" bind:value={meetingId}>
						<option value="">Not tied to a meeting</option>
						{#each data.meetings as m (m.id)}
							<option value={m.id}>{formatDay(m.meeting_date)} · {m.kind}</option>
						{/each}
					</select>
				</label>
			</div>

			<label class="check">
				<input type="checkbox" bind:checked={evidenceRequired} />
				<span>Evidence required to close it</span>
			</label>

			<fieldset class="teams">
				<legend>Teams</legend>
				<button class="btn btn--ghost btn--small" type="button" onclick={toggleAll}>
					{allSelected ? 'Clear all' : 'Select all four'}
				</button>
				<div class="teams__list">
					{#each data.teams as team (team.id)}
						<label class="check" data-accent={team.accent}>
							<input type="checkbox" checked={targets.includes(team.id)} onchange={() => toggleTeam(team.id)} />
							<span class="accent-dot" aria-hidden="true"></span>
							<span>{team.name}</span>
						</label>
					{/each}
				</div>
			</fieldset>

			<button class="btn btn--primary" type="submit" disabled={busy === 'create'}>
				Create on {targets.length} team{plural(targets.length)}
			</button>
		</form>
	</section>

	<section class="card">
		<h2>Every task</h2>
		<p class="muted small">
			Four teams times a session's worth of work is well past one screen, so this list is filtered and sorted
			rather than scrolled. Pick a task to edit it, move it to another meeting, or set where it stands.
		</p>

		<div class="filters">
			<label class="field">
				<span>Team</span>
				<select class="input" bind:value={fTeam}>
					<option value="">Every team</option>
					{#each data.teams as team (team.id)}
						<option value={team.id}>{team.name}</option>
					{/each}
				</select>
			</label>
			<label class="field">
				<span>Role queue</span>
				<select class="input" bind:value={fRole}>
					<option value="">Every role</option>
					{#each TEAM_ROLES as r (r)}
						<option value={r}>{ROLE_LABEL[r]}</option>
					{/each}
				</select>
			</label>
			<label class="field">
				<span>Status</span>
				<select class="input" bind:value={fStatus}>
					<option value="">Every status</option>
					{#each TASK_STATUSES as s (s)}
						<option value={s}>{STATUS_LABEL[s]}</option>
					{/each}
				</select>
			</label>
			<label class="field">
				<span>Search</span>
				<input class="input" type="search" bind:value={fText} placeholder="Title or detail" />
			</label>
			<label class="field">
				<span>Sort by</span>
				<select class="input" bind:value={sortKey}>
					<option value="when">When it was made</option>
					<option value="team">Team</option>
					<option value="role">Role queue</option>
					<option value="status">Status</option>
					<option value="title">Title</option>
				</select>
			</label>
		</div>

		<div class="bar">
			<p class="muted small">
				Showing {shown.length} of {data.tasks.length} task{plural(data.tasks.length)}.
			</p>
			{#if filtering}
				<button class="btn btn--ghost btn--small" type="button" onclick={clearFilters}>Clear filters</button>
			{/if}
		</div>

		{#if confirmBulk}
			<p class="notice">
				Deleting these {shown.length} task{plural(shown.length)} also deletes the {shownPhotos} photo{plural(
					shownPhotos
				)} on them, out of storage, for good. {shownBlockers} blocker{plural(shownBlockers)} raised on them stay
				raised, pointing at no task.
			</p>
			<div class="bar">
				<button class="btn btn--danger" type="button" disabled={busy === 'bulk'} onclick={removeShown}>
					Yes, delete {shown.length} task{plural(shown.length)}
				</button>
				<button class="btn btn--ghost" type="button" onclick={() => (confirmBulk = false)}>Keep them</button>
			</div>
		{:else if shown.length > 0}
			<div class="bar">
				<button class="btn btn--ghost btn--small" type="button" onclick={removeShown}>
					Delete the {shown.length} task{plural(shown.length)} shown
				</button>
			</div>
		{/if}

		<div class="split">
			<div class="split__list">
				{#if shown.length === 0}
					<p class="muted">Nothing matches. Clear the filters to see the rest.</p>
				{:else}
					<ul class="tlist">
						{#each shown as task (task.id)}
							<li
								class="tlist__item"
								class:tlist__item--on={task.id === selectedId}
								data-accent={teamAccent.get(task.team_id)}
							>
								<button
									class="tlist__pick"
									type="button"
									aria-current={task.id === selectedId ? 'true' : undefined}
									onclick={() => pick(task.id)}
								>
									<span class="tlist__title">{task.title}</span>
									<span class="muted small tlist__meta">
										<span class="accent-dot" aria-hidden="true"></span>
										<span>
											{teamName.get(task.team_id) ?? 'A team'} · {STATUS_LABEL[task.status]}{#if task.role}
												· {ROLE_LABEL[task.role]}{/if}{#if task.assigned_student_id}
												· {studentName.get(task.assigned_student_id) ?? 'assigned'}{/if}{#if task.evidence_required}
												· evidence{/if}
										</span>
									</span>
									<span class="muted small">
										Made {formatDay(task.created_at)}{#if task.meeting_id}
											· {meetingLabel.get(task.meeting_id) ?? 'a cancelled meeting'}{/if}{#if photoCount.get(task.id)}
											· {photoCount.get(task.id)} photo{plural(photoCount.get(task.id) ?? 0)}{/if}
									</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			<div class="split__detail">
				{#if !selected}
					<p class="muted">Pick a task on the left to edit it.</p>
				{:else}
					<h3 class="detail__head">{teamName.get(selected?.team_id ?? '') ?? 'A team'}</h3>

					<div class="statuses">
						{#each TASK_STATUSES as s (s)}
							<button
								class="btn btn--small"
								class:btn--primary={s === selected?.status}
								class:btn--ghost={s !== selected?.status}
								type="button"
								disabled={busy === `status:${selectedId}` || s === selected?.status}
								onclick={() => setStatus(selectedId, s)}
							>
								{STATUS_LABEL[s]}
							</button>
						{/each}
					</div>
					<p class="muted small">
						{#if selected?.status === 'done'}
							Closed {formatDay(selected?.closed_at ?? null)}
							{formatTime(selected?.closed_at ?? null)}. Setting it back to anything else reopens it and clears
							that time.
						{:else}
							A task that is done can be reopened from here at any time.
						{/if}
					</p>

					<form onsubmit={saveTask}>
						<label class="field">
							<span>Title</span>
							<input class="input" bind:value={editTitle} maxlength="200" required />
						</label>
						<label class="field">
							<span>Detail</span>
							<textarea class="input" bind:value={editDetail} rows="3" maxlength="4000"></textarea>
						</label>
						<label class="field">
							<span>Role queue</span>
							<select class="input" bind:value={editRole}>
								<option value="">Anyone on the team</option>
								{#each TEAM_ROLES as r (r)}
									<option value={r}>{ROLE_LABEL[r]}</option>
								{/each}
							</select>
						</label>
						<label class="field">
							<span>Assigned to</span>
							<select class="input" bind:value={editAssignee}>
								<option value="">Nobody in particular</option>
								{#each selectedRoster as student (student.id)}
									<option value={student.id}>{student.first_name} {student.last_initial}.</option>
								{/each}
							</select>
						</label>
						<label class="field">
							<span>Meeting</span>
							<select class="input" bind:value={editMeetingId}>
								<option value="">Not tied to a meeting</option>
								{#if editMeetingId && !meetingIds.has(editMeetingId)}
									<option value={editMeetingId}>The meeting it was filed under</option>
								{/if}
								{#each data.meetings as m (m.id)}
									<option value={m.id}>{formatDay(m.meeting_date)} · {m.kind}</option>
								{/each}
							</select>
						</label>
						<label class="check">
							<input type="checkbox" bind:checked={editEvidence} />
							<span>Evidence required to close it</span>
						</label>
						<div class="bar">
							<button class="btn btn--primary" type="submit" disabled={busy === `save:${selectedId}`}>
								Save this task
							</button>
							<button class="btn btn--ghost" type="button" onclick={() => (selectedId = '')}>Close</button>
						</div>
					</form>

					<h4 class="detail__sub">Photos on this task</h4>
					{#if selectedPhotos.length === 0}
						<p class="muted small">No photos yet. Students attach them from their own screen.</p>
					{:else}
						<ul class="plist">
							{#each selectedPhotos as photo (photo.id)}
								<li class="plist__item">
									<span class="plist__main">
										<strong>{photo.caption || 'No caption'}</strong>
										<span class="muted small">
											{formatDay(photo.upload_timestamp)}
											{formatTime(photo.upload_timestamp)} ·
											{studentName.get(photo.uploaded_by_student_id) ?? 'Somebody no longer on the team'}
										</span>
									</span>
									{#if confirmPhoto === photo.id}
										<span class="plist__confirm">
											<span class="notice small">The photo itself goes with it, out of storage, for good.</span>
											<span class="bar">
												<button
													class="btn btn--danger btn--small"
													type="button"
													disabled={busy === `photo:${photo.id}`}
													onclick={() => removePhoto(photo.id)}
												>
													Yes, delete the photo
												</button>
												<button class="btn btn--ghost btn--small" type="button" onclick={() => (confirmPhoto = '')}>
													Keep it
												</button>
											</span>
										</span>
									{:else}
										<button class="btn btn--ghost btn--small" type="button" onclick={() => removePhoto(photo.id)}>
											Delete
										</button>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}

					<h4 class="detail__sub">Delete this task</h4>
					{#if confirmTask === selectedId}
						<p class="notice">
							The {selectedPhotoCount} photo{plural(selectedPhotoCount)} on this task go with it, out of storage,
							for good. {selectedBlockerCount} blocker{plural(selectedBlockerCount)} raised on it stay raised,
							pointing at no task.
						</p>
						<div class="bar">
							<button
								class="btn btn--danger"
								type="button"
								disabled={busy === `del:${selectedId}`}
								onclick={() => removeTask(selectedId)}
							>
								Yes, delete this task
							</button>
							<button class="btn btn--ghost" type="button" onclick={() => (confirmTask = '')}>Keep it</button>
						</div>
					{:else}
						<button class="btn btn--ghost" type="button" onclick={() => removeTask(selectedId)}>
							Delete this task
						</button>
					{/if}
				{/if}
			</div>
		</div>

		<p class="muted small">
			A task tagged with a role lands in that role's queue in the student runtime. Who is actually in that seat on a
			given day is resolved by the database, never guessed here.
		</p>
	</section>
</div>

<style>
	.tasks {
		display: grid;
		gap: var(--space-4);
		min-width: 0;
	}
	.grid2 {
		display: grid;
		gap: var(--space-3);
	}
	.check {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2.75rem;
	}
	.check input {
		width: 1.25rem;
		height: 1.25rem;
	}
	.teams {
		border: 1px solid var(--hairline);
		border-radius: var(--radius-control);
		padding: var(--space-3);
		margin: 0 0 var(--space-3);
	}
	.teams legend {
		font-size: var(--fs-label);
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		color: var(--text-3);
	}
	.teams__list {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}
	.accent-dot {
		display: inline-block;
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 999px;
		background: var(--team-accent, var(--boundary));
	}

	.filters {
		display: grid;
		gap: var(--space-3);
		margin-bottom: var(--space-2);
	}
	.filters .field {
		margin-bottom: 0;
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

	.split {
		display: grid;
		gap: var(--space-4);
		align-items: start;
		min-width: 0;
	}
	.split__list,
	.split__detail {
		min-width: 0;
	}
	.split__detail {
		border: 1px solid var(--hairline);
		border-radius: var(--radius-card);
		background: var(--surface-2);
		padding: var(--space-4);
	}
	.detail__head {
		margin: 0 0 var(--space-3);
		font-size: var(--fs-h3);
	}
	.detail__sub {
		margin: var(--space-4) 0 var(--space-2);
		font-size: var(--fs-h3);
	}
	.statuses {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}

	.tlist {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-2);
	}
	.tlist__item {
		border-radius: var(--radius-control);
		border: 1px solid var(--hairline);
		background: var(--surface-2);
		min-width: 0;
	}
	.tlist__item--on {
		border-color: var(--team-accent, var(--boundary));
		background: var(--team-accent-wash, var(--surface-1));
	}
	.tlist__pick {
		display: grid;
		gap: 0.125rem;
		width: 100%;
		min-height: 2.75rem;
		padding: var(--space-2) var(--space-3);
		border: 0;
		border-radius: var(--radius-control);
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
		min-width: 0;
	}
	.tlist__title {
		font-weight: var(--fw-bold);
		overflow-wrap: anywhere;
	}
	.tlist__meta {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.plist {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-2);
	}
	.plist__item {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-control);
		border: 1px solid var(--hairline);
		background: var(--surface-1);
	}
	.plist__main {
		display: grid;
		gap: 0.125rem;
		min-width: 0;
		flex: 1 1 12rem;
		overflow-wrap: anywhere;
	}
	.plist__confirm {
		display: grid;
		gap: var(--space-2);
	}
	.plist__confirm .bar {
		margin-bottom: 0;
	}

	@media (min-width: 48rem) {
		.grid2 {
			grid-template-columns: 1fr 1fr;
		}
		.filters {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	@media (min-width: 68rem) {
		.filters {
			grid-template-columns: repeat(5, minmax(0, 1fr));
		}
		.split {
			grid-template-columns: minmax(0, 1fr) minmax(0, 24rem);
		}
	}
</style>

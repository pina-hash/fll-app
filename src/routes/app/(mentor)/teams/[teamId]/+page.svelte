<script lang="ts">
	import { untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { knownPins, mintPin, rememberPin, forgetPins } from '$lib/console/pins';
	import { ACCENT_LABEL, ROLE_LABEL, TEAM_ACCENTS, TEAM_ROLES, type TeamAccent, type TeamRole } from '$lib/console/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let busy = $state('');
	let message = $state('');
	let good = $state('');

	// --- team settings -------------------------------------------------------
	// untrack: these are seeded from the first team and then owned by the form.
	// The $effect below re-seeds them when the rail switches to another team.
	let name = $state(untrack(() => data.team.name));
	let number = $state(untrack(() => (data.team.fll_team_number ? String(data.team.fll_team_number) : '')));
	let accent = $state<TeamAccent>(untrack(() => data.team.accent));
	let confirmRotate = $state(false);

	// Re-seed the form when the rail switches team.
	$effect(() => {
		const t = data.team;
		name = t.name;
		number = t.fll_team_number ? String(t.fll_team_number) : '';
		accent = t.accent;
		confirmRotate = false;
	});

	// --- PINs this tab has seen ---------------------------------------------
	let pins = $state<Record<string, string>>({});
	$effect(() => {
		pins = knownPins();
	});

	// --- add-a-student form --------------------------------------------------
	let firstName = $state('');
	let lastInitial = $state('');
	let grade = $state('');
	let justAdded = $state<{ id: string; name: string; pin: string }[]>([]);
	let firstNameInput = $state<HTMLInputElement | null>(null);

	let activeStudents = $derived(data.students.filter((s) => !s.deactivated_at));
	let takenAccents = $derived(
		new Set(data.teams.filter((t) => !t.archived_at && t.id !== data.team.id).map((t) => t.accent))
	);
	let rolesWithoutSecond = $derived(data.roles.filter((r) => !r.has_second).length);

	async function call(key: string, fn: () => Promise<{ error: { message: string } | null }>, ok = '') {
		busy = key;
		message = '';
		good = '';
		const { error } = await fn();
		busy = '';
		if (error) {
			message = error.message;
			return false;
		}
		good = ok;
		await invalidateAll();
		return true;
	}

	function saveTeam(event: SubmitEvent) {
		event.preventDefault();
		return call(
			'team',
			async () =>
				data.supabase
					.from('teams')
					.update({
						name: name.trim(),
						fll_team_number: number.trim() ? Number(number) : null,
						accent
					})
					.eq('id', data.team.id),
			'Team saved.'
		);
	}

	async function rotateCode() {
		if (!confirmRotate) {
			confirmRotate = true;
			return;
		}
		confirmRotate = false;
		busy = 'rotate';
		message = '';
		good = '';
		const { data: result, error } = await data.supabase.rpc('team_regenerate_join_code', {
			p_team_id: data.team.id
		});
		busy = '';
		if (error) {
			message = error.message;
			return;
		}
		const row = result as { join_code: string; students_relogin: number } | null;
		good = `New code ${row?.join_code}. ${row?.students_relogin ?? 0} student login${
			row?.students_relogin === 1 ? '' : 's'
		} rewritten and signed out. Reprint the roster card.`;
		await invalidateAll();
	}

	async function addStudent(event: SubmitEvent) {
		event.preventDefault();
		message = '';
		good = '';
		if (!firstName.trim() || !/^[A-Za-z]$/.test(lastInitial.trim())) {
			message = 'A first name and a single-letter last initial, please.';
			return;
		}
		busy = 'add';
		const { data: created, error } = await data.supabase.rpc('student_create', {
			p_team_id: data.team.id,
			p_first_name: firstName.trim(),
			p_last_initial: lastInitial.trim().toUpperCase(),
			p_grade: grade.trim() ? Number(grade) : undefined
		});
		busy = '';
		if (error) {
			message = error.message;
			return;
		}
		const row = created as { student_id: string; first_name: string; last_initial: string; pin: string } | null;
		if (row?.student_id && row.pin) {
			rememberPin(row.student_id, row.pin);
			pins = knownPins();
			justAdded = [
				...justAdded,
				{ id: row.student_id, name: `${row.first_name} ${row.last_initial}.`, pin: row.pin }
			];
		}
		// Stay on the form: a mentor adds six students in a row.
		firstName = '';
		lastInitial = '';
		grade = '';
		firstNameInput?.focus();
		await invalidateAll();
	}

	async function resetPin(studentId: string, label: string) {
		const pin = mintPin();
		const okay = await call(
			`pin:${studentId}`,
			async () => data.supabase.rpc('student_reset_pin', { p_student_id: studentId, p_new_pin: pin }),
			`${label}'s new PIN is ${pin}. It is shown until this tab closes.`
		);
		if (okay) {
			rememberPin(studentId, pin);
			pins = knownPins();
		}
	}

	function deactivate(studentId: string) {
		return call(
			`off:${studentId}`,
			async () => data.supabase.rpc('student_deactivate', { p_student_id: studentId }),
			'Deactivated. Their PIN no longer works.'
		);
	}

	function reactivate(studentId: string) {
		return call(
			`on:${studentId}`,
			async () => data.supabase.rpc('student_reactivate', { p_student_id: studentId }),
			'Reactivated with the same PIN.'
		);
	}

	function setRole(role: TeamRole, tier: 'primary' | 'second', studentId: string) {
		if (!studentId) {
			return call(
				`role:${role}:${tier}`,
				async () => data.supabase.rpc('role_unassign', { p_team_id: data.team.id, p_role: role, p_tier: tier }),
				'Role cleared.'
			);
		}
		// role_assign, not an insert: 0005's exclusion constraints refuse an
		// overlapping holder, so the RPC ends the old assignment first.
		return call(
			`role:${role}:${tier}`,
			async () =>
				data.supabase.rpc('role_assign', {
					p_team_id: data.team.id,
					p_student_id: studentId,
					p_role: role,
					p_tier: tier
				}),
			'Role set.'
		);
	}

	function holderOf(role: TeamRole, tier: 'primary' | 'second'): string {
		const row = data.roles.find((r) => r.role === role);
		if (!row) return '';
		return (tier === 'primary' ? row.primary_student_id : row.second_student_id) ?? '';
	}

	function clearPins() {
		forgetPins();
		pins = {};
		justAdded = [];
		good = 'PINs forgotten for this tab.';
	}
</script>

<svelte:head><title>{data.team.name}</title></svelte:head>

<div class="tp" data-accent={data.team.accent}>
	{#if message}
		<p class="error" role="alert">{message}</p>
	{/if}
	{#if good}
		<p class="notice" role="status">{good}</p>
	{/if}

	<section class="card">
		<h1 class="tp__name">{data.team.name}</h1>
		<p class="muted small">
			Join code <code class="tp__code">{data.team.join_code}</code> ·
			<a href="/app/teams/{data.team.id}/card">Printable roster card</a> ·
			<a href="/app/board/{data.team.id}">Live view</a>
		</p>

		<form onsubmit={saveTeam} class="tp__form">
			<label class="field">
				<span>Name</span>
				<input class="input" bind:value={name} maxlength="80" required />
			</label>
			<label class="field">
				<span>FLL number</span>
				<input class="input" bind:value={number} inputmode="numeric" pattern="[0-9]*" placeholder="unassigned" />
			</label>
			<label class="field">
				<span>Accent</span>
				<select class="input" bind:value={accent}>
					{#each TEAM_ACCENTS as option (option)}
						<option value={option}>{ACCENT_LABEL[option]}{takenAccents.has(option) ? ' (another team)' : ''}</option>
					{/each}
				</select>
			</label>
			<button class="btn btn--secondary" type="submit" disabled={busy === 'team'}>Save team</button>
		</form>

		<hr class="rule" />
		<h3>Join code</h3>
		{#if confirmRotate}
			<p class="notice">
				A new code rewrites the login address of all {activeStudents.length} students on this team and signs them out.
				Their PINs stay the same. Every printed card becomes wrong.
			</p>
			<div class="tp__row">
				<button class="btn btn--primary" disabled={busy === 'rotate'} onclick={rotateCode}>
					Yes, regenerate {data.team.join_code}
				</button>
				<button class="btn btn--ghost" onclick={() => (confirmRotate = false)}>Keep it</button>
			</div>
		{:else}
			<button class="btn btn--ghost" onclick={rotateCode}>Regenerate join code</button>
		{/if}
	</section>

	<section class="card">
		<h2>Roles</h2>
		<p class="muted small">
			One primary and one second for each of the five roles. A role without a second is the attendance failure
			waiting to happen: if the primary is out that day, nobody is in the seat.
		</p>
		{#if rolesWithoutSecond > 0}
			<p class="notice" role="status">
				{rolesWithoutSecond} of 5 roles have no second.
			</p>
		{/if}
		{#if data.rolesError}
			<p class="error">{data.rolesError}</p>
		{/if}
		<ul class="roles">
			{#each TEAM_ROLES as role (role)}
				{@const row = data.roles.find((r) => r.role === role)}
				<li class="rrow" class:rrow--warn={row && !row.has_second}>
					<span class="rrow__label">{ROLE_LABEL[role]}</span>
					<label class="rrow__pick">
						<span class="small muted">Primary</span>
						<select
							class="input"
							disabled={busy === `role:${role}:primary`}
							value={holderOf(role, 'primary')}
							onchange={(e) => setRole(role, 'primary', e.currentTarget.value)}
						>
							<option value="">Nobody</option>
							{#each activeStudents as s (s.id)}
								<option value={s.id}>{s.first_name} {s.last_initial}.</option>
							{/each}
						</select>
					</label>
					<label class="rrow__pick">
						<span class="small muted">Second</span>
						<select
							class="input"
							disabled={busy === `role:${role}:second`}
							value={holderOf(role, 'second')}
							onchange={(e) => setRole(role, 'second', e.currentTarget.value)}
						>
							<option value="">Nobody</option>
							{#each activeStudents as s (s.id)}
								<option value={s.id}>{s.first_name} {s.last_initial}.</option>
							{/each}
						</select>
					</label>
				</li>
			{/each}
		</ul>
	</section>

	<section class="card">
		<h2>Add students</h2>
		<p class="muted small">
			Creating a student mints their PIN and shows it once, here. Read it aloud or print the roster card; nothing can
			tell you a PIN again afterwards, only reset it.
		</p>
		<form onsubmit={addStudent} class="tp__form">
			<label class="field">
				<span>First name</span>
				<input class="input" bind:value={firstName} bind:this={firstNameInput} maxlength="40" required />
			</label>
			<label class="field">
				<span>Last initial</span>
				<input class="input input--initial" bind:value={lastInitial} maxlength="1" required />
			</label>
			<label class="field">
				<span>Grade</span>
				<input class="input" bind:value={grade} inputmode="numeric" pattern="[0-9]*" placeholder="optional" />
			</label>
			<button class="btn btn--primary" type="submit" disabled={busy === 'add'}>Add and stay</button>
		</form>

		{#if justAdded.length}
			<h3>Added this session</h3>
			<ul class="pinlist">
				{#each justAdded as entry (entry.id)}
					<li><span>{entry.name}</span> <code class="pin">{entry.pin}</code></li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="card">
		<h2>Roster</h2>
		<div class="tablewrap">
			<table class="table">
				<thead>
					<tr>
						<th scope="col">Student</th>
						<th scope="col">Grade</th>
						<th scope="col">Login</th>
						<th scope="col">PIN</th>
						<th scope="col">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each data.students as student (student.id)}
						<tr class:row--off={Boolean(student.deactivated_at)}>
							<th scope="row">{student.first_name} {student.last_initial}.</th>
							<td>{student.grade ?? ''}</td>
							<td><code class="small">{student.slug}</code></td>
							<td>
								{#if pins[student.id]}
									<code class="pin">{pins[student.id]}</code>
								{:else}
									<span class="muted small">reset to see one</span>
								{/if}
							</td>
							<td class="tp__row">
								<button
									class="btn btn--ghost btn--small"
									disabled={busy === `pin:${student.id}` || Boolean(student.deactivated_at)}
									onclick={() => resetPin(student.id, `${student.first_name} ${student.last_initial}.`)}
								>
									Reset PIN
								</button>
								{#if student.deactivated_at}
									<button
										class="btn btn--secondary btn--small"
										disabled={busy === `on:${student.id}`}
										onclick={() => reactivate(student.id)}>Reactivate</button
									>
								{:else}
									<button
										class="btn btn--ghost btn--small"
										disabled={busy === `off:${student.id}`}
										onclick={() => deactivate(student.id)}>Deactivate</button
									>
								{/if}
							</td>
						</tr>
					{:else}
						<tr><td colspan="5" class="muted">No students yet.</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
		{#if Object.keys(pins).length}
			<p class="muted small">
				{Object.keys(pins).length} PIN{Object.keys(pins).length === 1 ? '' : 's'} are held in this tab only.
				<button class="btn btn--ghost btn--small" onclick={clearPins}>Forget them now</button>
			</p>
		{/if}
	</section>
</div>

<style>
	.tp {
		display: grid;
		gap: var(--space-4);
		min-width: 0;
	}
	.tp > * {
		min-width: 0;
	}
	.tp__name {
		margin-bottom: var(--space-2);
		color: var(--team-accent);
	}
	.tp__code {
		font-size: var(--fs-h3);
		letter-spacing: var(--track-wide);
		color: var(--team-accent);
	}
	.tp__form {
		display: grid;
		gap: var(--space-3);
		align-items: end;
		margin-top: var(--space-4);
	}
	.tp__row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.rule {
		border: none;
		border-top: 1px solid var(--hairline);
		margin: var(--space-4) 0 var(--space-3);
	}

	.roles {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-2);
	}
	.rrow {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-3);
		border-radius: var(--radius-control);
		border: 1px solid var(--hairline);
		background: var(--surface-2);
	}
	.rrow--warn {
		border-color: var(--amber);
	}
	.rrow__label {
		font-weight: var(--fw-bold);
	}
	.rrow__pick {
		display: grid;
		gap: var(--space-1);
	}

	.pinlist {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-2);
	}
	.pinlist li {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-control);
		background: var(--surface-2);
		border: 1px solid var(--hairline);
	}
	.pin {
		font-family: var(--font-mono);
		font-size: var(--fs-h3);
		font-weight: var(--fw-bold);
		letter-spacing: var(--track-wide);
		color: var(--glow-green);
	}

	.tablewrap {
		overflow-x: auto;
	}
	.table {
		width: 100%;
		border-collapse: collapse;
		min-width: 34rem;
	}
	.table th,
	.table td {
		text-align: left;
		padding: var(--space-2) var(--space-2);
		border-bottom: 1px solid var(--hairline);
		vertical-align: middle;
	}
	.table thead th {
		font-size: var(--fs-label);
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		color: var(--text-3);
	}
	.row--off th,
	.row--off td {
		color: var(--text-3);
	}

	:global(.input--initial) {
		max-width: 5rem;
		text-transform: uppercase;
	}

	@media (min-width: 48rem) {
		.tp__form {
			grid-template-columns: 2fr 1fr 1fr auto;
		}
		.rrow {
			grid-template-columns: 1fr 1fr 1fr;
			align-items: center;
		}
	}
</style>

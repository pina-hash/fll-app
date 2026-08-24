<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { watchTables } from '$lib/console/live.svelte';
	import { knownPins, mintPin, rememberPin, forgetPins } from '$lib/console/pins';
	import { parentUrl } from '$lib/parent/qr';
	import { ROLE_LABEL, TEAM_ROLES, type TeamAccent, type TeamRole } from '$lib/console/types';
	import AccentPicker from '$lib/team/AccentPicker.svelte';
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
	let shortName = $state(untrack(() => data.team.short_name ?? ''));
	let confirmRotate = $state(false);
	let accentBusy = $state(false);
	let accentMessage = $state('');

	// Re-seed the form when the rail switches team.
	$effect(() => {
		const t = data.team;
		name = t.name;
		number = t.fll_team_number ? String(t.fll_team_number) : '';
		shortName = t.short_name ?? '';
		accentMessage = '';
		confirmRotate = false;
		confirmArchive = false;
		editing = null;
		moving = null;
	});

	/**
	 * THE ROSTER FILLS IN WHILE THIS PAGE IS OPEN. On the Friday this is built,
	 * a mentor hands out seat cards and then watches the children spend them
	 * from twenty phones. A realtime event on `students` or `teams` (0013)
	 * schedules a REFETCH of this load, never a patch: seats left is the cap
	 * minus the roster minus the cards nobody has spent yet, and that
	 * subtraction is a rule that lives in SQL. Recomputing it here from a
	 * stream of INSERTs is the second implementation the repo's rules forbid.
	 */
	onMount(() =>
		watchTables(data.supabase, ['students', 'teams'], `console-roster-${page.params.teamId}`, () =>
			void invalidateAll()
		)
	);

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
	let rolesWithoutSecond = $derived(data.roles.filter((r) => !r.has_second).length);

	// team_roster_state answers for LIVE teams only, so an archived team has no
	// row here at all. That absence is the honest state and is shown as one,
	// never as a team with zero seats.
	let seatsLeft = $derived(data.rosterState?.seats_left ?? 0);
	let sizeCap = $derived(data.rosterState?.size_cap ?? 0);
	let rosterSize = $derived(data.rosterState?.roster_size ?? activeStudents.length);
	let claimsOpen = $derived(data.rosterState?.claims_open ?? 0);
	let archived = $derived(Boolean(data.team.archived_at));
	let otherTeams = $derived(data.teams.filter((t) => !t.archived_at && t.id !== data.team.id));

	let parentByStudent = $derived(
		new Map(data.parentLinks.map((row) => [row.student_id, row]))
	);

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
		// .select(): an RLS-filtered UPDATE comes back 204 with no rows and no
		// error, so "no error" is not "it landed". Asking for the row back is
		// the only thing that tells a rename that saved from one that did not.
		return call(
			'team',
			async () => {
				const result = await data.supabase
					.from('teams')
					.update({
						name: name.trim(),
						fll_team_number: number.trim() ? Number(number) : null
					})
					.eq('id', data.team.id)
					.select('id');
				if (!result.error && (result.data ?? []).length === 0) {
					return { error: { message: 'That change was not saved. Ask an admin mentor.' } };
				}
				return result;
			},
			'Team saved.'
		);
	}

	let proposedByName = $derived.by(() => {
		const id = data.team.accent_proposed_by;
		if (!id) return null;
		const s = data.students.find((x) => x.id === id);
		return s ? `${s.first_name} ${s.last_initial}.` : null;
	});

	async function saveShortName(event: SubmitEvent) {
		event.preventDefault();
		return call(
			'shortname',
			async () =>
				// An empty string is how "no name" is said: the RPC nullifies a
				// blank, so clearing the field clears the name.
				data.supabase.rpc('team_set_short_name', {
					p_team_id: data.team.id,
					p_short_name: shortName.trim()
				}),
			'Team name saved.'
		);
	}

	/**
	 * The mentor override. The DATABASE decides whether it lands: a colour
	 * another live team holds comes back as a sentence naming them, which is
	 * shown rather than swallowed.
	 */
	async function setAccent(accent: TeamAccent | null) {
		accentBusy = true;
		accentMessage = '';
		const { error } = await data.supabase.rpc('team_set_accent', {
			p_team_id: data.team.id,
			p_accent: accent ?? undefined
		});
		accentBusy = false;
		if (error) {
			accentMessage = error.message;
			return;
		}
		await invalidateAll();
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

	// --- archive and restore -------------------------------------------------
	let confirmArchive = $state(false);

	/**
	 * ARCHIVING REFUSES RATHER THAN DESTROYS. `team_archive` counts the
	 * students still on the roster and the seat cards still out, and raises a
	 * sentence naming both; that sentence is shown as it comes, because it is
	 * already written in the mentor's own terms and it says what to do next.
	 */
	async function archiveTeam() {
		if (!confirmArchive) {
			confirmArchive = true;
			return;
		}
		confirmArchive = false;
		busy = 'archive';
		message = '';
		good = '';
		const { error } = await data.supabase.rpc('team_archive', { p_team_id: data.team.id });
		busy = '';
		if (error) {
			message = error.message;
			return;
		}
		good = `${data.team.name} is archived. Bring it back any time from the teams list.`;
		await invalidateAll();
	}

	/**
	 * A restore can cost the team its colour: an accent belongs to one LIVE
	 * team at a time (0018), so another team may have taken it while this one
	 * was away. The RPC decides that and reports it in `accent_cleared`; this
	 * only says what happened.
	 */
	async function restoreTeam() {
		busy = 'restore';
		message = '';
		good = '';
		const { data: result, error } = await data.supabase.rpc('team_restore', { p_team_id: data.team.id });
		busy = '';
		if (error) {
			message = error.message;
			return;
		}
		const row = result as { name: string; accent_cleared: boolean } | null;
		good = row?.accent_cleared
			? `${data.team.name} is back. Another team took its colour while it was away, so it has none now: pick a new one above.`
			: `${data.team.name} is back on the live teams list.`;
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

	// --- editing one student -------------------------------------------------
	let editing = $state<string | null>(null);
	let editFirst = $state('');
	let editInitial = $state('');
	let editGrade = $state('');
	let moving = $state<{ studentId: string; toTeamId: string } | null>(null);

	function startEdit(student: { id: string; first_name: string; last_initial: string; grade: number | null }) {
		editing = student.id;
		editFirst = student.first_name;
		editInitial = student.last_initial;
		editGrade = student.grade ? String(student.grade) : '';
	}

	async function saveEdit(studentId: string) {
		if (!editFirst.trim() || !/^[A-Za-z]$/.test(editInitial.trim())) {
			message = 'A first name and a single-letter last initial, please.';
			return;
		}
		// .select(): an RLS-filtered UPDATE comes back 204 with no error and no
		// rows. Asking for the row back is what tells "saved" from "refused".
		const okay = await call(
			`edit:${studentId}`,
			async () => {
				const result = await data.supabase
					.from('students')
					.update({
						first_name: editFirst.trim(),
						last_initial: editInitial.trim().toUpperCase(),
						grade: editGrade.trim() ? Number(editGrade) : null
					})
					.eq('id', studentId)
					.select('id');
				if (!result.error && (result.data ?? []).length === 0) {
					return { error: { message: 'That change was not saved. Ask an admin mentor.' } };
				}
				return result;
			},
			'Saved. Their login is unchanged.'
		);
		if (okay) editing = null;
	}

	async function moveStudent(studentId: string, toTeamId: string) {
		if (!moving || moving.studentId !== studentId || moving.toTeamId !== toTeamId) {
			moving = { studentId, toTeamId };
			return;
		}
		moving = null;
		busy = `move:${studentId}`;
		message = '';
		good = '';
		const { data: result, error } = await data.supabase.rpc('student_move_team', {
			p_student_id: studentId,
			p_to_team_id: toTeamId
		});
		busy = '';
		if (error) {
			message = error.message;
			return;
		}
		const row = result as {
			to_team_name: string;
			roles_cleared: number;
			tasks_unassigned: number;
		} | null;
		good =
			`Moved to ${row?.to_team_name}. Their login address changed and they are signed out; the PIN is the same. ` +
			`${row?.roles_cleared ?? 0} role assignment${row?.roles_cleared === 1 ? '' : 's'} cleared, ` +
			`${row?.tasks_unassigned ?? 0} job${row?.tasks_unassigned === 1 ? '' : 's'} unassigned. Reprint both roster cards.`;
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
			'Deactivated. Their PIN no longer works, and their seat is free.'
		);
	}

	function reactivate(studentId: string) {
		return call(
			`on:${studentId}`,
			async () => data.supabase.rpc('student_reactivate', { p_student_id: studentId }),
			'Reactivated with the same PIN.'
		);
	}

	// --- parent links --------------------------------------------------------
	let copied = $state('');

	function issueParentLink(studentId: string, label: string) {
		return call(
			`parent:${studentId}`,
			async () => data.supabase.rpc('parent_access_issue', { p_student_id: studentId }),
			`${label} has a new link. Any link printed before now is dead. Print the parent cards again.`
		);
	}

	function revokeParentLink(studentId: string, label: string) {
		return call(
			`parentoff:${studentId}`,
			async () => data.supabase.rpc('parent_access_revoke', { p_student_id: studentId }),
			`${label}'s parent link is off.`
		);
	}

	async function copyLink(token: string, studentId: string) {
		try {
			await navigator.clipboard.writeText(parentUrl(page.url.origin, token));
			copied = studentId;
			setTimeout(() => (copied = ''), 2000);
		} catch {
			message = 'This browser would not let the page copy. Open the parent cards page and read it off there.';
		}
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

	// --- team board device ---------------------------------------------------
	let boardPin = $state('');
	let confirmBoardOff = $state(false);

	function enableBoard(event: SubmitEvent) {
		event.preventDefault();
		if (!/^[0-9]{6}$/.test(boardPin)) {
			message = 'A board PIN is 6 digits.';
			return;
		}
		const pin = boardPin;
		boardPin = '';
		return call(
			'board',
			async () => data.supabase.rpc('team_board_enable', { p_team_id: data.team.id, p_pin: pin }),
			`Board ready. Open /board on the iPad, type ${data.team.join_code} and that PIN.`
		);
	}

	async function disableBoard() {
		if (!confirmBoardOff) {
			confirmBoardOff = true;
			return;
		}
		confirmBoardOff = false;
		await call(
			'boardoff',
			async () => data.supabase.rpc('team_board_disable', { p_team_id: data.team.id }),
			'Board turned off. The iPad is signed out.'
		);
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

	{#if archived}
		<p class="notice" role="status">
			This team is archived. It is off the live teams list, out of the colour palette and out of every "move a
			student here" menu. Nothing it did was deleted.
		</p>
	{/if}

	<section class="card">
		<h1 class="tp__name">{data.team.name}</h1>
		<p class="muted small">
			Join code <code class="tp__code">{data.team.join_code}</code> ·
			<a href="/app/teams/{data.team.id}/card">Printable roster card</a> ·
			<a href="/app/teams/{data.team.id}/parents">Parent cards</a> ·
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
			<button class="btn btn--secondary" type="submit" disabled={busy === 'team'}>Save team</button>
		</form>

		<hr class="rule" />
		<form onsubmit={saveShortName} class="tp__form">
			<label class="field">
				<span>The name the team picked for itself</span>
				<input
					class="input"
					bind:value={shortName}
					maxlength="24"
					placeholder="optional, shown under the number"
				/>
			</label>
			<button class="btn btn--secondary" type="submit" disabled={busy === 'shortname'}>
				Save the team name
			</button>
		</form>

		<hr class="rule" />
		<AccentPicker
			teamId={data.team.id}
			teamName={data.team.name}
			options={data.accentOptions}
			current={data.team.accent}
			proposed={data.team.accent_proposed}
			proposedByName={proposedByName}
			canConfirm={true}
			canPropose={true}
			isMentor={true}
			busy={accentBusy}
			message={accentMessage}
			onSet={setAccent}
		/>

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

	<!-- SEATS. A seat is held by a student on the roster OR by a seat card that
	     has been handed out and not yet spent. The subtraction is SQL's
	     (team_roster_state, 0019); this only prints the three numbers. -->
	<section class="card">
		<h2>Seats</h2>
		{#if data.rosterState}
			<ul class="seats">
				<li class="seats__stat">
					<span class="seats__n">{rosterSize}</span>
					<span class="seats__u">on the team</span>
				</li>
				<li class="seats__stat">
					<span class="seats__n">{claimsOpen}</span>
					<span class="seats__u">seat card{claimsOpen === 1 ? '' : 's'} out</span>
				</li>
				<li class="seats__stat">
					<span class="seats__n">{seatsLeft}</span>
					<span class="seats__u">of {sizeCap} free</span>
				</li>
			</ul>
			<p class="muted small">
				A seat card carries a six-character code a child types at the login screen to take their seat and pick
				their own PIN. A card that is out holds its seat until it is used or you void it.
			</p>
			<a class="btn btn--primary" href="/app/teams/{data.team.id}/claims">Seat cards</a>
			{#if seatsLeft === 0}
				<p class="muted small">
					All {sizeCap} seats are spoken for, by students or by cards nobody has used yet. Take somebody off the
					team, or void a card, before handing out another.
				</p>
			{/if}
		{:else}
			<p class="muted small">
				Seats are counted for live teams only, and this one is archived. Nobody can take a seat on it until it is
				back.
			</p>
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
		<h2>Team board iPad</h2>
		<p class="muted small">
			The spare iPad on the table, for students with no device. It shows the phase, the clock, who is here and the
			open jobs, and anyone can tap a job done from it. It is a device, not a person: it holds no role, is never
			checked in and appears on no roster.
		</p>
		{#if data.boardDevice}
			<p class="notice" role="status">
				This team has a board. On the iPad open <code>/board</code>, type <code>{data.team.join_code}</code> and the
				PIN you set.
			</p>
			<form onsubmit={enableBoard} class="tp__form">
				<label class="field">
					<span>Change the board PIN</span>
					<input class="input" bind:value={boardPin} inputmode="numeric" maxlength="6" placeholder="6 digits" />
				</label>
				<button class="btn btn--secondary" type="submit" disabled={busy === 'board'}>Set new PIN</button>
			</form>
			{#if confirmBoardOff}
				<div class="tp__row">
					<button class="btn btn--primary" disabled={busy === 'boardoff'} onclick={disableBoard}>
						Yes, turn the board off
					</button>
					<button class="btn btn--ghost" onclick={() => (confirmBoardOff = false)}>Keep it</button>
				</div>
			{:else}
				<button class="btn btn--ghost" onclick={disableBoard}>Turn the board off</button>
			{/if}
		{:else}
			<form onsubmit={enableBoard} class="tp__form">
				<label class="field">
					<span>Board PIN</span>
					<input class="input" bind:value={boardPin} inputmode="numeric" maxlength="6" placeholder="6 digits" />
				</label>
				<button class="btn btn--primary" type="submit" disabled={busy === 'board'}>Turn the board on</button>
			</form>
		{/if}
	</section>

	<section class="card">
		<h2>Add students by hand</h2>
		<p class="muted small">
			For the ones who will not be in the room, or whose phone will not cooperate. Creating a student mints their
			PIN and shows it once, here. Read it aloud or print the roster card; nothing can tell you a PIN again
			afterwards, only reset it.
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
			<button class="btn btn--primary" type="submit" disabled={busy === 'add' || archived || seatsLeft === 0}>
				Add and stay
			</button>
		</form>
		{#if archived}
			<p class="muted small">This team is archived. Bring it back before you add anybody to it.</p>
		{:else if seatsLeft === 0}
			<p class="muted small">
				This team is full ({sizeCap}). Take somebody off, or void a seat card, first.
			</p>
		{/if}

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
		<p class="muted small">
			{#if data.rosterState}
				{rosterSize} of {sizeCap} seats used, {claimsOpen} card{claimsOpen === 1 ? '' : 's'} still out. This list
				fills in by itself as children spend their seat cards.
			{:else}
				{activeStudents.length} student{activeStudents.length === 1 ? '' : 's'} on this team.
			{/if}
		</p>
		<div class="tablewrap">
			<table class="table">
				<thead>
					<tr>
						<th scope="col">Student</th>
						<th scope="col">Grade</th>
						<th scope="col">Login</th>
						<th scope="col">PIN</th>
						<th scope="col">Parent link</th>
						<th scope="col">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each data.students as student (student.id)}
						{@const link = parentByStudent.get(student.id)}
						{@const label = `${student.first_name} ${student.last_initial}.`}
						<tr class:row--off={Boolean(student.deactivated_at)}>
							<th scope="row">
								{#if editing === student.id}
									<div class="edit">
										<input class="input" bind:value={editFirst} maxlength="40" aria-label="First name" />
										<input
											class="input input--initial"
											bind:value={editInitial}
											maxlength="1"
											aria-label="Last initial"
										/>
									</div>
								{:else}
									{label}
								{/if}
							</th>
							<td>
								{#if editing === student.id}
									<input
										class="input input--grade"
										bind:value={editGrade}
										inputmode="numeric"
										pattern="[0-9]*"
										aria-label="Grade"
									/>
								{:else}
									{student.grade ?? ''}
								{/if}
							</td>
							<td><code class="small">{student.slug}</code></td>
							<td>
								{#if pins[student.id]}
									<code class="pin">{pins[student.id]}</code>
								{:else}
									<span class="muted small">reset to see one</span>
								{/if}
							</td>
							<td class="tp__row">
								{#if link && !link.revoked_at}
									<button
										class="btn btn--ghost btn--small"
										onclick={() => copyLink(link.token, student.id)}
									>
										{copied === student.id ? 'Copied' : 'Copy link'}
									</button>
									<button
										class="btn btn--ghost btn--small"
										disabled={busy === `parentoff:${student.id}`}
										onclick={() => revokeParentLink(student.id, label)}>Turn off</button
									>
									<span class="muted small">
										{link.open_count > 0 ? `opened ${link.open_count}x` : 'not opened yet'}
									</span>
								{:else}
									<button
										class="btn btn--secondary btn--small"
										disabled={busy === `parent:${student.id}` || Boolean(student.deactivated_at)}
										onclick={() => issueParentLink(student.id, label)}
									>
										{link ? 'New link' : 'Make link'}
									</button>
								{/if}
							</td>
							<td class="tp__row">
								{#if editing === student.id}
									<button
										class="btn btn--primary btn--small"
										disabled={busy === `edit:${student.id}`}
										onclick={() => saveEdit(student.id)}>Save</button
									>
									<button class="btn btn--ghost btn--small" onclick={() => (editing = null)}>Cancel</button>
								{:else}
									<button class="btn btn--ghost btn--small" onclick={() => startEdit(student)}>Edit</button>
									<button
										class="btn btn--ghost btn--small"
										disabled={busy === `pin:${student.id}` || Boolean(student.deactivated_at)}
										onclick={() => resetPin(student.id, label)}
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
									{#if otherTeams.length > 0 && !student.deactivated_at}
										<select
											class="input input--move"
											aria-label={`Move ${label} to another team`}
											value={moving?.studentId === student.id ? moving.toTeamId : ''}
											disabled={busy === `move:${student.id}`}
											onchange={(e) => e.currentTarget.value && moveStudent(student.id, e.currentTarget.value)}
										>
											<option value="">Move to...</option>
											{#each otherTeams as t (t.id)}
												<option value={t.id}>{t.name}</option>
											{/each}
										</select>
									{/if}
								{/if}
							</td>
						</tr>
						{#if moving?.studentId === student.id}
							<tr class="confirmrow">
								<td colspan="6">
									<p class="notice">
										Moving {label} to {otherTeams.find((t) => t.id === moving?.toTeamId)?.name} rewrites their
										login address (the code and the name part both change) and signs them out on every device.
										Their PIN stays the same. Their role assignments are cleared and their jobs are unassigned.
										Both roster cards become wrong.
									</p>
									<div class="tp__row">
										<button
											class="btn btn--primary btn--small"
											disabled={busy === `move:${student.id}`}
											onclick={() => moving && moveStudent(student.id, moving.toTeamId)}
										>
											Yes, move {label}
										</button>
										<button class="btn btn--ghost btn--small" onclick={() => (moving = null)}>Stay here</button>
									</div>
								</td>
							</tr>
						{/if}
					{:else}
						<tr><td colspan="6" class="muted">No students yet. Hand out seat cards, or add one by hand.</td></tr>
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

	<section class="card">
		<h2>{archived ? 'Bring this team back' : 'Put this team away'}</h2>
		{#if archived}
			<p class="muted small">
				Everything this team did is still attached to it: the roster, the seat cards, the match runs and the
				notebook. Bringing it back may cost it its colour, because a colour belongs to one live team at a time and
				another team may have taken it while this one was away. Nothing else changes.
			</p>
			<button class="btn btn--primary" disabled={busy === 'restore'} onclick={restoreTeam}>
				Bring {data.team.name} back
			</button>
		{:else if confirmArchive}
			<p class="notice">
				Archiving {data.team.name} takes it off the live teams list, off the login screen, and out of every
				"move a student here" menu, and gives up its colour to whichever team asks for it next. Its roster, its
				seat cards, its match runs and its notebook all stay attached to it, and the archived filter on the
				teams list brings it back. If it still has a team board iPad, turn that off above first: archiving does
				not sign it out.
			</p>
			<div class="tp__row">
				<button class="btn btn--danger" disabled={busy === 'archive'} onclick={archiveTeam}>
					Yes, archive {data.team.name}
				</button>
				<button class="btn btn--ghost" onclick={() => (confirmArchive = false)}>Keep it</button>
			</div>
		{:else}
			<p class="muted small">
				For a team that is not running this season. It refuses while anybody is still on the roster or any seat
				card is still out, and tells you how many of each: move them, take them off, or void the cards first.
			</p>
			<button class="btn btn--ghost" onclick={archiveTeam}>Archive this team</button>
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
		align-items: center;
	}
	.rule {
		border: none;
		border-top: 1px solid var(--hairline);
		margin: var(--space-4) 0 var(--space-3);
	}

	.seats {
		list-style: none;
		margin: var(--space-3) 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(9rem, 100%), 1fr));
		gap: var(--space-3);
	}
	.seats__stat {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: var(--space-2);
		min-width: 0;
		padding: var(--space-3);
		border-radius: var(--radius-control);
		border: 1px solid var(--hairline);
		background: var(--surface-2);
	}
	.seats__n {
		font-family: var(--font-mono);
		font-size: var(--fs-h1);
		font-weight: var(--fw-black);
		color: var(--team-accent);
		line-height: 1;
	}
	.seats__u {
		font-size: var(--fs-label);
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		color: var(--text-3);
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
		border-color: var(--warning);
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
		color: var(--success-text);
	}

	.tablewrap {
		overflow-x: auto;
	}
	.table {
		width: 100%;
		border-collapse: collapse;
		min-width: 52rem;
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
	.confirmrow td {
		background: var(--surface-2);
	}
	.edit {
		display: flex;
		gap: var(--space-2);
	}

	:global(.input--initial) {
		max-width: 5rem;
		text-transform: uppercase;
	}
	:global(.input--grade) {
		max-width: 5rem;
	}
	:global(.input--move) {
		max-width: 11rem;
		min-height: 2.25rem;
	}
	@media (pointer: coarse) {
		:global(.input--move) {
			min-height: 2.75rem;
		}
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

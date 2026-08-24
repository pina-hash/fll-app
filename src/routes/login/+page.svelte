<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import { displayName, isValidJoinCode, isValidPin, normalizeJoinCode, studentEmail } from '$lib/auth/student-identity';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type RosterStudent = { first_name: string; last_initial: string; slug: string };
	type Roster = {
		team_id: string;
		team_name: string;
		join_code: string;
		size_cap: number;
		roster_size: number;
		roster_full: boolean;
		join_open: boolean;
		students: RosterStudent[];
	};

	/**
	 * The student flow is code -> name -> PIN, with one branch: a child who is
	 * not on the roster yet taps "I'm new here" and types themselves in.
	 *
	 * THE JOIN WINDOW AND THE CAP ARE THE DATABASE'S ANSWER, NOT THIS SCREEN'S.
	 * Both come back from team_login_roster so the button can be honest before
	 * a child fills in a form -- but a phone that loaded this page twenty
	 * minutes ago is showing a twenty-minute-old answer, and the RPC re-checks
	 * both inside its own transaction. When it refuses, its sentence is shown
	 * verbatim: it is written for a nine-year-old and this screen has nothing
	 * to add to it.
	 */
	let step: 'code' | 'name' | 'pin' | 'new' = $state('code');
	let code = $state('');
	let roster: Roster | null = $state(null);
	let chosen: RosterStudent | null = $state(null);
	let pin = $state('');
	let busy = $state(false);
	let message = $state('');

	// --- the "I'm new here" form ---------------------------------------------
	let newFirst = $state('');
	let newInitial = $state('');
	let newGrade = $state('');
	let newPin = $state('');
	let newPinAgain = $state('');

	const reasonText: Record<string, string> = {
		rejected: 'That Google account is not a boscotech.edu mentor account.',
		'no-access': 'That account is not active here any more. Ask a mentor.',
		failed: 'Sign-in did not complete. Try again.'
	};
	let notice = $derived(reasonText[page.url.searchParams.get('reason') ?? ''] ?? '');

	// $derived.by, not $derived: at this point in the file `roster` has only
	// ever been assigned null, so TypeScript narrows it to null in a bare
	// expression. Reading it inside a closure is what tells the checker it can
	// change later, which it does on every team lookup.
	let canJoin = $derived.by(() => Boolean(roster?.join_open) && !roster?.roster_full);

	async function lookupTeam(event: SubmitEvent) {
		event.preventDefault();
		message = '';
		if (!isValidJoinCode(code)) {
			message = 'A team code is 6 letters and numbers.';
			return;
		}
		busy = true;
		const { data: found, error } = await data.supabase.rpc('team_login_roster', { p_join_code: normalizeJoinCode(code) });
		busy = false;
		if (error) {
			message = 'Could not reach the server. Check the wifi and try again.';
			return;
		}
		if (!found) {
			message = 'No team has that code.';
			return;
		}
		roster = found as unknown as Roster;
		step = 'name';
	}

	function pickStudent(student: RosterStudent) {
		chosen = student;
		pin = '';
		message = '';
		step = 'pin';
	}

	async function signInStudent(event: SubmitEvent) {
		event.preventDefault();
		if (!roster || !chosen) return;
		message = '';
		if (!isValidPin(pin)) {
			message = 'Your PIN is 6 numbers.';
			return;
		}
		busy = true;
		const { error } = await data.supabase.auth.signInWithPassword({
			email: studentEmail(roster.join_code, chosen.slug),
			password: pin
		});
		busy = false;
		if (error) {
			message = 'That PIN did not work. Try again, or ask a mentor to reset it.';
			pin = '';
			return;
		}
		await invalidate('supabase:auth');
		await goto(data.next);
	}

	function startNew() {
		message = '';
		newFirst = '';
		newInitial = '';
		newGrade = '';
		newPin = '';
		newPinAgain = '';
		step = 'new';
	}

	/**
	 * Sign myself up, then sign myself in, with no approval queue in between:
	 * a queue means twenty children waiting on one adult in a room where the
	 * roster is being built live.
	 */
	async function enroll(event: SubmitEvent) {
		event.preventDefault();
		if (!roster) return;
		message = '';
		if (!newFirst.trim()) {
			message = 'Type your first name.';
			return;
		}
		if (!/^[A-Za-z]$/.test(newInitial.trim())) {
			message = 'Type the first letter of your last name.';
			return;
		}
		const grade = Number(newGrade);
		if (!Number.isInteger(grade) || grade < 1 || grade > 12) {
			message = 'Pick your grade.';
			return;
		}
		if (!isValidPin(newPin)) {
			message = 'Make up a PIN of 6 numbers.';
			return;
		}
		if (newPin !== newPinAgain) {
			message = 'The two PINs are not the same. Type it again.';
			return;
		}

		busy = true;
		const { data: made, error } = await data.supabase.rpc('student_self_enroll', {
			p_join_code: roster.join_code,
			p_first_name: newFirst.trim(),
			p_last_initial: newInitial.trim().toUpperCase(),
			p_grade: grade,
			p_pin: newPin
		});
		if (error) {
			busy = false;
			// The database writes these sentences for a nine-year-old. Showing
			// our own here would be a second, worse copy of the same rule.
			message = error.message;
			return;
		}

		const row = made as unknown as { email: string } | null;
		if (!row?.email) {
			busy = false;
			message = 'Something went wrong signing you up. Ask a mentor.';
			return;
		}
		const signIn = await data.supabase.auth.signInWithPassword({ email: row.email, password: newPin });
		busy = false;
		if (signIn.error) {
			message = 'You are on the team. Now tap your name and type your PIN.';
			const { data: again } = await data.supabase.rpc('team_login_roster', {
				p_join_code: roster.join_code
			});
			if (again) roster = again as unknown as Roster;
			step = 'name';
			return;
		}
		await invalidate('supabase:auth');
		await goto(data.next);
	}

	async function signInMentor() {
		busy = true;
		message = '';
		const { error } = await data.supabase.auth.signInWithOAuth({
			provider: 'google',
			options: {
				redirectTo: `${page.url.origin}/auth/callback?next=${encodeURIComponent(data.next)}`,
				queryParams: { hd: 'boscotech.edu', prompt: 'select_account' }
			}
		});
		if (error) {
			busy = false;
			message = 'Could not start Google sign-in.';
		}
	}

	function back() {
		message = '';
		if (step === 'pin' || step === 'new') {
			step = 'name';
			chosen = null;
		} else if (step === 'name') {
			step = 'code';
			roster = null;
		}
	}
</script>

<main class="login">
	<header class="login__brand">
		<p class="eyebrow">Bosco Tech · FIRST LEGO League</p>
		<h1 class="glow">BIOGLOW</h1>
		<p class="muted">2026-27 season</p>
	</header>

	{#if notice}
		<p class="notice" role="status">{notice}</p>
	{/if}

	<section class="card login__student" aria-labelledby="student-heading">
		<h2 id="student-heading">Students</h2>

		{#if step === 'code'}
			<form onsubmit={lookupTeam}>
				<label class="field">
					<span>Team code</span>
					<input
						class="input input--code"
						bind:value={code}
						autocomplete="off"
						autocapitalize="characters"
						spellcheck="false"
						maxlength="6"
						placeholder="ABC234"
						aria-describedby="code-help"
						disabled={busy}
					/>
				</label>
				<p id="code-help" class="muted small">Your mentor has it.</p>
				<button class="btn btn--primary" type="submit" disabled={busy}>Find my team</button>
			</form>
		{:else if step === 'name' && roster}
			<p class="muted">Team <strong>{roster.team_name}</strong> · which one are you?</p>
			{#if roster.students.length === 0}
				<p>Nobody has signed up yet.</p>
			{:else}
				<ul class="tiles">
					{#each roster.students as student (student.slug)}
						<li>
							<button class="tile" type="button" onclick={() => pickStudent(student)}>
								{displayName(student.first_name, student.last_initial)}
							</button>
						</li>
					{/each}
				</ul>
			{/if}

			{#if canJoin}
				<button class="btn btn--secondary login__new" type="button" onclick={startNew}>
					I'm new here
				</button>
				<p class="muted small">
					{roster.size_cap - roster.roster_size} spot{roster.size_cap - roster.roster_size === 1 ? '' : 's'} left
					on this team.
				</p>
			{:else if roster.roster_full}
				<p class="muted small">
					This team is full ({roster.size_cap} people). If you are new, ask a mentor which team to join.
				</p>
			{:else}
				<p class="muted small">
					Sign-ups are closed right now. If you are new, ask a mentor to open them.
				</p>
			{/if}

			<button class="btn btn--ghost" type="button" onclick={back}>Different team</button>
		{:else if step === 'pin' && roster && chosen}
			<form onsubmit={signInStudent}>
				<p class="muted">
					<strong>{displayName(chosen.first_name, chosen.last_initial)}</strong> · {roster.team_name}
				</p>
				<label class="field">
					<span>Your PIN</span>
					<input
						class="input input--pin"
						type="password"
						inputmode="numeric"
						pattern="[0-9]*"
						maxlength="6"
						autocomplete="off"
						bind:value={pin}
						disabled={busy}
					/>
				</label>
				<div class="row">
					<button class="btn btn--ghost" type="button" onclick={back} disabled={busy}>Not me</button>
					<button class="btn btn--primary" type="submit" disabled={busy}>Sign in</button>
				</div>
			</form>
		{:else if step === 'new' && roster}
			<form onsubmit={enroll}>
				<p class="muted">Joining <strong>{roster.team_name}</strong>.</p>
				<label class="field">
					<span>First name</span>
					<input class="input" bind:value={newFirst} maxlength="40" autocomplete="off" disabled={busy} />
				</label>
				<label class="field">
					<span>First letter of your last name</span>
					<input
						class="input input--one"
						bind:value={newInitial}
						maxlength="1"
						autocapitalize="characters"
						autocomplete="off"
						disabled={busy}
					/>
				</label>
				<label class="field">
					<span>Grade</span>
					<select class="input" bind:value={newGrade} disabled={busy}>
						<option value="">Pick one</option>
						{#each [3, 4, 5, 6, 7, 8, 9] as g (g)}
							<option value={String(g)}>{g}</option>
						{/each}
					</select>
				</label>
				<label class="field">
					<span>Make up a PIN: 6 numbers</span>
					<input
						class="input input--pin"
						type="password"
						inputmode="numeric"
						pattern="[0-9]*"
						maxlength="6"
						autocomplete="off"
						bind:value={newPin}
						disabled={busy}
					/>
				</label>
				<label class="field">
					<span>Type your PIN again</span>
					<input
						class="input input--pin"
						type="password"
						inputmode="numeric"
						pattern="[0-9]*"
						maxlength="6"
						autocomplete="off"
						bind:value={newPinAgain}
						disabled={busy}
					/>
				</label>
				<p class="muted small">
					Remember your PIN. Nobody can look it up later, but a mentor can give you a new one.
				</p>
				<div class="row">
					<button class="btn btn--ghost" type="button" onclick={back} disabled={busy}>Back</button>
					<button class="btn btn--primary" type="submit" disabled={busy}>Join the team</button>
				</div>
			</form>
		{/if}

		{#if message}
			<p class="error" role="alert">{message}</p>
		{/if}
	</section>

	<section class="card login__mentor" aria-labelledby="mentor-heading">
		<h2 id="mentor-heading">Mentors</h2>
		<p class="muted small">boscotech.edu Google accounts only.</p>
		<button class="btn btn--secondary" type="button" onclick={signInMentor} disabled={busy}>
			Sign in with Google
		</button>
	</section>
</main>

<style>
	.login {
		min-height: 100dvh;
		display: grid;
		gap: var(--space-5);
		place-content: start center;
		padding: var(--space-6) var(--space-4);
		max-width: 28rem;
		margin: 0 auto;
	}
	.login__brand {
		text-align: center;
	}
	.login__brand h1 {
		font-size: var(--fs-hero);
		letter-spacing: var(--track-hero);
		margin: 0;
	}
	.tiles {
		list-style: none;
		padding: 0;
		margin: var(--space-3) 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
		gap: var(--space-3);
	}
	.row {
		display: flex;
		gap: var(--space-3);
		justify-content: space-between;
	}
	.login__new {
		width: 100%;
		margin-bottom: var(--space-2);
	}
	.input--code {
		font-family: var(--font-mono);
		font-size: var(--fs-h2);
		letter-spacing: 0.25em;
		text-transform: uppercase;
		text-align: center;
	}
	.input--pin {
		font-family: var(--font-mono);
		font-size: var(--fs-h2);
		letter-spacing: 0.4em;
		text-align: center;
	}
	.input--one {
		max-width: 5rem;
		text-transform: uppercase;
		text-align: center;
		font-size: var(--fs-h2);
	}
</style>

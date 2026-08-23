<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import { displayName, isValidJoinCode, isValidPin, normalizeJoinCode, studentEmail } from '$lib/auth/student-identity';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type RosterStudent = { first_name: string; last_initial: string; slug: string };
	type Roster = { team_id: string; team_name: string; join_code: string; students: RosterStudent[] };

	// The student flow is three steps on one screen: code -> name -> PIN.
	let step: 'code' | 'name' | 'pin' = $state('code');
	let code = $state('');
	let roster: Roster | null = $state(null);
	let chosen: RosterStudent | null = $state(null);
	let pin = $state('');
	let busy = $state(false);
	let message = $state('');

	const reasonText: Record<string, string> = {
		rejected: 'That Google account is not a boscotech.edu mentor account.',
		'no-access': 'That account is not active here any more. Ask a mentor.',
		failed: 'Sign-in did not complete. Try again.'
	};
	let notice = $derived(reasonText[page.url.searchParams.get('reason') ?? ''] ?? '');

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
		roster = found as Roster;
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
		if (step === 'pin') {
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
				<p>No students on this team yet. Ask a mentor.</p>
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
</style>

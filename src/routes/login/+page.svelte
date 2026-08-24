<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import {
		displayName,
		isValidClaimCode,
		isValidJoinCode,
		isValidPin,
		normalizeClaimCode,
		normalizeJoinCode,
		studentEmail
	} from '$lib/auth/student-identity';
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
		students: RosterStudent[];
	};
	type ClaimedSeat = { email: string; join_code: string };

	/**
	 * TWO DOORS, BOTH ON THE FIRST SCREEN.
	 *
	 * A child who has signed in before types the team code, taps their name and
	 * types their PIN: code -> name -> pin, unchanged. A child who never has is
	 * holding a CARD with one seat code on it, and takes that seat: card ->
	 * who I am -> a PIN I make up. Both buttons are on the FIRST screen,
	 * because a new child has the card and nothing else. Putting "I have a
	 * seat code" behind a team-code lookup would ask them for something nobody
	 * ever gave them.
	 *
	 * THERE IS NO OPEN JOIN WINDOW ANY MORE (0019). The old one was open to
	 * whoever was holding a team code: an older sibling, a child from another
	 * team, the same child twice, for as long as a mentor forgot to close it.
	 * A seat code is handed to ONE child by an adult, is spent once, and can be
	 * voided before it is spent, so "who may take this seat" is answered by the
	 * person handing out the cards rather than by a clock. Nothing on this
	 * screen decides whether a seat is going spare: the code works or it does
	 * not, and student_claim_seat settles that inside its own transaction.
	 *
	 * WHEN THE DATABASE REFUSES, ITS SENTENCE IS SHOWN VERBATIM. Every refusal
	 * student_claim_seat raises is already written for a nine-year-old ("That is
	 * your team code, not your seat code"), and a second copy of the same rule
	 * in this file would drift from it within a season. What is checked here is
	 * only what saves a round trip, plus the one thing the server cannot see:
	 * whether the two PIN boxes agree.
	 */
	let step: 'code' | 'name' | 'pin' | 'card' | 'card-you' | 'card-pin' = $state('code');
	let code = $state('');
	let roster: Roster | null = $state(null);
	let chosen: RosterStudent | null = $state(null);
	let pin = $state('');
	let busy = $state(false);
	let message = $state('');

	// --- the "I have a seat code" form ---------------------------------------
	let seatCode = $state('');
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

	/** The second door. Reachable from the first screen and from the roster. */
	function startClaim() {
		message = '';
		seatCode = '';
		newFirst = '';
		newInitial = '';
		newGrade = '';
		newPin = '';
		newPinAgain = '';
		step = 'card';
	}

	/**
	 * Shape only. Nothing here can tell a live code from a spent one, and there
	 * is no anon door that would: team_claim_codes answers mentors. So this
	 * catches the typo that would otherwise cost a child three more screens,
	 * and student_claim_seat catches everything that matters.
	 */
	function seatCodeNext(event: SubmitEvent) {
		event.preventDefault();
		message = '';
		if (!isValidClaimCode(seatCode)) {
			message = 'A seat code is 6 letters and numbers. Look at your card.';
			return;
		}
		seatCode = normalizeClaimCode(seatCode);
		step = 'card-you';
	}

	function seatNameNext(event: SubmitEvent) {
		event.preventDefault();
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
		step = 'card-pin';
	}

	/**
	 * Spend the seat, then sign in with the PIN they just made up. No approval
	 * queue in between: a queue means twenty children waiting on one adult in a
	 * room where the roster is being built card by card.
	 */
	async function claimSeat(event: SubmitEvent) {
		event.preventDefault();
		message = '';
		if (!isValidPin(newPin)) {
			message = 'Make up a PIN of 6 numbers.';
			return;
		}
		// The one check the database cannot make: it is only ever handed one PIN.
		if (newPin !== newPinAgain) {
			message = 'Those two PINs are not the same.';
			return;
		}

		busy = true;
		const { data: took, error } = await data.supabase.rpc('student_claim_seat', {
			p_claim_code: normalizeClaimCode(seatCode),
			p_first_name: newFirst.trim(),
			p_last_initial: newInitial.trim().toUpperCase(),
			p_grade: Number(newGrade),
			p_pin: newPin
		});
		if (error) {
			busy = false;
			// The database writes these sentences for a nine-year-old. Showing
			// our own here would be a second, worse copy of the same rule.
			message = error.message;
			return;
		}

		// An RPC that answers with nothing took nothing: no error is not proof
		// the seat is now theirs, and the next screen would be a lie.
		const seat = took as unknown as ClaimedSeat | null;
		if (!seat?.email) {
			busy = false;
			message = 'Something went wrong taking your seat. Ask a mentor.';
			return;
		}

		const signIn = await data.supabase.auth.signInWithPassword({ email: seat.email, password: newPin });
		busy = false;
		if (signIn.error) {
			// The seat IS spent, so never send them back to the card: they are on
			// the roster now, and the roster is the way in from here.
			message = 'You are on the team. Now tap your name and type your PIN.';
			const { data: again } = await data.supabase.rpc('team_login_roster', {
				p_join_code: seat.join_code
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
		if (step === 'pin') {
			step = 'name';
			chosen = null;
		} else if (step === 'name') {
			step = 'code';
			roster = null;
		} else if (step === 'card') {
			// Back to wherever the card was picked up from.
			step = roster ? 'name' : 'code';
		} else if (step === 'card-you') {
			step = 'card';
		} else if (step === 'card-pin') {
			step = 'card-you';
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
				<button class="btn btn--primary login__wide" type="submit" disabled={busy}>Find my team</button>
			</form>

			<div class="login__alt">
				<p class="muted small">First time here? A mentor gave you a card with a seat code on it.</p>
				<button class="btn btn--secondary login__wide" type="button" onclick={startClaim} disabled={busy}>
					I have a seat code
				</button>
			</div>
		{:else if step === 'name' && roster}
			<p class="muted">Team <strong>{roster.team_name}</strong> · which one are you?</p>
			{#if roster.students.length === 0}
				<p>Nobody has signed in yet.</p>
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

			<div class="login__alt">
				<p class="muted small">Not on the list? Use the code on your card.</p>
				<button class="btn btn--secondary login__wide" type="button" onclick={startClaim} disabled={busy}>
					I have a seat code
				</button>
			</div>

			<button class="btn btn--ghost login__wide login__back" type="button" onclick={back}>Different team</button>
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
		{:else if step === 'card'}
			<form onsubmit={seatCodeNext}>
				<p class="muted">Type the code from your card.</p>
				<label class="field">
					<span>Seat code</span>
					<input
						class="input input--code"
						bind:value={seatCode}
						autocomplete="off"
						autocapitalize="characters"
						spellcheck="false"
						maxlength="6"
						placeholder="GH7KPQ"
						aria-describedby="seat-help"
						disabled={busy}
					/>
				</label>
				<p id="seat-help" class="muted small">
					It is the code on your own card. It is not the team code.
				</p>
				<div class="row">
					<button class="btn btn--ghost" type="button" onclick={back} disabled={busy}>Back</button>
					<button class="btn btn--primary" type="submit" disabled={busy}>Next</button>
				</div>
			</form>
		{:else if step === 'card-you'}
			<form onsubmit={seatNameNext}>
				<p class="muted">Seat code <strong>{seatCode}</strong> · who are you?</p>
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
				<div class="row">
					<button class="btn btn--ghost" type="button" onclick={back} disabled={busy}>Back</button>
					<button class="btn btn--primary" type="submit" disabled={busy}>Next</button>
				</div>
			</form>
		{:else if step === 'card-pin'}
			<form onsubmit={claimSeat}>
				<p class="muted">Make up a PIN. You will type it every time you sign in.</p>
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
					<button class="btn btn--primary" type="submit" disabled={busy}>Take my seat</button>
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
	/* The two doors are the same width, because they are the same size of
	   decision: one child knows the team code, the next one only has a card. */
	.login__wide {
		width: 100%;
	}
	/* A decorative rule, so --hairline rather than --boundary: the separation
	   is already carried by the sentence above the button. */
	.login__alt {
		display: grid;
		gap: var(--space-3);
		margin-top: var(--space-4);
		padding-top: var(--space-4);
		border-top: 1px solid var(--hairline);
	}
	.login__back {
		margin-top: var(--space-3);
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

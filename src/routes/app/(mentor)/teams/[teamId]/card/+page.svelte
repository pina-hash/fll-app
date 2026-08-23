<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { knownPins, mintPin, rememberPin } from '$lib/console/pins';
	import { ROLE_SHORT, type TeamRole } from '$lib/console/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let pins = $state<Record<string, string>>({});
	let busy = $state(false);
	let message = $state('');
	let confirmReset = $state(false);

	$effect(() => {
		pins = knownPins();
	});

	// studentId -> "Run Captain (primary)", from the one role resolver.
	let rolesOf = $derived.by(() => {
		const map = new Map<string, string[]>();
		for (const row of data.roles) {
			const label = ROLE_SHORT[row.role as TeamRole];
			if (row.primary_student_id) {
				map.set(row.primary_student_id, [...(map.get(row.primary_student_id) ?? []), `${label} (primary)`]);
			}
			if (row.second_student_id) {
				map.set(row.second_student_id, [...(map.get(row.second_student_id) ?? []), `${label} (second)`]);
			}
		}
		return map;
	});

	let missing = $derived(data.students.filter((s) => !pins[s.id]).length);

	/**
	 * A PIN is a bcrypt hash the moment it is set, so "print the current PINs"
	 * is not a thing anyone can do. Minting a fresh one for every student is,
	 * and it is what a mentor actually wants when the cards are wrong.
	 */
	async function resetEveryPin() {
		if (!confirmReset) {
			confirmReset = true;
			return;
		}
		confirmReset = false;
		busy = true;
		message = '';
		for (const student of data.students) {
			const pin = mintPin();
			const { error } = await data.supabase.rpc('student_reset_pin', {
				p_student_id: student.id,
				p_new_pin: pin
			});
			if (error) {
				message = `Stopped at ${student.first_name}: ${error.message}`;
				busy = false;
				pins = knownPins();
				return;
			}
			rememberPin(student.id, pin);
		}
		pins = knownPins();
		busy = false;
		message = `${data.students.length} PINs reset. Everyone is signed out and the card below is current.`;
		await invalidateAll();
	}
</script>

<svelte:head><title>{data.team.name} roster card</title></svelte:head>

<div class="cardpage">
	<section class="card noprint">
		<h1>Printable roster card</h1>
		{#if message}
			<p class="notice" role="status">{message}</p>
		{/if}
		{#if missing > 0}
			<p class="muted">
				{missing} of {data.students.length} PINs are not known to this browser tab. A PIN is stored as a bcrypt hash
				the moment it is set, so nothing can read one back: the card can only print a PIN that this tab watched being
				created or reset. Reset them all to print a complete card.
			</p>
		{:else}
			<p class="muted">Every PIN on this card is one this tab minted. Print it, then close the tab.</p>
		{/if}
		<div class="cardpage__actions">
			<button class="btn btn--primary" onclick={() => window.print()}>Print</button>
			{#if confirmReset}
				<button class="btn btn--secondary" disabled={busy} onclick={resetEveryPin}>
					Yes, reset all {data.students.length} PINs
				</button>
				<button class="btn btn--ghost" onclick={() => (confirmReset = false)}>Cancel</button>
			{:else}
				<button class="btn btn--ghost" disabled={busy || data.students.length === 0} onclick={resetEveryPin}>
					Reset every PIN on this team
				</button>
			{/if}
			<a class="btn btn--ghost" href="/app/teams/{data.team.id}">Back to team</a>
		</div>
		<p class="muted small">
			Resetting signs every student out and invalidates every card printed before now.
		</p>
	</section>

	<article class="sheet" data-accent={data.team.accent}>
		<header class="sheet__head">
			<div>
				<p class="sheet__eyebrow">Bosco Tech FIRST LEGO League · BIOGLOW 2026-27</p>
				<h2 class="sheet__name">{data.team.name}</h2>
			</div>
			<div class="sheet__code">
				<span class="sheet__codelabel">Team code</span>
				<span class="sheet__codevalue">{data.team.join_code}</span>
				{#if data.team.fll_team_number}
					<span class="sheet__codelabel">FLL #{data.team.fll_team_number}</span>
				{/if}
			</div>
		</header>

		<table class="sheet__table">
			<thead>
				<tr>
					<th scope="col">Name</th>
					<th scope="col">Grade</th>
					<th scope="col">Role</th>
					<th scope="col">PIN</th>
				</tr>
			</thead>
			<tbody>
				{#each data.students as student (student.id)}
					<tr>
						<th scope="row">{student.first_name} {student.last_initial}.</th>
						<td>{student.grade ?? ''}</td>
						<td>{(rolesOf.get(student.id) ?? []).join(', ')}</td>
						<td class="sheet__pin">{pins[student.id] ?? '_ _ _ _ _ _'}</td>
					</tr>
				{:else}
					<tr><td colspan="4">No students on this team yet.</td></tr>
				{/each}
			</tbody>
		</table>

		<footer class="sheet__foot">
			Sign in at the team tablet: type the team code, tap your name, type your PIN. Lost your PIN? Ask a mentor to
			reset it.
		</footer>
	</article>
</div>

<style>
	.cardpage {
		display: grid;
		gap: var(--space-4);
	}
	.cardpage__actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: var(--space-3) 0 var(--space-2);
	}

	/* On screen the sheet is a card like any other; on paper it is the page. */
	.sheet {
		background: var(--surface-1);
		border: 1px solid var(--boundary);
		border-top: 6px solid var(--team-accent);
		border-radius: var(--radius-card);
		padding: var(--space-5);
	}
	.sheet__head {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: var(--space-4);
		align-items: flex-start;
		margin-bottom: var(--space-4);
	}
	.sheet__eyebrow {
		margin: 0 0 var(--space-1);
		font-size: var(--fs-label);
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		color: var(--text-3);
	}
	.sheet__name {
		margin: 0;
		color: var(--team-accent);
	}
	.sheet__code {
		display: grid;
		justify-items: end;
		gap: 0.125rem;
	}
	.sheet__codelabel {
		font-size: var(--fs-label);
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		color: var(--text-3);
	}
	.sheet__codevalue {
		font-family: var(--font-mono);
		font-size: var(--fs-h1);
		font-weight: var(--fw-bold);
		letter-spacing: var(--track-wide);
		color: var(--team-accent);
	}
	.sheet__table {
		width: 100%;
		border-collapse: collapse;
	}
	.sheet__table th,
	.sheet__table td {
		text-align: left;
		padding: var(--space-2);
		border-bottom: 1px solid var(--hairline);
	}
	.sheet__table thead th {
		font-size: var(--fs-label);
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		color: var(--text-3);
	}
	.sheet__pin {
		font-family: var(--font-mono);
		font-size: var(--fs-h3);
		font-weight: var(--fw-bold);
		letter-spacing: var(--track-wide);
	}
	.sheet__foot {
		margin-top: var(--space-4);
		font-size: var(--fs-small);
		color: var(--text-2);
	}

	/* PAPER. The console is dark because a tablet in a lit room wants it; a
	   printer does not. Everything but the sheet is removed. */
	@media print {
		:global(body) {
			background: #ffffff;
			color: #000000;
		}
		:global(.shell__bar),
		:global(.shell__nav),
		:global(.prov__rail),
		.noprint {
			display: none !important;
		}
		:global(.shell__main) {
			padding: 0;
			max-width: none;
		}
		:global(.prov) {
			display: block;
		}
		.sheet {
			background: #ffffff;
			border: 2px solid #000000;
			border-radius: 0;
			padding: 1rem;
			color: #000000;
		}
		.sheet__name,
		.sheet__codevalue {
			color: #000000;
		}
		.sheet__eyebrow,
		.sheet__codelabel,
		.sheet__table thead th,
		.sheet__foot {
			color: #333333;
		}
		.sheet__table th,
		.sheet__table td {
			border-bottom: 1px solid #999999;
		}
	}
</style>

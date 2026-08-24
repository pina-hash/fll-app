<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import FirstName from '$lib/brand/FirstName.svelte';
	import { SEASON } from '$lib/brand/rules';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let busy = $state(false);
	let message = $state('');

	let missing = $derived(data.cards.filter((c) => !c.href).length);

	/**
	 * Make a link for everyone who has not got one. It deliberately does NOT
	 * touch the students who already have a live link: reissuing those would
	 * kill cards already in parents' hands, which is exactly the thing the
	 * PIN card has to do and this one does not.
	 */
	async function issueMissing() {
		busy = true;
		message = '';
		for (const card of data.cards) {
			if (card.href) continue;
			const { error } = await data.supabase.rpc('parent_access_issue', {
				p_student_id: card.student.id
			});
			if (error) {
				busy = false;
				message = `Stopped at ${card.student.first_name}: ${error.message}`;
				await invalidateAll();
				return;
			}
		}
		busy = false;
		message = 'Every student on this team now has a parent link. Print and hand them out.';
		await invalidateAll();
	}
</script>

<svelte:head><title>{data.team.name} parent cards</title></svelte:head>

<div class="pc">
	<section class="card noprint">
		<h1>Parent cards</h1>
		{#if message}
			<p class="notice" role="status">{message}</p>
		{/if}
		<p class="muted">
			One card per student. A parent scans the code or types the address; there is no account and no password, and
			the page is read-only. Anyone holding the link can see that child's page, so hand the card to the parent
			rather than leaving a pile on a table.
		</p>
		{#if missing > 0}
			<p class="muted">
				{missing} of {data.cards.length} students have no link yet. Making the missing ones does not touch the
				links that already exist, so cards already handed out keep working.
			</p>
		{/if}
		<div class="pc__actions">
			<button class="btn btn--primary" onclick={() => window.print()}>Print</button>
			<button class="btn btn--secondary" disabled={busy || missing === 0} onclick={issueMissing}>
				Make the {missing} missing link{missing === 1 ? '' : 's'}
			</button>
			<a class="btn btn--ghost" href="/app/teams/{data.team.id}">Back to team</a>
		</div>
		<p class="muted small">
			To replace one link (a card went astray), use "New link" on the team page. That kills the old address
			immediately.
		</p>
	</section>

	<div class="sheet" data-accent={data.team.accent}>
		{#each data.cards as card (card.student.id)}
			<article class="pcard">
				<header class="pcard__head">
					<p class="pcard__eyebrow">Bosco Tech · <FirstName name="season" /> · {SEASON.years}</p>
					<h2 class="pcard__name">{card.student.first_name} {card.student.last_initial}.</h2>
					<p class="pcard__team">
						{data.team.name}
						{#if card.student.grade}<span class="pcard__grade">· grade {card.student.grade}</span>{/if}
					</p>
				</header>

				{#if card.href && card.qr}
					<div class="pcard__body">
						<div class="pcard__qr">{@html card.qr}</div>
						<div class="pcard__text">
							<p class="pcard__lead">Follow along at home</p>
							<p class="pcard__url">{card.display}</p>
							<p class="pcard__note">
								Scan the code or type that address. No sign-in. You will see the next session, when
								{card.student.first_name} has been here, what they finished and the photos they took.
							</p>
							<p class="pcard__warn">Keep this link private. Ask a mentor if you need a new one.</p>
						</div>
					</div>
				{:else}
					<p class="pcard__none">
						{card.revoked ? 'This link was turned off.' : 'No parent link yet.'} Make one from this page, then print
						again.
					</p>
				{/if}
			</article>
		{:else}
			<p class="muted">No students on this team yet.</p>
		{/each}
	</div>
</div>

<style>
	.pc {
		display: grid;
		gap: var(--space-4);
	}
	.pc__actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: var(--space-3) 0 var(--space-2);
	}
	.sheet {
		display: grid;
		gap: var(--space-4);
	}

	.pcard {
		background: var(--surface-1);
		border: 1px solid var(--boundary);
		border-left: 6px solid var(--team-accent);
		border-radius: var(--radius-card);
		padding: var(--space-4);
		break-inside: avoid;
	}
	.pcard__eyebrow {
		margin: 0 0 var(--space-1);
		font-size: var(--fs-label);
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		color: var(--text-3);
	}
	.pcard__name {
		margin: 0;
		color: var(--team-accent);
	}
	.pcard__team {
		margin: 0 0 var(--space-3);
		font-weight: var(--fw-bold);
	}
	.pcard__grade {
		color: var(--text-3);
		font-weight: var(--fw-regular);
	}
	.pcard__body {
		display: grid;
		grid-template-columns: 8rem minmax(0, 1fr);
		gap: var(--space-4);
		align-items: start;
	}
	.pcard__qr :global(svg) {
		width: 100%;
		height: auto;
		display: block;
		border-radius: 0.25rem;
	}
	.pcard__lead {
		margin: 0 0 var(--space-1);
		font-family: var(--font-display);
		font-size: var(--fs-h3);
		font-weight: var(--fw-black);
	}
	.pcard__url {
		margin: 0 0 var(--space-2);
		font-family: var(--font-mono);
		font-size: var(--fs-small);
		word-break: break-all;
		color: var(--text-1);
	}
	.pcard__note {
		margin: 0 0 var(--space-2);
		font-size: var(--fs-small);
		color: var(--text-2);
	}
	.pcard__warn {
		margin: 0;
		font-size: var(--fs-small);
		font-weight: var(--fw-bold);
		color: var(--warning);
	}
	.pcard__none {
		margin: 0;
		color: var(--text-3);
	}

	@media (max-width: 30rem) {
		.pcard__body {
			grid-template-columns: 1fr;
		}
		.pcard__qr {
			max-width: 10rem;
		}
	}

	/* PAPER. The console is dark because a tablet in a lit room wants it; a
	   printer does not, and a QR code has to be black on white or no phone
	   will read it. One card per half page, none of them split across a fold. */
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
			gap: 0.5rem;
		}
		.pcard {
			background: #ffffff;
			color: #000000;
			border: 2px solid #000000;
			border-left: 6px solid #000000;
			border-radius: 0;
			padding: 0.75rem;
			margin-bottom: 0.5rem;
		}
		.pcard__name,
		.pcard__url {
			color: #000000;
		}
		.pcard__eyebrow,
		.pcard__grade,
		.pcard__note {
			color: #333333;
		}
		.pcard__warn {
			color: #000000;
		}
	}
</style>

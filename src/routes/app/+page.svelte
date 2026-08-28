<script lang="ts">
	import {
		COMP_BOT_MANUAL_ROUTE,
		COMP_BOT_MANUAL_SIZE,
		COMP_BOT_MANUAL_STEPS
	} from '$lib/content/resources';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const p = $derived(data.principal);
</script>

{#if p.kind === 'student'}
	<section class="card" data-accent={p.accent}>
		<p class="eyebrow">{p.teamName}</p>
		<h1>Hi, {p.firstName}!</h1>
		<p class="muted">
			You are signed in to <strong>{p.teamName}</strong> (team code <code>{p.joinCode}</code>). Your
			screen is at <a href="/app/me">My Screen</a>.
		</p>
	</section>
{:else}
	<section class="card">
		<p class="eyebrow">Mentor console</p>
		<h1>Loading the board</h1>
		<p class="muted">
			Mentors land on the live board. If this screen stays up, open <a href="/app/board">the live board</a> directly.
		</p>
	</section>
{/if}

<!--
	THE BUILD MANUAL IS A FIRST-CLASS CARD, NOT A LINE IN A LIBRARY. It is the
	one document all four teams need every single session, and until this bundle
	the only way to it was four taps through the Skill Hub with the word "build"
	appearing nowhere above the last one. So it gets a card of its own, headed
	with the robot rather than with a document, and it links at the /app/build
	screen rather than at the 23 MB file: the size warning belongs next to the
	tap that starts the transfer, and a card cannot carry one and still be a card.
-->
<a class="card build" href={COMP_BOT_MANUAL_ROUTE}>
	<span class="build__icon" aria-hidden="true">🧱</span>
	<span class="build__text">
		<span class="build__title">Build the robot</span>
		<span class="build__blurb">
			All four teams build the same robot this season. The manual is the whole build, all
			{COMP_BOT_MANUAL_STEPS} steps, from the drive wheels up to the SPIKE Prime hub.
		</span>
		<span class="build__note muted small">
			It is a big file, {COMP_BOT_MANUAL_SIZE}, so it opens on a tap and never on its own.
		</span>
	</span>
</a>

<style>
	.build {
		display: flex;
		align-items: flex-start;
		gap: var(--space-4);
		margin-top: var(--space-4);
		text-decoration: none;
		color: var(--text-1);
	}
	.build__icon {
		font-size: var(--fs-h1);
		line-height: 1;
		flex: none;
	}
	.build__text {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
	.build__title {
		font-weight: var(--fw-bold);
		font-size: var(--fs-h2);
		color: var(--text-1);
	}
	.build__blurb {
		color: var(--text-2);
	}
</style>

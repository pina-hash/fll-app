<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const p = $derived(data.principal);
</script>

{#if p.kind === 'student'}
	<section class="card" data-accent={p.accent}>
		<p class="eyebrow">{p.teamName}</p>
		<h1>Hi, {p.firstName}!</h1>
		<p class="muted">
			You are signed in to <strong>{p.teamName}</strong> (team code <code>{p.joinCode}</code>). Your team board is on
			its way in the next build.
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

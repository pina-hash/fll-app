<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const p = $derived(data.principal);
</script>

{#if p.kind === 'mentor'}
	<section class="card">
		<p class="eyebrow">Mentor console</p>
		<h1>Hi, {p.displayName}</h1>
		<p class="muted">
			You are signed in as a mentor{p.isAdmin ? ' and an admin' : ''} ({p.email}). The console — teams, roster, meetings,
			the live phase clock — lands in the next build. The schema, sign-in, and team boundaries underneath it are live.
		</p>
	</section>
{:else}
	<section class="card">
		<p class="eyebrow">{p.teamName}</p>
		<h1>Hi, {p.firstName}!</h1>
		<p class="muted">
			You are signed in to <strong>{p.teamName}</strong> (team code <code>{p.joinCode}</code>). Your team board is on
			its way in the next build.
		</p>
	</section>
{/if}

<script lang="ts">
	/**
	 * THE MENTOR'S NOTEBOOK, PLUS THE BIN. A deleted page is soft deleted
	 * (0020), so it can come back: a child has ten seconds inside the notebook
	 * itself, and an adult has this list, which is what "she deleted it last
	 * Friday" needs. Restoring is one RPC, and the notebook is remounted
	 * afterwards because its local model is captured once on purpose (see
	 * Notebook.svelte) and would otherwise not show the page that just
	 * returned.
	 */
	import { NOTEBOOK_SECTIONS } from '$lib/content/notebook';
	import NotebookPage from '$lib/notebook/NotebookPage.svelte';
	import { safeInvalidateAll } from '$lib/student/refresh';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// The (mentor) layout guarantees this, but the type union does not know it.
	let mentorId = $derived(data.principal.kind === 'mentor' ? data.principal.mentorId : '');

	/** Ids put back in this session, so the row leaves the list on the tap. */
	let restored = $state<string[]>([]);
	let binBusy = $state<string | null>(null);
	let binMessage = $state('');
	/** Bumped after a restore, so the notebook below remounts with the page. */
	let remount = $state(0);

	const bin = $derived(data.bin.filter((e) => !restored.includes(e.entryId)));

	function sectionName(id: string): string {
		return NOTEBOOK_SECTIONS.find((s) => s.id === id)?.short ?? 'Notebook';
	}

	function deletedWhen(iso: string | null): string {
		if (!iso) return '';
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return '';
		return d.toLocaleString('en-US', {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	async function putBack(entryId: string, title: string) {
		if (binBusy) return;
		binBusy = entryId;
		binMessage = '';
		// An RPC in this schema answers with a sentence a mentor can act on, so
		// its message is shown as written rather than translated here.
		const { error } = await data.supabase.rpc('notebook_entry_restore', { p_entry_id: entryId });
		binBusy = null;
		if (error) {
			binMessage = error.message;
			return;
		}
		restored = [...restored, entryId];
		binMessage = `${title || 'That page'} is back in the notebook.`;
		await safeInvalidateAll();
		remount += 1;
	}
</script>

<svelte:head><title>{data.team.name} notebook</title></svelte:head>

<div class="mnb" data-accent={data.team.accent}>
	<div class="mnb__head">
		<h1 class="mnb__title">Engineering notebook</h1>
		<nav class="mnb__teams" aria-label="Teams">
			{#each data.teams as t (t.id)}
				<a
					class="mnb__team"
					class:mnb__team--on={t.id === data.team.id}
					data-accent={t.accent}
					href="/app/notebook/{t.id}"
				>
					{t.name}
				</a>
			{/each}
		</nav>
	</div>

	{#if bin.length > 0}
		<section class="mnb__bin card" aria-label="Deleted pages">
			<h2 class="mnb__bintitle">In the bin ({bin.length})</h2>
			<p class="mnb__binlede">
				Deleted pages are kept. Put one back and it returns to the section it came from.
			</p>
			<ul class="mnb__binlist">
				{#each bin as entry (entry.entryId)}
					<li class="mnb__binrow">
						<div class="mnb__binwhat">
							<span class="mnb__binsection">{sectionName(entry.section)}</span>
							<span class="mnb__bintitleline">{entry.title || 'Untitled page'}</span>
							{#if entry.body}<span class="mnb__binbody">{entry.body}</span>{/if}
							{#if deletedWhen(entry.deletedAt)}
								<span class="mnb__binwhen">Deleted {deletedWhen(entry.deletedAt)}</span>
							{/if}
						</div>
						<button
							class="btn btn--secondary"
							type="button"
							disabled={binBusy === entry.entryId}
							onclick={() => putBack(entry.entryId, entry.title)}
						>
							{binBusy === entry.entryId ? 'Putting it back...' : 'Put it back'}
						</button>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if binMessage}
		<p class="mnb__binmsg" role="status">{binMessage}</p>
	{/if}

	{#key `${data.team.id}:${remount}`}
		<NotebookPage
			supabase={data.supabase}
			ownerId={mentorId}
			team={{ id: data.team.id, name: data.team.name }}
			isMentor={true}
			myStudentId={null}
			data={data.notebook}
			printHref="/app/notebook/{data.team.id}/print"
		/>
	{/key}
</div>

<style>
	.mnb {
		display: grid;
		gap: var(--space-4);
		min-width: 0;
	}
	.mnb__head {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-3);
	}
	.mnb__title {
		margin: 0;
		font-size: var(--fs-h2);
	}
	.mnb__teams {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.mnb__team {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		padding: 0 var(--space-3);
		border-radius: var(--radius-control);
		border: 1px solid var(--boundary);
		color: var(--text-2);
		text-decoration: none;
		font-weight: var(--fw-bold);
	}
	.mnb__team--on {
		/* Accent-coloured label on the accent WASH, which is a pairing
		   team-accents.css derives to clear 4.5 on both grounds. The ink
		   token is for a filled chip and put white on a near-white wash. */
		color: var(--team-accent, var(--text-1));
		border-color: var(--team-accent, var(--boundary));
		background: var(--team-accent-wash, transparent);
	}

	.mnb__bin {
		display: grid;
		gap: var(--space-3);
		min-width: 0;
	}
	.mnb__bintitle {
		margin: 0;
		font-size: var(--fs-h3);
	}
	.mnb__binlede {
		margin: 0;
		color: var(--text-2);
	}
	.mnb__binlist {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-3);
		min-width: 0;
	}
	.mnb__binrow {
		display: flex;
		align-items: flex-start;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: var(--space-3);
		padding-top: var(--space-3);
		border-top: 1px solid var(--hairline);
		min-width: 0;
	}
	.mnb__binrow:first-child {
		padding-top: 0;
		border-top: 0;
	}
	.mnb__binwhat {
		display: grid;
		gap: var(--space-1);
		flex: 1 1 18rem;
		min-width: 0;
	}
	.mnb__binsection {
		font-size: var(--fs-small);
		font-weight: var(--fw-bold);
		color: var(--text-3);
	}
	.mnb__bintitleline {
		font-weight: var(--fw-bold);
		overflow-wrap: anywhere;
	}
	.mnb__binbody {
		color: var(--text-2);
		overflow-wrap: anywhere;
	}
	.mnb__binwhen {
		font-size: var(--fs-small);
		color: var(--text-3);
	}
	.mnb__binmsg {
		margin: 0;
		color: var(--text-2);
	}
</style>

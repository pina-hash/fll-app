<script lang="ts">
	import NotebookPrint from '$lib/notebook/NotebookPrint.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>{data.team.name} notebook, print</title></svelte:head>

<NotebookPrint
	team={{ name: data.team.name, fllTeamNumber: data.team.fll_team_number }}
	entries={data.notebook.entries}
	recaps={data.notebook.recaps}
	stats={data.notebook.stats}
	roles={data.notebook.roles}
	studentNames={data.notebook.studentNames}
	photos={data.notebook.photos}
	photoUrls={data.notebook.photoUrls}
	backHref="/app/notebook/{data.team.id}"
/>

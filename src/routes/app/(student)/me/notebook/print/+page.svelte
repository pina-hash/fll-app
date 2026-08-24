<script lang="ts">
	import NotebookPrint from '$lib/notebook/NotebookPrint.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>{data.student.teamName} notebook, print</title></svelte:head>

<NotebookPrint
	team={{ name: data.student.teamName, fllTeamNumber: data.fllTeamNumber }}
	entries={data.notebook.entries}
	recaps={data.notebook.recaps}
	stats={data.notebook.stats}
	roles={data.notebook.roles}
	studentNames={data.notebook.studentNames}
	photos={data.notebook.photos}
	photoUrls={data.notebook.photoUrls}
	backHref="/app/me/notebook"
/>

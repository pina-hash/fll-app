<script lang="ts">
	import CodegenPage from '$lib/codegen/CodegenPage.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>{data.student.teamName} robot code</title></svelte:head>

<CodegenPage
	supabase={data.supabase ?? null}
	team={{ id: data.student.teamId, name: data.student.teamName, accent: data.student.accent }}
	data={data.codegen}
/>

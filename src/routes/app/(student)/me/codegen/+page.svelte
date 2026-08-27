<script lang="ts">
	import CodegenPage from '$lib/codegen/CodegenPage.svelte';
	import { supabaseCodegenSave } from '$lib/codegen/storage';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/**
	 * The student surface's payload: their own team, and a transport closed over
	 * it. A student never chooses a team, so there is nothing here to pick from;
	 * RLS scopes every write to current_student_team_id() regardless, and whether
	 * THIS student may write is strategy_can_edit's answer, which comes back from
	 * the write itself.
	 */
	const save = $derived(supabaseCodegenSave(data.supabase, data.student.teamId));
</script>

<svelte:head><title>{data.student.teamName} robot code</title></svelte:head>

<CodegenPage
	{save}
	team={{ id: data.student.teamId, name: data.student.teamName, accent: data.student.accent }}
	data={data.codegen}
/>

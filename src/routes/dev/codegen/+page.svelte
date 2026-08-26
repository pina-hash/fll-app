<script lang="ts">
	import CodegenPage from '$lib/codegen/CodegenPage.svelte';
	import type { CodegenData } from '$lib/codegen/storage';

	/**
	 * The REAL component with fixture props, the way /dev/route-planner and
	 * /dev/student-screen do it. A harness that rendered its own copy of the
	 * markup would be testing nothing.
	 *
	 * supabase is null on purpose: there is no session here, so Save must have
	 * nothing to write through. Generating needs neither, which is the whole
	 * reason this surface can be checked in a browser with no stack running.
	 */
	const fixture: CodegenData = { configs: [], calibrations: [], unavailable: null };
</script>

<svelte:head><title>Codegen harness</title></svelte:head>

<CodegenPage
	supabase={null}
	team={{ id: 'dev-team', name: 'Team 1', accent: 'teal' }}
	data={fixture}
	backHref="/dev"
/>

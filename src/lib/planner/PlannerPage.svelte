<script lang="ts">
	/**
	 * The wiring between a route (mentor console or student runtime) and the
	 * pure RoutePlanner component: it owns the WriteQueue, so EVERY planner
	 * edit hits IndexedDB before it touches the wire, and it owns the two
	 * online-only actions (version snapshot, mat photo upload).
	 *
	 * NO onChange refetch is passed to the queue ON PURPOSE: the planner's
	 * local model is the session's truth (see RoutePlanner.svelte), and a
	 * SvelteKit invalidate after every flush would rebuild the page under an
	 * editing child. The queue still reports connection state and failures,
	 * which the planner shows.
	 */
	import { onMount } from 'svelte';
	import type { SupabaseClient } from '@supabase/supabase-js';
	import type { Database } from '$lib/supabase/database.types';
	import { WriteQueue } from '$lib/student/queue.svelte';
	import RoutePlanner from './RoutePlanner.svelte';
	import { fetchStrategies, type PlannerData } from './data';
	import { uploadMatPhoto } from './photo';

	interface Props {
		supabase: SupabaseClient<Database>;
		/** The signed-in principal's id, so another account's ops are never replayed. */
		ownerId: string;
		team: { id: string; name: string };
		isMentor: boolean;
		data: PlannerData;
	}

	let { supabase, ownerId, team, isMentor, data }: Props = $props();

	// One queue for the life of this page; the client and owner never change
	// underneath it, so the initial capture is deliberate.
	// svelte-ignore state_referenced_locally
	const queue = new WriteQueue(supabase, ownerId);
	onMount(() => {
		let stop: (() => void) | null = null;
		let gone = false;
		void queue.start().then((s) => {
			if (gone) s();
			else stop = s;
		});
		return () => {
			gone = true;
			stop?.();
		};
	});

	async function snapshot(label: string) {
		const { error } = await supabase.rpc('strategy_snapshot', {
			p_team_id: team.id,
			...(label ? { p_label: label } : {})
		});
		if (error) return { ok: false, message: error.message };
		const strategies = await fetchStrategies(supabase, team.id);
		return { ok: true, strategies };
	}
</script>

<RoutePlanner
	{team}
	{isMentor}
	canEdit={data.canEdit}
	missions={data.missions}
	strategies={data.strategies}
	robot={data.robot}
	matSetup={data.matSetup}
	matPhotoUrl={data.matPhotoUrl}
	connection={queue.connection}
	pendingCount={queue.pendingCount}
	failed={queue.failed.map((f) => ({ id: f.id, message: f.failure ?? 'It did not save.' }))}
	onPersist={(op) => void queue.enqueue(op)}
	onSnapshot={snapshot}
	onUploadPhoto={isMentor ? (file) => uploadMatPhoto(supabase, file) : undefined}
	onDismissFailure={(id) => void queue.dismiss(id)}
/>

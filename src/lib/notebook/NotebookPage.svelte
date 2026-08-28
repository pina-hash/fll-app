<script lang="ts">
	/**
	 * The wiring between a route (mentor console or student runtime) and the
	 * pure Notebook component: it owns the WriteQueue, so EVERY notebook edit
	 * hits IndexedDB before it touches the wire.
	 *
	 * NO onChange refetch is passed to the queue ON PURPOSE, same as the
	 * planner: the notebook's local model is the session's truth, and a
	 * SvelteKit invalidate after every flush would rebuild the page under a
	 * child mid-sentence.
	 */
	import { onMount } from 'svelte';
	import type { SupabaseClient } from '@supabase/supabase-js';
	import type { Database } from '$lib/supabase/database.types';
	import { WriteQueue } from '$lib/student/queue.svelte';
	import Notebook from './Notebook.svelte';
	import type { NotebookData } from './data';

	interface Props {
		supabase: SupabaseClient<Database>;
		/** The signed-in principal's id, so another account's ops are never replayed. */
		ownerId: string;
		team: { id: string; name: string };
		isMentor: boolean;
		myStudentId: string | null;
		data: NotebookData;
		printHref: string;
	}

	let { supabase, ownerId, team, isMentor, myStudentId, data, printHref }: Props = $props();

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
</script>

<Notebook
	{team}
	{isMentor}
	{myStudentId}
	canEdit={data.canEdit}
	canConfirm={data.canConfirm}
	entries={data.entries}
	recaps={data.recaps}
	stats={data.stats}
	roles={data.roles}
	studentNames={data.studentNames}
	photos={data.photos}
	photoUrls={data.photoUrls}
	connection={queue.connection}
	pendingCount={queue.pendingCount}
	failed={queue.failed.map((f) => ({ id: f.id, message: f.failure ?? 'It did not save.' }))}
	{printHref}
	onPersist={(op) => void queue.enqueue(op)}
	onDismissFailure={(id) => void queue.dismiss(id)}
/>

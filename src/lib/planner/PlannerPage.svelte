<script lang="ts">
	/**
	 * The wiring between a route (mentor console or student runtime) and the
	 * pure RoutePlanner component: it owns the WriteQueue, so EVERY planner
	 * edit hits IndexedDB before it touches the wire, and it owns the two
	 * online-only actions (version snapshot, and everything to do with the
	 * team's field picture: upload, calibrate, dim, remove, re-sign).
	 *
	 * NO onChange refetch is passed to the queue ON PURPOSE: the planner's
	 * local model is the session's truth (see RoutePlanner.svelte), and a
	 * SvelteKit invalidate after every flush would rebuild the page under an
	 * editing child. The queue still reports connection state and failures,
	 * which the planner shows.
	 *
	 * THE DIM SETTING IS A WRITE LIKE ANY OTHER, AND IS JUDGED LIKE ONE. It
	 * used to be fired and forgotten, so an RLS-filtered update (a mentor
	 * deactivated mid-session) left the slider where the mentor put it and the
	 * setting unsaved: the next tablet to open the mat showed the old dimming
	 * and nobody knew why. Its answer now joins the planner's own failure
	 * strip, which is the one place this surface reports a write that did not
	 * land.
	 */
	import { onMount } from 'svelte';
	import type { SupabaseClient } from '@supabase/supabase-js';
	import type { Database } from '$lib/supabase/database.types';
	import { WriteQueue } from '$lib/student/queue.svelte';
	import RoutePlanner from './RoutePlanner.svelte';
	import { fetchMatImage, fetchStrategies, signMatImageUrl, type PlannerData } from './data';
	import {
		prepareFieldImage,
		removeFieldImage,
		saveCalibration as writeCalibration,
		saveDim,
		uploadFieldImage
	} from './field-image';
	import type { MatCalibration } from './calibration';

	interface Props {
		supabase: SupabaseClient<Database>;
		/** The signed-in principal's id, so another account's ops are never replayed. */
		ownerId: string;
		team: { id: string; name: string };
		isMentor: boolean;
		data: PlannerData;
		/** Where "See an example plan" points for this audience. */
		exampleHref?: string;
	}

	let { supabase, ownerId, team, isMentor, data, exampleHref }: Props = $props();

	/**
	 * Failures from the online-only actions, shown beside the queue's own. One
	 * id per action, so repeated attempts replace the line rather than stack
	 * up.
	 */
	const DIM_FAILURE = 'mat-dim';
	let actionFailures = $state<{ id: string; message: string }[]>([]);

	function reportFailure(id: string, message: string) {
		actionFailures = [...actionFailures.filter((f) => f.id !== id), { id, message }];
	}
	function clearFailure(id: string) {
		actionFailures = actionFailures.filter((f) => f.id !== id);
	}

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

	/**
	 * THE FIELD PICTURE'S ACTIONS, ALL ONLINE-ONLY AND ALL MENTOR-ONLY. They
	 * are not queued: there is no offline form of "a file landed in a
	 * bucket", and a calibration a mentor cannot SEE confirmed is worse than
	 * no calibration. Each answers with the row read back from the server, so
	 * the component never reconstructs one from what it hoped happened.
	 */
	async function reloadPicture(res: { ok: boolean; message: string }) {
		return { ...res, image: await fetchMatImage(supabase, team.id) };
	}

	async function uploadPicture(file: File) {
		const prepared = await prepareFieldImage(file);
		if ('error' in prepared) {
			return { ok: false, message: prepared.error, image: await fetchMatImage(supabase, team.id) };
		}
		return reloadPicture(await uploadFieldImage(supabase, team.id, prepared));
	}

	async function saveCalibration(cal: MatCalibration) {
		return reloadPicture(await writeCalibration(supabase, team.id, cal));
	}

	async function removePicture() {
		return reloadPicture(await removeFieldImage(supabase, team.id));
	}

	async function persistDim(pct: number) {
		try {
			const res = await saveDim(supabase, team.id, pct);
			if (res.ok) clearFailure(DIM_FAILURE);
			else reportFailure(DIM_FAILURE, res.message);
		} catch {
			// The request never reached the server. Say so rather than leaving
			// the slider looking saved.
			reportFailure(DIM_FAILURE, 'The dimming did not save. Check the connection and try again.');
		}
	}

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
	{exampleHref}
	connection={queue.connection}
	pendingCount={queue.pendingCount}
	failed={[
		...queue.failed.map((f) => ({ id: f.id, message: f.failure ?? 'It did not save.' })),
		...actionFailures
	]}
	onPersist={(op) => void queue.enqueue(op)}
	onSnapshot={snapshot}
	matImage={data.matImage}
	onUploadPicture={isMentor ? uploadPicture : undefined}
	onSaveCalibration={isMentor ? saveCalibration : undefined}
	onRemovePicture={isMentor ? removePicture : undefined}
	onSaveDim={isMentor ? (pct) => void persistDim(pct) : undefined}
	onRefreshPictureUrl={() => signMatImageUrl(supabase, team.id)}
	onDismissFailure={(id) => {
		clearFailure(id);
		void queue.dismiss(id);
	}}
/>

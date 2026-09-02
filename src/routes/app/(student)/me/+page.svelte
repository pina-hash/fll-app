<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { COMP_BOT_MANUAL_ROUTE } from '$lib/content/resources';
	import { watchTables } from '$lib/console/live.svelte';
	import StudentScreen from '$lib/student/StudentScreen.svelte';
	import { SessionClock } from '$lib/student/clock.svelte';
	import { WriteQueue, evidencePath } from '$lib/student/queue.svelte';
	import { safeInvalidateAll } from '$lib/student/refresh';
	import { myRoleFrom, type StudentTask } from '$lib/student/types';
	import type { TaskStatus } from '$lib/console/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// untrack: both own their state from the first payload onward.
	const clock = untrack(() => new SessionClock(data.serverNow));
	const queue = untrack(
		() => new WriteQueue(data.supabase, data.student.studentId, () => void safeInvalidateAll())
	);

	let busy = $state('');

	/**
	 * WHAT THIS DEVICE DID, ON TOP OF WHAT THE SERVER LAST SAID.
	 *
	 * A tap has to change the screen instantly whether or not the wifi is up,
	 * and it must not be undone by a refetch that has not caught up yet. The
	 * overlay holds this device's own writes until the server payload agrees
	 * with them, and then clears itself so a mentor reopening a task still
	 * wins.
	 */
	let localTasks = $state<Record<string, { status?: TaskStatus; assigned?: string | null; evidence?: number }>>({});
	let localCheckedIn = $state(false);

	onMount(() => {
		const stopClock = clock.start();
		let stopQueue: (() => void) | null = null;
		void queue.start().then((stop) => (stopQueue = stop));
		// A phase change has to land here without a reload. Same five tables the
		// mentor board watches, same rule: refetch, never patch.
		const stopWatch = watchTables(
			data.supabase,
			['meetings', 'meeting_phases', 'tasks', 'blockers', 'attendance'],
			`student-${data.student.studentId}`,
			() => void safeInvalidateAll()
		);
		return () => {
			stopClock();
			stopQueue?.();
			stopWatch();
		};
	});

	// Re-sync the clock off every fresh payload rather than drifting all session.
	$effect(() => {
		clock.sync(data.serverNow);
	});

	// Retire overlay entries the server has caught up with.
	$effect(() => {
		const server = data.tasks as StudentTask[];
		let next = localTasks;
		let changed = false;
		for (const task of server) {
			const held = next[task.id];
			if (!held) continue;
			const statusAgrees = held.status === undefined || held.status === task.status;
			const assignAgrees = held.assigned === undefined || held.assigned === task.assigned_student_id;
			const evidenceAgrees = held.evidence === undefined || task.evidence_count >= held.evidence;
			if (statusAgrees && assignAgrees && evidenceAgrees) {
				if (!changed) next = { ...next };
				delete next[task.id];
				changed = true;
			}
		}
		if (changed) localTasks = next;
		if (localCheckedIn && data.checkedIn) localCheckedIn = false;
	});

	let checkedIn = $derived(data.checkedIn || localCheckedIn);
	let myRole = $derived(myRoleFrom(data.roles, data.student.studentId));

	let tasksWithLocal = $derived(
		(data.tasks as StudentTask[]).map((task) => {
			const held = localTasks[task.id];
			if (!held) return task;
			return {
				...task,
				status: held.status ?? task.status,
				assigned_student_id: held.assigned !== undefined ? held.assigned : task.assigned_student_id,
				evidence_count: Math.max(task.evidence_count, held.evidence ?? 0)
			};
		})
	);

	/**
	 * The role queue: open work tagged to my role, plus anything already mine,
	 * plus untagged work anyone can pick up. Mine first, then unclaimed.
	 */
	let queueTasks = $derived.by(() => {
		const rank = (t: StudentTask) =>
			t.assigned_student_id === data.student.studentId ? 0 : t.assigned_student_id ? 2 : 1;
		return tasksWithLocal
			.filter((t) => t.status !== 'done')
			.filter(
				(t) =>
					(myRole && t.role === myRole.role) ||
					t.assigned_student_id === data.student.studentId ||
					t.role === null
			)
			.sort((a, b) => rank(a) - rank(b));
	});

	function hold(taskId: string, patch: { status?: TaskStatus; assigned?: string | null; evidence?: number }) {
		localTasks = { ...localTasks, [taskId]: { ...localTasks[taskId], ...patch } };
	}

	async function checkIn() {
		if (!data.meeting) return;
		busy = 'checkin';
		localCheckedIn = true;
		await queue.enqueue({
			kind: 'attendance',
			meetingId: data.meeting.id,
			studentId: data.student.studentId
		});
		busy = '';
	}

	async function claim(taskId: string) {
		busy = `claim:${taskId}`;
		hold(taskId, { assigned: data.student.studentId });
		await queue.enqueue({ kind: 'task_claim', taskId, assignedStudentId: data.student.studentId });
		busy = '';
	}

	async function markDone(taskId: string) {
		busy = `done:${taskId}`;
		hold(taskId, { status: 'done' });
		await queue.enqueue({ kind: 'task_status', taskId, status: 'done' satisfies TaskStatus });
		busy = '';
	}

	async function addEvidence(taskId: string, file: File, caption: string) {
		// The id is minted here because the storage path is named after it, and
		// because that id is what makes a replayed insert a no-op.
		const evidenceId = crypto.randomUUID();
		const contentType = file.type || 'image/jpeg';
		const path = evidencePath(data.student.teamId, taskId, evidenceId, contentType);
		const current = tasksWithLocal.find((t) => t.id === taskId)?.evidence_count ?? 0;
		hold(taskId, { evidence: current + 1 });
		await queue.enqueue(
			{
				kind: 'evidence',
				teamId: data.student.teamId,
				taskId,
				studentId: data.student.studentId,
				storagePath: path,
				caption: caption || null,
				contentType
			},
			file,
			evidenceId
		);
	}

	async function raiseBlocker(note: string, taskId: string | null) {
		await queue.enqueue({
			kind: 'blocker',
			teamId: data.student.teamId,
			studentId: data.student.studentId,
			taskId,
			note
		});
	}
</script>

<svelte:head><title>{data.student.teamName}</title></svelte:head>

<StudentScreen
	team={{ name: data.student.teamName, accent: data.student.accent, joinCode: data.student.joinCode }}
	me={{
		studentId: data.student.studentId,
		firstName: data.student.firstName,
		lastInitial: data.student.lastInitial
	}}
	meeting={data.meeting}
	nowMs={clock.nowMs}
	{checkedIn}
	{myRole}
	tasks={queueTasks}
	connection={queue.connection}
	pendingCount={queue.pendingCount}
	failed={queue.failed.map((f) => ({ id: f.id, message: f.failure ?? 'It did not save.' }))}
	{busy}
	onCheckIn={checkIn}
	onClaim={claim}
	onDone={markDone}
	onEvidence={addEvidence}
	onStuck={raiseBlocker}
	onDismissFailure={(id) => queue.dismiss(id)}
	buildHref={COMP_BOT_MANUAL_ROUTE}
/>

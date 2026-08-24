/**
 * THE LOCAL-FIRST WRITE QUEUE.
 *
 * The room's wifi drops. When it does, a nine-year-old who just finished a
 * task and photographed it must not lose either, and must not be told the
 * write landed when it did not. Every mutation the student runtime makes goes
 * through here: it is written to IndexedDB FIRST, then attempted, and it stays
 * on disk until the server has actually accepted it.
 *
 * WHY EVERY OP CARRIES A CLIENT-MINTED UUID. 0007 grants `id` on every insert
 * for exactly this: the device names the row, so replaying a queued insert is
 * a primary-key conflict rather than a duplicate. That turns "did my insert
 * land before the wifi died?" from an unanswerable question into a no-op.
 * Updates are last-write-wins by id and are idempotent by construction.
 * `attendance` additionally has a natural unique key (meeting_id, student_id),
 * and `evidence.storage_path` is unique, so those replay as upserts too.
 *
 * WHY INDEXEDDB AND NOT localStorage. A captured photo is a Blob of a few
 * megabytes. localStorage is strings and about 5MB total; IndexedDB stores the
 * Blob itself. Losing the photo is the failure this whole file exists to
 * prevent, so the photo goes to disk in the same transaction as the op.
 *
 * TRANSIENT VERSUS PERMANENT. A fetch that never reached the server is
 * transient: the op stays queued and is retried. A SQLSTATE coming back from
 * Postgres (RLS refused it, the evidence rule refused it) is permanent: the op
 * is marked failed and SHOWN, because retrying it forever would be a lie told
 * quietly. A duplicate-key error is neither; it is the idempotency working,
 * and it counts as success.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/database.types';
import type { TaskStatus } from '$lib/console/types';
import { applyPlannerOp, isPlannerOp, type PlannerOp } from '$lib/planner/ops';
import { applyMatchOp, isMatchOp, type MatchOp } from '$lib/match/ops';
import { applyNotebookOp, isNotebookOp, type NotebookOp } from '$lib/notebook/ops';
import { classifyPostgrest } from './postgrest';
import { setReachable } from './refresh';

const DB_NAME = 'fll-student-queue';
const DB_VERSION = 1;
const OPS = 'ops';
const BLOBS = 'blobs';

export type QueuedOp =
	| { kind: 'task_status'; taskId: string; status: TaskStatus }
	| { kind: 'task_claim'; taskId: string; assignedStudentId: string | null }
	| { kind: 'attendance'; meetingId: string; studentId: string }
	| { kind: 'blocker'; teamId: string; studentId: string; taskId: string | null; note: string }
	| {
			kind: 'evidence';
			teamId: string;
			taskId: string;
			studentId: string;
			storagePath: string;
			caption: string | null;
			contentType: string;
	  }
	/** The route planner's edits; applied by src/lib/planner/ops.ts. */
	| PlannerOp
	/** Practice runs logged at the mat; applied by src/lib/match/ops.ts. */
	| MatchOp
	/** Engineering notebook writing; applied by src/lib/notebook/ops.ts. */
	| NotebookOp;

export interface QueueRecord {
	/** The client-minted uuid. Also the primary key of any row this op inserts. */
	id: string;
	/** Which signed-in identity queued it, so another student's ops are never replayed. */
	ownerId: string;
	seq: number;
	op: QueuedOp;
	attempts: number;
	failure: string | null;
}

export type ConnectionState = 'online' | 'offline' | 'syncing';

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(OPS)) {
				const store = db.createObjectStore(OPS, { keyPath: 'id' });
				store.createIndex('seq', 'seq');
			}
			if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS);
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

function tx<T>(db: IDBDatabase, stores: string[], mode: IDBTransactionMode, run: (t: IDBTransaction) => IDBRequest<T>) {
	return new Promise<T>((resolve, reject) => {
		const t = db.transaction(stores, mode);
		const req = run(t);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

export class WriteQueue {
	/** Ops still on disk, oldest first. */
	pending = $state<QueueRecord[]>([]);
	/** Ops the server refused. Shown to the student; never retried silently. */
	failed = $state<QueueRecord[]>([]);
	connection = $state<ConnectionState>('online');
	/** True once the queue has read IndexedDB, so the UI does not flash "0 waiting". */
	ready = $state(false);

	#supabase: SupabaseClient<Database>;
	#ownerId: string;
	#db: IDBDatabase | null = null;
	#seq = 0;
	#flushing = false;
	#timer: ReturnType<typeof setInterval> | null = null;
	#stopped = false;
	#onChange: (() => void) | null;

	constructor(supabase: SupabaseClient<Database>, ownerId: string, onChange?: () => void) {
		this.#supabase = supabase;
		this.#ownerId = ownerId;
		this.#onChange = onChange ?? null;
	}

	get pendingCount(): number {
		return this.pending.length;
	}

	async start(): Promise<() => void> {
		this.#stopped = false;
		this.#db = await openDb();
		await this.#load();
		this.ready = true;
		this.connection = navigator.onLine === false ? 'offline' : 'online';

		const onOnline = () => {
			this.connection = 'online';
			void this.flush();
		};
		const onOffline = () => {
			this.connection = 'offline';
		};
		window.addEventListener('online', onOnline);
		window.addEventListener('offline', onOffline);
		// A retry heartbeat: `online` does not fire when the access point is up
		// but the internet behind it is not, which is the common school failure.
		this.#timer = setInterval(() => void this.flush(), 8000);
		void this.flush();

		return () => {
			this.#stopped = true;
			window.removeEventListener('online', onOnline);
			window.removeEventListener('offline', onOffline);
			if (this.#timer) clearInterval(this.#timer);
			this.#db?.close();
			this.#db = null;
		};
	}

	async #load(): Promise<void> {
		if (!this.#db) return;
		const all = await tx<QueueRecord[]>(this.#db, [OPS], 'readonly', (t) =>
			t.objectStore(OPS).getAll() as IDBRequest<QueueRecord[]>
		);
		const mine = all.filter((r) => r.ownerId === this.#ownerId).sort((a, b) => a.seq - b.seq);
		this.#seq = all.reduce((max, r) => Math.max(max, r.seq), 0);
		this.pending = mine.filter((r) => !r.failure);
		this.failed = mine.filter((r) => Boolean(r.failure));
	}

	/**
	 * Puts an op on disk and returns its client-minted id. The caller uses that
	 * id optimistically; the row it becomes will carry the same one.
	 *
	 * `id` may be supplied because an evidence upload has to know its own id
	 * before it can name its storage path.
	 */
	async enqueue(op: QueuedOp, blob?: Blob, forcedId?: string): Promise<string> {
		const id = forcedId ?? crypto.randomUUID();
		const record: QueueRecord = {
			id,
			ownerId: this.#ownerId,
			seq: ++this.#seq,
			op,
			attempts: 0,
			failure: null
		};
		if (this.#db) {
			if (blob) {
				await tx(this.#db, [BLOBS], 'readwrite', (t) => t.objectStore(BLOBS).put(blob, id));
			}
			await tx(this.#db, [OPS], 'readwrite', (t) => t.objectStore(OPS).put(record));
		}
		this.pending = [...this.pending, record];
		void this.flush();
		return id;
	}

	async #remove(id: string): Promise<void> {
		if (this.#db) {
			await tx(this.#db, [OPS], 'readwrite', (t) => t.objectStore(OPS).delete(id));
			await tx(this.#db, [BLOBS], 'readwrite', (t) => t.objectStore(BLOBS).delete(id)).catch(() => {});
		}
		this.pending = this.pending.filter((r) => r.id !== id);
	}

	async #markFailed(record: QueueRecord, message: string): Promise<void> {
		const updated = { ...record, failure: message, attempts: record.attempts + 1 };
		if (this.#db) await tx(this.#db, [OPS], 'readwrite', (t) => t.objectStore(OPS).put(updated));
		this.pending = this.pending.filter((r) => r.id !== record.id);
		this.failed = [...this.failed, updated];
	}

	/** Drops a failed op the student has acknowledged. */
	async dismiss(id: string): Promise<void> {
		if (this.#db) {
			await tx(this.#db, [OPS], 'readwrite', (t) => t.objectStore(OPS).delete(id));
			await tx(this.#db, [BLOBS], 'readwrite', (t) => t.objectStore(BLOBS).delete(id)).catch(() => {});
		}
		this.failed = this.failed.filter((r) => r.id !== id);
	}

	async #blobFor(id: string): Promise<Blob | null> {
		if (!this.#db) return null;
		return tx<Blob | undefined>(this.#db, [BLOBS], 'readonly', (t) =>
			t.objectStore(BLOBS).get(id) as IDBRequest<Blob | undefined>
		).then((b) => b ?? null);
	}

	/**
	 * Replays the queue in order. Ordering matters exactly once: an evidence
	 * upload has to land before the task_status that the evidence rule (0010)
	 * is guarding, and both are queued in that order by the caller.
	 */
	async flush(): Promise<void> {
		if (this.#stopped || this.#flushing || this.pending.length === 0) return;
		if (navigator.onLine === false) {
			this.connection = 'offline';
			return;
		}
		this.#flushing = true;
		this.connection = 'syncing';
		let unreachable = false;
		try {
			for (const record of [...this.pending]) {
				const result = await this.#apply(record);
				if (result === 'done') {
					await this.#remove(record.id);
				} else if (result === 'transient') {
					// The request never reached the server. Stop replaying and say
					// so: the heartbeat will try again. "Offline" is honest even
					// when navigator.onLine claims otherwise, because from this
					// student's point of view the work has not landed.
					this.connection = 'offline';
					unreachable = true;
					setReachable(false);
					return;
				} else {
					await this.#markFailed(record, result.message);
				}
			}
			this.connection = 'online';
			setReachable(true);
		} finally {
			this.#flushing = false;
			// ONLY refetch after a flush that actually reached the server. Asking
			// SvelteKit to re-run a load over a dead connection is what made the
			// student's screen hard-reload to a blank page; see refresh.ts.
			if (!unreachable) this.#onChange?.();
		}
	}

	async #apply(record: QueueRecord): Promise<'done' | 'transient' | { message: string }> {
		const sb = this.#supabase;
		const op = record.op;
		// Planner edits carry their own application and judgement rules
		// (including the zero-rows-back probe); ops.ts catches its own fetch
		// failures and answers 'transient'.
		if (isPlannerOp(op)) return applyPlannerOp(sb, op);
		// Match runs likewise: one op writes the run and everything under it,
		// and every row carries an id this device minted, so a replay collides
		// rather than duplicating. See src/lib/match/ops.ts.
		if (isMatchOp(op)) return applyMatchOp(sb, op);
		// Notebook writing follows the planner's judgement rules exactly; see
		// src/lib/notebook/ops.ts.
		if (isNotebookOp(op)) return applyNotebookOp(sb, op);
		try {
			if (op.kind === 'task_status') {
				const { error } = await sb.from('tasks').update({ status: op.status }).eq('id', op.taskId);
				return this.#classify(error);
			}
			if (op.kind === 'task_claim') {
				const { error } = await sb
					.from('tasks')
					.update({ assigned_student_id: op.assignedStudentId })
					.eq('id', op.taskId);
				return this.#classify(error);
			}
			if (op.kind === 'attendance') {
				const { error } = await sb
					.from('attendance')
					.insert({ id: record.id, meeting_id: op.meetingId, student_id: op.studentId });
				return this.#classify(error);
			}
			if (op.kind === 'blocker') {
				const { error } = await sb.from('blockers').insert({
					id: record.id,
					team_id: op.teamId,
					student_id: op.studentId,
					task_id: op.taskId,
					note: op.note
				});
				return this.#classify(error);
			}
			// evidence: the file first, then the row that points at it.
			const blob = await this.#blobFor(record.id);
			if (!blob) return { message: 'The photo is no longer on this device.' };
			const upload = await sb.storage
				.from('evidence')
				.upload(op.storagePath, blob, { contentType: op.contentType, upsert: true });
			if (upload.error) {
				const status = (upload.error as { statusCode?: string }).statusCode;
				// Storage speaks HTTP, not SQLSTATE. A 4xx is the server deciding.
				if (status && /^4\d\d$/.test(status)) return { message: upload.error.message };
				return 'transient';
			}
			const { error } = await sb.from('evidence').insert({
				id: record.id,
				task_id: op.taskId,
				team_id: op.teamId,
				storage_path: op.storagePath,
				caption: op.caption,
				uploaded_by_student_id: op.studentId
			});
			return this.#classify(error);
		} catch {
			// fetch threw: the request never reached the server.
			return 'transient';
		}
	}

	#classify(error: { code?: string | null; message?: string } | null): 'done' | 'transient' | { message: string } {
		return classifyPostgrest(error);
	}
}

/** The storage key for a piece of evidence: `{team}/{task}/{evidence id}.{ext}`. */
export function evidencePath(teamId: string, taskId: string, evidenceId: string, mime: string): string {
	const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
	return `${teamId}/${taskId}/${evidenceId}.${ext}`;
}

# Local-first write queue

Moved verbatim from `CLAUDE.md` (Conventions) on 2026-10-19, so `CLAUDE.md` stays under 3,000 words. `CLAUDE.md` links here; keep this file current in the same change as anything it describes.

#### Local-first write queue (built: `src/lib/student/queue.svelte.ts`)

- Every insert grant includes `id`: the device mints the uuid, so a replayed insert is a conflict, not a duplicate, and a queued update already knows its target.
- `updated_at` is server-stamped on every mutable table; clients never send it.
- Natural unique keys make retries upserts: `attendance (meeting_id, student_id)`, `evidence.storage_path`.
- Nothing depends on a server-generated sequence.
- **EVERY STUDENT WRITE GOES THROUGH THE QUEUE**, which puts it in IndexedDB before it touches the wire and keeps it there until the server accepts it. Photos are stored as Blobs, not strings: losing a captured photo is the failure the whole thing exists to prevent.
- **Transient and permanent are different.** A fetch that never reached the server keeps the op queued and retried; a SQLSTATE from Postgres marks it FAILED and shows it. `23505` is neither, it is the idempotency working, and counts as success.
- **`invalidateAll()` IS UNSAFE ON ANY PATH THAT CAN RUN OFFLINE.** Re-running a server load over a dead connection makes SvelteKit fall back to a full document reload, which on a phone blanks the student's screen and looks like lost work. Use `safeInvalidateAll()` (`src/lib/student/refresh.ts`), which refuses to run when the queue has reported the server unreachable, and give the UI an optimistic overlay so a tap responds without a refetch at all.
- **`navigator.onLine` is not the question.** A phone joined to an access point with no uplink says it is online. Only the queue knows, because only the queue has tried; it owns the reachability flag.

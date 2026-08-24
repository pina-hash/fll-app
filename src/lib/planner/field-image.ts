/**
 * THE FIELD PICTURE'S WRITE PATH: get one picture into this team's folder in
 * the private 'mat' bucket, record its size, and record the two corners a
 * mentor tapped. Reading it back is data.ts.
 *
 * COPYRIGHT IS THE REASON THIS FILE LOOKS LIKE THIS. The picture is a FIRST
 * and LEGO field layout. It is never committed, never placed in static/,
 * never bundled and never served from a public URL. It reaches the app one
 * way only: a mentor uploads it here, into a folder named for their team, in
 * a bucket whose read policy answers that team and nobody else, and every
 * read is a signed URL that expires in minutes. See CLAUDE.md.
 *
 * TWO HALVES, ON PURPOSE. prepareFieldImage() needs a browser (it decodes and
 * may re-encode the file); uploadFieldImage() needs only the network. They
 * are separate exports so the round trip -- upload, calibrate, place a
 * marker, reload, same millimetre -- can be proved by a test holding a real
 * mentor session, without a canvas. tests/mat-image-roundtrip.test.ts drives
 * exactly these functions.
 *
 * A NEW PICTURE CLEARS THE CALIBRATION. Two corners describe one picture.
 * Keeping the old taps across an upload would silently apply them to a
 * different frame, which is the same invisible wrongness this whole bundle
 * exists to remove. The mentor is told, and calibrates again.
 *
 * AN RLS-FILTERED WRITE IS NOT AN ERROR. Every write here asks for its rows
 * back and treats an empty answer as a refusal (CLAUDE.md); a mentor who has
 * been deactivated mid-session must not be told the calibration saved. That
 * goes for the REMOVAL too: asking for the rows back and then not reading
 * them is the same lie in a longer form, so the delete below judges its
 * answer and says which half of the removal actually happened.
 *
 * NO POSTGRES SENTENCE REACHES A MENTOR. These are PostgREST table writes,
 * not this schema's RPCs, so their errors are constraint names and SQLSTATEs;
 * each one is mapped to a sentence naming what to do next.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/database.types';
import { isUsableCalibration, type MatCalibration } from './calibration';
import { matImagePath, signMatImageUrl } from './data';

type Client = SupabaseClient<Database>;

/** Longest edge kept. Above this the picture is re-encoded smaller. */
const MAX_DIM = 2600;
/** The bucket's own limit (0012). Anything larger is re-encoded. */
const MAX_BYTES = 10 * 1024 * 1024;
const PASSTHROUGH = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** What a mentor reads when a table write is refused; never the raw answer. */
const SAVE_FAILED = 'The picture did not save. Reload the page and try again.';
const DIM_FAILED = 'The dimming did not save. Reload the page and try again.';
const ROW_LEFT =
	'The picture file went, but its record did not. Reload the page and remove it again.';

export interface PreparedImage {
	blob: Blob;
	contentType: string;
	width: number;
	height: number;
}

export interface WriteResult {
	ok: boolean;
	message: string;
}

/**
 * Decodes the chosen file, measures it, and hands back bytes the bucket will
 * accept. A file that is ALREADY an accepted type, within the size cap and
 * within MAX_DIM is passed through UNTOUCHED: a field layout is line art and
 * a JPEG round trip would soften exactly the edges a mentor calibrates
 * against. Only an oversized or unusual file is re-encoded, and a PNG stays
 * a PNG so it stays lossless.
 */
export async function prepareFieldImage(file: File): Promise<PreparedImage | { error: string }> {
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file);
	} catch {
		return { error: 'That picture could not be read on this device. Try a PNG or a JPEG.' };
	}
	const width = bitmap.width;
	const height = bitmap.height;
	const longest = Math.max(width, height);

	if (PASSTHROUGH.has(file.type) && file.size <= MAX_BYTES && longest <= MAX_DIM) {
		bitmap.close();
		return { blob: file, contentType: file.type, width, height };
	}

	const scale = Math.min(1, MAX_DIM / longest);
	const w = Math.max(1, Math.round(width * scale));
	const h = Math.max(1, Math.round(height * scale));
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d');
	if (!ctx) {
		bitmap.close();
		return { error: 'That picture could not be read on this device. Try a PNG or a JPEG.' };
	}
	ctx.drawImage(bitmap, 0, 0, w, h);
	bitmap.close();

	// Line art stays lossless; a photograph becomes a bounded JPEG.
	const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
	if (!blob) return { error: 'That picture could not be prepared on this device.' };
	if (blob.size > MAX_BYTES) {
		return { error: 'That picture is too big even after shrinking it. Try a smaller one.' };
	}
	return { blob, contentType: type, width: w, height: h };
}

/**
 * Puts the picture in this team's folder and records its size, clearing any
 * calibration that described the previous picture. Online only: there is no
 * queued form of "a file landed in a bucket".
 */
export async function uploadFieldImage(
	supabase: Client,
	teamId: string,
	image: PreparedImage
): Promise<WriteResult> {
	const up = await supabase.storage
		.from('mat')
		.upload(matImagePath(teamId), image.blob, {
			contentType: image.contentType,
			upsert: true
		});
	if (up.error) {
		return { ok: false, message: 'The upload did not go through. Are you online, and a mentor?' };
	}

	const row = {
		image_w: image.width,
		image_h: image.height,
		origin_u: null,
		origin_v: null,
		far_u: null,
		far_v: null
	};
	const updated = await supabase
		.from('mat_images')
		.update(row)
		.eq('team_id', teamId)
		.select('id');
	if (updated.error) return { ok: false, message: SAVE_FAILED };
	if ((updated.data ?? []).length > 0) {
		return { ok: true, message: 'New picture saved. Calibrate it before it is shown.' };
	}

	const inserted = await supabase
		.from('mat_images')
		.insert({ id: crypto.randomUUID(), team_id: teamId, ...row })
		.select('id');
	if (inserted.error) return { ok: false, message: SAVE_FAILED };
	if ((inserted.data ?? []).length === 0) {
		return { ok: false, message: 'The server did not accept the picture.' };
	}
	return { ok: true, message: 'Picture saved. Calibrate it before it is shown.' };
}

/**
 * Records the two tapped corners. Refuses a pair the transform could not
 * invert BEFORE the round trip, so the mentor gets the reason rather than a
 * constraint name; the table's own check is the backstop beneath it, the
 * same belt and braces the roster cap uses.
 */
export async function saveCalibration(
	supabase: Client,
	teamId: string,
	cal: MatCalibration
): Promise<WriteResult> {
	if (!isUsableCalibration(cal)) {
		return { ok: false, message: 'Those two taps are too close together. Tap opposite corners.' };
	}
	const res = await supabase
		.from('mat_images')
		.update({
			origin_u: cal.origin.u,
			origin_v: cal.origin.v,
			far_u: cal.far.u,
			far_v: cal.far.v
		})
		.eq('team_id', teamId)
		.select('id');
	if (res.error) return { ok: false, message: 'The calibration did not save. Try the two taps again.' };
	if ((res.data ?? []).length === 0) {
		return { ok: false, message: 'The server did not accept the calibration.' };
	}
	return { ok: true, message: 'Calibration saved.' };
}

/** How far the picture is dimmed under the schematic. Shared by the team. */
export async function saveDim(supabase: Client, teamId: string, pct: number): Promise<WriteResult> {
	const value = Math.round(Math.min(90, Math.max(0, pct)));
	const res = await supabase
		.from('mat_images')
		.update({ dim_pct: value })
		.eq('team_id', teamId)
		.select('id');
	if (res.error || (res.data ?? []).length === 0) return { ok: false, message: DIM_FAILED };
	return { ok: true, message: '' };
}

/**
 * Takes the picture back out: the object AND the row. A mentor must be able
 * to remove copyrighted material they uploaded, in one action, without a
 * console.
 */
export async function removeFieldImage(supabase: Client, teamId: string): Promise<WriteResult> {
	const gone = await supabase.storage.from('mat').remove([matImagePath(teamId)]);
	if (gone.error) return { ok: false, message: 'The picture could not be removed. Are you online?' };

	const res = await supabase.from('mat_images').delete().eq('team_id', teamId).select('id');
	if (res.error) return { ok: false, message: ROW_LEFT };
	if ((res.data ?? []).length === 0) {
		// Zero rows and no error: either RLS filtered the delete (the row is
		// still there and this mentor may not remove it) or there was no row to
		// begin with. Ask, because only the first case is a problem, and only
		// the first case may be reported as "removed" nowhere.
		const probe = await supabase.from('mat_images').select('id').eq('team_id', teamId).maybeSingle();
		if (probe.error) return { ok: false, message: ROW_LEFT };
		if (probe.data) return { ok: false, message: ROW_LEFT };
	}
	return { ok: true, message: 'Picture removed.' };
}

/** A fresh signed URL, for when the short-lived one on the page has expired. */
export async function refreshFieldImageUrl(supabase: Client, teamId: string): Promise<string | null> {
	return signMatImageUrl(supabase, teamId);
}

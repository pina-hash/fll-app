/**
 * The mat photo upload: the club's own top-down photo of its own mat,
 * converted to a bounded JPEG on the device that took it (that device can
 * decode its own camera format; another tablet might not), then upserted to
 * the one well-known path in the private 'mat' bucket. No calibration: the
 * mentor crops to the mat borders and the schematic stretches it to the mat
 * aspect ratio.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/database.types';
import { fetchMatPhotoUrl, MAT_PHOTO_PATH } from './data';

const MAX_DIM = 2048;
const PASSTHROUGH = new Set(['image/jpeg', 'image/png', 'image/webp']);

async function toJpeg(file: File): Promise<Blob> {
	const bitmap = await createImageBitmap(file);
	const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
	const w = Math.max(1, Math.round(bitmap.width * scale));
	const h = Math.max(1, Math.round(bitmap.height * scale));
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('no canvas');
	ctx.drawImage(bitmap, 0, 0, w, h);
	bitmap.close();
	const blob = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob(resolve, 'image/jpeg', 0.85)
	);
	if (!blob) throw new Error('encode failed');
	return blob;
}

export async function uploadMatPhoto(
	supabase: SupabaseClient<Database>,
	file: File
): Promise<{ url: string | null; message?: string }> {
	let blob: Blob;
	try {
		blob = await toJpeg(file);
	} catch {
		// The device could not decode it (an old browser, an odd format). If the
		// bucket accepts the original as-is, send that instead.
		if (!PASSTHROUGH.has(file.type)) {
			return { url: null, message: 'That photo could not be read on this device. Try a JPEG.' };
		}
		blob = file;
	}
	const { error } = await supabase.storage
		.from('mat')
		.upload(MAT_PHOTO_PATH, blob, { contentType: blob.type || 'image/jpeg', upsert: true });
	if (error) {
		return { url: null, message: 'The upload did not go through. Are you online?' };
	}
	const url = await fetchMatPhotoUrl(supabase);
	return { url, message: 'Photo saved.' };
}

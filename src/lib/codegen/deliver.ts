// Getting the file off the tablet and into the SPIKE App.
//
// THE STUDENTS ARE ON IPADS. A plain download puts the .llsp3 in Files, and
// opening it in the SPIKE App from there is: notice the download, open Files,
// find Downloads, long press, Share, scroll the sheet, pick SPIKE. Six steps
// between a nine-year-old and their program, most of them in an app that is
// not this one.
//
// The Web Share API with a file payload collapses that to one sheet with SPIKE
// already on it. It is NOT assumed: iPadOS Safari has it, desktop Firefox does
// not, and a browser that has navigator.share may still refuse this particular
// payload. So it is DETECTED, per payload, with canShare(), and the anchor
// download is the fallback rather than the afterthought.

export interface DeliverableFile {
	filename: string;
	bytes: Uint8Array;
}

export type DeliveryMethod = 'shared' | 'downloaded' | 'cancelled';

/**
 * .llsp3 is a zip with a manifest and has no registered media type. Octet
 * stream is what the SPIKE App's own exports are served as, and the extension
 * is what every receiver actually routes on.
 */
const LLSP3_TYPE = 'application/octet-stream';

function toFiles(files: DeliverableFile[]): File[] {
	return files.map(
		// A fresh ArrayBuffer per file: a Uint8Array view over a shared buffer
		// would hand the receiver the wrong slice.
		(f) => new File([f.bytes.slice()], f.filename, { type: LLSP3_TYPE })
	);
}

/** True when THIS payload can go through the share sheet, not merely when the API exists. */
export function canShareFiles(files: DeliverableFile[]): boolean {
	if (typeof navigator === 'undefined') return false;
	if (typeof navigator.share !== 'function') return false;
	if (typeof navigator.canShare !== 'function') return false;
	try {
		return navigator.canShare({ files: toFiles(files) });
	} catch {
		// Some builds throw rather than answering false. Same answer either way.
		return false;
	}
}

/** The fallback: one anchor click per file, object URLs revoked after. */
function download(files: DeliverableFile[]): DeliveryMethod {
	for (const f of files) {
		const url = URL.createObjectURL(new Blob([f.bytes.slice()], { type: LLSP3_TYPE }));
		const a = document.createElement('a');
		a.href = url;
		a.download = f.filename;
		a.rel = 'noopener';
		document.body.appendChild(a);
		a.click();
		a.remove();
		// Revoking synchronously cancels the download in some browsers; one
		// turn of the event loop is enough for the click to have been taken.
		setTimeout(() => URL.revokeObjectURL(url), 10_000);
	}
	return 'downloaded';
}

/**
 * Hand the files to the student. MUST be called inside the click handler chain:
 * navigator.share requires a user gesture and refuses one it cannot see.
 *
 * A cancelled share is reported as cancelled, NOT retried as a download. The
 * child closed the sheet on purpose; dropping a file in Downloads behind their
 * back is not what they asked for.
 */
export async function deliver(files: DeliverableFile[]): Promise<DeliveryMethod> {
	if (!files.length) return 'cancelled';
	if (canShareFiles(files)) {
		try {
			await navigator.share({
				files: toFiles(files),
				title: 'FLL toolkit',
				text: 'Open these in the SPIKE App.'
			});
			return 'shared';
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
			// Anything else is the share failing, not the student declining.
			return download(files);
		}
	}
	return download(files);
}

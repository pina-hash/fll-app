/**
 * A QR code, as inline SVG, for a parent link on a printed card.
 *
 * WHY INLINE SVG AND NOT AN IMAGE. The card is printed from the console, and
 * the CSP on this app allows no external hosts: a QR fetched from an image
 * service would be a blank square on the one page whose whole job is to be
 * handed to somebody. SVG also prints at whatever resolution the printer has,
 * which a 200px PNG does not.
 *
 * WHY A LIBRARY AND NOT A HAND-ROLLED ENCODER. QR is Reed-Solomon error
 * correction over a mask-selected bitmap; a hand-rolled one that is subtly
 * wrong still LOOKS like a QR code, and the failure shows up as a parent in a
 * car park whose phone will not read the card. qrcode-generator is the
 * reference implementation, has no dependencies of its own, and runs the same
 * in the server load and the browser.
 *
 * ERROR CORRECTION LEVEL M. The card is paper that lives in a bag: M tolerates
 * about 15% damage, which is the usual choice for print. The token is 64 hex
 * characters plus the origin, which fits comfortably.
 */
import qrcode from 'qrcode-generator';

export interface QrSvgOptions {
	/** Quiet-zone modules on every side. The spec's minimum is 4; do not go below it. */
	margin?: number;
	/** Rendered edge length, in CSS pixels or any unit you set on the element. */
	size?: number;
}

/**
 * The QR as a `<svg>` string with a viewBox in MODULES, so the caller sizes it
 * with CSS and the modules stay on whole-number boundaries.
 */
export function qrSvg(text: string, options: QrSvgOptions = {}): string {
	const margin = options.margin ?? 4;
	// Type 0 = "pick the smallest version that fits".
	const qr = qrcode(0, 'M');
	qr.addData(text);
	qr.make();

	const count = qr.getModuleCount();
	const span = count + margin * 2;

	// One path for every dark module. A single path element keeps the printed
	// file small and avoids hairline seams between adjacent rects.
	let d = '';
	for (let row = 0; row < count; row++) {
		for (let col = 0; col < count; col++) {
			if (!qr.isDark(row, col)) continue;
			d += `M${col + margin} ${row + margin}h1v1h-1z`;
		}
	}

	const sizeAttr = options.size ? ` width="${options.size}" height="${options.size}"` : '';
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${span} ${span}"${sizeAttr}` +
		` shape-rendering="crispEdges" role="img" aria-label="QR code for this parent link">` +
		`<rect width="${span}" height="${span}" fill="#ffffff"/>` +
		`<path d="${d}" fill="#000000"/>` +
		`</svg>`
	);
}

/** `https://host/p/<token>`. The whole of what the QR encodes. */
export function parentUrl(origin: string, token: string): string {
	return `${origin.replace(/\/+$/, '')}/p/${token}`;
}

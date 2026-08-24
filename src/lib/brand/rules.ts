/**
 * THE BRAND RULES, AS CODE. Every rule here is quoted from a guideline the
 * team is bound by, and every one of them is ENFORCED by BrandLogo.svelte
 * rather than written down and hoped for. A future session cannot break a
 * rule in this file by not having read the PDF.
 *
 * SOURCES (downloaded and read; not committed, they are FIRST's documents):
 *   [BG]  FIRST Branding & Design Guidelines
 *   [FLL] FIRST LEGO League Branding & Lockup Guidelines
 *   [IP]  Policy on the Use of FIRST Trademarks and Copyrighted Materials
 *
 * THE FOUR RULES THIS FILE EXISTS FOR
 *
 *  1. MARKS ARE USED EXACTLY AS SUPPLIED. [BG p13, FLL p15] "DO NOT alter the
 *     logo in any way ... Logo files should be used as is", "DO NOT crop out
 *     any elements", "DO NOT rotate or change the color", "DO NOT add a
 *     containing shape or border", "DO NOT distort or skew ... Always scale
 *     the logo proportionally". The component therefore takes a HEIGHT and
 *     nothing else, sets width automatically, and exposes no colour, radius,
 *     rotation, filter or background prop. It also refuses to inherit the
 *     team accent (see BrandLogo.svelte).
 *
 *  2. A SUPPORTING PIECE MAY NOT STAND ALONE. [BG p10] "The FIRST wordmark
 *     and interlocking triangle, circle, and square icon element may be used
 *     as separate branding pieces but MUST NOT be the only representation of
 *     the logo. Either the Vertical or Horizontal logo MUST appear in its
 *     original designed configuration somewhere in the materials." The same
 *     rule governs two supplied lockups: the program logotype [BG p16] "may
 *     only be used if the FIRST logo appears in close proximity", and the FLL
 *     division Vertical lockup [FLL p4] "may only be used if the FIRST logo
 *     appears with it, in close proximity". `assertMarkAllowed` is that rule.
 *
 *  3. THE ACRONYM DEFINITION IS NEVER USED ALONE. [BG p11] the acronym
 *     ("For Inspiration and Recognition of Science and Technology") is a
 *     supporting element shown locked up with the FIRST logo. It is not in
 *     the supplied artwork at all, so it exists here only as running text in
 *     the trademark attribution, where the logo is present beside it.
 *
 *  4. NAME USAGE IN TEXT. [BG p8, p20; FLL p9; IP III.A.4-6] FIRST is always
 *     all capitals and italic, LEGO always capitals and never italic, and a
 *     superscript registered symbol goes on the FIRST use of each name in a
 *     document -- "both in heading/title and in body copy". Never plural,
 *     never possessive. FirstName.svelte is the only thing that prints these
 *     names, and it counts first use per surface.
 *
 * WHY THERE IS NO ICON-ONLY OR WORDMARK-ONLY ASSET. The official downloads
 * (first-logo-all-formats.zip, firstlegoleaguechallenge-lockup-all-formats.zip)
 * contain complete logos and complete lockups only. Producing an icon-alone or
 * wordmark-alone image would mean CROPPING a supplied file, which rule 1
 * forbids outright. So those two marks are declared here, are subject to rule
 * 2, and additionally have no `file`: asking for one is refused with the
 * reason. That is stricter than the guideline and deliberately so.
 */

/** Every mark the app may render, and the marks it knows about but refuses. */
export type BrandMark =
	| 'first-horizontal'
	| 'first-vertical'
	| 'fll-challenge-horizontal-stacked'
	| 'fll-challenge-horizontal'
	| 'fll-challenge-vertical-icon'
	| 'fll-challenge-vertical'
	| 'first-icon'
	| 'first-wordmark';

export interface MarkSpec {
	/** The supplied file, byte-identical to the official download, or null
	 *  when no such file is supplied and cropping one would be required. */
	file: string | null;
	/** The reverse (dark-background) file, where one is supplied. */
	reverseFile?: string;
	/** Intrinsic pixel size of the supplied file, for the aspect ratio. */
	width: number;
	height: number;
	/** Minimum digital height in CSS pixels, from the guidelines. */
	minHeightPx: number;
	/** Where that minimum is written down. */
	minSource: string;
	/** True when the mark is a FULL official logo in its original designed
	 *  configuration, which is what rule 2 requires to be present. */
	isFullLogo: boolean;
	/** True when rule 2 governs this mark. */
	needsFullLogoNearby: boolean;
	/** Alt text. Never a caption, never rendered as visible text beside the
	 *  mark: adding text to a mark is forbidden [BG p13]. */
	alt: string;
	/** Why a mark with no file is refused. */
	refusedBecause?: string;
}

export const MARKS: Record<BrandMark, MarkSpec> = {
	'first-horizontal': {
		file: '/brand/first/FIRST_Horz_RGB.png',
		reverseFile: '/brand/first/FIRST_HorzRGB_reverse.png',
		width: 1692,
		height: 442,
		minHeightPx: 30,
		minSource: 'BG p7: horizontal logo minimum 30 pixels tall (digital)',
		isFullLogo: true,
		needsFullLogoNearby: false,
		alt: 'FIRST'
	},
	'first-vertical': {
		file: '/brand/first/FIRST_Vertical_RGB.png',
		reverseFile: '/brand/first/FIRST_Vertical_RGB_reverse.png',
		width: 959,
		height: 720,
		minHeightPx: 60,
		minSource: 'BG p7: vertical logo minimum 60 pixels tall (digital)',
		isFullLogo: true,
		needsFullLogoNearby: false,
		alt: 'FIRST'
	},
	'fll-challenge-horizontal-stacked': {
		file: '/brand/fll-challenge/FLL-RGB_Challenge-horiz-stacked-full-color.png',
		reverseFile: '/brand/fll-challenge/FLL-RGB_Challenge-horiz-stacked-full-color-reverse.png',
		width: 2606,
		height: 1639,
		minHeightPx: 45,
		minSource: 'FLL p11: horizontal stacked lockup minimum 45 pixels tall (digital)',
		isFullLogo: true,
		needsFullLogoNearby: false,
		alt: 'FIRST LEGO League Challenge'
	},
	'fll-challenge-horizontal': {
		file: '/brand/fll-challenge/FLL-RGB_Challenge-horiz-full-color.png',
		width: 5186,
		height: 1162,
		minHeightPx: 25,
		minSource: 'BG p22: horizontal division lockup minimum 25 pixels tall (digital)',
		isFullLogo: true,
		needsFullLogoNearby: false,
		alt: 'FIRST LEGO League Challenge'
	},
	'fll-challenge-vertical-icon': {
		file: '/brand/fll-challenge/FLL-RGB_Challenge-vert-icon-full-color.png',
		width: 2143,
		height: 2365,
		minHeightPx: 60,
		minSource: 'FLL p11: vertical lockup with icon minimum 60 pixels tall (digital)',
		isFullLogo: true,
		needsFullLogoNearby: false,
		alt: 'FIRST LEGO League Challenge'
	},
	'fll-challenge-vertical': {
		file: '/brand/fll-challenge/FLL-RGB_Challenge-vert-full-color.png',
		width: 2218,
		height: 1902,
		minHeightPx: 40,
		minSource: 'FLL p11: vertical lockup minimum 40 pixels tall (digital)',
		isFullLogo: false,
		// FLL p4: "The Vertical format may only be used if the FIRST logo
		// appears with it, in close proximity."
		needsFullLogoNearby: true,
		alt: 'FIRST LEGO League Challenge'
	},
	'first-icon': {
		file: null,
		width: 0,
		height: 0,
		minHeightPx: 0,
		minSource: 'BG p10',
		isFullLogo: false,
		needsFullLogoNearby: true,
		alt: 'FIRST',
		refusedBecause:
			'FIRST supplies no icon-alone file. Producing one would mean cropping a supplied logo, which the guidelines forbid outright.'
	},
	'first-wordmark': {
		file: null,
		width: 0,
		height: 0,
		minHeightPx: 0,
		minSource: 'BG p10',
		isFullLogo: false,
		needsFullLogoNearby: true,
		alt: 'FIRST',
		refusedBecause:
			'FIRST supplies no wordmark-alone file, and the guidelines also say the wordmark is not to be used as a word in body copy. Use FirstName instead, which sets the name as text.'
	}
};

/** Thrown when a usage would break a rule. Never caught to carry on anyway. */
export class BrandRuleError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BrandRuleError';
	}
}

/**
 * A surface's brand register: what marks this page is rendering. One per
 * page, created by BrandSurface.svelte and read by every BrandLogo on it.
 * "The same material" in the guidelines is one screen here, which is the
 * strictest reasonable reading: a rule about what a reader can see at once.
 */
export interface BrandRegister {
	marks: Set<BrandMark>;
	fullLogos: number;
}

export function createRegister(): BrandRegister {
	return { marks: new Set(), fullLogos: 0 };
}

export function registerMark(register: BrandRegister, mark: BrandMark): void {
	register.marks.add(mark);
	if (MARKS[mark].isFullLogo) register.fullLogos += 1;
}

export function unregisterMark(register: BrandRegister, mark: BrandMark): void {
	if (MARKS[mark].isFullLogo) register.fullLogos = Math.max(0, register.fullLogos - 1);
}

/**
 * RULE 2, AS A FUNCTION. Throws unless this mark may appear on a surface
 * holding these marks. A mark with no supplied file is refused whatever else
 * is on the page, because the only way to make one is to crop.
 */
export function assertMarkAllowed(mark: BrandMark, register: BrandRegister): void {
	const spec = MARKS[mark];
	if (!spec.file) {
		throw new BrandRuleError(
			`The ${mark} mark is refused: ${spec.refusedBecause} (Branding & Design Guidelines p10, p13.)`
		);
	}
	if (spec.needsFullLogoNearby && register.fullLogos === 0) {
		throw new BrandRuleError(
			`The ${mark} mark may not be the only representation of the logo on a surface. ` +
				`A full FIRST logo, or a full FIRST LEGO League lockup in its original designed ` +
				`configuration, has to appear on the same surface. ` +
				`(Branding & Design Guidelines p10; FIRST LEGO League Branding & Lockup Guidelines p4.)`
		);
	}
}

/**
 * RULE 1, THE HALF CSS CANNOT DEFEND. `all: initial` on the image stops an
 * inherited colour, an inherited filter and a page-level `img {}` rule. It
 * does NOT stop an ANCESTOR's `filter`, `opacity` or `mix-blend-mode`: those
 * rasterise the whole subtree, and nothing a descendant declares can escape
 * them. That is exactly the "DO NOT rotate or change the color of the logo"
 * case, arriving from three elements up.
 *
 * So it is checked instead of claimed. `ancestorHazard` walks the ancestors
 * of a rendered mark and names the first one that would alter it. The walk
 * needs computed styles, so it runs in the browser only; BrandLogo refuses
 * the mark when it finds one.
 */
export function ancestorHazard(
	el: Element | null,
	read: (e: Element) => { filter: string; opacity: string; blend: string; transform: string }
): string | null {
	let node = el?.parentElement ?? null;
	let depth = 0;
	while (node && depth < 40) {
		const s = read(node);
		const label = node.tagName.toLowerCase() + (node.className ? `.${String(node.className).split(' ')[0]}` : '');
		if (s.filter && s.filter !== 'none') return `an ancestor (${label}) applies filter: ${s.filter}`;
		if (s.blend && s.blend !== 'normal') return `an ancestor (${label}) applies mix-blend-mode: ${s.blend}`;
		if (s.opacity && Number(s.opacity) < 1) return `an ancestor (${label}) applies opacity: ${s.opacity}`;
		// A rotation or a non-uniform scale reaches the mark the same way.
		if (s.transform && s.transform !== 'none' && !isUniformTranslate(s.transform)) {
			return `an ancestor (${label}) applies transform: ${s.transform}`;
		}
		node = node.parentElement;
		depth += 1;
	}
	return null;
}

/** A translate-only matrix moves a mark without altering it, which is fine. */
function isUniformTranslate(transform: string): boolean {
	const m = transform.match(/^matrix\(([^)]+)\)$/);
	if (!m) return false;
	const [a, b, c, d] = m[1].split(',').map((n) => Number(n.trim()));
	return a === 1 && b === 0 && c === 0 && d === 1;
}

/** RULE 1, the size half: refuse a mark below its documented minimum. */
export function assertMinimumHeight(mark: BrandMark, heightPx: number): void {
	const spec = MARKS[mark];
	if (heightPx < spec.minHeightPx) {
		throw new BrandRuleError(
			`The ${mark} mark may not be rendered at ${heightPx}px. Its minimum is ` +
				`${spec.minHeightPx}px. (${spec.minSource}.)`
		);
	}
}

/**
 * The minimum clear space around a mark is "equal to the height and width of
 * the 'F' in the FIRST wordmark" [BG p6, p21; FLL p10]. The F is measured
 * from the supplied horizontal logo: its cap height is close to a quarter of
 * the lockup's own height, and taking a quarter of the RENDERED height is
 * therefore a safe reading of the rule that scales with the mark. It is
 * applied as padding, never as a border or a box.
 */
export function clearSpacePx(heightPx: number): number {
	return Math.ceil(heightPx / 4);
}

/**
 * THE TRADEMARK ATTRIBUTION, VERBATIM.
 *
 * Taken word for word from the Policy on the Use of FIRST Trademarks and
 * Copyrighted Materials, section IV.A, "A disclaimer for the use of joint
 * FIRST and LEGO Trademarks". It is the statement that names both FIRST and
 * the LEGO Group, which is what the footer has to carry.
 *
 * A note on why this exact one. Under IP II.1 a currently registered FIRST
 * team using the marks for its own team activities is not REQUIRED to post a
 * disclaimer at all. The other candidate statements in section IV say the
 * marks are "used by special permission", which would be a claim this club
 * has not been granted. This one is true as written for a registered team,
 * names both owners, and is quoted rather than paraphrased.
 */
export const TRADEMARK_ATTRIBUTION =
	'FIRST® LEGO® League is a jointly held trademark of FIRST® ' +
	'(www.firstinspires.org) and the LEGO Group, neither of which is overseeing, ' +
	'involved with, or responsible for this activity, product, or service.';

/**
 * THE SEASON NAMES ARE TEXT, NEVER ARTWORK. No season lockup, mat graphic,
 * mission model render or building instruction is fetched or stored anywhere
 * in this repo. IP III.A.3 also says to set the marks "in the same font and
 * size as surrounding text to avoid creating the appearance of a new logo".
 *
 * The symbols: Attachment A of the IP policy lists the registered marks, and
 * says that FIRST game names and FIRST LEGO League challenge names not yet
 * registered "must be designated with a 'TM' or 'SM'" (Attachment A, B and
 * D.31). Neither CANOPY nor BIOGLOW appears on the registered list, so both
 * take a trademark symbol and not a registered one.
 */
export const SEASON = {
	/** The FIRST season. FIRST is a registered mark; the season name is not. */
	first: 'CANOPY',
	/** The FIRST LEGO League Challenge season. */
	challenge: 'BIOGLOW',
	years: '2026-27'
} as const;

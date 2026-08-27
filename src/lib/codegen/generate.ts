// Build, validate, and only then package.
//
// This is the orchestration main.ts and emitall.ts held in the container: same
// order, same two projects, same slot indices. What changed is the ending. The
// CLI wrote the file whenever the validator came back clean; here the bytes are
// returned and a caller that never looks at `findings` cannot hand them to
// anybody, because there are no bytes to hand over unless it is clean.

import { Builder, resetIds } from './blocks.js';
import { layout, measure } from './layout.js';
import {
	pack,
	validate,
	verifyContainer,
	type EmitSource,
	type Finding,
	type PackOpts
} from './package.js';
import { buildSelfTest } from './selftest.js';
import { buildToolkit, type Calibration, type RobotConfig } from './toolkit.js';

export interface GeneratedProject {
	/** What the SPIKE App will call it. */
	name: string;
	/** What the download is called. */
	filename: string;
	/**
	 * The packaged .llsp3, or NULL when the validator found anything at all.
	 *
	 * THIS IS THE POINT OF THE WHOLE MODULE. The SPIKE App refuses a malformed
	 * project with no diagnostic: a student who is handed a bad file learns
	 * only that the app will not open it, on a Saturday, with a mentor who
	 * cannot tell them why either. A project that did not validate has no bytes.
	 */
	bytes: Uint8Array | null;
	findings: Finding[];
	blockCount: number;
	variables: string[];
	extensions: string[];
	stacks: { x: number; y: number; w: number; h: number }[];
	/**
	 * Manifest fields V8's round trip found in the packed file that the
	 * verified-shapes registry says nothing about. NOT a defect and not a
	 * reason to withhold the bytes: it is the evidence gap named out loud, so
	 * a field cannot enter the manifest with nothing in the world vouching for
	 * it. See ContainerReport.unpinned. It is deliberately not on the student's
	 * screen: that surface reads at fourth grade and this is a note to whoever
	 * next observes the SPIKE App writing a manifest.
	 */
	containerUnpinned: string[];
}

function emit(
	name: string,
	slotIndex: number,
	filename: string,
	src: EmitSource,
	build: (b: Builder) => void
): GeneratedProject {
	resetIds();
	const b = new Builder();
	build(b);
	const extensions = b.normalize();
	layout(b.blocks);

	const o: PackOpts = {
		name,
		slotIndex,
		blocks: b.blocks,
		variables: b.variables,
		extensions
	};
	const findings = validate(o, src);
	const roots = Object.keys(b.blocks).filter((k) => b.blocks[k].topLevel);

	/**
	 * V8 runs on the BYTES, so it can only run after packing, which is why
	 * packing now happens before the bytes are known to be handed over. The
	 * order that matters is unchanged: nothing is returned to a caller until
	 * every check has answered, and a container that fails the round trip
	 * leaves `bytes` null exactly as a bad block graph does.
	 */
	let bytes: Uint8Array | null = null;
	let containerUnpinned: string[] = [];
	if (!findings.length) {
		const packed = pack(o);
		const container = verifyContainer(packed);
		findings.push(...container.findings);
		containerUnpinned = container.unpinned;
		bytes = container.findings.length ? null : packed;
	}

	return {
		name,
		filename,
		bytes,
		findings,
		blockCount: Object.keys(b.blocks).length,
		variables: Object.values(b.variables).map((v) => v[0]),
		extensions,
		stacks: roots.map((k) => ({
			x: b.blocks[k].x ?? 0,
			y: b.blocks[k].y ?? 0,
			...measure(b.blocks, k)
		})),
		containerUnpinned
	};
}

/**
 * The two files a team gets: the toolkit they build runs out of, and the self
 * test that grades the toolkit on the hub.
 *
 * The self test BUILDS THE WHOLE TOOLKIT INTO ITSELF (buildSelfTest calls
 * buildToolkit), so it is a standalone project and not a companion that only
 * works if the other one is loaded. Slot indices are the container's: 19 and 18.
 */
export function generateProjects(c: RobotConfig, cal: Calibration): GeneratedProject[] {
	const src: EmitSource = { config: c, calibration: cal };
	return [
		emit('FLL Toolkit v1', 19, 'FLL_Toolkit_v1.llsp3', src, (b) => {
			buildToolkit(b, c, cal);
		}),
		emit('FLL Toolkit Self Test', 18, 'FLL_Toolkit_SelfTest.llsp3', src, (b) => {
			buildSelfTest(b, c, cal);
		})
	];
}

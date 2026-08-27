import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import registry from "../../../docs/FLL_VERIFIED_SHAPES.json";
import type { Blocks } from "./blocks.js";
import { overlaps } from "./layout.js";
import type { Calibration, RobotConfig } from "./toolkit.js";

const STUB = "deadc057000000000000000000000000";
const VM_META = {
  semver: "3.0.0",
  vm: "0.2.0-prerelease.20200512204241",
  agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
};

const rid = (k: number) => Array.from({ length: k },
  () => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[
    Math.floor(Math.random() * 62)]).join("");

export interface PackOpts {
  name: string; slotIndex: number; blocks: Blocks;
  variables: Record<string, [string, number]>; extensions: string[];
}

export function buildProjectJson(o: PackOpts) {
  const costume = (name: string, cx: number, cy: number) => ({
    assetId: STUB, name, bitmapResolution: 1, md5ext: `${STUB}.svg`,
    dataFormat: "svg", rotationCenterX: cx, rotationCenterY: cy,
  });
  return {
    targets: [
      {
        isStage: true, name: "Stage", variables: {}, lists: {}, broadcasts: {},
        blocks: {}, comments: {}, currentCostume: 0,
        costumes: [costume("backdrop1", 47, 55)], sounds: [], volume: 0, tempo: 60,
        videoTransparency: 50, videoState: "on", textToSpeechLanguage: null,
      },
      {
        isStage: false, name: rid(20), variables: o.variables, lists: {},
        broadcasts: {}, blocks: o.blocks, comments: {}, currentCostume: 0,
        costumes: [costume(rid(20), 240, 180)], sounds: [], volume: 100,
        visible: true, x: 0, y: 0, size: 100, direction: 90, draggable: false,
        rotationStyle: "all around",
      },
    ],
    monitors: [], extensions: o.extensions, meta: VM_META,
  };
}

export function pack(o: PackOpts): Uint8Array {
  const sb3 = zipSync({
    "project.json": strToU8(JSON.stringify(buildProjectJson(o))),
    // STORED, not deflated. The registry's container block records the app
    // writing inner assets stored, and V8 now reads that field: fflate's
    // default level deflates even this zero-byte entry, and the round trip
    // reported the mismatch on every single generation until this said
    // otherwise. Matching the app-authored reference is the point of V8.
    [`${STUB}.svg`]: [new Uint8Array(0), { level: 0 }] as [Uint8Array, { level: 0 }],
  });
  const now = new Date().toISOString().replace(/(\.\d{3})\d*Z?$/, "$1Z");
  const manifest = {
    type: "word-blocks", autoDelete: false, created: now, id: rid(12),
    lastsaved: now, size: 0, name: o.name, slotIndex: o.slotIndex,
    workspaceX: 120, workspaceY: 120, zoomLevel: 0.675, showAllBlocks: true,
    version: 38, hardware: { [rid(20)]: { type: "flipper" } },
    extensions: o.extensions,
    state: { playMode: "download", canvasDrawerTab: "monitorTab", canvasDrawerOpen: false },
    extraFiles: [],
  };
  // Outer entries STORED, matching what the app writes.
  return zipSync({
    "manifest.json": strToU8(JSON.stringify(manifest)),
    "scratch.sb3": sb3,
    "icon.svg": strToU8('<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 261 238"></svg>'),
  }, { level: 0 });
}

// ============================================================== VALIDATOR
export interface Finding { check: string; detail: string; }

/** The parts of FLL_VERIFIED_SHAPES.json the validator reads. */
interface RegistryShape {
  shapes: Record<string, unknown>;
  _meta: {
    namespaces: { NOT_IN_THIS_APP: { namespaces: string[] } };
    container: ContainerRef;
  };
}

/**
 * `_meta.container`: what a .llsp3 the SPIKE App ITSELF wrote looks like.
 * Provenance A, so these are exact values rather than tolerances, which is why
 * V8 compares against this block and not against pack()'s own beliefs.
 */
interface ContainerRef {
  outer: { entries: string[]; compression: string };
  inner: { entries: string[]; project_json: string; assets: string };
  stub_asset_id: string;
  stub_asset_bytes: number;
  meta_vm: string;
  manifest_version: number;
  sounds_required: boolean;
  icon_svg_may_be_stub: boolean;
}

/**
 * Why a registry cannot be used at all.
 *
 * PLACEHOLDER AND EMPTY ARE SEPARATE BECAUSE A PLACEHOLDER IS ALSO EMPTY, and
 * a guard that only counted shapes would report the symptom and hide the cause.
 * A checkout shipped with a stand-in registry once already: V9 rejected all 374
 * blocks of the toolkit, which reads exactly like an emitter that has broken,
 * and the true reason (nobody had put the registry in yet) appeared nowhere in
 * the 374 findings.
 */
export type RegistryFaultCode = 'placeholder' | 'empty' | 'no-container';

export class RegistryFault extends Error {
  constructor(readonly code: RegistryFaultCode, message: string) {
    super(message);
    this.name = 'RegistryFault';
  }
}

/**
 * THIS THROWS RATHER THAN RETURNING A FINDING, and the difference is the point.
 * A finding is a statement about the PROJECT being validated; this is a
 * statement about the VALIDATOR, which cannot answer anything until it has a
 * registry. Returning findings here would let a broken toolchain wear the
 * costume of a broken project.
 */
export function assertRegistryUsable(reg: unknown): void {
  const meta = (reg as { _meta?: { placeholder?: unknown } })?._meta;
  if (meta?.placeholder === true) {
    throw new RegistryFault(
      'placeholder',
      'FLL_VERIFIED_SHAPES.json is a PLACEHOLDER, not the verified-shape registry. ' +
        'V9 cannot answer, so no project can be validated and none may be handed over. ' +
        'Put the real registry at docs/FLL_VERIFIED_SHAPES.json.'
    );
  }
  const shapes = (reg as { shapes?: Record<string, unknown> })?.shapes;
  if (!shapes || Object.keys(shapes).length === 0) {
    throw new RegistryFault(
      'empty',
      'FLL_VERIFIED_SHAPES.json declares no shapes. It is not flagged as a placeholder, ' +
        'so this is a registry that has lost its contents rather than one never filled in. ' +
        'V9 cannot answer and no project can be validated.'
    );
  }
}

/**
 * What the emitter was built FROM, as opposed to what it produced. V5 is the
 * only check that reads it: every other check reasons over the block graph, and
 * by then the calibration has been baked into literals and its two original
 * numbers are unrecoverable from what is left.
 */
export interface EmitSource {
  config: RobotConfig;
  calibration: Calibration;
}

/**
 * V5's margin, in raw reflectivity points. The sensor reports 0 to 100.
 *
 * WHY A MARGIN AND NOT MERELY white > black. The emitter bakes
 * (raw - black) / (white - black) * 100 as LITERALS, so the separation is a
 * divisor fixed at generation time that nobody can re-read at the table. At a
 * separation of S, one raw point of sensor noise moves the normalised reading
 * by 100/S points: at 83 (the measured practice pair, white 95 and black 12)
 * that is 1.2 points and the proportional term absorbs it; at 5 it is 20 points
 * and the follower chases noise instead of the line. Bare inequality lets white
 * 51 and black 50 through, which is a divisor of 1 and a hundred-point swing
 * for every point of noise.
 *
 * AND A SEPARATION THIS SMALL IS NOT A CALIBRATION, IT IS A MEASUREMENT THAT
 * WENT WRONG: a sensor mounted too high off the mat, a hall light washing the
 * white out, or both readings taken on the same colour. The answer is to
 * measure again, which is what the finding says, rather than to bake two
 * numbers that were always going to fail in the room they were meant for.
 *
 * 20 is a FLOOR, not a target: it holds one point of noise to five normalised
 * points. Real practice pairs measure 60 to 85 apart. The database refuses
 * white <= black outright (0024's calibrations_white_above_black_check); the
 * separation is what V5 adds on top of that, because a row that is legal to
 * STORE can still be too narrow to BAKE.
 */
export const CALIBRATION_MIN_SEPARATION = 20;

/**
 * V5 calibration sanity, and the live defect it guards.
 *
 * buildToolkit divides by (white - black) and emits the quotient as a literal,
 * so white === black produces a division by zero INSIDE the generated blocks,
 * and white < black inverts every line reading: dark reads bright, the follower
 * steers away from the line, and nothing in the file looks wrong. Neither shows
 * up in the block graph, so no other check can see either one.
 *
 * The finding names the PORT because a calibration is a property of a sensor in
 * a room, and whoever is holding the robot needs to know which sensor to put
 * back on the mat. Both ports the config names get their own finding: the
 * emitter bakes one pair for both, so one bad pair is wrong twice.
 */
export function validateCalibration(src: EmitSource): Finding[] {
  const { white, black } = src.calibration;
  const gap = white - black;
  if (gap >= CALIBRATION_MIN_SEPARATION) return [];
  const why =
    gap === 0
      ? "white and black are the same reading, so the generated project divides by zero"
      : gap < 0
        ? "black reads lighter than white, which inverts every line reading"
        : `a separation of ${gap}, under the minimum of ${CALIBRATION_MIN_SEPARATION}`;
  return [src.config.leftColorPort, src.config.rightColorPort].map((port) => ({
    check: "V5",
    detail: `port ${port} calibration white ${white} black ${black}: ${why}. Measure both again on this mat.`,
  }));
}

/**
 * `src` is REQUIRED rather than optional, and that is deliberate. An optional
 * source would make V5 a check that silently does not run whenever a caller
 * forgets to pass one, which is the same failure as a grant assertion that only
 * ever runs in the environment where the bug cannot occur: it can only pass.
 */
export function validate(o: PackOpts, src: EmitSource): Finding[] {
  assertRegistryUsable(registry);
  const reg = registry as RegistryShape;
  const known: Set<string> = new Set(Object.keys(reg.shapes));
  const banned: Set<string> = new Set(reg._meta.namespaces.NOT_IN_THIS_APP.namespaces);
  const f: Finding[] = [];
  const B = o.blocks;

  // V5 calibration sanity, read off the source rather than the block graph.
  f.push(...validateCalibration(src));

  // V6 link and reachability integrity
  for (const [k, b] of Object.entries(B)) {
    for (const [nm, iv] of Object.entries(b.inputs)) {
      const ref = (iv as any[])[1];
      if (typeof ref === "string") {
        if (!B[ref]) f.push({ check: "V6", detail: `${b.opcode}.${nm} -> missing ${ref}` });
        else if (B[ref].parent !== k) f.push({ check: "V6", detail: `${b.opcode}.${nm} parent mismatch` });
      }
    }
    if (b.next && B[b.next]?.parent !== k) f.push({ check: "V6", detail: `${b.opcode} next parent mismatch` });
  }
  const seen = new Set<string>();
  const walk = (k: string) => {
    if (seen.has(k) || !B[k]) return;
    seen.add(k);
    for (const iv of Object.values(B[k].inputs)) {
      const r = (iv as any[])[1];
      if (typeof r === "string") walk(r);
    }
    if (B[k].next) walk(B[k].next!);
  };
  for (const [k, b] of Object.entries(B)) if (b.topLevel) walk(k);
  for (const k of Object.keys(B)) if (!seen.has(k)) f.push({ check: "V6", detail: `unreachable ${B[k].opcode}` });

  // V9 verified-shapes registry
  for (const b of Object.values(B)) {
    const ns = b.opcode.split("_")[0];
    if (banned.has(ns)) f.push({ check: "V9", detail: `${b.opcode} is in a namespace this app does not have` });
    else if (!known.has(b.opcode)) f.push({ check: "V9", detail: `${b.opcode} not in the verified registry` });
  }

  // extensions declared must cover what is used, and vice versa
  const used = new Set([...Object.values(B)]
    .map(b => b.opcode.split("_")[0]).filter(x => x.startsWith("flipper")));
  for (const u of used) if (!o.extensions.includes(u)) f.push({ check: "V9", detail: `undeclared namespace ${u}` });

  // V1 every sensor wait has a timeout companion
  for (const [k, b] of Object.entries(B)) {
    if (b.opcode !== "control_repeat_until" && b.opcode !== "control_wait_until") continue;
    const cond = (b.inputs.CONDITION as any[])?.[1];
    let hasTimer = false;
    const scan = (x: string, d = 0) => {
      if (!B[x] || d > 12 || hasTimer) return;
      if (B[x].opcode === "flippersensors_timer") { hasTimer = true; return; }
      for (const iv of Object.values(B[x].inputs)) {
        const r = (iv as any[])[1];
        if (typeof r === "string") scan(r, d + 1);
      }
    };
    if (typeof cond === "string") scan(cond);
    if (!hasTimer) f.push({ check: "V1", detail: `${b.opcode} ${k} has no timeout in its condition` });
  }

  // V10 technique conformance. The T3 speed floor was written into the spec, built,
  // then silently deleted by an unrelated defect fix and survived a clean validator
  // run plus a visual review. A requirement with no assertion is a requirement that
  // can be removed without anything noticing.
  const opcodes = Object.values(B).map(b => b.opcode);
  const has = (op: string) => opcodes.includes(op);

  // T3: the proportional turn must clamp its output, or a small error commands a
  // speed too low to overcome static friction and the turn never settles.
  const clampGuards = Object.entries(B).filter(([k, b]) => {
    if (b.opcode !== "control_if") return false;
    const c = (b.inputs.CONDITION as any[])?.[1];
    if (typeof c !== "string" || !B[c]) return false;
    if (!["operator_lt", "operator_gt"].includes(B[c].opcode)) return false;
    const lhs = (B[c].inputs.OPERAND1 as any[])?.[1];
    return typeof lhs === "string" && B[lhs]?.opcode === "data_variable"
      && B[lhs].fields.VARIABLE?.[0] === "_mag";
  });
  if (clampGuards.length < 2) {
    f.push({ check: "V10", detail: `T3 needs a floor and a cap on turn power; found ${clampGuards.length} clamp guard(s)` });
  }

  // T3b: the speed floor must sit INSIDE the out-of-tolerance branch. Applied
  // unconditionally it commands 15 percent at a robot that has already arrived,
  // knocking it back out of tolerance and resetting the settle counter, so the turn
  // oscillates until the timeout instead of finishing.
  for (const [k, b] of Object.entries(B)) {
    if (b.opcode !== "control_if") continue;
    const c = (b.inputs.CONDITION as any[])?.[1];
    if (typeof c !== "string" || !B[c]) continue;
    const lhs = (B[c].inputs.OPERAND1 as any[])?.[1];
    if (typeof lhs !== "string" || B[lhs]?.fields?.VARIABLE?.[0] !== "_mag") continue;
    // Only the turn's floor applies. The straight-drive correction clamp also reads
    // _mag and is unconditional by design, so identify the guard by what it WRITES.
    const arm = (b.inputs.SUBSTACK as any[])?.[1];
    const writesPwr = (x: any): boolean => {
      if (typeof x !== "string" || !B[x]) return false;
      if (B[x].fields?.VARIABLE?.[0] === "_pwr") return true;
      for (const nm of ["SUBSTACK", "SUBSTACK2"]) {
        if (writesPwr((B[x].inputs[nm] as any[])?.[1])) return true;
      }
      return writesPwr(B[x].next);
    };
    if (!writesPwr(arm)) continue;
    // walk up: this guard must be reachable only from a SUBSTACK2 (the else arm)
    let cur: string | null = k, hops = 0, guarded = false;
    while (cur && hops++ < 40) {
      const owner: string | undefined = Object.keys(B).find(x =>
        (B[x].inputs.SUBSTACK2 as any[])?.[1] === cur || (B[x].inputs.SUBSTACK as any[])?.[1] === cur);
      if (owner) {
        if ((B[owner].inputs.SUBSTACK2 as any[])?.[1] === cur && B[owner].opcode === "control_if_else") {
          guarded = true; break;
        }
        cur = owner;
      } else {
        cur = Object.keys(B).find(x => B[x].next === cur) ?? null;
      }
    }
    if (!guarded) f.push({ check: "V10", detail: "T3 speed floor is not inside the out-of-tolerance branch" });
  }

  // T13: every yaw reset must be followed by a settling wait, or the next heading
  // read can return the pre-reset value.
  for (const [k, b] of Object.entries(B)) {
    if (b.opcode !== "flippersensors_resetYaw") continue;
    if (!b.next || B[b.next].opcode !== "control_wait") {
      f.push({ check: "V10", detail: "T13 yaw reset not followed by a settling wait" });
    }
  }

  // T5: distance must be measured from both drive motors, since heading correction
  // makes the two sides travel different distances.
  const posReads = opcodes.filter(o => o === "flippermoremotor_position").length;
  const zeroes = opcodes.filter(o => o === "flippermoremotor_motorSetDegreeCounted").length;
  if (posReads % 2 !== 0 || posReads === 0) {
    f.push({ check: "V10", detail: `T5 position reads should pair across both motors; found ${posReads}` });
  }
  if (zeroes % 2 !== 0) {
    f.push({ check: "V10", detail: `T5 relative-position resets should pair across both motors; found ${zeroes}` });
  }

  // V11: generated stacks must not overlap. Readability is a stated requirement and
  // an overlapping workspace also makes the output impossible to audit by eye.
  for (const o2 of overlaps(B)) f.push({ check: "V11", detail: o2 });

  // T14: the preamble must set the movement pair and stop method.
  if (!has("flippermove_setMovementPair")) f.push({ check: "V10", detail: "T14 preamble missing movement pair" });
  if (!has("flippermoremove_movementSetStopMethod")) f.push({ check: "V10", detail: "T14 preamble missing stop method" });

  return f;
}

// ================================================== V8 CONTAINER ROUND TRIP
//
// V8 opens the bytes pack() just produced, reads the inner project.json back
// out of them, and holds the result against `_meta.container` in
// FLL_VERIFIED_SHAPES.json field by field.
//
// IT READS THE ZIP RATHER THAN THE VALUES THAT WENT INTO IT, which is the whole
// point: every other check reasons over the objects the emitter is still
// holding, so an emitter that assembles the manifest correctly and then packs
// it wrong passes all of them. The SPIKE App refuses a malformed project whole,
// with no diagnostic and no partial render, so "the zip opens" is not an
// assumption anything here is entitled to make.
//
// THE REFERENCE IS PROVENANCE A: `_meta.container` records what the app ITSELF
// wrote. Comparing pack() against it compares the emitter to the app. Comparing
// it against constants restated here would compare the emitter to itself, which
// is the failure the registry exists to prevent.

/** ZIP's two compression methods, as the container block names them. */
const ZIP_METHOD: Record<string, number> = { STORED: 0, DEFLATED: 8 };

/**
 * Entry name to compression method, read off the central directory.
 *
 * fflate hands back decompressed bytes and forgets HOW each entry was stored,
 * and three of the container block's fields are about exactly that, so the
 * directory is walked here. It is walked from the end-of-central-directory
 * record rather than by scanning for the 0x02014b50 signature: that signature
 * turns up inside compressed data often enough to invent entries.
 */
function entryMethods(zip: Uint8Array): Map<string, number> {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("no end-of-central-directory record");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map<string, number>();
  for (let k = 0; k < count; k++) {
    if (p + 46 > zip.length || dv.getUint32(p, true) !== 0x02014b50) {
      throw new Error("the central directory is malformed");
    }
    const nlen = dv.getUint16(p + 28, true);
    out.set(strFromU8(zip.subarray(p + 46, p + 46 + nlen)), dv.getUint16(p + 10, true));
    p += 46 + nlen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  return out;
}

export interface ContainerReport {
  findings: Finding[];
  /**
   * Manifest fields the container block makes no statement about, by name.
   *
   * REPORTED RATHER THAN SILENTLY ACCEPTED, AND NOT AS A FINDING, because the
   * two say different things. A finding says the PROJECT is wrong; this says
   * the REGISTRY has never been asked about a field, which is a gap in the
   * evidence and not a defect in the file. Making it a finding would withhold
   * every project this emitter has ever produced over sixteen fields nobody has
   * observed yet; dropping it would let a field enter the manifest with nothing
   * in the world vouching for it. So it is NAMED, and closing the gap means
   * watching the app write those fields and recording them in `_meta.container`
   * as `manifest_<field>`, never reasoning about them here.
   */
  unpinned: string[];
}

/**
 * A registry that cannot answer V8, THROWN rather than returned, for the same
 * reason assertRegistryUsable throws: a container block that is not there is a
 * statement about the validator, not about the file being validated.
 *
 * Separate from `empty` because the two fail differently. An empty registry
 * means nothing at all is known; a registry full of shapes with no container
 * block means somebody kept the shapes and dropped the reference V8 compares
 * against, and V9 would go on answering confidently the whole time.
 *
 * Takes the registry as a parameter so the guard can be tested on one, which is
 * the whole difference between a control and a comment.
 */
export function assertContainerUsable(reg: unknown): void {
  assertRegistryUsable(reg);
  const ref = (reg as { _meta?: { container?: ContainerRef } })?._meta?.container;
  if (!ref?.outer || !ref?.inner) {
    throw new RegistryFault(
      'no-container',
      'FLL_VERIFIED_SHAPES.json carries shapes but no _meta.container block. V8 has ' +
        'nothing to compare a packed .llsp3 against, so the round trip cannot be run ' +
        'and no project may be handed over.'
    );
  }
}

/** The container block, or the reason the validator cannot answer at all. */
function containerRef(): ContainerRef {
  assertContainerUsable(registry);
  return (registry as RegistryShape)._meta.container;
}

/**
 * Open a packed .llsp3 and hold it against the container block.
 *
 * EVERY field of that block is consumed here, including the two that grant
 * permission rather than impose a requirement (`sounds_required` and
 * `icon_svg_may_be_stub`): a field nobody reads is a field the registry can
 * change without anything noticing.
 */
export function verifyContainer(bytes: Uint8Array): ContainerReport {
  const ref = containerRef();
  const f: Finding[] = [];
  const bad = (detail: string) => f.push({ check: "V8", detail });
  const stub = `${ref.stub_asset_id}.svg`;

  let outer: Record<string, Uint8Array>;
  let outerMethods: Map<string, number>;
  try {
    outer = unzipSync(bytes);
    outerMethods = entryMethods(bytes);
  } catch (err) {
    // V8's first clause is "the zip opens". A container that does not is a
    // FINDING, not an exception: the caller is asking whether this file is safe
    // to hand to a child, and the answer is no.
    bad(`the .llsp3 did not open: ${(err as Error).message}`);
    return { findings: f, unpinned: [] };
  }

  const outerNames = Object.keys(outer);
  if (outerNames.join("|") !== ref.outer.entries.join("|")) {
    bad(`outer entries are ${JSON.stringify(outerNames)}, registry says ${JSON.stringify(ref.outer.entries)}`);
  }
  const wantOuter = ZIP_METHOD[ref.outer.compression];
  for (const [name, method] of outerMethods) {
    if (method !== wantOuter) {
      bad(`outer entry ${name} is compression method ${method}, registry says ${ref.outer.compression}`);
    }
  }

  // The manifest, field by field, DRIVEN BY THE REGISTRY rather than by a list
  // restated here: every `manifest_<field>` key in the container block is one
  // assertion, so a field observed later is enforced without touching this code.
  let manifest: Record<string, unknown> = {};
  const unpinned: string[] = [];
  if (!outer["manifest.json"]) {
    bad("there is no manifest.json in the container");
  } else {
    try {
      manifest = JSON.parse(strFromU8(outer["manifest.json"])) as Record<string, unknown>;
    } catch (err) {
      bad(`manifest.json is not JSON: ${(err as Error).message}`);
    }
    const pins = Object.entries(ref as unknown as Record<string, unknown>)
      .filter(([k]) => k.startsWith("manifest_"))
      .map(([k, v]) => [k.slice("manifest_".length), v] as const);
    for (const [field, want] of pins) {
      if (manifest[field] !== want) {
        bad(`manifest ${field} is ${JSON.stringify(manifest[field])}, registry says ${JSON.stringify(want)}`);
      }
    }
    const pinned = new Set(pins.map(([field]) => field));
    unpinned.push(...Object.keys(manifest).filter((k) => !pinned.has(k)).sort());
  }

  // The inner sb3, and the project.json read back out of it.
  const sb3 = outer["scratch.sb3"];
  if (!sb3) {
    bad("there is no scratch.sb3 in the container");
    return { findings: f, unpinned };
  }
  let inner: Record<string, Uint8Array>;
  let innerMethods: Map<string, number>;
  try {
    inner = unzipSync(sb3);
    innerMethods = entryMethods(sb3);
  } catch (err) {
    bad(`scratch.sb3 did not open: ${(err as Error).message}`);
    return { findings: f, unpinned };
  }

  const wantInner = ref.inner.entries.map((e) => (e === "<stub>.svg" ? stub : e));
  const innerNames = Object.keys(inner);
  if (innerNames.join("|") !== wantInner.join("|")) {
    bad(`inner entries are ${JSON.stringify(innerNames)}, registry says ${JSON.stringify(wantInner)}`);
  }
  for (const [name, method] of innerMethods) {
    const label = name === "project.json" ? ref.inner.project_json : ref.inner.assets;
    if (method !== ZIP_METHOD[label]) {
      bad(`inner entry ${name} is compression method ${method}, registry says ${label}`);
    }
  }
  if (!inner[stub]) {
    bad(`the stub asset ${stub} is not in scratch.sb3`);
  } else if (inner[stub].length !== ref.stub_asset_bytes) {
    bad(`the stub asset is ${inner[stub].length} bytes, registry says ${ref.stub_asset_bytes}`);
  }

  if (!inner["project.json"]) {
    bad("there is no project.json in scratch.sb3");
    return { findings: f, unpinned };
  }
  let project: {
    meta?: { vm?: unknown };
    targets?: { sounds?: unknown[]; costumes?: { assetId?: unknown; md5ext?: unknown }[] }[];
  };
  try {
    project = JSON.parse(strFromU8(inner["project.json"]));
  } catch (err) {
    bad(`project.json did not parse back: ${(err as Error).message}`);
    return { findings: f, unpinned };
  }

  if (project.meta?.vm !== ref.meta_vm) {
    bad(`project.json meta.vm is ${JSON.stringify(project.meta?.vm)}, registry says ${JSON.stringify(ref.meta_vm)}`);
  }
  for (const t of project.targets ?? []) {
    for (const c of t.costumes ?? []) {
      if (c.assetId !== ref.stub_asset_id || c.md5ext !== stub) {
        bad(`a costume points at ${JSON.stringify(c.md5ext)}, the registry's stub asset is ${stub}`);
      }
    }
    // sounds_required is false, so an empty array is legal and a MISSING one is
    // not: the app writes the key either way.
    if (!ref.sounds_required && !Array.isArray(t.sounds)) {
      bad("a target has no sounds array; the registry permits it to be empty, not absent");
    }
  }
  // icon_svg_may_be_stub is true, so the icon's CONTENT is not asserted. Its
  // presence among the outer entries, checked above, is.
  if (!ref.icon_svg_may_be_stub && outer["icon.svg"] && outer["icon.svg"].length === 0) {
    bad("icon.svg is a stub and the registry no longer permits one");
  }

  return { findings: f, unpinned };
}

import { zipSync, strToU8 } from "fflate";
import registry from "../../../docs/FLL_VERIFIED_SHAPES.json";
import type { Blocks } from "./blocks.js";
import { overlaps } from "./layout.js";

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
    [`${STUB}.svg`]: new Uint8Array(0),
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

/** The two parts of FLL_VERIFIED_SHAPES.json that validate() reads. */
interface RegistryShape {
  shapes: Record<string, unknown>;
  _meta: { namespaces: { NOT_IN_THIS_APP: { namespaces: string[] } } };
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
export type RegistryFaultCode = 'placeholder' | 'empty';

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

export function validate(o: PackOpts): Finding[] {
  assertRegistryUsable(registry);
  const reg = registry as RegistryShape;
  const known: Set<string> = new Set(Object.keys(reg.shapes));
  const banned: Set<string> = new Set(reg._meta.namespaces.NOT_IN_THIS_APP.namespaces);
  const f: Finding[] = [];
  const B = o.blocks;

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

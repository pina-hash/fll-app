// Block construction for SPIKE App 3 word-block projects.
// Every shape here is in FLL_VERIFIED_SHAPES.json. Nothing else may be added
// without a verified entry: the SPIKE App refuses the whole file on a bad shape
// and gives no indication which block is at fault.

export type Field = [string, string | null];
export type InputVal = any[];

export interface Block {
  opcode: string;
  next: string | null;
  parent: string | null;
  inputs: Record<string, InputVal>;
  fields: Record<string, Field>;
  shadow: boolean;
  topLevel: boolean;
  x?: number;
  y?: number;
  mutation?: Record<string, any>;
}

export type Blocks = Record<string, Block>;

let counter = 0;
export function resetIds() { counter = 0; }
export function id(tag = "b"): string {
  counter += 1;
  return (`${tag}${String(counter).padStart(5, "0")}` + "zzzzzzzzzzzzzzzzzzzz").slice(0, 20);
}

/** Numeric literal as an inline primitive. Verified: Project_1 export. */
export const n = (v: number | string): InputVal => [1, [4, String(v)]];
/** Text literal as an inline primitive. */
export const s = (v: string): InputVal => [1, [10, String(v)]];
/** A reporter obscuring an inline literal. Verified type 3: Probe A/D. */
export const rep = (blockId: string, fallback = "0"): InputVal => [3, blockId, [4, fallback]];
/** A boolean block in a boolean slot. Verified: Probe D/R1. */
export const bool = (blockId: string): InputVal => [2, blockId];
/** A stack in a SUBSTACK slot. Verified: Probe D/R5. */
export const stack = (blockId: string): InputVal => [2, blockId];

export class Builder {
  blocks: Blocks = {};
  variables: Record<string, [string, number]> = {};

  /** Toolkit variables are prefixed so they cannot collide with student names. */
  variable(name: string): [string, string] {
    const vid = `tk_${name}`;
    if (!this.variables[vid]) this.variables[vid] = [`_${name}`, 0];
    return [`_${name}`, vid];
  }

  add(opcode: string, opts: Partial<Block> = {}, tag = "b"): string {
    const k = id(tag);
    this.blocks[k] = {
      opcode, next: null, parent: null,
      inputs: opts.inputs ?? {}, fields: opts.fields ?? {},
      shadow: opts.shadow ?? false, topLevel: opts.topLevel ?? false,
      ...(opts.x !== undefined ? { x: opts.x, y: opts.y } : {}),
      ...(opts.mutation ? { mutation: opts.mutation } : {}),
    };
    return k;
  }

  /** Shadow pattern 1: <ns>_<name>-selector | <ns>_custom-<name>, field_<opcode>. */
  selector(opcode: string, value: string): string {
    return this.add(opcode, { fields: { [`field_${opcode}`]: [value, null] }, shadow: true }, "s");
  }

  /** Shadow pattern 2: <ns>_menu_<NAME>, field named <NAME>. Verified: Probe B. */
  menu(opcode: string, fieldName: string, value: string): string {
    return this.add(opcode, { fields: { [fieldName]: [value, null] }, shadow: true }, "m");
  }

  /** Variable reporter. */
  varRead(name: string): string {
    const [n_, vid] = this.variable(name);
    return this.add("data_variable", { fields: { VARIABLE: [n_, vid] } }, "v");
  }

  varSet(name: string, value: InputVal): string {
    const [n_, vid] = this.variable(name);
    return this.add("data_setvariableto", { inputs: { VALUE: value }, fields: { VARIABLE: [n_, vid] } }, "sv");
  }

  varChange(name: string, value: InputVal): string {
    const [n_, vid] = this.variable(name);
    return this.add("data_changevariableby", { inputs: { VALUE: value }, fields: { VARIABLE: [n_, vid] } }, "cv");
  }

  /** My Block parameter reporter. Verified: Probe A/D. */
  arg(name: string): string {
    return this.add("argument_reporter_string_number", { fields: { VALUE: [name, null] } }, "a");
  }

  op(opcode: string, inputs: Record<string, InputVal>, fields: Record<string, Field> = {}): string {
    return this.add(opcode, { inputs, fields }, "o");
  }

  /** Link a sequence of blocks head -> ...seq. Returns the last block id. */
  chain(head: string, seq: string[]): string {
    let prev = head;
    for (const b of seq) { this.blocks[prev].next = b; prev = b; }
    return prev;
  }

  /**
   * Derive every parent link from structure, and compute the extensions array.
   * Parent tracked by hand drifts; parent derived from ownership cannot.
   * Established when hand-tracked parents produced three reporters whose parent
   * disagreed with the input holding them, in an otherwise well-formed file.
   */
  normalize(): string[] {
    for (const [k, b] of Object.entries(this.blocks)) {
      for (const iv of Object.values(b.inputs)) {
        if (Array.isArray(iv) && typeof iv[1] === "string") this.blocks[iv[1]].parent = k;
      }
      if (b.next) this.blocks[b.next].parent = k;
    }
    for (const b of Object.values(this.blocks)) if (b.topLevel) b.parent = null;
    const used = new Set<string>();
    for (const b of Object.values(this.blocks)) {
      const ns = b.opcode.split("_")[0];
      if (ns.startsWith("flipper")) used.add(ns);
    }
    return [...used].sort();
  }
}

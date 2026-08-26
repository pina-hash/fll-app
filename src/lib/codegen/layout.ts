// Layout for generated projects.
//
// Readability is a requirement, not a nicety: the explainability case rests on a
// student being able to open the output and read it, and a judge being shown it.
// Hand-guessed y offsets overlapped as soon as a stack grew, which made the
// toolkit unreadable and, incidentally, made auditing the output impossible.
// Stack extent is therefore measured, never estimated by eye.

import type { Blocks } from "./blocks.js";

// Calibrated 2026-08-25 against a render measured at scale 0.315. The first values
// ran 5 to 8 percent short on every stack containing a C-block.
const BLOCK_H = 52;
const CWRAP_H = 56;      // a C-block's mouth costs more than a statement's height
const COL_GAP = 200;
const ROW_GAP = 320;     // empty canvas is free; overlap is not
const LABEL_W = 150;     // a statement block's own label text
const REP_W = 105;        // a reporter's own label and chrome
const LITERAL_W = 62;     // an inline number or text slot

/**
 * Width of a block row, summing operands rather than taking nesting depth.
 *
 * The first model multiplied depth by a constant. It underestimated by roughly a
 * third, because a row grows with the BREADTH of its operand tree, not its depth:
 * `a < b and c < d or timer > n` is shallow and very wide. V11 passed on those
 * numbers while the rendered file plainly overlapped, which is the failure mode
 * worth naming: a check reasoning over a wrong model returns confident and wrong.
 */
function rowWidth(B: Blocks, k: string, depth = 0): number {
  if (!B[k] || depth > 24) return REP_W;
  const isStatement = depth === 0;
  let w = isStatement ? LABEL_W : REP_W;
  for (const [nm, iv] of Object.entries(B[k].inputs)) {
    if (nm === "SUBSTACK" || nm === "SUBSTACK2" || nm === "custom_block") continue;
    const r = (iv as any[])[1];
    w += typeof r === "string" ? rowWidth(B, r, depth + 1) : LITERAL_W;
  }
  return w;
}

/** Height and width of the stack rooted at a top-level block. */
export function measure(B: Blocks, root: string): { h: number; w: number } {
  let h = 0, w = 0, cur: string | null = root;
  while (cur && B[cur]) {
    h += BLOCK_H;
    w = Math.max(w, rowWidth(B, cur));
    for (const nm of ["SUBSTACK", "SUBSTACK2"]) {
      const sub = (B[cur].inputs[nm] as any[])?.[1];
      if (typeof sub === "string") {
        const m = measure(B, sub);
        h += m.h + CWRAP_H;
        w = Math.max(w, m.w + 40);   // substack indent
      }
    }
    cur = B[cur].next;
  }
  // Both models estimate what the app's renderer does; neither can be validated
  // from here. Margins cost empty canvas. Being short costs an overlapping,
  // unreadable, unauditable file.
  return { h: Math.round(h * 1.2), w: Math.round(w * 1.15) };
}

/**
 * Place every top-level stack in a single column, in definition order.
 *
 * Multi-column packing was tried and abandoned for two reasons. Filling the
 * shortest column scrambles reading order: it exiled TURN TO, the second block
 * anyone needs, to a column three thousand units off screen. And column width
 * depends on the width model, which cannot be validated from here, so every
 * layout bug became a width-estimate bug.
 *
 * One column removes the dependency rather than tuning it. Vertical scrolling is
 * the natural gesture, definition order is preserved, and horizontal overlap is
 * not merely unlikely but impossible.
 */
export function layout(B: Blocks, columns = 1, originX = 40, originY = 40): number {
  const roots = Object.keys(B).filter(k => B[k].topLevel);
  if (!roots.length) return 0;
  const sized = roots.map(k => ({ k, ...measure(B, k) }));
  const widest = Math.max(...sized.map(s => s.w));
  // A stack wider than a sane canvas gets its own column rather than being packed
  // beside another. Columns are sized to the widest stack, never to an average.
  if (widest > 2200) columns = Math.min(columns, 2);
  if (widest > 3400) columns = 1;
  const colW = widest + COL_GAP;
  const colY = new Array(columns).fill(originY);

  for (const s of sized) {
    let c = 0;
    for (let i = 1; i < columns; i++) if (colY[i] < colY[c]) c = i;
    B[s.k].x = originX + c * colW;
    B[s.k].y = colY[c];
    colY[c] += s.h + ROW_GAP;
  }
  return columns;
}

/** V11: no two top-level stacks may overlap. */
export function overlaps(B: Blocks): string[] {
  const boxes = Object.keys(B).filter(k => B[k].topLevel).map(k => {
    const m = measure(B, k);
    return { k, x: B[k].x ?? 0, y: B[k].y ?? 0, w: m.w, h: m.h };
  });
  const hits: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
        hits.push(`${a.k} overlaps ${b.k}`);
      }
    }
  }
  return hits;
}

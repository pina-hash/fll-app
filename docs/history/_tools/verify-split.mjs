#!/usr/bin/env node
// The control for the 2026-09-02 split of `docs/HISTORY.md`.
//
// It reassembles every `record_order`-carrying file in `docs/history/`, in
// order, from the bytes that follow each file's front matter (with each
// entry's `## <title>` heading synthesized back in), and compares the result
// against the record body as it stood immediately before the split. It must
// be byte-identical: the split added front matter and nothing else.
//
// The reference is pinned two ways, because either can be unavailable:
//   * REFERENCE_COMMIT -- read with `git show`, which gives a real diff on
//     failure. Absent from a shallow clone that does not reach that commit
//     (a CI checkout is shallow, so that leg is normally unavailable there).
//   * REFERENCE_SHA256 -- always checkable, but only ever answers yes or no.
// A run that can do neither reports that it verified nothing, and exits 1.
//
// An entry's `## <title>` heading is DERIVED, not stored: the body on disk
// starts directly at the first real content, and `title` in front matter is
// the one copy of that sentence. idea-app learned that the hard way (a
// retyped heading drifted from its title three times before its
// `derive-headings.mjs` removed the second copy); this split never wrote one.
//
// Ported from idea-app's `docs/history/_tools/verify-split.mjs` with this
// repo's constants. Run: npm run history:verify

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readEntries } from './front-matter.mjs';

// The last commit on `main` that carried the whole record in one file.
const REFERENCE_COMMIT = '0f2e3fa408721ca06c29f6b666042d5cbcc916b9';
const REFERENCE_PATH = 'docs/HISTORY.md';
const REFERENCE_FIRST_HEADING = '## 2026-08-22 -- Foundation: scaffold, schema 0001-0008, RLS, both auth paths';
const REFERENCE_SHA256 = 'c8dade45731fc381a8d850f7c2554be3f6804f0929ef75e9d5e3dd9beefd4274';
const REFERENCE_BYTES = 281921;
const REFERENCE_ENTRIES = 27;

const problems = [];
const fail = (msg) => problems.push(msg);

const entries = readEntries();
const record = entries.filter((e) => Number.isInteger(e.record_order));

// --- structural checks the reassembly cannot make on its own ----------------

const seen = new Map();
for (const e of entries) {
	if (seen.has(e.file)) fail(`duplicate filename: ${e.file}`);
	seen.set(e.file, e);
	if (e.body.startsWith('## ')) {
		fail(`${e.file}: body opens with a ## heading. The heading is derived from the front-matter title; remove the retyped line.`);
	}
	if (!e.title) fail(`${e.file}: no title in front matter`);
	if (!e.date || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) fail(`${e.file}: date is missing or not YYYY-MM-DD`);
	if (!e.file.startsWith('record-') && Number.isInteger(e.record_order)) {
		fail(`${e.file}: carries record_order but is not a pre-split archive file. record_order belongs only to the ${REFERENCE_ENTRIES} entries the split produced.`);
	}
	if (e.file.startsWith('record-') && !Number.isInteger(e.record_order)) {
		fail(`${e.file}: uses the reserved record- prefix without a record_order.`);
	}
	if (/[\u2014\u2013]/.test(e.body) || /[\u2014\u2013]/.test(e.title)) {
		fail(`${e.file}: contains an em dash or an en dash (CLAUDE.md, Writing).`);
	}
}

record.sort((a, b) => a.record_order - b.record_order);
record.forEach((e, i) => {
	if (e.record_order !== i + 1) fail(`record_order is not 1..N contiguous: expected ${i + 1}, found ${e.record_order} (${e.file})`);
});
if (record.length !== REFERENCE_ENTRIES) {
	fail(`entry count moved: the split produced ${REFERENCE_ENTRIES} archive entries, found ${record.length}`);
}

// --- the reassembly ---------------------------------------------------------

const rebuilt = record.map((e) => `## ${e.title}\n\n${e.body}`).join('');
const rebuiltBytes = Buffer.byteLength(rebuilt, 'utf8');
const rebuiltSha = createHash('sha256').update(rebuilt, 'utf8').digest('hex');

console.log(`entries reassembled : ${record.length} (expected ${REFERENCE_ENTRIES})`);
console.log(`reassembled bytes   : ${rebuiltBytes} (expected ${REFERENCE_BYTES})`);
console.log(`reassembled sha256  : ${rebuiltSha}`);
console.log(`reference sha256    : ${REFERENCE_SHA256}`);

let checkedAgainstGit = false;
try {
	const ref = execFileSync('git', ['show', `${REFERENCE_COMMIT}:${REFERENCE_PATH}`], {
		encoding: 'utf8',
		maxBuffer: 1 << 28
	});
	const at = ref.indexOf(REFERENCE_FIRST_HEADING);
	if (at < 0) throw new Error(`${REFERENCE_FIRST_HEADING} not found in the reference`);
	const body = ref.slice(at);
	checkedAgainstGit = true;
	if (body === rebuilt) {
		console.log(`git byte compare    : IDENTICAL against ${REFERENCE_COMMIT.slice(0, 10)}:${REFERENCE_PATH}`);
	} else {
		const a = join(tmpdir(), 'history-reference.md');
		const b = join(tmpdir(), 'history-reassembled.md');
		writeFileSync(a, body);
		writeFileSync(b, rebuilt);
		fail(`reassembly differs from ${REFERENCE_COMMIT}:${REFERENCE_PATH}. Wrote ${a} and ${b}; diff them.`);
	}
} catch (err) {
	if (!checkedAgainstGit) {
		console.log(`git byte compare    : unavailable (${String(err.message).split('\n')[0]})`);
	}
}

const shaOk = rebuiltSha === REFERENCE_SHA256;
console.log(`sha256 compare      : ${shaOk ? 'IDENTICAL' : 'DIFFERENT'}`);
if (!shaOk) fail('reassembled sha256 does not match the pinned pre-split body.');

if (!checkedAgainstGit && !shaOk) fail('neither reference was reachable: this run verified nothing.');

if (problems.length) {
	console.error('\nFAILED:');
	for (const p of problems) console.error(`  - ${p}`);
	process.exit(1);
}
console.log('\nOK: the split is lossless. Every byte of the pre-split record body is present, in order.');

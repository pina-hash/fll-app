// A PLACEHOLDER REGISTRY MUST NEVER SHIP QUIETLY AGAIN.
//
// It already did once. docs/FLL_VERIFIED_SHAPES.json went out with an empty
// shapes map, and the only symptom was V9 rejecting all 374 blocks of the
// toolkit: a report that reads exactly like an emitter which has broken, with
// the actual cause (nobody had put the registry in yet) named nowhere in it.
// The generator was fail-closed, which was correct, and completely unhelpful
// about why.
//
// These cases are the guard for that, and they run in every suite.

import { expect, test } from 'vitest';
import registry from '../../../../docs/FLL_VERIFIED_SHAPES.json';
import { RegistryFault, assertRegistryUsable } from '../package.js';

const shipped = registry as unknown as {
	_meta: { placeholder?: boolean; namespaces: { NOT_IN_THIS_APP: { namespaces: string[] } } };
	shapes: Record<string, unknown>;
};

/**
 * The one that would have caught it. Not a skip, not a warning: a failure, in
 * the same run as everything else, naming the file and what is wrong with it.
 */
test('the shipped registry is the real one, not a placeholder', () => {
	expect(
		shipped._meta.placeholder,
		'docs/FLL_VERIFIED_SHAPES.json is flagged as a placeholder. Nothing this repo ' +
			'generates has been validated against real shapes.'
	).not.toBe(true);
	expect(Object.keys(shipped.shapes).length).toBeGreaterThan(0);
	expect(shipped._meta.namespaces.NOT_IN_THIS_APP.namespaces.length).toBeGreaterThan(0);
	// The one namespace whose absence is a proven whole-file refusal (Probe C).
	expect(shipped._meta.namespaces.NOT_IN_THIS_APP.namespaces).toContain('flipperdisplay');
});

test('every shipped shape carries its provenance and the probe that proved it', () => {
	const untagged = Object.entries(shipped.shapes).filter(([, v]) => {
		const shape = v as { provenance?: string; proof?: string; status?: string };
		return !['A', 'B'].includes(shape.provenance ?? '') || !shape.proof || shape.status !== 'verified';
	});
	// A shape with no provenance is a shape somebody reasoned their way into.
	expect(untagged.map(([k]) => k)).toEqual([]);
});

// --- the negative controls for the guard itself --------------------------

test('a placeholder registry is refused, and named as a placeholder', () => {
	const fault = catchFault(() =>
		assertRegistryUsable({ _meta: { placeholder: true }, shapes: {} })
	);
	expect(fault.code).toBe('placeholder');
	expect(fault.message).toMatch(/PLACEHOLDER/);
});

/**
 * The distinction that matters: a placeholder IS empty, so a guard that only
 * counted shapes would report both as "empty" and bury the reason a reader
 * needs. These two must not collapse into one another.
 */
test('an empty registry is refused too, and NOT reported as a placeholder', () => {
	const fault = catchFault(() => assertRegistryUsable({ _meta: {}, shapes: {} }));
	expect(fault.code).toBe('empty');
	expect(fault.message).not.toMatch(/PLACEHOLDER/);
	expect(fault.message).toMatch(/lost its contents/);
});

test('a placeholder that somehow carries shapes is still refused as a placeholder', () => {
	// placeholder wins over the shape count, because the flag is a statement
	// about the file's authority and the count is only about its size.
	const fault = catchFault(() =>
		assertRegistryUsable({ _meta: { placeholder: true }, shapes: { flippermove_stopMove: {} } })
	);
	expect(fault.code).toBe('placeholder');
});

// --- the positive control: the real thing must pass silently -------------

test('the shipped registry passes the guard without complaint', () => {
	expect(() => assertRegistryUsable(shipped)).not.toThrow();
});

function catchFault(fn: () => void): RegistryFault {
	try {
		fn();
	} catch (err) {
		if (err instanceof RegistryFault) return err;
		throw err;
	}
	throw new Error('assertRegistryUsable accepted a registry it must refuse.');
}

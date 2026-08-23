// tests/student-identity.test.ts
//
// The pure client-side half of the student identity. The database half is
// held to it in tests/login-roster.test.ts.

import { describe, expect, test } from 'vitest';
import {
	JOIN_CODE_ALPHABET,
	displayName,
	isValidJoinCode,
	isValidPin,
	isValidSlug,
	normalizeJoinCode,
	slugBase,
	studentEmail
} from '../src/lib/auth/student-identity';

describe('join codes', () => {
	test('the alphabet has 32 symbols and none of O, 0, I, 1', () => {
		expect(JOIN_CODE_ALPHABET).toHaveLength(32);
		expect(new Set(JOIN_CODE_ALPHABET).size).toBe(32);
		for (const bad of ['O', '0', 'I', '1']) expect(JOIN_CODE_ALPHABET).not.toContain(bad);
	});

	test('normalize trims and upper-cases; validate accepts exactly six alphabet symbols', () => {
		expect(normalizeJoinCode('  ar6x2y ')).toBe('AR6X2Y');
		expect(isValidJoinCode('ar6x2y')).toBe(true);
		expect(isValidJoinCode('AR6X2')).toBe(false);
		expect(isValidJoinCode('AR6X2YZ')).toBe(false);
		expect(isValidJoinCode('AR0X2Y')).toBe(false);
		expect(isValidJoinCode('ARIX2Y')).toBe(false);
		expect(isValidJoinCode('AR1X2Y')).toBe(false);
		expect(isValidJoinCode('AROX2Y')).toBe(false);
	});
});

describe('pins and slugs', () => {
	test('a PIN is exactly six digits', () => {
		expect(isValidPin('123456')).toBe(true);
		expect(isValidPin('12345')).toBe(false);
		expect(isValidPin('1234567')).toBe(false);
		expect(isValidPin('12345a')).toBe(false);
		expect(isValidPin(' 123456')).toBe(false);
	});

	test('slugBase lowercases, joins, and strips everything outside [a-z0-9]', () => {
		expect(slugBase('Alex', 'P')).toBe('alexp');
		expect(slugBase("  Mary-Jo ", 'k')).toBe('maryjok');
		expect(slugBase('José', 'R')).toBe('josr');
		expect(slugBase('!!!', '?')).toBe('');
		expect(isValidSlug('alexp2')).toBe(true);
		expect(isValidSlug('Alex')).toBe(false);
		expect(isValidSlug('')).toBe(false);
	});
});

describe('the address', () => {
	test('lowercased code, dash, slug, @fll.invalid', () => {
		expect(studentEmail('AR6X2Y', 'alexp')).toBe('ar6x2y-alexp@fll.invalid');
		expect(studentEmail(' ar6x2y ', 'alexp2')).toBe('ar6x2y-alexp2@fll.invalid');
	});

	test('displayName is "First L."', () => {
		expect(displayName('Alex', 'P')).toBe('Alex P.');
	});
});

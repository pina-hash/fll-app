// tests/student-role-projection.test.ts
//
// COVERING IS THE SENTENCE THE STUDENT SCREEN EXISTS TO SAY. A kid who is the
// second, and who does not know the primary is out today, will not do the job.
// `myRoleFrom` is the projection of `team_resolve_roles` onto one student that
// decides whether that sentence appears, so it is tested on its own, without a
// database, over every shape the resolver can return.
//
// It is a PROJECTION, not a second copy of the rule: the resolver has already
// decided who is active. These tests assert the projection never invents an
// answer the resolver did not give.

import { describe, expect, test } from 'vitest';
import type { ResolvedRole } from '../src/lib/console/types';
import { myRoleFrom } from '../src/lib/student/types';

const ME = 'student-me';
const OTHER = 'student-other';

function row(over: Partial<ResolvedRole> = {}): ResolvedRole {
	return {
		role: 'lead_builder',
		primary_student_id: null,
		primary_name: null,
		primary_present: false,
		second_student_id: null,
		second_name: null,
		second_present: false,
		active_student_id: null,
		active_tier: null,
		active_name: null,
		unfilled: true,
		has_second: false,
		...over
	};
}

describe('myRoleFrom', () => {
	test('nobody assigned anywhere: no role, and no invented one', () => {
		expect(myRoleFrom([row(), row({ role: 'run_captain' })], ME)).toBeNull();
	});

	test('I am the primary and I am here: I hold it, not covering', () => {
		const rows = [
			row({
				primary_student_id: ME,
				primary_name: 'Me M.',
				primary_present: true,
				active_student_id: ME,
				active_tier: 'primary',
				active_name: 'Me M.',
				unfilled: false
			})
		];
		expect(myRoleFrom(rows, ME)).toEqual({
			role: 'lead_builder',
			tier: 'primary',
			covering: false,
			primaryName: 'Me M.'
		});
	});

	test('I am the second, the primary is OUT: I am covering, and the primary is named', () => {
		const rows = [
			row({
				primary_student_id: OTHER,
				primary_name: 'Diego S.',
				primary_present: false,
				second_student_id: ME,
				second_name: 'Me M.',
				second_present: true,
				active_student_id: ME,
				active_tier: 'second',
				active_name: 'Me M.',
				unfilled: false,
				has_second: true
			})
		];
		expect(myRoleFrom(rows, ME)).toEqual({
			role: 'lead_builder',
			tier: 'second',
			covering: true,
			primaryName: 'Diego S.'
		});
	});

	test('I am the second and the primary IS here: I am the second, NOT covering', () => {
		// The distinction that matters: "you are the backup" must not read the
		// same as "the job is yours today".
		const rows = [
			row({
				primary_student_id: OTHER,
				primary_name: 'Diego S.',
				primary_present: true,
				second_student_id: ME,
				second_name: 'Me M.',
				second_present: true,
				active_student_id: OTHER,
				active_tier: 'primary',
				active_name: 'Diego S.',
				unfilled: false,
				has_second: true
			})
		];
		expect(myRoleFrom(rows, ME)).toEqual({
			role: 'lead_builder',
			tier: 'second',
			covering: false,
			primaryName: 'Diego S.'
		});
	});

	test('I am the primary but I have not checked in: still my job, not covering', () => {
		const rows = [
			row({
				primary_student_id: ME,
				primary_name: 'Me M.',
				primary_present: false
			})
		];
		expect(myRoleFrom(rows, ME)).toEqual({
			role: 'lead_builder',
			tier: 'primary',
			covering: false,
			primaryName: 'Me M.'
		});
	});

	test('the seat I am ACTIVELY holding wins over one I am only assigned to', () => {
		// Assigned as the second on Lead Builder (primary present, so not mine
		// today) and actively covering Run Captain. The screen must show the one
		// I am actually doing.
		const rows = [
			row({
				role: 'lead_builder',
				primary_student_id: OTHER,
				primary_name: 'Diego S.',
				primary_present: true,
				second_student_id: ME,
				second_name: 'Me M.',
				active_student_id: OTHER,
				active_tier: 'primary',
				unfilled: false,
				has_second: true
			}),
			row({
				role: 'run_captain',
				primary_student_id: 'someone-away',
				primary_name: 'Lena T.',
				primary_present: false,
				second_student_id: ME,
				second_name: 'Me M.',
				second_present: true,
				active_student_id: ME,
				active_tier: 'second',
				active_name: 'Me M.',
				unfilled: false,
				has_second: true
			})
		];
		expect(myRoleFrom(rows, ME)).toEqual({
			role: 'run_captain',
			tier: 'second',
			covering: true,
			primaryName: 'Lena T.'
		});
	});

	test('somebody else holding every seat leaves me with no role', () => {
		const rows = [
			row({
				primary_student_id: OTHER,
				primary_name: 'Diego S.',
				primary_present: true,
				active_student_id: OTHER,
				active_tier: 'primary',
				unfilled: false
			})
		];
		expect(myRoleFrom(rows, ME)).toBeNull();
	});

	test('an empty resolver answer (another team, or no rows) is no role, not a crash', () => {
		expect(myRoleFrom([], ME)).toBeNull();
	});
});

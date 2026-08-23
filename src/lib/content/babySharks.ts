// ---------------------------------------------------------------------------
// BABY SHARKS COURSES -- three free PDF courses shared directly by FTC Team
// 33574, ported from fll-camp's src/state/resources.js. The FLL Coding Course
// is season content; Intro to Python and Basic Engineering are optional,
// clearly labeled non-FLL extras.
//
// `page` on each lesson row is the 1-based PDF page read from the PDF's own
// embedded outline, not guessed. It drives the `#page=N` fragment on the
// row's link and the visible "p. N" marker -- iOS Safari's PDF viewer ignores
// `#page=`, so the printed page number is what makes the jump reliable on an
// iPad. If a course PDF is ever revised, re-read the outline and update these.
// ---------------------------------------------------------------------------

import type { BabySharksCourse, BabySharksLessonRow, Resource } from './types';
import { RESOURCES } from './resources';

export const BABY_SHARKS_LESSON_INDEX: BabySharksLessonRow[] = [
	{ num: 'L1', title: 'Getting started with SPIKE Prime', page: 4, note: 'App setup, hub connection, block types' },
	{ num: 'L2', title: 'Basic movement', page: 9, note: 'Drive, two turning methods, rotations vs degrees' },
	{ num: 'L3', title: 'Loops', page: 12 },
	{ num: 'L4', title: 'Conditionals', page: 13 },
	{ num: 'L5', title: 'Sensors', page: 15, note: 'Color, distance, touch, gyro' },
	{ num: 'L5.5', title: 'Robot consistency', page: 19, note: 'Drift causes, hub placement' },
	{ num: 'L6', title: 'Variables', page: 19 },
	{ num: 'L7', title: 'Operators', page: 22 },
	{ num: 'L8', title: 'MyBlocks', page: 24, note: 'Custom blocks' },
	{ num: 'L8.5', title: 'Self-adjusting code', page: 26 },
	{
		num: 'L9',
		title: 'Gyro turn, line following, gyro straight',
		page: 27,
		note: 'The three core FLL codes -- troubleshooting pages at 28, 31 and 34'
	},
	{ num: 'L10', title: 'Lights and sounds', page: 39 },
	{ num: 'L11', title: 'Final project', page: 41, note: 'Autonomous obstacle avoidance, built in six steps' },
	{ num: 'L12', title: 'Conclusion', page: 43 },
	{ num: '*', title: 'Printable summary sheet', page: 51, note: 'One-page cheat sheet at the back of the course' }
];

/** Optional, not FLL season content. */
export const BABY_SHARKS_PYTHON_INDEX: BabySharksLessonRow[] = [
	{ num: 'L1', title: 'What is Programming?', page: 4, note: 'Algorithms, syntax, running Python in the browser' },
	{ num: 'L2', title: 'Variables and Data Types', page: 6 },
	{ num: 'L3', title: 'String Methods', page: 9 },
	{ num: 'L4', title: 'Input and Output', page: 11 },
	{ num: 'L5', title: 'Operators and Expressions', page: 13 },
	{ num: 'L6', title: 'Conditionals', page: 16 },
	{ num: 'L7', title: 'Loops', page: 18 },
	{ num: 'L8', title: 'Lists', page: 21 },
	{ num: 'L9', title: 'Dictionaries', page: 23 },
	{ num: 'L10', title: 'Functions', page: 25 },
	{ num: 'L11', title: 'Try/Except', page: 27 },
	{ num: 'L12', title: 'Combining Everything', page: 30 },
	{ num: 'L13', title: 'Final Project', page: 32 },
	{ num: 'L14', title: 'Conclusion', page: 34 }
];

/** Optional, not FLL season content. `num` is the course's own chapter-section
 *  numbering, not lesson numbers. */
export const BABY_SHARKS_ENGINEERING_INDEX: BabySharksLessonRow[] = [
	{ num: '1-1', title: 'The Engineering and Design Process', page: 4 },
	{ num: '1-2', title: 'EDP activities and practice', page: 6 },
	{ num: '2-1', title: 'What Is a Robot?', page: 8 },
	{ num: '3-1', title: 'The 5 subsystems of a robot', page: 10 },
	{ num: '3-2', title: 'Structure: the skeleton', page: 15 },
	{ num: '3-3', title: 'Actuators: the muscles', page: 18 },
	{ num: '3-4', title: 'Sensors: the senses', page: 21 },
	{ num: '3-5', title: 'Control system: the brain', page: 23 },
	{ num: '3-6', title: 'Power: the energy source', page: 24 },
	{ num: '3-7', title: 'How the subsystems work together', page: 27 },
	{ num: '4-1', title: 'Gears and torque', page: 29 },
	{ num: '5-1', title: 'Linear vs rotational movement', page: 32 },
	{ num: '5-2', title: 'Simple machines in robotics', page: 34 },
	{ num: '6-1', title: 'Extenders', page: 38 },
	{ num: '6-2', title: 'Introduction to rotation', page: 40 },
	{ num: '7-1', title: 'Logic and pseudocode', page: 42 },
	{ num: '8-1', title: 'Sensor logic challenge', page: 48 },
	{ num: '9-1', title: 'Final robotics challenge', page: 53 },
	{ num: '10-1', title: 'Thinking like an engineer', page: 58 },
	{ num: '*', title: 'Glossary', page: 61 }
];

const BABY_SHARKS_COURSES: { id: string; badge: string; index: BabySharksLessonRow[] }[] = [
	{ id: 'baby-sharks-fll-coding', badge: 'Season course', index: BABY_SHARKS_LESSON_INDEX },
	{ id: 'baby-sharks-python', badge: 'Optional, not FLL', index: BABY_SHARKS_PYTHON_INDEX },
	{ id: 'baby-sharks-engineering', badge: 'Optional, not FLL', index: BABY_SHARKS_ENGINEERING_INDEX }
];

/** All three Baby Sharks courses resolved to { ...resource, badge, index }.
 *  One data source: the link and blurb still come from RESOURCES by id. */
export function babySharksCourses(): (Resource & BabySharksCourse)[] {
	return BABY_SHARKS_COURSES.map((c) => {
		const res = RESOURCES[c.id];
		return res ? { ...res, badge: c.badge, index: c.index } : null;
	}).filter((c): c is Resource & BabySharksCourse => Boolean(c));
}

/** A course PDF opened at a specific page. Viewers that honour the `#page=`
 *  fragment jump straight there; the rest open at page 1, which is why every
 *  row also prints its page number. */
export function coursePageUrl(url: string, page?: number): string {
	return page ? `${url}#page=${page}` : url;
}

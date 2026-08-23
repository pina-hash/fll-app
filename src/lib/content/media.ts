// ---------------------------------------------------------------------------
// THE VIDEO AND RESOURCE LIBRARY -- the seventh Skill Hub category, ported
// from fll-camp's src/state/resources.js. A curated jump-off list of external
// videos and guides, filtered by topic chips: no notes, no lesson, no detail
// sheet, and deliberately kept out of the item-card categories.
//
// LINK POLICY (same as resources.ts): link only, never copy PrimeLessons /
// FLL Tutorials / video content into this app.
// ---------------------------------------------------------------------------

import type { MediaItem, MediaSeries, MediaTopic } from './types';

const FLLT = 'https://flltutorials.com';
const PRIME = 'https://primelessons.org/en/ProgrammingLessons';

/** Filter chips above the media list, in display order. */
export const MEDIA_TOPICS: MediaTopic[] = [
	{ key: 'robot-build', label: 'Robot Build' },
	{ key: 'programming-basics', label: 'Programming Basics' },
	{ key: 'driving-sensors', label: 'Driving & Sensors' },
	{ key: 'core-values', label: 'Core Values' },
	{ key: 'innovation-project', label: 'Innovation Project' }
];

/** Sequential runs: entries sharing a `series` id build on each other and
 *  render as a numbered mini-series under this header, never shuffled. */
export const MEDIA_SERIES: Record<string, MediaSeries> = {
	'spike-101': {
		id: 'spike-101',
		label: 'SPIKE Prime Programming for Beginners',
		note: 'Six parts, in order -- each one builds on the last.'
	}
};

/** The media library, in display order. */
export const MEDIA_ITEMS: MediaItem[] = [
	{
		id: 'med-ultimate-robot',
		kind: 'video',
		title: '5 Simple Tips to Build the Ultimate FLL Robot',
		subtitle: "Companion video to the team's starter-bot drive instructions.",
		source: 'Zain Khan',
		url: 'https://www.youtube.com/watch?v=4aHr97Xof34',
		topics: ['robot-build']
	},

	{
		id: 'med-prog-1',
		kind: 'video',
		title: "SPIKE Prime Programming 101 -- What You'll Learn & Why It Matters",
		source: 'GummyBears Robotics',
		url: 'https://www.youtube.com/watch?v=fNjZFMIFY0E',
		topics: ['programming-basics'],
		series: 'spike-101',
		step: 1
	},
	{
		id: 'med-prog-2',
		kind: 'video',
		title: 'Setup + Block Coding Basics',
		source: 'GummyBears Robotics',
		url: 'https://www.youtube.com/watch?v=lMQ2BrV6XC4',
		topics: ['programming-basics'],
		series: 'spike-101',
		step: 2
	},
	{
		id: 'med-prog-3',
		kind: 'video',
		title: 'Motors and DriveTrain',
		source: 'GummyBears Robotics',
		url: 'https://www.youtube.com/watch?v=fulg2fzzPDY',
		topics: ['programming-basics'],
		series: 'spike-101',
		step: 3
	},
	{
		id: 'med-prog-4',
		kind: 'video',
		title: 'Basic Turns',
		source: 'GummyBears Robotics',
		url: 'https://www.youtube.com/watch?v=AFrqL8DzpVQ',
		topics: ['programming-basics'],
		series: 'spike-101',
		step: 4
	},
	{
		id: 'med-prog-5',
		kind: 'video',
		title: 'Logic Statements',
		source: 'GummyBears Robotics',
		url: 'https://www.youtube.com/watch?v=2gbNfkL1JcA',
		topics: ['programming-basics'],
		series: 'spike-101',
		step: 5
	},
	{
		id: 'med-prog-6',
		kind: 'video',
		title: 'Introduction to Sensors',
		source: 'GummyBears Robotics',
		url: 'https://www.youtube.com/watch?v=pXRrFweAZVo',
		topics: ['programming-basics'],
		series: 'spike-101',
		step: 6
	},

	{
		id: 'med-gyro-straight',
		kind: 'guide',
		title: 'Gyro Move Straight',
		subtitle: 'PDF lesson -- hold a straight heading with the gyro.',
		source: 'PrimeLessons',
		url: `${PRIME}/GyroMoveStraight.pdf`,
		topics: ['driving-sensors']
	},
	{
		id: 'med-prog-quick-guide',
		kind: 'guide',
		title: 'Programming Skills Quick Guide',
		subtitle: 'PDF -- line following and aligning on a line.',
		source: 'FLL Tutorials',
		url: `${FLLT}/translations/en-us/RobotGame/ProgrammingQuickGuide.pdf`,
		topics: ['driving-sensors']
	},

	{
		id: 'med-coach-workshop',
		kind: 'video',
		title: "FLL Coaches' Workshop: Innovation Project and Core Values",
		subtitle: 'General coaching content, not season-specific.',
		source: 'ASU Engineering Outreach',
		url: 'https://www.youtube.com/watch?v=9on7e7eOiBk',
		topics: ['core-values', 'innovation-project']
	},
	{
		id: 'med-coach-training-6',
		kind: 'video',
		title: 'FLL Challenge Coach Training #6: Innovation Project, Core Values, Robot Design',
		subtitle: 'General coaching content, not season-specific.',
		source: 'High Tech Kids',
		url: 'https://www.youtube.com/watch?v=2pkFxNcE_SI',
		topics: ['core-values', 'innovation-project']
	}
];

/** Label for a media topic key (falls back to the raw key). */
export function mediaTopicLabel(key: string): string {
	return MEDIA_TOPICS.find((t) => t.key === key)?.label ?? key;
}

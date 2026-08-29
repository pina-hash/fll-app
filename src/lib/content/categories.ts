// ---------------------------------------------------------------------------
// SKILL HUB CONTENT -- the seven open categories, ported from fll-camp's
// src/state/content.js.
//
// Nothing here is gated. Every item is browsable from day one, and none of it
// is scoped to a role, phase, or check-in. Six categories use the item-card
// shape (`kind: 'items'`): a card, a detail sheet, and (for missions only,
// see src/lib/content/missions.ts and the `missions` / `team_mission_notes`
// database tables) a persisted team strategy note. The seventh, the Video and
// Resource Library, is `kind: 'media'` -- its entries live in media.ts.
//
// PROVENANCE: the legal-sensor list in ROBOT3 (force/touch, colour, distance,
// gyro) is the BIOGLOW Robot Game Rulebook's. The ROBOT6 numbers come from the
// INSPECT match-basic item (one launch area, under 12 in, 20 pts).
// ---------------------------------------------------------------------------

import type { HubCategory, HubItem } from './types';

export const ROBOT_ITEMS: HubItem[] = [
	{
		id: 'ROBOT1',
		num: 'ROBOT1',
		title: 'The Hub',
		description: 'The brick everything else plugs into.',
		lesson:
			"The hub is the robot's brain. Six ports around its edge take motors and sensors in any combination, and the display in the middle shows you what the hub thinks is happening. Press the round centre button to switch it on and hold it to switch it off, and remember that whatever port you plug a motor into is the port your program has to name, so pick a port layout once and write it down.",
		prompt: 'Which hub is yours, and what is plugged into each port? Write the port map here.'
	},
	{
		id: 'ROBOT2',
		num: 'ROBOT2',
		title: 'Motors',
		description: 'Large for driving, medium for attachments.',
		lesson:
			'You get two sizes of motor and they are good at different jobs. The large motor has more turning force, which is why it drives the wheels and moves the whole robot. The medium motor is smaller and lighter, so it is the one to put on an attachment where weight high up on the robot would make it tip. Both report their exact position back to the hub, so either can be told to turn a precise number of degrees.',
		prompt: 'Which motors drive your base, and which are free for attachments?'
	},
	{
		id: 'ROBOT3',
		num: 'ROBOT3',
		title: "Sensors You're Allowed to Use",
		description: 'Four sensors are legal. That is the whole list.',
		lesson:
			'The Robot Game Rulebook allows four kinds of sensor: the force (touch) sensor, the colour sensor, the distance (ultrasonic) sensor, and the gyro built into the hub itself. Nothing else is legal, however useful it looks. In practice the colour sensor and the gyro earn their keep most often, because those are the two that stop a long run from drifting off course.',
		prompt: 'Which sensors are on your robot right now, and what does each one actually do for you?'
	},
	{
		id: 'ROBOT4',
		num: 'ROBOT4',
		title: 'The Driving Base',
		description: 'Build this first. Everything else sits on it.',
		lesson:
			'Every robot starts as a driving base: two motors, two wheels, and a frame stiff enough that the robot goes where you point it. This season every team builds the same one, and the official competition bot manual is the build you are working from: 225 steps covering the drivetrain, the attachment motors, the SPIKE Prime hub, and the framing. It now has a screen of its own, Build the robot, and the Go deeper link just below opens the same file. Build it before you build a single attachment, because every mission you ever attempt inherits how straight and how repeatably this thing drives.',
		prompt: 'How far through the 225 steps are you, and who is building which section?',
		resourceId: 'comp-bot-manual',
		secondaryResourceId: 'robot-designs'
	},
	{
		id: 'ROBOT5',
		num: 'ROBOT5',
		title: 'Building vs Programming',
		description: 'The build decides what is possible; the code decides when.',
		lesson:
			'SPIKE Prime is two halves that only work together. The build sets what is physically possible, how far the arm reaches, how much force the gears deliver, whether the robot can even get there. The program sets when and how much. When a mission fails, work out which half is at fault before you change anything: no program will fix an attachment that cannot reach, and no rebuild will fix a turn that fires at the wrong moment.',
		prompt: 'Last thing that failed, was it the build or the code? How did you tell?'
	},
	{
		id: 'ROBOT6',
		num: 'ROBOT6',
		title: 'Equipment Rules',
		description: 'One launch area, under 12 inches. Measure it.',
		lesson:
			'Everything you bring to the table has to fit inside one launch area and stay under 12 inches (about 30 cm) tall, the robot, every attachment, and anything else you plan to use during the match. Passing that check is worth 20 points at Equipment Inspection, and it is the easiest 20 points in the match to throw away by turning up with a pile that does not fit. Measure it at practice, with everything you actually intend to bring.',
		prompt: 'What is your tallest piece of equipment, and how tall is it? Measure, do not guess.'
	}
];

export const CORE_VALUES_ITEMS: HubItem[] = [
	{
		id: 'CV1',
		num: 'CV1',
		title: 'Discovery',
		description: 'We explore new skills and ideas.',
		lesson:
			'Discovery means you tried something you did not already know how to do. Every session, someone on the team should learn a thing they could not do last week, a new block, a new mechanism, a new fact about the forest. Write those down as they happen; judges ask, and nobody remembers in April.',
		prompt: 'What did someone on this team learn recently that they could not do before?'
	},
	{
		id: 'CV2',
		num: 'CV2',
		title: 'Innovation',
		description: 'We use creativity and persistence to solve problems.',
		lesson:
			'Innovation is not the first idea, it is the fourth one, after three failed. Judges want the story: what you tried, why it did not work, what you changed. A design that failed and got fixed scores better in the telling than one that worked immediately.',
		prompt: 'Name one thing you tried that failed, and what you changed because of it.'
	},
	{
		id: 'CV3',
		num: 'CV3',
		title: 'Impact',
		description: 'We apply what we learn to improve our world.',
		lesson:
			'Impact means your work left the room. Did you share the innovation project with someone outside the team? Did anyone use your idea, or give you feedback that changed it? One real conversation with a real person outside the team is worth more than ten slides.',
		prompt: 'Who outside this team has seen your work, and what did they say?'
	},
	{
		id: 'CV4',
		num: 'CV4',
		title: 'Inclusion',
		description: 'We respect each other and embrace our differences.',
		lesson:
			'Inclusion is measured at the table, not in a speech. Does everyone touch the robot? Does everyone talk to the judges? If one person always codes and one person always watches, fix that now, rotate roles, and make the quiet member the one who explains the strategy.',
		prompt: 'Who has not had a turn on the thing they want to learn? What is the plan?'
	},
	{
		id: 'CV5',
		num: 'CV5',
		title: 'Teamwork',
		description: 'We are stronger when we work together.',
		lesson:
			'Teamwork on an FLL table looks like division of labour: one pair runs the robot, one pair builds and plans, and they talk to each other. Use the roles page each session so it is decided before the arguing starts.',
		prompt: 'How do you split the work in a session? Who decides when you disagree?'
	},
	{
		id: 'CV6',
		num: 'CV6',
		title: 'Fun',
		description: 'We enjoy and celebrate what we do.',
		lesson:
			'Fun is a scored value, not a bonus. Teams that celebrate small wins keep going when a mission fails for the tenth time. Have a thing you do when a run finally lands, judges notice teams that clearly like each other.',
		prompt: 'What does this team do to celebrate? Say it out loud so it is a real thing.'
	},
	{
		id: 'CV7',
		num: 'CV7',
		title: 'Gracious Professionalism & Coopertition',
		description: 'Compete hard, treat everyone well.',
		lesson:
			'Gracious Professionalism means you compete fiercely and are kind while doing it. Coopertition means you help the team you are about to compete against, and in BIOGLOW, M07 Humongous Fungus literally pays you both for cooperating. Lend a part, share a fix, then go win.',
		prompt: 'What could you help another team with at the next event?'
	},
	{
		id: 'CV8',
		num: 'CV8',
		title: 'The Judging Session',
		description: 'What actually happens in the room.',
		lesson:
			'You get a short session with judges: you present, they ask questions, everyone on the team should speak. They ask about the robot, the project, and how you work together. The best preparation is having real examples ready, that is what every note on this page is for.',
		prompt: 'Who says what? Draft your opening two sentences here.'
	}
];

export const PROJECT_ITEMS: HubItem[] = [
	{
		id: 'IP1',
		num: 'IP1',
		title: 'The BIOGLOW Theme: Biodiversity',
		description: 'What this season is actually about.',
		lesson:
			'BIOGLOW is about biodiversity, the web of living things in an ecosystem and what happens when parts of it disappear. The robot game mirrors it: drones surveying, seeds spreading, fungus networks connecting roots, keystone species holding a habitat together. Understanding the theme makes both the project and the mission strategy easier to explain.',
		prompt: 'In one sentence: what is biodiversity, in your own words?'
	},
	{
		id: 'IP2',
		num: 'IP2',
		title: 'Find a Real Problem',
		description: 'Pick a biodiversity problem you can actually investigate.',
		lesson:
			'A good project problem is specific and local. "Save the rainforest" is not a project; "the creek behind our school has no shade trees, so the fish are leaving" is. Look for a problem you can go and see, photograph, or ask someone about.',
		prompt: 'What problem are you taking on, and why does it matter to your community?'
	},
	{
		id: 'IP3',
		num: 'IP3',
		title: 'Research It',
		description: 'Find out what is already known, and talk to a person.',
		lesson:
			'Research means more than searching. Find out what has already been tried and why it did not fully solve the problem, then talk to someone who works on it: a biologist, a park ranger, a farmer, a teacher. One expert conversation gives you things no website has, and judges always ask who you talked to.',
		prompt: 'What did you find out, and who did you talk to? Note names and dates.'
	},
	{
		id: 'IP4',
		num: 'IP4',
		title: 'Design a Solution',
		description: 'Your idea, and why it is different.',
		lesson:
			'Your solution has to be new to you and improve on what already exists. It can be a device, a process, an app, or a plan, as long as you can explain how it works and how it is better than what people do now.',
		prompt: 'Describe your solution and what makes it different from what already exists.'
	},
	{
		id: 'IP5',
		num: 'IP5',
		title: 'Build a Model or Prototype',
		description: 'Make it real enough to show.',
		lesson:
			'A model makes an idea believable in a five-minute session. It does not have to work, a cardboard mock-up, a drawing, a slide diagram, or a LEGO build all count. What matters is that a judge can see the thing you are describing.',
		prompt: 'What will you build to show it? Who is building it, by when?'
	},
	{
		id: 'IP6',
		num: 'IP6',
		title: 'Share It',
		description: 'Get it in front of people outside the team.',
		lesson:
			'Sharing is the step teams skip and judges score. Present to a class, a local council, a shop owner, a park office, anyone affected by the problem. Then write down their feedback, and say what you changed because of it.',
		prompt: 'Who will you share with, and what feedback did you get?'
	},
	{
		id: 'IP7',
		num: 'IP7',
		title: 'Present to Judges',
		description: 'Five minutes, everyone speaks.',
		lesson:
			'The presentation is short: problem, research, solution, sharing, and what you would do next. Everyone on the team gets a speaking part. Practise it standing up, out loud, with a timer, reading from a script is the most common way teams lose the room.',
		prompt: 'Who covers which part? Write the running order here.'
	}
];

export const BUILD_ITEMS: HubItem[] = [
	{
		id: 'BP1',
		num: 'BP1',
		title: 'A Driving Base You Can Trust',
		description: 'Stable, square, and repeatable before anything else.',
		lesson:
			'A robot is only as good as it is repeatable. Both drive motors in the ports your program expects, no flex in the frame, wheels that do not rub. If the base wobbles, every mission after it inherits that wobble, fix it here, once.',
		prompt: 'What is your base design, and what have you changed about it?',
		resourceId: 'droidbot-m'
	},
	{
		id: 'BP2',
		num: 'BP2',
		title: 'Connect and Download',
		description: 'Get a program onto the hub and confirm it arrived.',
		lesson:
			'Pair the hub over Bluetooth or a cable, then download a tiny test program, a light, a sound, and a short motor spin, so you can confirm the hub really heard you before you debug anything complicated.',
		prompt: 'Which laptop and hub are yours? Note the hub name so you stop pairing the wrong one.',
		resourceId: 'block-guide'
	},
	{
		id: 'BP3',
		num: 'BP3',
		title: 'Drive Straight, Stop on Purpose',
		description: 'Rotations repeat. Seconds do not.',
		lesson:
			'Drive straight by giving both motors the same speed for a set number of rotations, rotations repeat far better than time, because a low battery changes how far a second takes you. Convert rotations to centimetres once and write the number down.',
		prompt: 'How many rotations per centimetre on your robot? Record the number.',
		resourceId: 'moving-straight',
		secondaryResourceId: 'baby-sharks-l2-driving'
	},
	{
		id: 'BP4',
		num: 'BP4',
		title: 'Turn on Purpose',
		description: 'Clean, repeatable 90-degree turns.',
		lesson:
			'Turn by spinning the wheels opposite amounts for a set number of rotations, then fine-tune until you land near 90 degrees. If the robot overshoots, lower the turn speed, less momentum to carry it past the target.',
		prompt: 'What turn speed and rotation count gives you a clean 90 on this robot?',
		resourceId: 'accurate-turning',
		secondaryResourceId: 'baby-sharks-l2-driving'
	},
	{
		id: 'BP5',
		num: 'BP5',
		title: 'Lock Your Start',
		description: 'The same start spot, every single run.',
		lesson:
			'A run can only be reliable if it starts the same way every time. Build a simple jig, or line the robot against the wall and the mat lines, so anyone on the team can place it identically under match pressure.',
		prompt: 'Describe your start setup so any team member can set it up the same way.',
		resourceId: 'reliability',
		secondaryResourceId: 'baby-sharks-l5-5-reliability'
	},
	{
		id: 'BP6',
		num: 'BP6',
		title: 'Attachments That Do Not Wobble',
		description: 'A loose attachment is the most common missed mission.',
		lesson:
			'Mount attachments so they cannot shift, braced on two points, not one. Check the robot still drives normally with it on, and that you can swap it in a couple of seconds with cold hands at a competition table.',
		prompt: 'Which attachments do you have, and which mission does each one serve?',
		resourceId: 'droidbot-m'
	},
	{
		id: 'BP7',
		num: 'BP7',
		title: 'Sensors: Square Up on a Line',
		description: 'Reset the robot mid-run so errors stop stacking.',
		lesson:
			'A colour sensor lets the robot find a line and square up against it, resetting position before a tricky approach. It is the one sensor skill worth the time: a long run drifts, and squaring up on a line wipes that drift out.',
		prompt: 'Which run drifts the most? Where could you square up mid-run?',
		resourceId: 'line-follower',
		secondaryResourceId: 'baby-sharks-l5-sensors'
	},
	{
		id: 'BP8',
		num: 'BP8',
		title: 'Chain Missions Into One Launch',
		description: 'Fewer trips home means more time scoring.',
		lesson:
			'Chaining means scoring two or three missions in one launch without returning home. Pick missions that sit near each other on the mat and plan a path that flows between them, every trip home costs you seconds you cannot spare.',
		prompt: 'Which missions sit close enough to chain? Sketch the launch order here.',
		resourceId: 'brainstorming'
	},
	{
		id: 'BP9',
		num: 'BP9',
		title: 'Make Runs Repeat Every Time',
		description: 'Score it three times in a row, or it does not count.',
		lesson:
			'A mission you scored once is not a mission you own. Run it three times: if it lands three for three, it goes in the match plan. If it lands one for three, it is a practice item, not a competition item. Match plans built on lucky runs fall apart at the event.',
		prompt: 'Which missions are three-for-three right now? Which are not yet?',
		resourceId: 'reliability',
		secondaryResourceId: 'baby-sharks-l5-5-reliability'
	}
];

/** Conceptual explainers, not build instructions. Each item says what a
 *  mechanism does and what it costs, names the BIOGLOW missions whose
 *  physical demand it matches (`fits`), and hands off to PrimeLessons for the
 *  actual worked builds. */
export const MECHANISM_ITEMS: HubItem[] = [
	{
		id: 'MECH1',
		num: 'MECH1',
		title: 'Gear Trains & Reduction',
		description: 'Trade speed for torque, or torque for speed.',
		lesson:
			'Gears let you choose between speed and strength, and you only ever get one at the cost of the other. Driving a small gear into a big one turns the output slower but with far more torque, which is what you want when something on the mat resists being moved; flip it around and the output spins fast but gives up its pushing power. When a motor stalls against a model, add reduction before you add speed.',
		fits: 'M08 Tangled and M05 Reaching Roots need force more than speed, and M12 Forest Elder has to raise the cane against gravity.',
		prompt: 'Which of your attachments stalls or overshoots? What gear ratio would you try instead?',
		resourceId: 'robot-designs'
	},
	{
		id: 'MECH2',
		num: 'MECH2',
		title: 'Worm Gear',
		description: 'Holds its position with the motor switched off.',
		lesson:
			'A worm gear drives the wheel it meshes with, but that wheel can never drive it back, so whatever you lift stays lifted after the motor stops, with no power draw and no drift. That makes it the safe choice for anything that has to hold a load in place. The trade is speed: a worm gear is slow, so use it where slow and controlled is exactly the point.',
		fits: 'M09 Research Platform has to stay raised, M12 Forest Elder has to hold the cane against the tree, and M15 Biocentric Architecture has to leave the nesting canopy up.',
		prompt: 'What does your robot lift that has to stay up after the motor stops?',
		resourceId: 'robot-designs'
	},
	{
		id: 'MECH3',
		num: 'MECH3',
		title: 'Rack and Pinion',
		description: 'Turns a spinning motor into a straight push or pull.',
		lesson:
			'A pinion is a gear; a rack is the straight toothed beam it runs along. Spin the pinion and the rack slides in a dead-straight line, which is how you turn rotation into a push or a pull without swinging an arm through an arc. Your reach is limited to the length of the rack, so measure the travel you need before you build it.',
		fits: 'M05 Reaching Roots and M07 Humongous Fungus both score for extending something straight out, and M15 Biocentric Architecture needs the garden skylight pushed in.',
		prompt: 'How far does the thing you are extending actually have to travel? Measure it first.',
		resourceId: 'robot-designs'
	},
	{
		id: 'MECH4',
		num: 'MECH4',
		title: 'Four-Bar Linkage',
		description: 'An arm that stays level all the way through its swing.',
		lesson:
			'A four-bar linkage is two parallel arms joined between a fixed frame and a moving end, so the end piece keeps the same angle no matter how high the arm travels. That is what stops a load tipping off, or a hook rolling out of position, partway through a lift. One motor buys you a controlled lift on a predictable path.',
		fits: 'M13 Keystone Species has to arrive on the restoration platform level, and M01 Drone Survey needs the drone lifted clear of the mat without dumping it.',
		prompt: 'Does anything you carry tip or slide when the arm moves? Where would a level arm help?',
		resourceId: 'robot-designs'
	},
	{
		id: 'MECH5',
		num: 'MECH5',
		title: 'Scissor Lift',
		description: 'Straight-up height from a small footprint.',
		lesson:
			'A scissor lift is crossed arms pinned at their middles; squeeze the bottom ends together and the platform on top rises straight up instead of leaning. It packs flat, so it costs you almost nothing at inspection, and it reaches much higher than its folded size suggests. It is fiddly to build square, so expect to spend a session getting the pivots free and the frame from twisting.',
		fits: 'M09 Research Platform and M15 Biocentric Architecture both score for raising something, and the flat packed height helps at Equipment Inspection.',
		prompt: 'How high does it actually need to go? Build to that height, not higher.',
		resourceId: 'robot-designs'
	},
	{
		id: 'MECH6',
		num: 'MECH6',
		title: 'Gripper / Claw',
		description: 'Pick a model up and still have it when you arrive.',
		lesson:
			'A gripper has two jobs: close on the model, and not let go while the robot drives. Almost every failure is the second one, the grip loosens over a bumpy run, or the piece rotates in the jaws, so build a hard stop or shape the jaw to match the model instead of relying on clamping force alone. Rubber tyres or a soft tip give you grip without crushing the piece.',
		fits: 'M03 Flip the Rock has to bring the rock home, M13 Keystone Species has to deliver onto the platform, and M14 Seeds of Renewal carries seeds across the mat.',
		prompt: 'What are you carrying, and what stops it falling out halfway? Drive the whole route loaded.',
		resourceId: 'robot-designs'
	},
	{
		id: 'MECH7',
		num: 'MECH7',
		title: 'Passive vs Active Attachments',
		description: 'Every motor you add is one more thing that can go wrong.',
		lesson:
			'A passive attachment has no motor, a hook, a fork, or a wedge that does its job purely because the robot drove somewhere. It cannot mis-time, it cannot run out of ports, and it swaps in fast, so use one wherever driving alone can score. An active attachment costs a motor and a port but does things driving cannot, so spend those motors only on the missions that genuinely need them.',
		fits: 'M02 Exploding Seeds, M10 Fragile Microhabitats and M08 Tangled can score passively as the robot drives past, while M09 Research Platform and M15 Biocentric Architecture need real motor actions.',
		prompt: 'Which of your attachments could lose its motor and still score? Try the passive version first.',
		resourceId: 'robot-designs'
	}
];

/** The open categories, in display order. `kind` says how the category
 *  renders and what it stores. The missions category has its own route (its
 *  items come from the database, not this module); it is not listed here. */
export const CATEGORIES: HubCategory[] = [
	{
		id: 'robot',
		kind: 'items',
		label: 'Meet the Robot',
		short: 'The Robot',
		icon: '🎛️',
		tagline: 'Start here before touching a mission',
		intro:
			'What the robot actually is, before you ask it to score anything: the hub, the motors, the sensors you are allowed to use, and the equipment rules the whole kit has to pass. Read these first.',
		items: ROBOT_ITEMS
	},
	{
		id: 'core-values',
		kind: 'items',
		label: 'Core Values',
		short: 'Core Values',
		icon: '🤝',
		tagline: 'What judges are really looking for',
		intro:
			'The values are scored, and the score comes from examples. Collect your real examples as they happen, so you are not inventing them the night before judging.',
		items: CORE_VALUES_ITEMS
	},
	{
		id: 'project',
		kind: 'items',
		label: 'Innovation Project',
		short: 'Project',
		icon: '🌱',
		tagline: 'Biodiversity, the BIOGLOW theme',
		intro:
			'The project runs the whole season, one step at a time. Work down the list and keep your research, decisions, and feedback close, this becomes your presentation.',
		items: PROJECT_ITEMS
	},
	{
		id: 'build',
		kind: 'items',
		label: 'Build & Programming',
		short: 'Build & Code',
		icon: '🛠️',
		tagline: 'The robot skills everything else needs',
		intro:
			'The skills every mission depends on. Each one has a short lesson, and most link out to a full guide from PrimeLessons or FLL Tutorials.',
		items: BUILD_ITEMS
	},
	{
		id: 'mechanisms',
		kind: 'items',
		label: 'Mechanisms Library',
		short: 'Mechanisms',
		icon: '⚙️',
		tagline: 'What to build and why',
		intro:
			'The mechanisms most FLL attachments are made of: what each one does, what it trades away, and which BIOGLOW missions it suits. These are explainers, not step-by-step builds, read the idea here, use "Go deeper" for worked examples.',
		items: MECHANISM_ITEMS
	},
	{
		id: 'media',
		kind: 'media',
		label: 'Video & Resource Library',
		short: 'Videos',
		icon: '🎬',
		tagline: 'Watch and read',
		intro:
			'A jump-off list of videos and guides from outside this app. Filter by topic with the chips below, then tap anything to open it in a new tab.'
	}
];

/** The item-card categories, in display order (excludes media and missions). */
export const ITEM_CATEGORIES = CATEGORIES.filter(
	(cat): cat is Extract<HubCategory, { kind: 'items' }> => cat.kind === 'items'
);

const ITEM_INDEX: Record<string, HubItem & { categoryId: string }> = Object.fromEntries(
	ITEM_CATEGORIES.flatMap((cat) => cat.items.map((item) => [item.id, { ...item, categoryId: cat.id }]))
);

export function getItem(itemId: string): (HubItem & { categoryId: string }) | null {
	return ITEM_INDEX[itemId] ?? null;
}

export function getCategory(categoryId: string): HubCategory | null {
	return CATEGORIES.find((c) => c.id === categoryId) ?? null;
}

// scripts/seed-local-session.mjs
//
// FILLS THE LOCAL STACK WITH A PLAUSIBLE FRIDAY SESSION so the console has
// something to show: rosters on all four teams, role assignments with
// deliberate gaps, a started meeting, attendance, tasks and two open blockers
// on one team. LOCAL ONLY -- it signs in as the seed admin mentor
// (supabase/seed.sql) and talks to 127.0.0.1:54322.
//
// Everything goes through the REAL RPCs the console calls (student_create,
// role_assign, meeting_create, meeting_start), so a change that breaks the
// console breaks this too.
//
//   node scripts/seed-local-session.mjs
//
// Idempotent: re-running adds nothing that is already there.
import postgres from 'postgres';

const sql = postgres('postgresql://postgres:postgres@127.0.0.1:54322/postgres', { max: 1, onnotice: () => {} });
const MENTOR_UID = '00000000-0000-4000-8000-000000000001';

const asMentor = (fn) =>
	sql.begin(async (tx) => {
		await tx`select set_config('request.jwt.claims', ${JSON.stringify({ role: 'authenticated', sub: MENTOR_UID })}, true)`;
		await tx.unsafe('set local role authenticated');
		return fn(tx);
	});

const ROSTERS = {
	'Red Team': [['Maya', 'R'], ['Diego', 'S'], ['Priya', 'K'], ['Omar', 'B'], ['Lena', 'T'], ['Jonah', 'W']],
	'Blue Team': [['Ana', 'C'], ['Theo', 'M'], ['Ruby', 'F'], ['Sam', 'L'], ['Ivy', 'N'], ['Kai', 'P']],
	'Green Team': [['Nora', 'A'], ['Felix', 'G'], ['Zoe', 'H'], ['Milo', 'D'], ['Ada', 'V']],
	// Six is the cap (0013's team_size_cap), so every roster here is six or
	// fewer. Gold used to carry a seventh; the trigger refuses it now, which is
	// the cap doing its job on a dev script exactly as it would on a Friday.
	'Gold Team': [['Rosa', 'E'], ['Hugo', 'J'], ['Iris', 'Q'], ['Leo', 'Y'], ['Talia', 'Z'], ['Nate', 'X']]
};

const ROLES = ['lead_builder', 'lead_programmer', 'run_captain', 'innovation_lead', 'notebook_values_lead'];

// 0018 MADE THE TEAM NUMBER THE IDENTITY AND THE COLOUR A CLAIM, AND THIS
// SCRIPT WAS LEFT BEHIND. seed.sql creates 'Team 1' through 'Team 4'; every map
// below is keyed on the colour names the teams had before that migration, so
// byName.get('Red Team') was undefined and the first student_create died with
// UNDEFINED_VALUE. Worse than the crash: rosterOf() matched nothing either, so
// the roles, attendance and closed-task loops silently seeded NOTHING on the
// runs that got that far. The keys stay as the colours because they are what
// this fixture is about; SHORT is the one place that maps them onto the
// numbered teams the schema actually has, and the short name is then set
// through the real RPC, which is what a team choosing its own name does.
const SHORT = { 'Team 1': 'Red Team', 'Team 2': 'Blue Team', 'Team 3': 'Green Team', 'Team 4': 'Gold Team' };

const teams = await sql`select id, name, short_name from public.teams order by name`;
const byName = new Map(teams.map((t) => [SHORT[t.name] ?? t.name, t.id]));

for (const team of teams) {
	const short = SHORT[team.name];
	if (short && team.short_name !== short) {
		await asMentor((tx) => tx`select public.team_set_short_name(${team.id}::uuid, ${short})`);
	}
}

// 1. Students, through student_create (mints the auth user, identity and PIN).
for (const [team, roster] of Object.entries(ROSTERS)) {
	const teamId = byName.get(team);
	for (const [first, initial] of roster) {
		const exists = await sql`
			select 1 from public.students s
			where s.team_id = ${teamId} and s.first_name = ${first} and s.last_initial = ${initial}`;
		if (exists.length) continue;
		await asMentor(
			(tx) => tx`select public.student_create(${teamId}::uuid, ${first}, ${initial}, 6::smallint, null)`
		);
	}
}

// 2. Roles, through role_assign. Red and Green are left with gaps on purpose:
//    Red has no second on two roles, Green has three roles with no holder at
//    all, which is what the board's "nobody in the seat" state needs.
const students = await sql`
	select s.id, s.first_name, s.team_id, t.name as team
	from public.students s join public.teams t on t.id = s.team_id
	order by t.name, s.created_at`;
// The query above aliases teams.name, which is 'Team 1'..'Team 4'; every map in
// this file is keyed on the colour. Translate once, here, so rosterOf and the
// PRESENT and CLOSED maps all agree. See SHORT above.
for (const s of students) s.team = SHORT[s.team] ?? s.team;
const rosterOf = (team) => students.filter((s) => s.team === team);

const PLAN = {
	'Red Team': [
		['lead_builder', 0, 1],
		['lead_programmer', 2, 3],
		['run_captain', 4, null],
		['innovation_lead', 5, null],
		['notebook_values_lead', 1, 0]
	],
	'Blue Team': [
		['lead_builder', 0, 1],
		['lead_programmer', 2, 3],
		['run_captain', 4, 5],
		['innovation_lead', 1, 2],
		['notebook_values_lead', 3, 4]
	],
	'Green Team': [
		['lead_builder', 0, 1],
		['lead_programmer', 2, null]
	],
	'Gold Team': [
		['lead_builder', 0, 1],
		['lead_programmer', 2, 3],
		['run_captain', 4, 5],
		['innovation_lead', 6, 0],
		['notebook_values_lead', 1, 2]
	]
};

for (const [team, rows] of Object.entries(PLAN)) {
	const teamId = byName.get(team);
	const roster = rosterOf(team);
	for (const [role, primaryIdx, secondIdx] of rows) {
		if (roster[primaryIdx]) {
			await asMentor(
				(tx) =>
					tx`select public.role_assign(${teamId}::uuid, ${roster[primaryIdx].id}::uuid, ${role}::public.team_role, 'primary'::public.role_tier)`
			);
		}
		if (secondIdx !== null && roster[secondIdx]) {
			await asMentor(
				(tx) =>
					tx`select public.role_assign(${teamId}::uuid, ${roster[secondIdx].id}::uuid, ${role}::public.team_role, 'second'::public.role_tier)`
			);
		}
	}
}

// 3. A meeting today, started, so the board has a running phase.
const [{ today }] = await sql`select (now() at time zone 'America/Los_Angeles')::date as today`;
let [meeting] = await sql`select id, started_at, ended_at from public.meetings where meeting_date = ${today}`;
if (!meeting) {
	const [{ meeting_create: created }] = await asMentor(
		(tx) => tx`select public.meeting_create('friday'::public.meeting_kind, ${today}::date, now() - interval '42 minutes')`
	);
	meeting = { id: created.meeting_id, started_at: null, ended_at: null };
}
if (!meeting.started_at) {
	await asMentor((tx) => tx`select public.meeting_start(${meeting.id}::uuid)`);
}

// 4. Attendance: most of Blue and Gold, some of Red, few of Green.
const PRESENT = { 'Red Team': 4, 'Blue Team': 6, 'Green Team': 2, 'Gold Team': 6 };
for (const [team, n] of Object.entries(PRESENT)) {
	for (const student of rosterOf(team).slice(0, n)) {
		await asMentor(
			(tx) =>
				tx`insert into public.attendance (meeting_id, student_id) values (${meeting.id}::uuid, ${student.id}::uuid)
				   on conflict (meeting_id, student_id) do nothing`
		);
	}
}

// 5. Tasks and blockers.
const [{ id: mentorId }] = await sql`select id from public.mentors where auth_user_id = ${MENTOR_UID}`;
const TASKS = [
	['Rebuild the arm attachment', 'lead_builder'],
	['Tune the line follower', 'lead_programmer'],
	['Three clean mat runs', 'run_captain'],
	['Interview a water district engineer', 'innovation_lead'],
	['Write up today in the notebook', 'notebook_values_lead']
];
for (const team of Object.keys(ROSTERS)) {
	const teamId = byName.get(team);
	const has = await sql`select 1 from public.tasks where team_id = ${teamId} limit 1`;
	if (has.length) continue;
	for (const [title, role] of TASKS) {
		await asMentor(
			(tx) =>
				tx`insert into public.tasks (team_id, meeting_id, title, role, created_by_mentor_id)
				   values (${teamId}::uuid, ${meeting.id}::uuid, ${title}, ${role}::public.team_role, ${mentorId}::uuid)`
		);
	}
}
// Blue closed four, Gold closed two, Red one, Green none.
const CLOSED = { 'Blue Team': 4, 'Gold Team': 2, 'Red Team': 1, 'Green Team': 0 };
for (const [team, n] of Object.entries(CLOSED)) {
	const teamId = byName.get(team);
	const open = await sql`select id from public.tasks where team_id = ${teamId} and status <> 'done' order by created_at limit ${n}`;
	for (const t of open) {
		await asMentor((tx) => tx`update public.tasks set status = 'done' where id = ${t.id}::uuid`);
	}
}
// Two blockers on Red, so exactly one card goes loud.
const redId = byName.get('Red Team');
const redRoster = rosterOf('Red Team');
const blockers = await sql`select 1 from public.blockers where team_id = ${redId} and resolved_at is null`;
if (!blockers.length) {
	for (const [i, note] of ['The motor cable keeps popping out.', 'We cannot find the 9-tooth gear.'].entries()) {
		await asMentor(
			(tx) =>
				tx`insert into public.blockers (team_id, student_id, note) values (${redId}::uuid, ${redRoster[i].id}::uuid, ${note})`
		);
	}
}

const summary = await asMentor((tx) => tx`select public.board_live_summary() as b`);
console.log(JSON.stringify(summary[0].b.teams.map((t) => ({
	name: t.name,
	here: `${t.present_count}/${t.roster_size}`,
	done: `${t.tasks_closed}/${t.tasks_opened}`,
	blockers: t.open_blockers,
	unfilled: t.roles_unfilled,
	noSecond: t.roles_without_second
})), null, 1));
console.log('phase:', JSON.stringify(summary[0].b.meeting.phase));
await sql.end();

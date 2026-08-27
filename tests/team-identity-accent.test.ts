// tests/team-identity-accent.test.ts
//
// A COLOUR IS TAKEN ONCE, AND THE RACE IS DECIDED BY POSTGRES.
//
// The claim that matters here cannot be shown by calling two RPCs one after
// the other: that only proves the second one read the first one's write. The
// concurrency test below opens TWO transactions, has both of them read "that
// colour is free", and only then lets both write -- which is the shape of two
// children tapping the same swatch in the same second. Exactly one commits;
// the other gets the unique index in the face and a sentence naming the
// winner. The positive control is the same pair of transactions on DIFFERENT
// colours, where both commit.
//
// teams.accent is global to the club, so every test here restores what it
// touched: cleanupRun() removes this file's own teams, and the seeded four
// are never given a colour by this file.

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import postgres from 'postgres';
import {
	LOCAL,
	captureError,
	cleanupRun,
	closeDb,
	createStudent,
	createTeam,
	seedMentor,
	serviceClient,
	signIn,
	sql,
	type Client,
	type SeededMentor,
	type SeededTeam
} from './db/harness';

const service = serviceClient();

let mentor: SeededMentor;
let teamA: SeededTeam;
let teamB: SeededTeam;
let studentA: Client;
let studentB: Client;
let studentAId = '';

beforeAll(async () => {
	mentor = await seedMentor('accent');
	teamA = await createTeam(mentor.client, 'AccentA');
	teamB = await createTeam(mentor.client, 'AccentB');
	const a = await createStudent(mentor.client, teamA, 'Ada', 'L');
	const b = await createStudent(mentor.client, teamB, 'Ben', 'R');
	studentAId = a.studentId;
	studentA = await signIn(a.email, a.pin);
	studentB = await signIn(b.email, b.pin);
});

afterAll(async () => {
	await cleanupRun();
	await closeDb();
});

describe('the seeded teams are numbered and each starts with a colour', () => {
	test('Team 1 to Team 4 exist, none of them NAMED after a colour', async () => {
		const rows = await sql<{ name: string; accent: string | null; join_code: string }[]>`
			select name, accent::text, join_code from public.teams
			where name in ('Team 1', 'Team 2', 'Team 3', 'Team 4') order by name`;
		expect(rows.map((r) => r.name)).toEqual(['Team 1', 'Team 2', 'Team 3', 'Team 4']);
		// A team still CHOOSES its colour and the propose/confirm/override flow
		// below is untouched. What 0025 changed is the state a team STARTS in:
		// every accent was null, so every screen fell back to the same neutral
		// and four teams rendered as four identical grey cards.
		expect(rows.map((r) => r.accent)).toEqual(['lime', 'purple', 'teal', 'orange']);
		// The name is still the identity and it is still a NUMBER. A team named
		// after its colour is the thing 0018 renamed away from, and handing out
		// colours must not walk that back.
		expect(rows.every((r) => /^Team [1-4]$/.test(r.name))).toBe(true);
		// The rename touched the name and nothing else: every join code is
		// still a real six-character code.
		expect(rows.every((r) => /^[A-Z0-9]{6}$/.test(r.join_code))).toBe(true);
	});

	test('the old colour names are gone from the enum entirely', async () => {
		const [{ vals }] = await sql<{ vals: string[] }[]>`
			select enum_range(null::public.team_accent)::text[] as vals`;
		expect(vals).toEqual([
			'bark',
			'orange',
			'olive',
			'lime',
			'green',
			'sage',
			'teal',
			'violet',
			'purple',
			'orchid',
			'magenta'
		]);
		expect(vals).not.toContain('cyan');
		expect(vals).not.toContain('chartreuse');
		expect(vals).not.toContain('amber');
	});

	test('RED AND BLUE ARE NOT IN THE PALETTE, and the enum is the only way to say a colour', async () => {
		// The mat's launch areas are red and blue. Nothing in the enum names
		// either, and a name that is not in the enum cannot be stored at all.
		const [{ vals }] = await sql<{ vals: string[] }[]>`
			select enum_range(null::public.team_accent)::text[] as vals`;
		for (const banned of ['red', 'blue', 'crimson', 'scarlet', 'navy', 'azure', 'cyan']) {
			expect(vals).not.toContain(banned);
		}
		const bad = await captureError(
			() => sql`update public.teams set accent = 'red' where name = 'Team 1'`
		);
		expect(bad.code).toBe('22P02'); // invalid input value for enum
	});
});

describe('choosing: any member proposes, the Run Captain or a mentor confirms', () => {
	test('a student proposes a colour for their own team and it holds no seat', async () => {
		const { data, error } = await studentA.rpc('team_propose_accent', { p_accent: 'violet' });
		expect(error).toBeNull();
		expect(data).toMatchObject({ team_id: teamA.teamId, accent_proposed: 'violet' });

		const [row] = await sql<{ accent: string | null; proposed: string | null; by: string | null }[]>`
			select accent::text, accent_proposed::text as proposed, accent_proposed_by::text as by
			from public.teams where id = ${teamA.teamId}`;
		// A proposal is a suggestion: the colour is NOT taken yet.
		expect(row.accent).toBeNull();
		expect(row.proposed).toBe('violet');
		expect(row.by).toBe(studentAId);

		// Which is why the OTHER team may propose the same colour.
		const other = await studentB.rpc('team_propose_accent', { p_accent: 'violet' });
		expect(other.error).toBeNull();
	});

	test('a student cannot confirm: that is the Run Captain or a mentor', async () => {
		const { error } = await studentA.rpc('team_confirm_accent', { p_team_id: teamA.teamId });
		expect(error?.message).toContain('Run Captain or a mentor');

		// POSITIVE CONTROL: the same call as the mentor takes the colour.
		const ok = await mentor.client.rpc('team_confirm_accent', { p_team_id: teamA.teamId });
		expect(ok.error).toBeNull();
		expect(ok.data).toMatchObject({ team_id: teamA.teamId, accent: 'violet' });

		const [row] = await sql<{ accent: string | null; proposed: string | null }[]>`
			select accent::text, accent_proposed::text as proposed
			from public.teams where id = ${teamA.teamId}`;
		expect(row.accent).toBe('violet');
		// Confirming clears the proposal: there is nothing left pending.
		expect(row.proposed).toBeNull();
	});

	test('a taken colour is refused at proposal time, naming who has it', async () => {
		const { error } = await studentB.rpc('team_propose_accent', { p_accent: 'violet' });
		expect(error?.message).toContain(teamA.name);
		expect(error?.message).toContain('Pick another one');
	});

	test('a student cannot propose for a team they are not on', async () => {
		// There is no team parameter at all: the caller IS the team. The only
		// team a student can move is their own, which is the design.
		const { data } = await studentB.rpc('team_propose_accent', { p_accent: 'sage' });
		expect(data).toMatchObject({ team_id: teamB.teamId });
		expect(data).not.toMatchObject({ team_id: teamA.teamId });
	});

	test('a mentor overrides any team, and cannot steal a colour by accident', async () => {
		const stolen = await mentor.client.rpc('team_set_accent', {
			p_team_id: teamB.teamId,
			p_accent: 'violet'
		});
		expect(stolen.error?.message).toContain('Take it off them first');

		// POSITIVE CONTROL: a free colour goes through.
		const ok = await mentor.client.rpc('team_set_accent', {
			p_team_id: teamB.teamId,
			p_accent: 'orchid'
		});
		expect(ok.error).toBeNull();

		// And clearing a colour releases it for anyone else.
		// Omitting the argument is how the RPC is told "no colour": the
		// parameter defaults to null, which is the clear.
		const cleared = await mentor.client.rpc('team_set_accent', {
			p_team_id: teamB.teamId
		});
		expect(cleared.error).toBeNull();
		const [row] = await sql<{ accent: string | null }[]>`
			select accent::text from public.teams where id = ${teamB.teamId}`;
		expect(row.accent).toBeNull();
	});

	test('a student cannot use the mentor override', async () => {
		const { error } = await studentA.rpc('team_set_accent', {
			p_team_id: teamA.teamId,
			p_accent: 'teal'
		});
		expect(error?.message).toContain('Only a mentor');
	});

	test('team_accent_options says which are taken and by whom', async () => {
		const { data, error } = await studentA.rpc('team_accent_options');
		expect(error).toBeNull();
		const options = data as { accent: string; taken_by: string | null }[];
		expect(options).toHaveLength(11);
		const violet = options.find((o) => o.accent === 'violet');
		expect(violet?.taken_by).toBe(teamA.name);
		// Everything else this test has not taken is free.
		expect(options.find((o) => o.accent === 'bark')?.taken_by).toBeNull();
	});
});

describe('THE RACE: two teams pick the same colour at the same moment', () => {
	/**
	 * Two real connections, two open transactions. Both read that 'sage' is
	 * free BEFORE either writes, which is the only way to reproduce the race
	 * a screen-level check would lose. Then both write and both try to
	 * commit.
	 */
	async function concurrentPick(colourA: string, colourB: string) {
		const one = postgres(LOCAL.dbUrl, { max: 1 });
		const two = postgres(LOCAL.dbUrl, { max: 1 });
		const results: { who: string; ok: boolean; code?: string; message?: string }[] = [];
		try {
			await one`begin`;
			await two`begin`;

			// Both see the colour as free. This is the stale read.
			const freeA = await one`select 1 from public.teams
				where accent = ${colourA}::public.team_accent and archived_at is null`;
			const freeB = await two`select 1 from public.teams
				where accent = ${colourB}::public.team_accent and archived_at is null`;
			expect(freeA).toHaveLength(0);
			expect(freeB).toHaveLength(0);

			// Now both write. The first UPDATE takes the index entry; the
			// second blocks on it and fails at commit or at write time.
			const write = async (
				db: postgres.Sql,
				teamId: string,
				colour: string,
				who: string
			) => {
				try {
					await db`update public.teams set accent = ${colour}::public.team_accent where id = ${teamId}`;
					await db`commit`;
					results.push({ who, ok: true });
				} catch (error) {
					const e = error as { code?: string; message?: string };
					results.push({ who, ok: false, code: e.code, message: e.message });
					try {
						await db`rollback`;
					} catch {
						// The transaction is already dead; nothing to roll back.
					}
				}
			};

			await Promise.all([
				write(one, teamA.teamId, colourA, 'A'),
				write(two, teamB.teamId, colourB, 'B')
			]);
			return results;
		} finally {
			await one.end({ timeout: 5 });
			await two.end({ timeout: 5 });
		}
	}

	test('exactly one wins, and the loser is refused by the unique index', async () => {
		await service.from('teams').update({ accent: null }).in('id', [teamA.teamId, teamB.teamId]);

		const results = await concurrentPick('sage', 'sage');
		const winners = results.filter((r) => r.ok);
		const losers = results.filter((r) => !r.ok);
		expect(winners).toHaveLength(1);
		expect(losers).toHaveLength(1);
		expect(losers[0].code).toBe('23505');
		expect(losers[0].message).toContain('teams_accent_unique_live');

		// One row holds it, and it is one of the two.
		const held = await sql<{ id: string }[]>`
			select id from public.teams where accent = 'sage' and archived_at is null`;
		expect(held).toHaveLength(1);
		expect([teamA.teamId, teamB.teamId]).toContain(held[0].id);
	});

	test('THE POSITIVE CONTROL: the same two transactions on different colours both commit', async () => {
		await service.from('teams').update({ accent: null }).in('id', [teamA.teamId, teamB.teamId]);

		// THE TWO COLOURS ARE LOOKED UP, NOT TYPED. This case used to name teal
		// and lime, and 0025 broke it by giving the seeded teams a starting
		// colour: four of the eleven are now held before any test runs, so a
		// hard-coded pair is a coin toss against the seed. Asking which are free
		// is what the RPC itself does, and it cannot go stale.
		const free = await sql<{ accent: string }[]>`
			select a.accent::text as accent
			from unnest(enum_range(null::public.team_accent)) as a(accent)
			where not exists (
				select 1 from public.teams t
				where t.accent = a.accent and t.archived_at is null
			)
			order by a.accent
			limit 2`;
		expect(free, 'the palette has no two free colours left; this case needs two').toHaveLength(2);
		const [first, second] = free.map((f) => f.accent);

		const results = await concurrentPick(first, second);
		expect(results.filter((r) => r.ok)).toHaveLength(2);

		const held = await sql<{ accent: string }[]>`
			select accent::text from public.teams
			where id = any(array[${teamA.teamId}, ${teamB.teamId}]::uuid[]) order by accent`;
		expect(held.map((h) => h.accent)).toEqual([first, second].sort());
	});

	test('the RPC turns that 23505 into a sentence naming the winner', async () => {
		await service.from('teams').update({ accent: null }).eq('id', teamB.teamId);
		await service.from('teams').update({ accent: 'purple' }).eq('id', teamA.teamId);

		// Confirming a colour another team already holds is the same collision
		// arriving a moment later, and it is the message a child sees.
		const { error } = await mentor.client.rpc('team_confirm_accent', {
			p_team_id: teamB.teamId,
			p_accent: 'purple'
		});
		expect(error?.message).toContain(teamA.name);
		expect(error?.message).toContain('Pick another one');
		expect(error?.message).not.toContain('teams_accent_unique_live');
	});

	test('an archived team releases its colour', async () => {
		await service.from('teams').update({ accent: 'bark' }).eq('id', teamA.teamId);
		// Taken while the team is live.
		const blocked = await captureError(
			() => sql`update public.teams set accent = 'bark' where id = ${teamB.teamId}`
		);
		expect(blocked.code).toBe('23505');

		// Archived, the index no longer covers the row, so the colour is free.
		await service.from('teams').update({ archived_at: new Date().toISOString() }).eq('id', teamA.teamId);
		await sql`update public.teams set accent = 'bark' where id = ${teamB.teamId}`;
		const held = await sql<{ n: number }[]>`
			select count(*)::int as n from public.teams where accent = 'bark'`;
		expect(held[0].n).toBe(2);
		await service.from('teams').update({ archived_at: null, accent: null }).eq('id', teamA.teamId);
	});
});

describe('the short name is filtered in the DATABASE', () => {
	test('a reasonable name is accepted and shows under the number', async () => {
		const { error } = await mentor.client.rpc('team_set_short_name', {
			p_team_id: teamA.teamId,
			p_short_name: 'Glow Squad'
		});
		expect(error).toBeNull();
		const [row] = await sql<{ name: string; short_name: string | null }[]>`
			select name, short_name from public.teams where id = ${teamA.teamId}`;
		// The number is the name; the chosen name is secondary data beside it.
		expect(row.name).toContain('Test ');
		expect(row.short_name).toBe('Glow Squad');
	});

	test('an inappropriate name is refused BY THE DATABASE, not by a screen', async () => {
		for (const bad of ['Big Ass', 'sh1t crew', 'S H I T', 'f-u-c-k', 'fuuuck', 'p0rn', 'WTF']) {
			const { error } = await mentor.client.rpc('team_set_short_name', {
				p_team_id: teamA.teamId,
				p_short_name: bad
			});
			expect({ bad, refused: Boolean(error) }).toEqual({ bad, refused: true });
			expect(error?.message).toContain('word we do not allow');
		}
	});

	test('the trigger bites on a RAW update too, with no RPC in the way', async () => {
		// The filter is on the table. A client that found a direct write path
		// gets the same answer as one that used the RPC.
		const raw = await captureError(
			() => sql`update public.teams set short_name = 'Big Ass' where id = ${teamA.teamId}`
		);
		expect(raw.message).toContain('word we do not allow');

		// POSITIVE CONTROL: the same raw statement with a clean name lands.
		await sql`update public.teams set short_name = 'Bio Bots' where id = ${teamA.teamId}`;
		const [row] = await sql<{ short_name: string }[]>`
			select short_name from public.teams where id = ${teamA.teamId}`;
		expect(row.short_name).toBe('Bio Bots');
	});

	test('ordinary words that merely CONTAIN a short blocked word are allowed', async () => {
		// The Scunthorpe problem, checked rather than hoped for.
		for (const good of ['Passenger', 'Class Act', 'Assemble', 'Shell Team', 'Titan', 'Grasshoppers']) {
			const { error } = await mentor.client.rpc('team_set_short_name', {
				p_team_id: teamA.teamId,
				p_short_name: good
			});
			expect({ good, refused: Boolean(error) }).toEqual({ good, refused: false });
		}
	});

	test('the shape rules refuse an empty, an over-long and a symbol-laden name', async () => {
		const tooShort = await mentor.client.rpc('team_set_short_name', {
			p_team_id: teamA.teamId,
			p_short_name: 'x'
		});
		expect(tooShort.error?.message).toContain('2 to 24');

		const tooLong = await mentor.client.rpc('team_set_short_name', {
			p_team_id: teamA.teamId,
			p_short_name: 'x'.repeat(25)
		});
		expect(tooLong.error?.message).toContain('2 to 24');

		const symbols = await mentor.client.rpc('team_set_short_name', {
			p_team_id: teamA.teamId,
			p_short_name: '<script>hi</script>'
		});
		expect(symbols.error).not.toBeNull();
	});

	test('a student cannot set the name; the Run Captain or a mentor can', async () => {
		const { error } = await studentA.rpc('team_set_short_name', {
			p_team_id: teamA.teamId,
			p_short_name: 'Sneaky'
		});
		expect(error?.message).toContain('Run Captain or a mentor');

		const [row] = await sql<{ short_name: string | null }[]>`
			select short_name from public.teams where id = ${teamA.teamId}`;
		expect(row.short_name).not.toBe('Sneaky');
	});
});

describe('no client may write a colour directly any more', () => {
	test('the update grant on teams.accent is gone', async () => {
		const rows = await sql<{ n: number }[]>`
			select count(*)::int as n from information_schema.column_privileges
			where table_schema = 'public' and table_name = 'teams' and column_name = 'accent'
				and grantee = 'authenticated' and privilege_type = 'UPDATE'`;
		expect(rows[0].n).toBe(0);
	});

	test('a mentor writing the column through PostgREST is refused; the RPC is the door', async () => {
		const direct = await mentor.client
			.from('teams')
			.update({ accent: 'olive' })
			.eq('id', teamA.teamId)
			.select('id');
		expect(direct.error?.code).toBe('42501');

		// POSITIVE CONTROL: the same colour through the RPC lands.
		const viaRpc = await mentor.client.rpc('team_set_accent', {
			p_team_id: teamA.teamId,
			p_accent: 'olive'
		});
		expect(viaRpc.error).toBeNull();
	});
});

-- 0018_team_identity_and_accent_claim.sql
--
-- THE FOUR TEAMS ARE NUMBERED, THEY PICK THEIR OWN COLOUR, AND A COLOUR IS
-- TAKEN ONCE. Renames the seeded rows to Team 1 through Team 4, replaces the
-- four assigned accents with a palette of eleven a team CHOOSES from, makes
-- the choice unique across active teams in the database rather than in a
-- screen, and adds the short name kids will want next to the number.
--
-- Applied by the Supabase CLI, after 0017.
--
-- ===========================================================================
-- RED AND BLUE ARE EXCLUDED FROM THE TEAM PALETTE. DO NOT ADD THEM BACK.
-- ===========================================================================
-- The robot game mat has two launch areas, one red and one blue. The route
-- planner draws a team's route, its waypoints and its robot footprint in that
-- team's accent, on top of the mat. A team whose accent is red or blue would
-- have its own route read as a launch area by the children using it, and the
-- mistake would be invisible in code review because the colour would look
-- perfectly reasonable in the picker.
--
-- Every value in public.team_accent therefore sits outside hue [335, 25] and
-- hue [200, 258]. Widening this enum is a decision about the mat, not about
-- the palette: if a future season's mat drops those launch areas, say so here
-- before adding a value. The same sentence is in
-- src/lib/design-system/team-accents.css, next to the hexes.
-- ===========================================================================
--
-- WHY THE ENUM IS REPLACED RATHER THAN EXTENDED. Postgres can add a value to
-- an enum but never remove one, and two of the four old values had to go:
-- 'cyan' is squarely in the excluded blue band, and 'chartreuse' and 'amber'
-- named colours that no longer exist in the palette. Leaving them reachable
-- would leave the launch-area collision one dropdown away. So the type is
-- rebuilt and every existing row is mapped: cyan -> teal, chartreuse -> lime,
-- amber -> orange, magenta -> magenta. The mapping is stated so a row that
-- was cyan yesterday is teal today and not null.
--
-- WHY EVERY TEAM STARTS WITH NO COLOUR. The old column was NOT NULL with a
-- default, and 0009 assigned accents in creation order. The point of this
-- bundle is that a team CHOOSES, so the column becomes nullable and every
-- existing choice is cleared: an assigned colour is not a chosen one, and a
-- team keeping the colour it was given should have to say so. A team with no
-- accent renders in the design system's neutral, which is a real state and
-- not a broken one.
--
-- WHO CHOOSES. Any member of the team may PROPOSE; the Run Captain or a
-- mentor CONFIRMS. That rule already exists, exactly, as strategy_can_edit()
-- from 0012 -- the active Run Captain while a meeting has one, otherwise the
-- assignment holders, plus any mentor -- so this file calls it rather than
-- writing a second version that would drift. A mentor may also set any team's
-- colour outright, which is the override.
--
-- HOW THE RACE RESOLVES. Twenty children on twenty phones can tap the same
-- swatch in the same second. The winner is decided by a PARTIAL UNIQUE INDEX
-- on (accent) where the team is not archived, so the loser gets a 23505 from
-- Postgres rather than a stale read; team_confirm_accent catches it and says
-- which team took the colour. Nothing about that depends on a client
-- refetching in time.
--
-- THE SHORT NAME IS FILTERED IN THE DATABASE. Not in the client: a student
-- runtime is local-first and replays queued writes, a board device posts
-- directly, and a determined nine-year-old will find the one screen that
-- forgot to check. The shape is a CHECK; the wordlist is a trigger, so the
-- refusal is a sentence a child can read instead of a constraint name.
--
-- WHAT THIS FILE DOES NOT DO. It does not touch join codes, team ids, student
-- addresses or anything derived from them: renaming a team is a display
-- change and nothing else. It does not add a separate team-number column;
-- teams.name IS 'Team 1' through 'Team 4' and sorts correctly. It does not
-- give a board device or a parent any new write.
--
-- ===========================================================================
-- TO UNDO
-- ===========================================================================
--
--   drop function if exists public.team_set_accent(uuid, public.team_accent);
--   drop function if exists public.team_confirm_accent(uuid, public.team_accent);
--   drop function if exists public.team_propose_accent(public.team_accent);
--   drop function if exists public.team_set_short_name(uuid, text);
--   drop function if exists public.team_accent_options();
--   drop trigger if exists teams_short_name_clean on public.teams;
--   drop function if exists public._teams_short_name_clean();
--   drop function if exists public._text_is_clean(text);
--   drop index if exists public.teams_accent_unique_live;
--   alter table public.teams drop column if exists short_name;
--   alter table public.teams drop column if exists accent_proposed;
--   alter table public.teams drop column if exists accent_proposed_by;
--   alter table public.teams drop column if exists accent_proposed_at;
--   -- The enum cannot be un-replaced without the same dance in reverse:
--   -- recreate the four-value type, map teal->cyan, lime->chartreuse,
--   -- orange->amber, magenta->magenta, restore NOT NULL and the 'cyan'
--   -- default, and re-create 0009's _next_team_accent() and team_create()
--   -- verbatim against it. The team names revert with:
--   --   update public.teams set name = 'Red Team'   where name = 'Team 1';
--   --   update public.teams set name = 'Blue Team'  where name = 'Team 2';
--   --   update public.teams set name = 'Green Team' where name = 'Team 3';
--   --   update public.teams set name = 'Gold Team'  where name = 'Team 4';

-- ---------------------------------------------------------------------------
-- 1. Rename the seeded teams. Matched by their old names, so a run over a
--    database that has already been renamed changes nothing, and a team the
--    club created itself is left alone.
-- ---------------------------------------------------------------------------
do $$
declare
	v_pair text[];
	v_n int := 0;
begin
	foreach v_pair slice 1 in array array[
		array['Red Team', 'Team 1'],
		array['Blue Team', 'Team 2'],
		array['Green Team', 'Team 3'],
		array['Gold Team', 'Team 4']
	] loop
		update public.teams set name = v_pair[2] where name = v_pair[1];
		v_n := v_n + coalesce((select count(*)::int from public.teams where name = v_pair[2]), 0);
	end loop;
	raise notice '0018: % team(s) now carry a numbered name.', v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The palette. Eleven values, every one outside the red and blue hue bands
--    the mat's launch areas occupy. The hexes live in
--    src/lib/design-system/team-accents.css with their measured contrast;
--    the database owns WHICH, the stylesheet owns WHAT IT LOOKS LIKE, which
--    is 0009's rule and is unchanged.
-- ---------------------------------------------------------------------------
drop function if exists public._next_team_accent();
drop function if exists public.team_create(text, integer, public.team_accent);

do $$
begin
	if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
	               where n.nspname = 'public' and t.typname = 'team_accent_v2') then
		create type public.team_accent_v2 as enum (
			'bark', 'orange', 'olive', 'lime', 'green', 'sage',
			'teal', 'violet', 'purple', 'orchid', 'magenta'
		);
	end if;
end;
$$;

alter table public.teams alter column accent drop default;
alter table public.teams alter column accent drop not null;

-- Map every existing row onto the new palette before the old type goes.
alter table public.teams
	alter column accent type public.team_accent_v2
	using (
		case accent::text
			when 'cyan' then 'teal'
			when 'chartreuse' then 'lime'
			when 'amber' then 'orange'
			when 'magenta' then 'magenta'
			else null
		end::public.team_accent_v2
	);

drop type if exists public.team_accent;
alter type public.team_accent_v2 rename to team_accent;

comment on column public.teams.accent is
	'Which of the eleven team colours this team CHOSE, or null if it has not chosen yet. An enum, not a colour: the stylesheet owns the palette. Unique across live teams -- a colour is taken once.';

-- ---------------------------------------------------------------------------
-- 3. A colour is taken once. A partial unique index, so an archived team
--    releases its colour and two teams with no colour yet do not collide
--    (Postgres treats NULLs as distinct, which is exactly right here).
-- ---------------------------------------------------------------------------
drop index if exists public.teams_accent_unique_live;
create unique index teams_accent_unique_live
	on public.teams (accent)
	where archived_at is null and accent is not null;

-- Every team starts unchosen: an assigned colour is not a chosen one.
update public.teams set accent = null where accent is not null;

-- ---------------------------------------------------------------------------
-- 4. The proposal. Any member may put a colour forward; it is a suggestion
--    until the Run Captain or a mentor confirms it, and it holds no seat.
-- ---------------------------------------------------------------------------
alter table public.teams add column if not exists accent_proposed public.team_accent;
alter table public.teams add column if not exists accent_proposed_by uuid references public.students (id);
alter table public.teams add column if not exists accent_proposed_at timestamptz;

comment on column public.teams.accent_proposed is
	'A colour a team member has put forward, waiting on the Run Captain or a mentor. Holds no seat: only teams.accent is unique.';

-- ---------------------------------------------------------------------------
-- 5. The short name, and the filter that is not in the client.
--
--    _text_is_clean is IMMUTABLE so a CHECK could call it, and is written as
--    a normalise-then-match: lowercase, fold the obvious letter-for-digit
--    substitutions, drop everything that is not a letter, then look for a
--    blocked word as a substring of the squashed string. Squashing is what
--    catches 's p a c e d' and 'w-o-r-d'; folding is what catches '4ss'.
--    The list is deliberately short and clinical: it covers the words a
--    nine-year-old would try, and a mentor can still rename anything.
-- ---------------------------------------------------------------------------
alter table public.teams add column if not exists short_name text;

alter table public.teams drop constraint if exists teams_short_name_shape;
alter table public.teams add constraint teams_short_name_shape check (
	short_name is null
	or (
		length(btrim(short_name)) between 2 and 24
		and short_name = btrim(short_name)
		and short_name ~ '^[A-Za-z0-9][A-Za-z0-9 ''!-]*$'
	)
);

create or replace function public._text_is_clean(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
	-- TWO LISTS, BECAUSE ONE LIST CANNOT WORK. Matching every blocked word as
	-- a SUBSTRING refuses "Passenger", "Class Act" and "Assemble" over "ass";
	-- matching every word only as a WHOLE WORD lets "s h i t" and "fuuuck"
	-- through. So the long unambiguous words are matched as substrings of the
	-- squashed text, and the short ambiguous ones only as whole tokens or as
	-- the whole squashed name.
	--
	-- NORMALISATION, four forms, all checked. '1' stands for both 'i' and 'l'
	-- depending on the word ('sh1t' and 'c1it'), so one folding cannot catch
	-- both; and a child refused once will try 'fuuuck', so each folding is
	-- also tested with runs of a repeated letter collapsed.
	with folded as (
		select translate(lower(coalesce(p_text, '')), '0134578@$!', 'oleastbasi') as a,
		       translate(lower(coalesce(p_text, '')), '0134578@$!', 'oieastbasi') as b
	), squashed as (
		select regexp_replace(a, '[^a-z]', '', 'g') as a, regexp_replace(b, '[^a-z]', '', 'g') as b
		from folded
	), forms as (
		select a as f from squashed
		union all select b from squashed
		union all select regexp_replace(a, '(.)\1+', '\1', 'g') from squashed
		union all select regexp_replace(b, '(.)\1+', '\1', 'g') from squashed
	), tokens as (
		select t from folded, unnest(regexp_split_to_array(a, '[^a-z]+')) t where t <> ''
		union all
		select t from folded, unnest(regexp_split_to_array(b, '[^a-z]+')) t where t <> ''
		union all
		select regexp_replace(f, '(.)\1+', '\1', 'g') from forms
	), long_words as (
		select unnest(array[
			'anus','arse','bastard','bitch','bollock','boner','bugger','bullshit',
			'clit','cunt','dildo','douche','ejacul','fellat','fuck','handjob',
			'jizz','kike','masturbat','milf','nazi','nigg','nutsack','orgasm',
			'orgy','penis','porn','pussy','rectum','retard','scrotum','semen',
			'shit','slut','spunk','testicle','twat','vagina','viagra','vulva',
			'wank','whore'
		]) as w
	), short_words as (
		select unnest(array[
			'anal','ass','asses','boob','boobs','butt','cock','cocks','coon','crap',
			'cum','damn','dick','dicks','dyke','fag','fags','fart','hell','hoe',
			'hoes','homo','knob','labia','negro','nipple','nipples','piss','poop',
			'prick','pube','pubes','queer','rape','rapes','sex','suck','sucks',
			'tit','tits','turd','wtf'
		]) as w
	)
	select
		not exists (select 1 from forms, long_words where position(long_words.w in forms.f) > 0)
		and not exists (select 1 from tokens, short_words where tokens.t = short_words.w)
		and not exists (select 1 from forms, short_words where forms.f = short_words.w);
$$;

revoke all on function public._text_is_clean(text) from public;

comment on function public._text_is_clean(text) is
	'False when the text contains a blocked word once case, spacing, punctuation and the obvious letter-for-digit substitutions are folded away. The team name filter lives in the DATABASE because the student runtime replays queued writes and a board device posts directly: a client-side check is one forgotten screen away from useless.';

create or replace function public._teams_short_name_clean()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	if new.short_name is not null and not public._text_is_clean(new.short_name) then
		raise exception 'That team name has a word we do not allow. Pick another one.';
	end if;
	return new;
end;
$$;

-- Private, like every other underscore helper: a trigger function is
-- executed by the trigger, never by a caller. The catalog test asserts it.
revoke all on function public._teams_short_name_clean() from public;

drop trigger if exists teams_short_name_clean on public.teams;
create trigger teams_short_name_clean
	before insert or update of short_name on public.teams
	for each row execute function public._teams_short_name_clean();

comment on column public.teams.short_name is
	'The name the team chose for itself, shown UNDER the number. teams.name stays "Team 1" through "Team 4"; this is secondary everywhere it appears.';

-- ---------------------------------------------------------------------------
-- 6. team_create, rebuilt against the new type. THE SIGNATURE TRAP: the old
--    three-argument function was dropped at its exact argument types in
--    section 2, before the type it named was replaced. A team created without
--    a colour gets none: nobody is assigned one any more.
-- ---------------------------------------------------------------------------
create or replace function public.team_create(
	p_name text,
	p_fll_team_number integer default null,
	p_accent public.team_accent default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_name text := btrim(coalesce(p_name, ''));
	v_team public.teams%rowtype;
	v_attempt int := 0;
begin
	if not public.is_mentor() then
		raise exception 'Only a mentor can create a team.';
	end if;
	if length(v_name) not between 1 and 80 then
		raise exception 'A team name is 1 to 80 characters.';
	end if;
	if p_fll_team_number is not null and p_fll_team_number not between 1 and 999999 then
		raise exception 'An FLL team number is between 1 and 999999.';
	end if;
	if p_accent is not null and exists (
		select 1 from public.teams t where t.accent = p_accent and t.archived_at is null
	) then
		raise exception 'Another team already has that colour. Pick another one.';
	end if;

	loop
		v_attempt := v_attempt + 1;
		begin
			insert into public.teams (name, fll_team_number, join_code, accent)
			values (v_name, p_fll_team_number, public._generate_join_code(), p_accent)
			returning * into v_team;
			exit;
		exception when unique_violation then
			if v_attempt >= 5 then
				raise exception 'The team could not be given a join code. Try again.';
			end if;
		end;
	end loop;

	return jsonb_build_object(
		'team_id', v_team.id,
		'name', v_team.name,
		'join_code', v_team.join_code,
		'accent', v_team.accent
	);
end;
$$;

revoke all on function public.team_create(text, integer, public.team_accent) from public;
grant execute on function public.team_create(text, integer, public.team_accent) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. What is on offer. One statement of "which colours exist and who holds
--    them", so the picker cannot show a stale list or invent a swatch. The
--    derived-answer rule: this is a rule, not a row, so it lives in SQL.
-- ---------------------------------------------------------------------------
create or replace function public.team_accent_options()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(jsonb_agg(jsonb_build_object(
		'accent', a.accent,
		'taken_by_team_id', t.id,
		'taken_by', t.name
	) order by a.ord), '[]'::jsonb)
	from unnest(enum_range(null::public.team_accent)) with ordinality as a(accent, ord)
	left join public.teams t on t.accent = a.accent and t.archived_at is null;
$$;

revoke all on function public.team_accent_options() from public;
grant execute on function public.team_accent_options() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Propose. Any member of the team, and any mentor. A proposal is a
--    suggestion: it takes no seat, so two teams may propose the same colour
--    and only the confirm decides.
-- ---------------------------------------------------------------------------
create or replace function public.team_propose_accent(p_accent public.team_accent)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_team_id uuid := public.current_student_team_id();
	v_student_id uuid := public.current_student_id();
	v_holder text;
begin
	if p_accent is null then
		raise exception 'Pick a colour first.';
	end if;
	if v_team_id is null then
		raise exception 'Only someone on the team can suggest a colour.';
	end if;

	select t.name into v_holder
	from public.teams t
	where t.accent = p_accent and t.archived_at is null and t.id <> v_team_id;
	if found then
		raise exception '% already has that colour. Pick another one.', v_holder;
	end if;

	update public.teams
	set accent_proposed = p_accent,
		accent_proposed_by = v_student_id,
		accent_proposed_at = now()
	where id = v_team_id;

	return jsonb_build_object('team_id', v_team_id, 'accent_proposed', p_accent);
end;
$$;

revoke all on function public.team_propose_accent(public.team_accent) from public;
grant execute on function public.team_propose_accent(public.team_accent) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Confirm. The Run Captain or a mentor, via 0012's strategy_can_edit --
--    the one statement of that rule in this schema. The unique index decides
--    the race; the 23505 is caught here and turned into a sentence naming
--    the team that got there first.
--
--    THE GATE IS WRAPPED IN coalesce(..., false) ON PURPOSE. current_*_id()
--    is NULL for a caller who is not that thing, and PL/pgSQL's IF treats
--    NULL as "no" and falls straight THROUGH `if not (...)`. See CLAUDE.md.
-- ---------------------------------------------------------------------------
create or replace function public.team_confirm_accent(
	p_team_id uuid,
	p_accent public.team_accent default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_team public.teams%rowtype;
	v_accent public.team_accent;
	v_holder text;
begin
	if p_team_id is null then
		raise exception 'Pick a team first.';
	end if;
	if not coalesce(public.strategy_can_edit(p_team_id), false) then
		raise exception 'Only the Run Captain or a mentor can confirm the team colour.';
	end if;

	select * into v_team from public.teams where id = p_team_id for update;
	if not found then
		raise exception 'That team does not exist.';
	end if;
	if v_team.archived_at is not null then
		raise exception 'That team is archived.';
	end if;

	v_accent := coalesce(p_accent, v_team.accent_proposed);
	if v_accent is null then
		raise exception 'Nobody has suggested a colour yet.';
	end if;

	begin
		update public.teams
		set accent = v_accent,
			accent_proposed = null,
			accent_proposed_by = null,
			accent_proposed_at = null
		where id = p_team_id;
	exception when unique_violation then
		select t.name into v_holder
		from public.teams t
		where t.accent = v_accent and t.archived_at is null;
		raise exception '% took that colour a moment before you did. Pick another one.',
			coalesce(v_holder, 'Another team');
	end;

	return jsonb_build_object('team_id', p_team_id, 'accent', v_accent);
end;
$$;

revoke all on function public.team_confirm_accent(uuid, public.team_accent) from public;
grant execute on function public.team_confirm_accent(uuid, public.team_accent) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. The mentor override, and the short name. A mentor may set any team's
--     colour, including clearing it, and may set any team's short name; the
--     Run Captain may set their own team's short name. The wordlist trigger
--     is beneath both.
-- ---------------------------------------------------------------------------
create or replace function public.team_set_accent(
	p_team_id uuid,
	p_accent public.team_accent default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_holder text;
begin
	if not coalesce(public.is_mentor(), false) then
		raise exception 'Only a mentor can set another team''s colour.';
	end if;
	if p_team_id is null then
		raise exception 'Pick a team first.';
	end if;

	begin
		update public.teams
		set accent = p_accent,
			accent_proposed = null,
			accent_proposed_by = null,
			accent_proposed_at = null
		where id = p_team_id;
	exception when unique_violation then
		select t.name into v_holder
		from public.teams t
		where t.accent = p_accent and t.archived_at is null;
		raise exception '% already has that colour. Take it off them first.',
			coalesce(v_holder, 'Another team');
	end;

	return jsonb_build_object('team_id', p_team_id, 'accent', p_accent);
end;
$$;

revoke all on function public.team_set_accent(uuid, public.team_accent) from public;
grant execute on function public.team_set_accent(uuid, public.team_accent) to authenticated;

create or replace function public.team_set_short_name(p_team_id uuid, p_short_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_name text := nullif(btrim(coalesce(p_short_name, '')), '');
begin
	if p_team_id is null then
		raise exception 'Pick a team first.';
	end if;
	if not coalesce(public.strategy_can_edit(p_team_id), false) then
		raise exception 'Only the Run Captain or a mentor can set the team name.';
	end if;
	if v_name is not null and length(v_name) not between 2 and 24 then
		raise exception 'A team name is 2 to 24 characters.';
	end if;
	if v_name is not null and v_name !~ '^[A-Za-z0-9][A-Za-z0-9 ''!-]*$' then
		raise exception 'A team name uses letters, numbers, spaces, apostrophes, hyphens and exclamation marks.';
	end if;

	-- The wordlist trigger fires beneath this and raises its own sentence.
	update public.teams set short_name = v_name where id = p_team_id;

	return jsonb_build_object('team_id', p_team_id, 'short_name', v_name);
end;
$$;

revoke all on function public.team_set_short_name(uuid, text) from public;
grant execute on function public.team_set_short_name(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Grants and reads. The new columns are readable by anyone who could
--     already read the team; none of them is client-writable, because every
--     write goes through one of the RPCs above and each re-checks its caller.
--     0009 granted update (accent) to authenticated for the old assign flow;
--     that grant is withdrawn, so the unique index and the RPCs are the only
--     way a colour changes.
-- ---------------------------------------------------------------------------
revoke update (accent) on public.teams from authenticated;
grant select (
	id, name, short_name, join_code, fll_team_number, accent, accent_proposed,
	accent_proposed_by, accent_proposed_at, archived_at, created_at, updated_at,
	join_open_since, join_open_meeting_id
) on public.teams to authenticated;

do $$
declare
	v_teams int;
	v_named int;
begin
	select count(*), count(*) filter (where name ~ '^Team [0-9]+$')
	into v_teams, v_named
	from public.teams where archived_at is null;
	raise notice '0018: % live team(s), % numbered, 0 with a colour until they choose.', v_teams, v_named;
end;
$$;

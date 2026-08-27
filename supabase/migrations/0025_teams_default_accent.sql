-- supabase/migrations/0025_teams_default_accent.sql
--
-- A TEAM WITH NO COLOUR IS A TEAM THAT LOOKS LIKE EVERY OTHER TEAM, AND ALL
-- FOUR OF THEM HAD NO COLOUR.
--
-- 0018 shipped eleven measured team accents, derived on both grounds, excluded
-- from the mat's red and blue, and separated by at least dE 21.4. Nothing has
-- used one since, because `teams.accent` is nullable and every team was created
-- NULL: the live board's 6px rail, the team card's wash, the notebook tab and
-- the route planner's mission chips all fall back to --text-2, so six team
-- cards on the console read as six identical grey cards. The variety the app
-- needs was sitting in the stylesheet, measured and unreachable.
--
-- WHY THIS IS A MIGRATION AND NOT A SCREEN. A colour a team has not chosen is
-- still a real state and the proposal flow stays exactly as 0018 built it
-- (`team_propose_accent`, `team_confirm_accent`, `team_set_accent`). What this
-- file changes is the STARTING state: a team begins with a colour instead of
-- beginning identical to its neighbours, and changing it is the same one tap it
-- always was.
--
-- WHAT IT DOES NOT DO:
--   * It never overwrites a colour a team already chose. Only `accent is null`.
--   * It never touches an archived team.
--   * It hands out at most one accent per live team, in enum order, because
--     `teams_accent_unique_live` is a unique index over live teams and a
--     duplicate would abort the whole migration. Where there are more colourless
--     live teams than free colours, the remainder KEEP their null and the file
--     says so with a count rather than failing or inventing a duplicate.
--
-- TO UNDO
--   The colours handed out here are indistinguishable afterwards from colours a
--   team chose, which is the point, so there is no safe blanket undo. To clear
--   one team: update public.teams set accent = null where id = '<uuid>';
--   To clear every team that still holds its starting colour, a mentor's
--   console does it one tap at a time and that is the intended path.

do $$
declare
	v_free public.team_accent[];
	v_team record;
	v_i int := 1;
	v_given int := 0;
	v_left int := 0;
begin
	-- THE ORDER IS DERIVED, NOT CHOSEN BY TASTE. Handing the eleven out in the
	-- enum's own order gives the first four teams bark, orange, olive and lime,
	-- whose closest pair measures dE 18.9 -- two of them are greens and on a
	-- console of small cards they read as the same colour twice. The order
	-- below is a farthest-point walk over the eleven, scoring each pair by its
	-- WORSE ground so a colour that separates well on one sheet and badly on
	-- the other cannot win: it gives lime, purple, teal, orange to the first
	-- four, whose closest pair measures dE 54.8. That is the number that
	-- matters, because this club runs exactly four teams.
	with preferred as (
		select * from unnest(array[
			'lime', 'purple', 'teal', 'orange', 'magenta', 'bark',
			'green', 'violet', 'orchid', 'sage', 'olive'
		]::public.team_accent[]) with ordinality as p(accent, ord)
	)
	select coalesce(array_agg(p.accent order by p.ord), '{}')
	into v_free
	from preferred p
	where not exists (
		select 1 from public.teams t
		where t.accent = p.accent and t.archived_at is null
	);

	-- The list above must name every value of the enum, or a colour silently
	-- stops being handed out when a twelfth is added.
	if (select count(*) from unnest(enum_range(null::public.team_accent))) <> 11 then
		raise exception 'The team accent enum is no longer eleven values. Update the hand-out order in 0025 before adding a colour.';
	end if;

	for v_team in
		select id, name from public.teams
		where accent is null and archived_at is null
		order by name, created_at, id
	loop
		if v_i > array_length(v_free, 1) then
			v_left := v_left + 1;
			continue;
		end if;
		update public.teams set accent = v_free[v_i] where id = v_team.id;
		raise notice '0025: % takes %', v_team.name, v_free[v_i];
		v_i := v_i + 1;
		v_given := v_given + 1;
	end loop;

	raise notice '0025: % live team(s) given a starting colour, % left without one (no free colour).',
		v_given, v_left;
end $$;

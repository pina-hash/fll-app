-- supabase/seed.sql
--
-- LOCAL DEVELOPMENT SEED. Runs after the migration chain on `supabase db reset`
-- and `supabase start`; `supabase db push` does NOT send it to the linked
-- project (and must not: the admin below is a placeholder account).
--
-- What it creates:
--   1. one admin mentor, via the same auth.users insert GoTrue performs for a
--      Google sign-in, so 0002's trigger is what makes the mentors row (and
--      what makes it the admin, as the first one). It also gets a local-only
--      password so tests and dev tooling can sign in without Google;
--   2. four numbered teams with generated join codes and a starting colour;
--   3. the standard phase template for both meeting kinds:
--        Friday,   90 min: Huddle 10, Role Blocks 60, Mat Run 15, Close 5
--        Saturday, 120 min: Huddle 10, Role Blocks 75, Mat Time 25, Close 10
--
-- Team names and numbers are placeholders until FIRST assigns numbers.

-- ---------------------------------------------------------------------------
-- 1. Admin mentor (shape of a GoTrue Google sign-in, plus a dev password).
-- ---------------------------------------------------------------------------
do $$
declare
	v_uid uuid := '00000000-0000-4000-8000-000000000001';
begin
	if exists (select 1 from auth.users where id = v_uid) then
		raise notice 'seed: admin mentor already present; skipped.';
		return;
	end if;

	insert into auth.users (
		instance_id, id, aud, role, email, encrypted_password,
		email_confirmed_at, confirmation_token, recovery_token,
		email_change_token_new, email_change, email_change_token_current, email_change_confirm_status,
		phone_change, phone_change_token, reauthentication_token,
		raw_app_meta_data, raw_user_meta_data,
		is_super_admin, is_sso_user, is_anonymous,
		created_at, updated_at
	) values (
		'00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
		'admin@boscotech.edu',
		extensions.crypt('mentor-local-password', extensions.gen_salt('bf', 10)),
		now(), '', '',
		'', '', '', 0,
		'', '', '',
		jsonb_build_object('provider', 'google', 'providers', jsonb_build_array('google')),
		jsonb_build_object('full_name', 'Seed Admin', 'email', 'admin@boscotech.edu'),
		false, false, false,
		now(), now()
	);

	insert into auth.identities (
		id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
	) values (
		gen_random_uuid(), v_uid, 'seed-google-sub-1', 'google',
		jsonb_build_object('sub', 'seed-google-sub-1', 'email', 'admin@boscotech.edu', 'email_verified', true, 'full_name', 'Seed Admin'),
		null, now(), now()
	);

	raise notice 'seed: admin mentor admin@boscotech.edu created (is_admin = %).',
		(select m.is_admin from public.mentors m where m.auth_user_id = v_uid);
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Four teams, NUMBERED AND EACH WITH A STARTING COLOUR. Direct insert (the
--    seed runs as postgres, not as a mentor); join codes come from the same
--    generator team_create uses.
--
--    THE FOUR COLOURS ARE 0025's, AND THEY ARE HERE BECAUSE THE SEED RUNS
--    AFTER THE MIGRATION CHAIN. `supabase db reset` applies 0025 to an empty
--    teams table, which is a no-op, and then this file creates the teams; a
--    seed that left them null would put a local stack back in exactly the state
--    0025 exists to end, with four identical grey cards on the console.
--
--    A team still CHOOSES its colour: propose, confirm, override, all unchanged
--    from 0018. What changed is the state a team starts in.
-- ---------------------------------------------------------------------------
do $$
declare
	v_seed constant text[][] := array[
		array['Team 1', 'lime'], array['Team 2', 'purple'],
		array['Team 3', 'teal'], array['Team 4', 'orange']
	];
	v_i int;
	v_n int := 0;
begin
	for v_i in 1 .. array_length(v_seed, 1) loop
		if not exists (select 1 from public.teams t where t.name = v_seed[v_i][1]) then
			insert into public.teams (name, join_code, accent)
			values (v_seed[v_i][1], public._generate_join_code(), v_seed[v_i][2]::public.team_accent);
			v_n := v_n + 1;
		end if;
	end loop;
	raise notice 'seed: % of 4 teams created, each with a starting colour.', v_n;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Phase templates.
-- ---------------------------------------------------------------------------
insert into public.phase_templates (kind, ordinal, name, planned_minutes)
values
	('friday',   1, 'Huddle',      10),
	('friday',   2, 'Role Blocks', 60),
	('friday',   3, 'Mat Run',     15),
	('friday',   4, 'Close',        5),
	('saturday', 1, 'Huddle',      10),
	('saturday', 2, 'Role Blocks', 75),
	('saturday', 3, 'Mat Time',    25),
	('saturday', 4, 'Close',       10)
on conflict (kind, ordinal) do update
	set name = excluded.name,
		planned_minutes = excluded.planned_minutes;

do $$
begin
	raise notice 'seed: phase templates friday=% min, saturday=% min.',
		(select sum(planned_minutes) from public.phase_templates where kind = 'friday'),
		(select sum(planned_minutes) from public.phase_templates where kind = 'saturday');
end
$$;

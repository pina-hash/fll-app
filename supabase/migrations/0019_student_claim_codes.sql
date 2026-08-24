-- 0019_student_claim_codes.sql
--
-- A SEAT IS HANDED OUT, NOT LEFT OPEN. A mentor mints N empty seats on a
-- team; each seat carries one short single-use CLAIM CODE printed on a card;
-- the child types that code, their own name and grade, picks a PIN, and is
-- signed in. The open join window from 0013 is REMOVED in the same file,
-- because two enrollment doors means one of them is untested on the morning
-- it matters.
--
-- Applied by the Supabase CLI, after 0018.
--
-- WHY A CODE PER CHILD RATHER THAN A WINDOW PER TEAM. The window was built
-- for a mentor who knows the room: open it, watch six children type, close
-- it. The mentor this season does not know the children's names, and a window
-- is open to whoever is holding a team code -- an older sibling, a child from
-- another team, the same child twice. A claim code is issued once, spent
-- once, and can be voided before it is spent, so the question "who is allowed
-- to take this seat" is answered by whoever the mentor hands the card to
-- rather than by a clock.
--
-- A LIVE CODE HOLDS A SEAT, AND THAT IS WHAT MAKES THE CAP HONEST. The cap is
-- six ACTIVE students per team (0013, team_size_cap()). If an unclaimed code
-- did not count, a mentor could print six cards for a team that already has
-- four students and two children would be turned away at the tablet holding a
-- card that says they have a seat. So from here the cap counts ACTIVE
-- STUDENTS PLUS LIVE CLAIM CODES, and _students_team_cap is rewritten to say
-- so; a second trigger holds the same line for the codes themselves. A code
-- that has been claimed no longer holds a seat (the student it minted does);
-- a voided code holds nothing.
--
-- THE ORDER INSIDE REDEMPTION IS LOAD-BEARING. student_claim_seat marks the
-- code CLAIMED BEFORE it inserts the student. The other order deadlocks the
-- arithmetic against itself: with four students and two live codes the team
-- is full at six, and inserting the student first asks the cap to allow a
-- seventh seat for the duration of one statement. Marking first hands the
-- seat over rather than adding one, and the count never leaves the cap.
--
-- WHAT STOPS THE INTERNET FROM MINTING AN ACCOUNT. student_claim_seat is
-- granted to `anon`, because the whole point is a child who has never signed
-- in -- and it replaces student_self_enroll one for one, so the number of
-- functions `anon` may execute is still FIVE and tests/schema-catalog.test.ts
-- still says so. In front of it stands a single-use secret the mentor handed
-- over on paper. It builds the login address itself from the team's join code
-- and the deduplicated slug, exactly as 0004 does, so no caller names an
-- account; 0002/0010's auth.users trigger still demands the transaction-local
-- `fll.creating_student` flag, which only a definer body in this schema can
-- raise; and the code row is taken `for update` before it is read, so two
-- tablets racing on one card resolve in Postgres.
--
-- THE ALPHABET IS THE JOIN CODE'S, FOR THE REASON THE JOIN CODE HAS IT.
-- _generate_claim_code() draws from the same 32 symbols as
-- _generate_join_code() (0001): A-Z without I and O, 2-9 without 0 and 1.
-- A code is read aloud across a noisy room and typed by a nine-year-old on an
-- iPad, so a character that is two characters depending on the font is a
-- support call. Six symbols is 1.07 billion codes; a collision retries.
--
-- A CLAIM CODE IS NOT A PIN AND IS NOT HASHED. A PIN authenticates a person
-- for the season and is bcrypt from the moment it is set (0004). A claim code
-- is a one-shot bearer token for a seat that stops working the second it is
-- spent, and a mentor has to be able to reprint a card for the child who lost
-- theirs on the way to the car. It is therefore a column, readable by mentors
-- and by nobody else. That is the same argument 0014 makes for the parent
-- token, and it does not generalise any further than these two.
--
-- WHAT THIS FILE DOES NOT DO. It does not touch student_create: a mentor who
-- DOES know a child's name still types them in, and that path is unchanged.
-- It does not delete any student, any claimed code, or any history. It does
-- not give a claim code an expiry: the card in a child's pocket is the state,
-- and a mentor who wants it dead voids it.
--
-- ===========================================================================
-- TO UNDO
-- ===========================================================================
--
--   -- 1. The claim surface.
--   drop function if exists public.student_claim_seat(text, text, text, smallint, text);
--   drop function if exists public.team_claim_codes(uuid);
--   drop function if exists public.team_claim_code_reissue(uuid);
--   drop function if exists public.team_claim_code_void(uuid);
--   drop function if exists public.team_claim_codes_issue(uuid, integer);
--   drop trigger if exists claim_codes_team_cap on public.student_claim_codes;
--   drop function if exists public._claim_codes_team_cap();
--   drop trigger if exists claim_codes_set_updated_at on public.student_claim_codes;
--   drop function if exists public._generate_claim_code();
--   drop table if exists public.student_claim_codes;
--
--   -- 2. The cap, back to counting students only (0013's body).
--   -- Re-run 0013's _students_team_cap() definition verbatim.
--
--   -- 3. The join window, back from 0013.
--   alter table public.teams
--     add column if not exists join_open_since timestamptz,
--     add column if not exists join_open_meeting_id uuid references public.meetings (id) on delete set null;
--   -- Re-run 0013's team_join_open(uuid), team_join_window_open(uuid),
--   -- team_join_window_close(uuid) and student_self_enroll(...) definitions,
--   -- 0016's meeting_end(uuid) definition, and 0013's team_login_roster(text)
--   -- and team_roster_state() definitions, verbatim.
--
-- Nothing outside this file references student_claim_codes.

-- ---------------------------------------------------------------------------
-- 1. The table.
-- ---------------------------------------------------------------------------
create table if not exists public.student_claim_codes (
	id uuid primary key default gen_random_uuid(),
	team_id uuid not null references public.teams (id),
	code char(6) not null unique,
	issued_by_mentor_id uuid not null references public.mentors (id),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	claimed_at timestamptz,
	claimed_student_id uuid,
	voided_at timestamptz,
	voided_by_mentor_id uuid references public.mentors (id),

	-- The composite key every student reference in this schema carries: "the
	-- student named on this row is on this row's team" is a constraint, not a
	-- convention. Both columns are null until the code is spent, and a
	-- MATCH SIMPLE foreign key is not enforced while any column is null,
	-- which is exactly the wanted behaviour for an unclaimed seat.
	-- DEFERRED, and that is what lets the claim be spent before the student
	-- exists. Redemption mints the student's uuid first, stamps the claim with
	-- it (which is what hands the seat over, see the header), and only then
	-- inserts the row; the pair is checked at commit, by which time both
	-- halves are there.
	constraint student_claim_codes_student_fkey
		foreign key (claimed_student_id, team_id)
		references public.students (id, team_id)
		deferrable initially deferred,

	-- Claimed and voided are the two ways a code stops being a seat, and they
	-- are mutually exclusive: voiding a spent code would rewrite history.
	constraint student_claim_codes_one_end
		check (not (claimed_at is not null and voided_at is not null)),
	-- A claim names the student it minted, always.
	constraint student_claim_codes_claim_names_student
		check ((claimed_at is null) = (claimed_student_id is null)),
	constraint student_claim_codes_void_names_mentor
		check ((voided_at is null) = (voided_by_mentor_id is null))
);

-- "Which seats are still open on this team" is the question the console asks
-- on every render and the cap asks on every write.
create index if not exists student_claim_codes_live_idx
	on public.student_claim_codes (team_id)
	where claimed_at is null and voided_at is null;

drop trigger if exists claim_codes_set_updated_at on public.student_claim_codes;
create trigger claim_codes_set_updated_at
	before update on public.student_claim_codes
	for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Grants and RLS.
--
-- No client writes this table: every transition is an RPC that re-checks its
-- own caller. Mentors read it (the console lists the seats and prints the
-- cards); students and board devices never see a code that is not their own,
-- and they have no reason to see one at all.
-- ---------------------------------------------------------------------------
revoke all on public.student_claim_codes from anon, authenticated;
grant all on public.student_claim_codes to service_role;
grant select on public.student_claim_codes to authenticated;

alter table public.student_claim_codes enable row level security;

drop policy if exists "mentors read claim codes" on public.student_claim_codes;
create policy "mentors read claim codes" on public.student_claim_codes
	for select to authenticated
	using ((select public.is_mentor()));

-- ---------------------------------------------------------------------------
-- 3. The code generator.
-- ---------------------------------------------------------------------------
create or replace function public._generate_claim_code()
returns char(6)
language plpgsql
volatile
set search_path = ''
as $$
declare
	v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	v_bytes bytea := extensions.gen_random_bytes(6);
	v_code text := '';
	v_i int;
begin
	for v_i in 0..5 loop
		v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, v_i) % 32) + 1, 1);
	end loop;
	return v_code;
end;
$$;
revoke all on function public._generate_claim_code() from public;

-- ---------------------------------------------------------------------------
-- 4. The cap, counting seats rather than students.
--
-- A SEAT IS A STUDENT OR A PROMISE OF ONE. Both triggers take the SAME
-- advisory lock 0013 took, on the same key, so a claim being issued and a
-- student being created serialise against each other rather than each reading
-- five.
-- ---------------------------------------------------------------------------
create or replace function public._team_seats_taken(p_team_id uuid, p_exclude_claim uuid default null)
returns integer
language sql
stable
set search_path = ''
as $$
	select
		(select count(*) from public.students s
		 where s.team_id = p_team_id and s.deactivated_at is null)
		+
		(select count(*) from public.student_claim_codes c
		 where c.team_id = p_team_id
			 and c.claimed_at is null
			 and c.voided_at is null
			 and (p_exclude_claim is null or c.id <> p_exclude_claim));
$$;
revoke all on function public._team_seats_taken(uuid, uuid) from public;

create or replace function public._students_team_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_cap integer := public.team_size_cap();
	v_taken integer;
	v_students integer;
	v_codes integer;
begin
	if new.deactivated_at is not null then
		return new;
	end if;
	if tg_op = 'UPDATE'
		and old.deactivated_at is null
		and old.team_id = new.team_id
	then
		return new;
	end if;

	-- Serialise every seat count for THIS team for the rest of the
	-- transaction. Two enrollments landing in the same millisecond queue up
	-- here instead of both reading five.
	perform pg_advisory_xact_lock(hashtext('public.students.team_cap'), hashtext(new.team_id::text));

	-- Students already on the team, plus seats promised by a live claim code,
	-- and never this row.
	select count(*) into v_students
	from public.students s
	where s.team_id = new.team_id and s.deactivated_at is null and s.id <> new.id;
	select count(*) into v_codes
	from public.student_claim_codes c
	where c.team_id = new.team_id and c.claimed_at is null and c.voided_at is null;
	v_taken := v_students + v_codes;

	-- THE SENTENCE NAMES WHAT IS ACTUALLY IN THE WAY. A team full of children
	-- and a team full of cards nobody has spent are different problems with
	-- different fixes, and telling a mentor "6 students and unclaimed seats"
	-- when there are no cards out would be a small lie. The first branch is
	-- 0013's sentence, unchanged, because in the common case nothing about
	-- this has changed.
	if v_taken >= v_cap then
		if v_codes = 0 then
			raise exception 'That team already has % students, which is the most a team can hold. Take somebody off the team first, or use another team.', v_cap;
		end if;
		raise exception 'That team has % students and % unclaimed seat codes, which together are the most a team can hold. Take somebody off the team, or void a seat code, first.', v_students, v_codes;
	end if;

	return new;
end;
$$;
revoke all on function public._students_team_cap() from public;

create or replace function public._claim_codes_team_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_cap integer := public.team_size_cap();
	v_taken integer;
begin
	-- Only a LIVE code holds a seat. Claiming one and voiding one both give a
	-- seat back rather than taking one, so neither is counted here.
	if new.claimed_at is not null or new.voided_at is not null then
		return new;
	end if;

	perform pg_advisory_xact_lock(hashtext('public.students.team_cap'), hashtext(new.team_id::text));

	v_taken := public._team_seats_taken(new.team_id, new.id);

	if v_taken >= v_cap then
		raise exception 'Every seat on that team is taken. Take somebody off the team, or void a seat code, first.';
	end if;

	return new;
end;
$$;
revoke all on function public._claim_codes_team_cap() from public;

drop trigger if exists claim_codes_team_cap on public.student_claim_codes;
create trigger claim_codes_team_cap
	before insert or update on public.student_claim_codes
	for each row execute function public._claim_codes_team_cap();

-- ---------------------------------------------------------------------------
-- 5. Minting seats.
--
-- N at a time, because a mentor standing in front of a table wants four cards
-- and does not want to press the button four times.
-- ---------------------------------------------------------------------------
create or replace function public.team_claim_codes_issue(p_team_id uuid, p_count integer default 1)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_team public.teams%rowtype;
	v_mentor_id uuid := public.current_mentor_id();
	v_cap integer := public.team_size_cap();
	v_taken integer;
	v_room integer;
	v_code char(6);
	v_attempt integer;
	v_i integer;
	v_out jsonb := '[]'::jsonb;
	v_row public.student_claim_codes%rowtype;
begin
	if not coalesce(public.is_mentor(), false) then
		raise exception 'Only a mentor can hand out seats.';
	end if;
	if coalesce(p_count, 0) < 1 then
		raise exception 'Say how many seats to open.';
	end if;

	select t.* into v_team
	from public.teams t
	where t.id = p_team_id and t.archived_at is null
	for update;
	if not found then
		raise exception 'That team is not here any more.';
	end if;

	-- The same lock the cap triggers take, so the count below cannot go stale
	-- between here and the inserts.
	perform pg_advisory_xact_lock(hashtext('public.students.team_cap'), hashtext(v_team.id::text));

	v_taken := public._team_seats_taken(v_team.id);
	v_room := v_cap - v_taken;
	if v_room <= 0 then
		raise exception 'Every seat on % is taken. Take somebody off the team, or void a claim code, first.', v_team.name;
	end if;
	if p_count > v_room then
		raise exception 'There is room for % more on %, not %.', v_room, v_team.name, p_count;
	end if;

	for v_i in 1..p_count loop
		v_attempt := 0;
		loop
			v_attempt := v_attempt + 1;
			begin
				insert into public.student_claim_codes (team_id, code, issued_by_mentor_id)
				values (v_team.id, public._generate_claim_code(), v_mentor_id)
				returning * into v_row;
				exit;
			exception
				when unique_violation then
					if v_attempt >= 10 then
						raise exception 'Could not mint a unique claim code after % tries.', v_attempt;
					end if;
			end;
		end loop;
		v_out := v_out || jsonb_build_object('claim_id', v_row.id, 'code', v_row.code);
	end loop;

	raise notice 'issued % claim codes on %', p_count, v_team.name;

	return jsonb_build_object(
		'team_id', v_team.id,
		'team_name', v_team.name,
		'short_name', v_team.short_name,
		'fll_team_number', v_team.fll_team_number,
		'issued', p_count,
		'seats_left', v_cap - public._team_seats_taken(v_team.id),
		'codes', v_out
	);
end;
$$;

revoke all on function public.team_claim_codes_issue(uuid, integer) from public;
grant execute on function public.team_claim_codes_issue(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Voiding and reissuing an unspent seat.
--
-- A card that has been lost, or handed to the wrong child, or printed for a
-- seat that turned out not to exist. A SPENT code is never voided: the
-- student it minted is the record of what happened.
-- ---------------------------------------------------------------------------
create or replace function public.team_claim_code_void(p_claim_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_claim public.student_claim_codes%rowtype;
	v_team public.teams%rowtype;
	v_student public.students%rowtype;
begin
	if not coalesce(public.is_mentor(), false) then
		raise exception 'Only a mentor can void a claim code.';
	end if;

	select c.* into v_claim from public.student_claim_codes c where c.id = p_claim_id for update;
	if not found then
		raise exception 'That claim code is not here any more.';
	end if;
	if v_claim.voided_at is not null then
		raise exception 'That code was already voided.';
	end if;
	if v_claim.claimed_at is not null then
		select s.* into v_student from public.students s where s.id = v_claim.claimed_student_id;
		raise exception 'That code has already been used by % %. Take them off the team instead.',
			coalesce(v_student.first_name, 'somebody'), coalesce(v_student.last_initial, '');
	end if;

	update public.student_claim_codes
	set voided_at = now(), voided_by_mentor_id = public.current_mentor_id()
	where id = v_claim.id
	returning * into v_claim;

	select t.* into v_team from public.teams t where t.id = v_claim.team_id;

	return jsonb_build_object(
		'claim_id', v_claim.id,
		'code', v_claim.code,
		'team_id', v_claim.team_id,
		'voided_at', v_claim.voided_at,
		'seats_left', public.team_size_cap() - public._team_seats_taken(v_claim.team_id)
	);
end;
$$;

revoke all on function public.team_claim_code_void(uuid) from public;
grant execute on function public.team_claim_code_void(uuid) to authenticated;

-- Reissue is void-then-mint in one transaction, so the seat is never released
-- to somebody else in between and the count never dips.
create or replace function public.team_claim_code_reissue(p_claim_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_claim public.student_claim_codes%rowtype;
	v_new jsonb;
begin
	if not coalesce(public.is_mentor(), false) then
		raise exception 'Only a mentor can reissue a claim code.';
	end if;

	select c.* into v_claim from public.student_claim_codes c where c.id = p_claim_id for update;
	if not found then
		raise exception 'That claim code is not here any more.';
	end if;
	if v_claim.claimed_at is not null then
		raise exception 'That code has already been used. Hand out a new seat instead.';
	end if;

	if v_claim.voided_at is null then
		perform public.team_claim_code_void(v_claim.id);
	end if;
	v_new := public.team_claim_codes_issue(v_claim.team_id, 1);

	return jsonb_build_object(
		'replaced_claim_id', v_claim.id,
		'replaced_code', v_claim.code,
		'team_id', v_claim.team_id,
		'claim_id', v_new -> 'codes' -> 0 ->> 'claim_id',
		'code', v_new -> 'codes' -> 0 ->> 'code',
		'seats_left', v_new ->> 'seats_left'
	);
end;
$$;

revoke all on function public.team_claim_code_reissue(uuid) from public;
grant execute on function public.team_claim_code_reissue(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. What the console shows: every seat on a team and what became of it.
-- ---------------------------------------------------------------------------
create or replace function public.team_claim_codes(p_team_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(
		jsonb_agg(
			jsonb_build_object(
				'claim_id', c.id,
				'code', c.code,
				'state', case
					when c.claimed_at is not null then 'claimed'
					when c.voided_at is not null then 'voided'
					else 'open'
				end,
				'created_at', c.created_at,
				'claimed_at', c.claimed_at,
				'voided_at', c.voided_at,
				'student_id', c.claimed_student_id,
				'first_name', s.first_name,
				'last_initial', s.last_initial
			)
			order by
				case when c.claimed_at is null and c.voided_at is null then 0
				     when c.claimed_at is not null then 1
				     else 2 end,
				c.created_at
		),
		'[]'::jsonb
	)
	from public.student_claim_codes c
	left join public.students s on s.id = c.claimed_student_id
	where c.team_id = p_team_id
		and public.is_mentor();
$$;

revoke all on function public.team_claim_codes(uuid) from public;
grant execute on function public.team_claim_codes(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Spending a seat. The one anon door this file opens, and it closes
--    student_self_enroll in the same breath (section 9).
-- ---------------------------------------------------------------------------
create or replace function public.student_claim_seat(
	p_claim_code text,
	p_first_name text,
	p_last_initial text,
	p_grade smallint,
	p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_code text := upper(btrim(coalesce(p_claim_code, '')));
	v_claim public.student_claim_codes%rowtype;
	v_team public.teams%rowtype;
	v_first text := btrim(coalesce(p_first_name, ''));
	v_initial text := upper(btrim(coalesce(p_last_initial, '')));
	v_cap integer := public.team_size_cap();
	v_active integer;
	v_base text;
	v_slug text;
	v_n int := 1;
	v_auth_id uuid := gen_random_uuid();
	v_student_id uuid;
	v_email text;
begin
	select c.* into v_claim
	from public.student_claim_codes c
	where c.code = v_code
	for update;

	if not found then
		-- The confusion that will actually happen in the room: a child typing
		-- the team code off the roster card into the claim box. Saying so is
		-- worth more than hiding it -- they are holding the team code either
		-- way, and a dead end is what loses a nine-year-old.
		if exists (select 1 from public.teams t where t.join_code = v_code) then
			raise exception 'That is your team code, not your seat code. Your seat code is on the card a mentor gave you.';
		end if;
		raise exception 'That seat code does not work. Check the card a mentor gave you.';
	end if;

	if v_claim.voided_at is not null then
		raise exception 'That seat code was cancelled. Ask a mentor for a new card.';
	end if;
	if v_claim.claimed_at is not null then
		raise exception 'That seat code has already been used. Ask a mentor for a new card.';
	end if;

	select t.* into v_team
	from public.teams t
	where t.id = v_claim.team_id and t.archived_at is null
	for update;
	if not found then
		raise exception 'That team is not here any more. Ask a mentor.';
	end if;

	if length(v_first) not between 1 and 40 then
		raise exception 'Type your first name.';
	end if;
	if v_initial !~ '^[A-Z]$' then
		raise exception 'Type the first letter of your last name.';
	end if;
	if p_grade is null or p_grade not between 1 and 12 then
		raise exception 'Pick your grade.';
	end if;
	if coalesce(p_pin, '') !~ '^[0-9]{6}$' then
		raise exception 'A PIN is exactly 6 numbers.';
	end if;

	-- Belt and braces, the way student_self_enroll and student_move_team do
	-- it: the trigger beneath this would refuse anyway, but the sentence a
	-- child reads should name the team rather than the rule. Counted under
	-- the same advisory lock the trigger takes.
	perform pg_advisory_xact_lock(hashtext('public.students.team_cap'), hashtext(v_team.id::text));
	select count(*) into v_active
	from public.students s
	where s.team_id = v_team.id and s.deactivated_at is null;
	if v_active >= v_cap then
		raise exception 'Everybody on % has already signed in. Ask a mentor which team you are on.', v_team.name;
	end if;

	v_base := public._student_slug_base(v_first, v_initial);
	if v_base = '' then
		raise exception 'That name has no letters or numbers to build a login from.';
	end if;
	v_slug := v_base;
	while exists (select 1 from public.students s where s.team_id = v_team.id and s.slug = v_slug) loop
		v_n := v_n + 1;
		v_slug := v_base || v_n::text;
	end loop;
	v_email := public._student_email(v_team.join_code, v_slug);

	-- SPEND THE SEAT FIRST. See the header: marking the code claimed hands
	-- the seat to the student about to be inserted, rather than asking the
	-- cap to hold seven for one statement. Both halves of the claim are
	-- written together, because the check constraint says a claim always
	-- names its student; the composite foreign key is deferred, so naming a
	-- student who is two statements away is legal until commit.
	v_student_id := gen_random_uuid();
	update public.student_claim_codes
	set claimed_at = now(), claimed_student_id = v_student_id
	where id = v_claim.id;

	perform set_config('fll.creating_student', 'on', true);

	insert into auth.users (
		instance_id, id, aud, role, email, encrypted_password,
		email_confirmed_at, invited_at,
		confirmation_token, confirmation_sent_at,
		recovery_token, email_change_token_new, email_change,
		email_change_token_current, email_change_confirm_status,
		phone_change, phone_change_token, reauthentication_token,
		raw_app_meta_data, raw_user_meta_data,
		is_super_admin, is_sso_user, is_anonymous, created_at, updated_at
	) values (
		'00000000-0000-0000-0000-000000000000', v_auth_id, 'authenticated', 'authenticated',
		v_email, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)),
		now(), null,
		'', null,
		'', '', '',
		'', 0,
		'', '', '',
		jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
		jsonb_build_object('first_name', v_first, 'last_initial', v_initial),
		false, false, false, now(), now()
	);

	insert into auth.identities (
		id, user_id, provider_id, provider, identity_data,
		last_sign_in_at, created_at, updated_at
	) values (
		gen_random_uuid(), v_auth_id, v_auth_id::text, 'email',
		jsonb_build_object('sub', v_auth_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
		null, now(), now()
	);

	insert into public.students (id, team_id, first_name, last_initial, grade, slug, auth_user_id)
	values (v_student_id, v_team.id, v_first, v_initial, p_grade, v_slug, v_auth_id);

	perform set_config('fll.creating_student', 'off', true);

	return jsonb_build_object(
		'student_id', v_student_id,
		'team_id', v_team.id,
		'team_name', v_team.name,
		'short_name', v_team.short_name,
		'join_code', v_team.join_code,
		'first_name', v_first,
		'last_initial', v_initial,
		'slug', v_slug,
		'email', v_email
	);
end;
$$;

revoke all on function public.student_claim_seat(text, text, text, smallint, text) from public;
grant execute on function public.student_claim_seat(text, text, text, smallint, text) to anon;

-- ---------------------------------------------------------------------------
-- 9. The open join window is removed, not left standing beside the new door.
--
-- THE SIGNATURE TRAP does not apply here (nothing gains a parameter), but the
-- drops are still explicit and at the exact argument types, because a leftover
-- overload is the thing that makes PostgREST unable to resolve a call.
-- ---------------------------------------------------------------------------
drop function if exists public.student_self_enroll(text, text, text, smallint, text);
drop function if exists public.team_join_window_open(uuid);
drop function if exists public.team_join_window_close(uuid);
drop function if exists public.team_join_open(uuid);

alter table public.teams drop column if exists join_open_since;
alter table public.teams drop column if exists join_open_meeting_id;

-- meeting_end no longer has a window to close. Rewritten whole (0016's body
-- minus the two statements and the returned key), because a migration states
-- the function it wants rather than patching the one it found.
create or replace function public.meeting_end(p_meeting_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_meeting public.meetings%rowtype;
	v_now timestamptz := now();
	v_closed integer;
	v_recaps integer;
begin
	if not coalesce(public.is_mentor(), false) then
		raise exception 'Only a mentor can end a meeting.';
	end if;

	select m.* into v_meeting from public.meetings m where m.id = p_meeting_id for update;
	if not found then
		raise exception 'That meeting is not here any more.';
	end if;
	if v_meeting.started_at is null then
		raise exception 'That meeting has not started yet.';
	end if;
	if v_meeting.ended_at is not null then
		raise exception 'That meeting has already ended.';
	end if;

	update public.meeting_phases
	set ended_at = v_now
	where meeting_id = p_meeting_id and started_at is not null and ended_at is null;
	get diagnostics v_closed = row_count;

	update public.meetings
	set ended_at = v_now, current_phase_id = null
	where id = p_meeting_id;

	v_recaps := public._meeting_recaps_generate(p_meeting_id);

	return jsonb_build_object(
		'meeting_id', p_meeting_id,
		'ended_at', v_now,
		'phases_closed', v_closed,
		'recaps_drafted', v_recaps
	);
end;
$$;

revoke all on function public.meeting_end(uuid) from public;
grant execute on function public.meeting_end(uuid) to authenticated;

-- The login screen no longer asks whether sign-ups are open, because they
-- never are: a child either holds a seat code or does not. `short_name` is
-- added so the screen can say the name the team calls itself (0018) next to
-- the number that identifies it.
create or replace function public.team_login_roster(p_join_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
	select jsonb_build_object(
		'team_id', t.id,
		'team_name', t.name,
		'short_name', t.short_name,
		'join_code', t.join_code,
		'size_cap', public.team_size_cap(),
		'roster_size', (
			select count(*) from public.students s
			where s.team_id = t.id and s.deactivated_at is null
		),
		'roster_full', (
			select count(*) from public.students s
			where s.team_id = t.id and s.deactivated_at is null
		) >= public.team_size_cap(),
		'students', coalesce((
			select jsonb_agg(
				jsonb_build_object(
					'first_name', s.first_name,
					'last_initial', s.last_initial,
					'slug', s.slug
				)
				order by s.first_name, s.last_initial, s.slug
			)
			from public.students s
			where s.team_id = t.id and s.deactivated_at is null
		), '[]'::jsonb)
	)
	from public.teams t
	where t.join_code = upper(btrim(p_join_code))
		and t.archived_at is null;
$$;

revoke all on function public.team_login_roster(text) from public;
grant execute on function public.team_login_roster(text) to anon, authenticated;

-- The console's roster pane counts SEATS now: students on the team, plus the
-- cards a mentor has handed out and nobody has spent yet.
create or replace function public.team_roster_state()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(
		jsonb_agg(
			jsonb_build_object(
				'team_id', t.id,
				'name', t.name,
				'short_name', t.short_name,
				'join_code', t.join_code,
				'accent', t.accent,
				'size_cap', public.team_size_cap(),
				'roster_size', (
					select count(*) from public.students s
					where s.team_id = t.id and s.deactivated_at is null
				),
				'claims_open', (
					select count(*) from public.student_claim_codes c
					where c.team_id = t.id and c.claimed_at is null and c.voided_at is null
				),
				'seats_left', greatest(public.team_size_cap() - public._team_seats_taken(t.id), 0)
			)
			order by t.name
		),
		'[]'::jsonb
	)
	from public.teams t
	where t.archived_at is null
		and public.is_mentor();
$$;

revoke all on function public.team_roster_state() from public;
grant execute on function public.team_roster_state() to authenticated;

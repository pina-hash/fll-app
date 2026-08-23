-- 0004_students.sql
--
-- STUDENTS: the COPPA-age population. No real email, no self-registration,
-- ever. A mentor mints the account through student_create, which writes
-- auth.users, auth.identities and public.students in ONE transaction; the PIN
-- is reset through student_reset_pin, which writes auth.users.encrypted_password
-- with pgcrypto's bcrypt and is the path this file commits to after being proved
-- end to end against GoTrue (tests/student-auth.test.ts).
--
-- Applied by the Supabase CLI, after 0003.
--
-- THE SYNTHETIC IDENTITY. email = `{join_code lowercased}-{slug}@fll.invalid`.
-- `.invalid` is the RFC 2606 reserved TLD, so the address can never deliver.
-- slug = lowercased first name + last initial in [a-z0-9], deduplicated within
-- a team by a numeric suffix (alexp, alexp2, ...). The slug is STORED rather
-- than recomputed so that a later rename never changes a login. The password is
-- a 6-digit PIN: GoTrue enforces a 6-character minimum, which is why it is not
-- 4. Both halves are mirrored in src/lib/auth/student-identity.ts.
--
-- WHY THE ROSTER RPC IS ANON-CALLABLE AND WHAT IT LEAKS. The login screen has
-- to show "which one are you?" before anyone is signed in, so
-- team_login_roster runs as anon. It returns the team's id and name and each
-- active student's first name, last initial and slug -- the three things the
-- client needs to build the address -- and nothing that grants access: no
-- student id, no auth user id, no PIN, no grade. Knowing a team id grants
-- nothing; every read of team data is gated by RLS on the signed-in identity.
--
-- HOW A DEFINER FUNCTION REACHES auth.users. Migrations run as `postgres`,
-- which Supabase grants INSERT/UPDATE/DELETE on auth.users, auth.identities and
-- auth.sessions. A SECURITY DEFINER function owned by postgres therefore
-- carries those rights into an RPC that any authenticated caller can invoke,
-- which is exactly why every such function re-checks is_mentor() in its own
-- body first.
--
-- ===========================================================================
-- TO UNDO
-- ===========================================================================
--
--   drop function if exists public.auth_whoami();
--   drop function if exists public.team_login_roster(text);
--   drop function if exists public.student_reactivate(uuid);
--   drop function if exists public.student_deactivate(uuid);
--   drop function if exists public.student_reset_pin(uuid, text);
--   drop function if exists public.student_create(uuid, text, text, smallint, text);
--   drop function if exists public._student_email(text, text);
--   drop trigger if exists students_immutable on public.students;
--   drop function if exists public._students_immutable();
--   drop trigger if exists students_set_updated_at on public.students;
--   drop table if exists public.students;
--
-- Auth users minted by student_create are NOT removed by that; delete them from
-- auth.users (`delete from auth.users where email like '%@fll.invalid'`) if the
-- intent is to forget the students rather than to rebuild the table.
-- 0005 onward references students; undo those first.

-- ---------------------------------------------------------------------------
-- 1. Table.
-- ---------------------------------------------------------------------------
create table if not exists public.students (
	id uuid primary key default gen_random_uuid(),
	team_id uuid not null references public.teams (id),
	first_name text not null
		check (length(btrim(first_name)) between 1 and 40),
	last_initial char(1) not null
		check (last_initial ~ '^[A-Z]$'),
	grade smallint
		check (grade is null or grade between 1 and 12),
	slug text not null
		check (slug ~ '^[a-z0-9]{1,48}$'),
	auth_user_id uuid not null unique references auth.users (id) on delete cascade,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	deactivated_at timestamptz,
	unique (team_id, slug),
	-- The target of every (student_id, team_id) composite foreign key in the
	-- chain: "the student named on this row is on this row's team" becomes a
	-- constraint rather than a check somebody has to remember.
	unique (id, team_id)
);

comment on table public.students is
	'A student account minted by student_create(). slug + the team join code form the synthetic login address. deactivated_at is the soft-delete stamp (the auth user is banned alongside it).';

drop trigger if exists students_set_updated_at on public.students;
create trigger students_set_updated_at
	before update on public.students
	for each row execute function public.set_updated_at();

-- A student never changes team, slug or auth user from a client: all three
-- are baked into the login address.
create or replace function public._students_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	if new.team_id <> old.team_id
		or new.slug <> old.slug
		or new.auth_user_id <> old.auth_user_id
	then
		raise exception 'A student''s team, login slug and auth user cannot be changed.';
	end if;
	return new;
end;
$$;
revoke all on function public._students_immutable() from public;

drop trigger if exists students_immutable on public.students;
create trigger students_immutable
	before update on public.students
	for each row execute function public._students_immutable();

-- ---------------------------------------------------------------------------
-- 2. The address. One definition; src/lib/auth/student-identity.ts mirrors it
--    and tests/student-identity.test.ts holds the two together.
-- ---------------------------------------------------------------------------
create or replace function public._student_email(p_join_code text, p_slug text)
returns text
language sql
immutable
set search_path = ''
as $$
	select lower(btrim(p_join_code)) || '-' || p_slug || '@fll.invalid';
$$;
revoke all on function public._student_email(text, text) from public;

-- ---------------------------------------------------------------------------
-- 3. student_create: auth user + identity + students row, atomically.
--
--    The team row is locked FOR UPDATE for the duration, which serialises slug
--    deduplication per team. The auth.users row is written in the shape GoTrue
--    writes for a confirmed email/password user, with every token column set to
--    '' rather than NULL (GoTrue scans those into Go strings and a NULL used to
--    be a hard error). The identity row is what makes the account visible as
--    an email identity to GoTrue and to the dashboard.
--
--    p_pin null means "mint one for me": the 6-digit PIN is returned ONCE, in
--    the response, for the mentor to hand to the student. A caller-supplied
--    PIN is never echoed back.
-- ---------------------------------------------------------------------------
create or replace function public.student_create(
	p_team_id uuid,
	p_first_name text,
	p_last_initial text,
	p_grade smallint default null,
	p_pin text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_team public.teams%rowtype;
	v_first text := btrim(coalesce(p_first_name, ''));
	v_initial text := upper(btrim(coalesce(p_last_initial, '')));
	v_pin text := p_pin;
	v_base text;
	v_slug text;
	v_n int := 1;
	v_auth_id uuid := gen_random_uuid();
	v_student_id uuid;
	v_email text;
begin
	if not public.is_mentor() then
		raise exception 'Only a mentor can add a student.';
	end if;
	if p_team_id is null then
		raise exception 'Which team?';
	end if;

	select t.* into v_team
	from public.teams t
	where t.id = p_team_id
	for update;
	if not found then
		raise exception 'That team does not exist.';
	end if;
	if v_team.archived_at is not null then
		raise exception 'That team is archived.';
	end if;

	if length(v_first) not between 1 and 40 then
		raise exception 'A first name is 1 to 40 characters.';
	end if;
	if v_initial !~ '^[A-Z]$' then
		raise exception 'A last initial is a single letter.';
	end if;
	if p_grade is not null and p_grade not between 1 and 12 then
		raise exception 'Grade is between 1 and 12.';
	end if;
	if v_pin is null then
		v_pin := lpad(
			(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32))::bigint % 1000000))::text,
			6, '0'
		);
	elsif v_pin !~ '^[0-9]{6}$' then
		raise exception 'A PIN is exactly 6 digits.';
	end if;

	v_base := public._student_slug_base(v_first, v_initial);
	if v_base = '' then
		raise exception 'That name has no letters or digits to build a login from.';
	end if;
	v_slug := v_base;
	while exists (select 1 from public.students s where s.team_id = p_team_id and s.slug = v_slug) loop
		v_n := v_n + 1;
		v_slug := v_base || v_n::text;
	end loop;
	v_email := public._student_email(v_team.join_code, v_slug);

	-- Raise the gate for 0002's auth.users trigger, for this transaction only.
	perform set_config('fll.creating_student', 'on', true);

	insert into auth.users (
		instance_id, id, aud, role, email, encrypted_password,
		email_confirmed_at, invited_at,
		confirmation_token, confirmation_sent_at,
		recovery_token, recovery_sent_at,
		email_change_token_new, email_change, email_change_sent_at,
		email_change_token_current, email_change_confirm_status,
		phone, phone_confirmed_at, phone_change, phone_change_token, phone_change_sent_at,
		reauthentication_token, reauthentication_sent_at,
		last_sign_in_at, raw_app_meta_data, raw_user_meta_data,
		is_super_admin, is_sso_user, is_anonymous, banned_until, deleted_at,
		created_at, updated_at
	) values (
		'00000000-0000-0000-0000-000000000000', v_auth_id, 'authenticated', 'authenticated', v_email,
		extensions.crypt(v_pin, extensions.gen_salt('bf', 10)),
		now(), null,
		'', null,
		'', null,
		'', '', null,
		'', 0,
		null, null, '', '', null,
		'', null,
		null,
		jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'kind', 'student'),
		jsonb_build_object('kind', 'student', 'team_id', v_team.id, 'first_name', v_first, 'last_initial', v_initial),
		false, false, false, null, null,
		now(), now()
	);

	insert into auth.identities (
		id, user_id, provider_id, provider, identity_data,
		last_sign_in_at, created_at, updated_at
	) values (
		gen_random_uuid(), v_auth_id, v_auth_id::text, 'email',
		jsonb_build_object('sub', v_auth_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
		null, now(), now()
	);

	insert into public.students (team_id, first_name, last_initial, grade, slug, auth_user_id)
	values (v_team.id, v_first, v_initial, p_grade, v_slug, v_auth_id)
	returning id into v_student_id;

	perform set_config('fll.creating_student', 'off', true);

	return jsonb_build_object(
		'student_id', v_student_id,
		'team_id', v_team.id,
		'first_name', v_first,
		'last_initial', v_initial,
		'slug', v_slug,
		'email', v_email,
		'pin', case when p_pin is null then v_pin else null end
	);
end;
$$;

revoke all on function public.student_create(uuid, text, text, smallint, text) from public;
grant execute on function public.student_create(uuid, text, text, smallint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. student_reset_pin: bcrypt the new PIN straight into auth.users and drop
--    every live session for that user so a lost tablet stops being signed in.
-- ---------------------------------------------------------------------------
create or replace function public.student_reset_pin(p_student_id uuid, p_new_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_auth_id uuid;
begin
	if not public.is_mentor() then
		raise exception 'Only a mentor can reset a PIN.';
	end if;
	if p_student_id is null then
		raise exception 'Which student?';
	end if;
	if p_new_pin !~ '^[0-9]{6}$' then
		raise exception 'A PIN is exactly 6 digits.';
	end if;

	select s.auth_user_id into v_auth_id
	from public.students s
	where s.id = p_student_id and s.deactivated_at is null
	for update;
	if not found then
		raise exception 'That student does not exist or is deactivated.';
	end if;

	update auth.users u
	set encrypted_password = extensions.crypt(p_new_pin, extensions.gen_salt('bf', 10)),
		updated_at = now()
	where u.id = v_auth_id;

	delete from auth.sessions s where s.user_id = v_auth_id;

	return jsonb_build_object('ok', true, 'student_id', p_student_id);
end;
$$;

revoke all on function public.student_reset_pin(uuid, text) from public;
grant execute on function public.student_reset_pin(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Deactivate / reactivate. Archive, never delete: the row keeps its
--    attendance, tasks and evidence; the auth user is banned so the PIN stops
--    working, and its sessions are dropped.
-- ---------------------------------------------------------------------------
create or replace function public.student_deactivate(p_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_auth_id uuid;
begin
	if not public.is_mentor() then
		raise exception 'Only a mentor can deactivate a student.';
	end if;

	update public.students s
	set deactivated_at = now()
	where s.id = p_student_id and s.deactivated_at is null
	returning s.auth_user_id into v_auth_id;
	if not found then
		raise exception 'That student does not exist or is already deactivated.';
	end if;

	update auth.users u set banned_until = 'infinity', updated_at = now() where u.id = v_auth_id;
	delete from auth.sessions s where s.user_id = v_auth_id;

	return jsonb_build_object('ok', true, 'student_id', p_student_id);
end;
$$;

revoke all on function public.student_deactivate(uuid) from public;
grant execute on function public.student_deactivate(uuid) to authenticated;

create or replace function public.student_reactivate(p_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_auth_id uuid;
begin
	if not public.is_mentor() then
		raise exception 'Only a mentor can reactivate a student.';
	end if;

	update public.students s
	set deactivated_at = null
	where s.id = p_student_id and s.deactivated_at is not null
	returning s.auth_user_id into v_auth_id;
	if not found then
		raise exception 'That student does not exist or is not deactivated.';
	end if;

	update auth.users u set banned_until = null, updated_at = now() where u.id = v_auth_id;

	return jsonb_build_object('ok', true, 'student_id', p_student_id);
end;
$$;

revoke all on function public.student_reactivate(uuid) from public;
grant execute on function public.student_reactivate(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. team_login_roster: the anon-callable half of the student login screen.
--    Null (not an error) for an unknown or archived code.
-- ---------------------------------------------------------------------------
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
		'join_code', t.join_code,
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

-- ---------------------------------------------------------------------------
-- 7. auth_whoami: one round trip that tells the app shell who is signed in.
--    Null for a session that is neither an active mentor nor an active
--    student (a deactivated account, or a Google user whose insert was
--    refused and who therefore has no row).
-- ---------------------------------------------------------------------------
create or replace function public.auth_whoami()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(
		(
			select jsonb_build_object(
				'kind', 'mentor',
				'mentor_id', m.id,
				'display_name', m.display_name,
				'email', m.email,
				'is_admin', m.is_admin
			)
			from public.mentors m
			where m.auth_user_id = (select auth.uid()) and m.deactivated_at is null
		),
		(
			select jsonb_build_object(
				'kind', 'student',
				'student_id', s.id,
				'first_name', s.first_name,
				'last_initial', s.last_initial,
				'slug', s.slug,
				'grade', s.grade,
				'team_id', t.id,
				'team_name', t.name,
				'join_code', t.join_code
			)
			from public.students s
			join public.teams t on t.id = s.team_id
			where s.auth_user_id = (select auth.uid()) and s.deactivated_at is null
		)
	);
$$;

revoke all on function public.auth_whoami() from public;
grant execute on function public.auth_whoami() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Grants and RLS. Mentors read every student and edit name and grade;
--    students read their own team's roster; nobody inserts, deletes or
--    deactivates from a client (the RPCs are the doors).
-- ---------------------------------------------------------------------------
revoke all on public.students from anon, authenticated;
grant all on public.students to service_role;
grant select on public.students to authenticated;
grant update (first_name, last_initial, grade) on public.students to authenticated;

alter table public.students enable row level security;

drop policy if exists "mentors read every student" on public.students;
create policy "mentors read every student"
	on public.students
	for select
	to authenticated
	using ((select public.is_mentor()));

drop policy if exists "students read their own team roster" on public.students;
create policy "students read their own team roster"
	on public.students
	for select
	to authenticated
	using (team_id = (select public.current_student_team_id()));

drop policy if exists "mentors update students" on public.students;
create policy "mentors update students"
	on public.students
	for update
	to authenticated
	using ((select public.is_mentor()))
	with check ((select public.is_mentor()));

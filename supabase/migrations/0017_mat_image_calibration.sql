-- 0017_mat_image_calibration.sql
--
-- THE FIELD PICTURE IS ONE TEAM'S PRIVATE FILE AND IT IS NEVER STRETCHED TO
-- FIT. One row per team pointing at one object in the private 'mat' bucket,
-- carrying the two-corner calibration that says where the playing surface is
-- INSIDE that picture, and a storage read policy that answers a team only for
-- its own folder.
--
-- Applied by the Supabase CLI, after 0016.
--
-- WHY. 0012 gave the planner a mat photo: ONE object at the bucket root,
-- readable by every signed-in account, drawn stretched corner to corner over
-- the 2362 by 1143 mm mat rectangle on the assumption that a mentor had
-- cropped it exactly to the mat borders. Both halves of that were wrong for
-- the picture the club actually has.
--
--   The stretch was wrong because a real field layout image includes the
--   border walls, so the picture is taller and less wide than the surface
--   inside it. Stretching moves every mission marker, and the error is
--   INVISIBLE: the picture still fills the rectangle and still looks like a
--   mat. Measured against a plausible true calibration of the club's own
--   2019 by 1153 image, stretch-to-fit is off by 183 mm at the corner of the
--   playing surface and 4 mm at the centre -- a robot's length of error,
--   hiding behind a centre that agrees. The two corners a mentor now taps
--   pin an origin and an INDEPENDENT scale per axis, which is exactly the
--   freedom a picture-inside-walls needs and no more. The transform lives in
--   src/lib/planner/calibration.ts, proved by tests/planner-calibration.test.ts
--   before any screen existed, for the same reason geometry.ts lives in
--   TypeScript: it recomputes under a finger, mid-drag, possibly offline.
--   This file stores the two taps and refuses a degenerate pair; it does not
--   restate the arithmetic.
--
--   The one shared object was wrong because the picture is copyrighted. The
--   club's own photo of its own mat could be shown to anybody signed in; a
--   FIRST or LEGO field layout cannot be redistributed at all. It is not in
--   git, not in static/, not in any bundle, and not on any public URL. It
--   lives in the private bucket, uploaded by a mentor, and is read only
--   through a short-lived signed URL by a mentor or by a member of the team
--   that owns it. Hence a per-team folder and a read policy that names it.
--
-- WHAT MAKES THE PATH SAFE. storage_path is GENERATED ALWAYS: a client cannot
-- send it, so a team's row can never be made to point at another team's
-- object, before any policy is consulted. It is the same instinct as the
-- composite foreign keys on the work surface -- a constraint first, a policy
-- second.
--
-- WHAT THIS FILE DOES NOT DO. It does not seed a picture, a calibration or a
-- mission position: every one of those is a mentor's measurement. It does not
-- add rotation or perspective to the transform (a picture taken at an angle
-- is the wrong picture, not a harder transform). It does not touch
-- mat_config, which still holds the launch area rectangle and is still
-- global. It does not put mat_images in supabase_realtime: the planner is
-- local-first by design (0012), and this row changes when a mentor uploads,
-- which is not a thing to stream.
--
-- WHAT IT TIGHTENS. The old policy "mat objects: signed-in users read the mat
-- photo" let ANY signed-in account read ANY object in the bucket. It is
-- dropped. Objects that are not under teams/<team_id>/ -- including 0012's
-- root-level mat.jpg -- become readable by mentors only. The notice below
-- counts them so an operator can see what changed hands.
--
-- ===========================================================================
-- TO UNDO
-- ===========================================================================
--
--   -- Restore 0012's bucket-wide read, then drop this file's table.
--   drop policy if exists "mat objects: a team reads only its own field picture" on storage.objects;
--   create policy "mat objects: signed-in users read the mat photo"
--     on storage.objects for select to authenticated
--     using (bucket_id = 'mat');
--   drop table if exists public.mat_images;
--
--   The uploaded objects themselves are NOT removed by the undo: they are the
--   club's files and deleting them is a decision, not a rollback. To remove
--   them too, empty storage.objects where bucket_id = 'mat' first.

-- ---------------------------------------------------------------------------
-- 1. The table: one field picture per team, with its calibration.
--    Calibration columns are nullable together -- a picture is uploaded
--    first and calibrated second, and an uncalibrated picture is simply not
--    drawn (the client refuses to guess). The three checks make a stored
--    calibration one that can actually be inverted.
-- ---------------------------------------------------------------------------
create table if not exists public.mat_images (
	id uuid primary key default gen_random_uuid(),
	team_id uuid not null unique references public.teams (id),
	storage_path text generated always as ('teams/' || team_id::text || '/field') stored,
	image_w integer not null check (image_w between 1 and 20000),
	image_h integer not null check (image_h between 1 and 20000),
	origin_u double precision,
	origin_v double precision,
	far_u double precision,
	far_v double precision,
	dim_pct integer not null default 40 check (dim_pct between 0 and 90),
	uploaded_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint mat_images_calibration_whole check (
		num_nonnulls(origin_u, origin_v, far_u, far_v) in (0, 4)
	),
	constraint mat_images_calibration_in_frame check (
		origin_u is null
		or (
			origin_u between 0 and 1 and origin_v between 0 and 1
			and far_u between 0 and 1 and far_v between 0 and 1
		)
	),
	constraint mat_images_calibration_span check (
		origin_u is null
		or (abs(far_u - origin_u) >= 0.05 and abs(far_v - origin_v) >= 0.05)
	)
);

comment on table public.mat_images is
	'One field picture per team: the object in the private mat bucket, its pixel size, and the two-corner calibration that says where the 2362 by 1143 mm playing surface sits inside it. origin_* is the launch-area corner (mat 0,0), far_* the diagonally opposite corner, both as fractions of the picture with v DOWN. Null calibration means the picture is not drawn: the planner refuses to guess a transform. dim_pct is how far the background is dimmed under the schematic.';

comment on column public.mat_images.storage_path is
	'GENERATED ALWAYS. A client cannot send it, so a team row can never point at another team''s object -- the boundary is a constraint before it is a policy.';

drop trigger if exists mat_images_set_updated_at on public.mat_images;
create trigger mat_images_set_updated_at
	before update on public.mat_images
	for each row execute function public.set_updated_at();

drop trigger if exists mat_images_immutable on public.mat_images;
create trigger mat_images_immutable
	before update on public.mat_images
	for each row execute function public._immutable_columns('team_id');

-- ---------------------------------------------------------------------------
-- 2. Grants. This image's default ACL gives the API roles nothing useful, so
--    the table states its own. The client mints the id (the write queue's
--    idempotency); uploaded_at and updated_at are server-stamped and appear
--    in no client grant; storage_path is generated and so cannot appear in
--    one at all.
-- ---------------------------------------------------------------------------
revoke all on public.mat_images from anon, authenticated;
grant all on public.mat_images to service_role;
grant select on public.mat_images to authenticated;
grant insert (id, team_id, image_w, image_h, origin_u, origin_v, far_u, far_v, dim_pct)
	on public.mat_images to authenticated;
grant update (image_w, image_h, origin_u, origin_v, far_u, far_v, dim_pct)
	on public.mat_images to authenticated;
grant delete on public.mat_images to authenticated;

-- ---------------------------------------------------------------------------
-- 3. RLS. Reads: mentors, and the team the row belongs to. Writes: mentors
--    only -- uploading and calibrating are measurements a mentor makes, and
--    a wrong calibration is invisible, so this is not a Run Captain's tap to
--    make by accident. Board devices read nothing here, the same stance 0012
--    took for the plan itself.
-- ---------------------------------------------------------------------------
alter table public.mat_images enable row level security;

drop policy if exists "mentors and the team read the field picture" on public.mat_images;
create policy "mentors and the team read the field picture"
	on public.mat_images
	for select
	to authenticated
	using ((select public.is_mentor()) or team_id = (select public.current_student_team_id()));

drop policy if exists "mentors record a field picture" on public.mat_images;
create policy "mentors record a field picture"
	on public.mat_images
	for insert
	to authenticated
	with check ((select public.is_mentor()));

drop policy if exists "mentors recalibrate a field picture" on public.mat_images;
create policy "mentors recalibrate a field picture"
	on public.mat_images
	for update
	to authenticated
	using ((select public.is_mentor()))
	with check ((select public.is_mentor()));

drop policy if exists "mentors remove a field picture" on public.mat_images;
create policy "mentors remove a field picture"
	on public.mat_images
	for delete
	to authenticated
	using ((select public.is_mentor()));

-- ---------------------------------------------------------------------------
-- 4. The storage read policy, narrowed from the bucket to one folder.
--    storage.foldername('teams/<uuid>/field') is {teams, <uuid>}; on an
--    object at the bucket root it is {}, so [2] is NULL and the comparison
--    is false -- a legacy object falls to mentors only, which is the safe
--    direction. The mentor write policy from 0012 is unchanged.
-- ---------------------------------------------------------------------------
do $$
declare
	v_legacy integer;
begin
	select count(*) into v_legacy
	from storage.objects
	where bucket_id = 'mat' and coalesce((storage.foldername(name))[1], '') <> 'teams';
	raise notice 'mat bucket: % object(s) outside teams/<team_id>/ become mentor-only reads.', v_legacy;
end;
$$;

drop policy if exists "mat objects: signed-in users read the mat photo" on storage.objects;
drop policy if exists "mat objects: a team reads only its own field picture" on storage.objects;
create policy "mat objects: a team reads only its own field picture"
	on storage.objects
	for select
	to authenticated
	using (
		bucket_id = 'mat'
		and (
			(select public.is_mentor())
			or (
				(storage.foldername(name))[1] = 'teams'
				and (storage.foldername(name))[2] = (select public.current_student_team_id())::text
			)
		)
	);

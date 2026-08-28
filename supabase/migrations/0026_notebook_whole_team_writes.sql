-- 0026_notebook_whole_team_writes.sql
--
-- THE NOTEBOOK BELONGS TO THE TEAM, SO THE WHOLE TEAM WRITES IN IT. Applied
-- by the Supabase CLI, after 0025.
--
-- WHAT WAS WRONG. 0016 made notebook_can_edit(team_id, section) a ROLE gate:
-- any mentor, the Notebook and Values Lead on every section, the Lead
-- Builder / Lead Programmer / Run Captain on Robot Design, the Innovation
-- Lead on the Innovation Project, all under team_resolve_roles' covering
-- rule. It was never literally "only the team lead", but it was narrow in the
-- way that matters on a Friday: a child holding none of those five roles
-- could read every word of their own team's notebook and write none of it.
-- Four teams of six means most of the room is locked out of the judged
-- document their own season produced. That is backwards. Mr. Pina asked for
-- it opened up, and this file opens it up.
--
-- THE NEW RULE, AND IT IS THE WHOLE RULE: any mentor, or any student on that
-- team. Nothing else. It is expressed with current_student_team_id(), the
-- identity helper 0016 itself already used at the notebook_season_stats
-- guard, rather than a second predicate that could drift from it. That
-- helper filters deactivated_at, so a child who left the club loses the pen
-- with everything else, and it reads public.students, which a board device
-- has no row in, so the shared iPad still sees none of this and writes none
-- of it. A rival team's student gets NULL from it, which coalesces to false.
--
-- THE SIGNATURE DOES NOT MOVE. notebook_can_edit keeps both parameters, its
-- SECURITY DEFINER, its pinned empty search_path, its return type and its
-- grants, so all four policies that call it (the insert, update and delete
-- policies on notebook_entries and the update policy on meeting_recaps) and
-- both 0020 RPCs that call it (notebook_entry_delete, notebook_entry_restore)
-- are correct as written and are not touched here. Rewriting a policy to
-- change who may write would be a second place the rule lives.
--
-- p_section IS DELIBERATELY KEPT AND DELIBERATELY UNUSED. Dropping it would
-- change the signature, which would force every policy, every grant and both
-- RPCs to be rewritten, and would walk into THE SIGNATURE TRAP on the way
-- (two overloads differing by a trailing parameter make PostgREST unable to
-- resolve the call). Section-level rules are also exactly the kind of thing
-- that comes back: a season where the Innovation Project needs its own gate
-- again is a new body in this same signature and nothing else. The parameter
-- is the seam that keeps that cheap.
--
-- ONE THING STAYS NARROW, AND IT IS A DECISION. Writing a recap and
-- CONFIRMING one are not the same act. meeting_recaps.confirmed is a "this is
-- finished, stop regenerating the draft" statement: the generator in 0016
-- refuses to touch a confirmed recap, and meeting_recap_regenerate (0020)
-- counts the confirmed ones it left alone. If the whole team can flip it back
-- and forth, it stops meaning anything and the frozen draft thaws under
-- somebody's thumb. So notebook_can_confirm(team_id) is added carrying 0016's
-- OLD rule, minus the section argument it never needed: any mentor, or the
-- Notebook and Values Lead under team_resolve_roles' covering rule. Everyone
-- on the team still writes the recap's summary.
--
-- WHY THE CONFIRM SPLIT IS A TRIGGER AND NOT A POLICY OR A GRANT. It has to
-- be, and this is the repo's existing answer rather than a new idea. RLS is
-- row level: one UPDATE policy on meeting_recaps cannot say "this column for
-- these callers and that column for those". A column grant is per ROLE, and
-- every signed-in human in this app is the same role, `authenticated`, so a
-- grant cannot tell the Notebook Lead from their teammate. That is precisely
-- why tasks.evidence_required is guarded by the _mentor_only_columns BEFORE
-- UPDATE trigger (0007) instead of a grant, and this is the same shape one
-- step more specific: the caller test is notebook_can_confirm rather than
-- is_mentor. The grants on meeting_recaps therefore do not move either:
-- (summary, confirmed) stays as 0016 wrote it, `summary` widens with the
-- policy, and `confirmed` is held by the trigger beneath it.
--
-- The gate takes _mentor_only_columns' escape hatch verbatim: a caller with
-- no auth.uid() is the service role, the seed or a migration, and is let
-- through. Without it, _meeting_recaps_generate and every service-role
-- fixture would start refusing themselves.
--
-- WHAT ELSE WIDENS, SAID OUT LOUD RATHER THAN DISCOVERED IN NOVEMBER. The
-- delete policy on notebook_entries and both 0020 delete/restore RPCs call
-- notebook_can_edit, so any teammate can now delete any teammate's page as
-- well as write one. That is the price of the same one-line rule and it is
-- accepted rather than overlooked: a notebook delete is a SOFT delete (0020),
-- the child who did it gets a ten second undo, and a mentor gets the bin
-- afterwards, so nothing is actually lost and an adult can always put it
-- back.
--
-- WHAT THIS FILE DOES NOT DO. It creates no table, no column, no type and no
-- policy; it changes no grant; it does not touch reads (mentors and the row's
-- own team could already read everything and still can); it does not touch
-- the notebook entry author check, so a child still cannot sign a page with
-- somebody else's name; and it leaves the roles themselves exactly as they
-- are. The Notebook and Values Lead is still a role a team assigns; it is no
-- longer a licence to be the only one holding the pen.
--
-- ===========================================================================
-- TO UNDO
-- ===========================================================================
--
--   -- 1. Put back 0016's role-gated body, at the same signature:
--   --
--   --   create or replace function public.notebook_can_edit(p_team_id uuid, p_section public.notebook_section)
--   --   returns boolean language sql stable security definer set search_path = ''
--   --   as $undo$
--   --     select public.is_mentor()
--   --       or exists (
--   --         select 1
--   --         from public.team_resolve_roles(p_team_id, public._resolve_current_meeting_id()) r
--   --         where (
--   --             r.role = 'notebook_values_lead'
--   --             or r.role = any (
--   --               case p_section
--   --                 when 'robot_design'
--   --                   then array['lead_builder', 'lead_programmer', 'run_captain']::public.team_role[]
--   --                 when 'innovation_project'
--   --                   then array['innovation_lead']::public.team_role[]
--   --                 else array[]::public.team_role[]
--   --               end
--   --             )
--   --           )
--   --           and case
--   --             when r.active_student_id is not null
--   --               then r.active_student_id = public.current_student_id()
--   --             else public.current_student_id() in (r.primary_student_id, r.second_student_id)
--   --           end
--   --       );
--   --   $undo$;
--   --
--   -- and restore 0016's comment on it.
--
--   -- 2. Drop the confirmation split, which the old body makes redundant
--   --    (under it, only the lead and mentors could reach the row at all):
--   drop trigger if exists meeting_recaps_confirm_gate on public.meeting_recaps;
--   drop function if exists public._meeting_recaps_confirm_gate();
--   drop function if exists public.notebook_can_confirm(uuid);
--
-- Nothing else in the chain depends on this file.

-- ---------------------------------------------------------------------------
-- 1. The edit rule, restated. Same signature, same security, same grants;
--    a new body and a new comment. The grants are re-stated rather than left
--    to `create or replace` (which does preserve them) because every function
--    in this chain states its own, and because the hosted project's default
--    privileges are closed (0021, 0022) so nothing arrives granted by luck.
-- ---------------------------------------------------------------------------
create or replace function public.notebook_can_edit(p_team_id uuid, p_section public.notebook_section)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	-- coalesce, not a bare OR: current_student_team_id() is NULL for a
	-- mentor, a board device and a signed-out caller, and `false or NULL` is
	-- NULL, which an IF in a calling RPC would read as "no" but which is
	-- worth never producing in the first place (the 0015 lesson).
	select coalesce(
		public.is_mentor()
			or (p_team_id is not null and p_team_id = public.current_student_team_id()),
		false
	);
$$;

revoke all on function public.notebook_can_edit(uuid, public.notebook_section) from public;
grant execute on function public.notebook_can_edit(uuid, public.notebook_section) to authenticated;

comment on function public.notebook_can_edit(uuid, public.notebook_section) is
	'True when the caller may write in this team''s notebook: any mentor, or any active student on that team. No role is consulted and no section is: the notebook belongs to the team, so every teammate holds the pen. p_section is KEPT ON PURPOSE and is currently not consulted -- it is the seam that would let a section-level rule return without changing the signature every policy and RPC calls. Confirming a session recap is the one narrower act; that is notebook_can_confirm.';

-- ---------------------------------------------------------------------------
-- 2. Confirming a recap: 0016's old rule, kept alive on purpose for the one
--    act that is a statement about the record rather than a contribution to
--    it. Built the way notebook_can_edit was, delegating the covering rule to
--    team_resolve_roles rather than re-deriving who is holding the role
--    today.
-- ---------------------------------------------------------------------------
create or replace function public.notebook_can_confirm(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(
		public.is_mentor()
			or exists (
				select 1
				from public.team_resolve_roles(p_team_id, public._resolve_current_meeting_id()) r
				where r.role = 'notebook_values_lead'
					and case
						when r.active_student_id is not null
							then r.active_student_id = public.current_student_id()
						else public.current_student_id() in (r.primary_student_id, r.second_student_id)
					end
			),
		false
	);
$$;

revoke all on function public.notebook_can_confirm(uuid) from public;
grant execute on function public.notebook_can_confirm(uuid) to authenticated;

comment on function public.notebook_can_confirm(uuid) is
	'True when the caller may mark a session recap finished, or reopen one: any mentor, or the Notebook and Values Lead under team_resolve_roles'' covering rule. This is 0016''s old notebook_can_edit rule, kept for this one act only. Writing a recap''s summary is notebook_can_edit and is open to the whole team; saying the record is FINISHED is not, because a confirmed recap stops regenerating and the word has to keep meaning something.';

-- ---------------------------------------------------------------------------
-- 3. The gate under the column. A grant cannot tell one `authenticated`
--    caller from another, and a row policy cannot speak about a single
--    column, so this is a BEFORE UPDATE trigger: the same tool, and the same
--    escape hatch for a caller with no auth.uid(), as _mentor_only_columns
--    (0007). It fires before meeting_recaps_confirm_stamp (alphabetical
--    order, and deliberately so): a refused confirmation never reaches the
--    stamp.
--
--    The message is a sentence in the child's own terms, ending in a period,
--    with no ERRCODE and no table name -- the RPC-shape convention, applied
--    to a trigger, because this text is what a nine year old reads in the
--    notebook's failure banner.
-- ---------------------------------------------------------------------------
create or replace function public._meeting_recaps_confirm_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	-- No auth.uid() is the service role, the seed, or a migration: the
	-- generator and every fixture would otherwise start refusing themselves.
	if (select auth.uid()) is null then
		return new;
	end if;
	if new.confirmed is distinct from old.confirmed
		and not coalesce(public.notebook_can_confirm(new.team_id), false) then
		raise exception 'Only the Notebook and Values Lead or a mentor can finish a session recap or reopen one. Your words are saved; ask one of them to press the button.';
	end if;
	return new;
end;
$$;
revoke all on function public._meeting_recaps_confirm_gate() from public;

drop trigger if exists meeting_recaps_confirm_gate on public.meeting_recaps;
create trigger meeting_recaps_confirm_gate
	before update on public.meeting_recaps
	for each row execute function public._meeting_recaps_confirm_gate();

-- ---------------------------------------------------------------------------
-- 4. Say what changed, in the counts a mentor can check against the roster.
-- ---------------------------------------------------------------------------
do $$
declare
	v_students int;
	v_teams int;
begin
	select count(*) into v_students from public.students s where s.deactivated_at is null;
	select count(*) into v_teams from public.teams t where t.archived_at is null;
	raise notice '0026: the notebook is now writable by % active student(s) across % live team(s); confirming a recap stays with the Notebook and Values Lead and mentors.', v_students, v_teams;
end
$$;

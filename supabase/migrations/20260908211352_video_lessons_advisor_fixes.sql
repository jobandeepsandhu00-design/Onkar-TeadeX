-- Advisor follow-up for the video learning domain.
-- Cover foreign-key lookups and avoid duplicate permissive SELECT policies.

create index video_lessons_owner_idx on public.video_lessons (owner_id);
create index video_lesson_rules_lesson_idx on public.video_lesson_rules (lesson_id);
create index video_lesson_checklist_lesson_idx on public.video_lesson_checklist (lesson_id);
create index lesson_progress_lesson_idx on public.lesson_progress (lesson_id);
create index saved_lessons_lesson_idx on public.saved_lessons (lesson_id);

drop policy video_captions_owner_manage on public.video_lesson_captions;
create policy video_captions_owner_insert on public.video_lesson_captions for insert to authenticated
with check (exists (select 1 from public.video_lessons l join public.profiles p on p.id = (select auth.uid()) where l.id = lesson_id and l.owner_id = (select auth.uid()) and p.role = 'owner'));
create policy video_captions_owner_update on public.video_lesson_captions for update to authenticated
using (exists (select 1 from public.video_lessons l join public.profiles p on p.id = (select auth.uid()) where l.id = lesson_id and l.owner_id = (select auth.uid()) and p.role = 'owner'))
with check (exists (select 1 from public.video_lessons l join public.profiles p on p.id = (select auth.uid()) where l.id = lesson_id and l.owner_id = (select auth.uid()) and p.role = 'owner'));
create policy video_captions_owner_delete on public.video_lesson_captions for delete to authenticated
using (exists (select 1 from public.video_lessons l join public.profiles p on p.id = (select auth.uid()) where l.id = lesson_id and l.owner_id = (select auth.uid()) and p.role = 'owner'));

drop policy video_rules_owner_manage on public.video_lesson_rules;
create policy video_rules_owner_insert on public.video_lesson_rules for insert to authenticated
with check (exists (select 1 from public.video_lessons l join public.profiles p on p.id = (select auth.uid()) where l.id = lesson_id and l.owner_id = (select auth.uid()) and p.role = 'owner'));
create policy video_rules_owner_update on public.video_lesson_rules for update to authenticated
using (exists (select 1 from public.video_lessons l join public.profiles p on p.id = (select auth.uid()) where l.id = lesson_id and l.owner_id = (select auth.uid()) and p.role = 'owner'))
with check (exists (select 1 from public.video_lessons l join public.profiles p on p.id = (select auth.uid()) where l.id = lesson_id and l.owner_id = (select auth.uid()) and p.role = 'owner'));
create policy video_rules_owner_delete on public.video_lesson_rules for delete to authenticated
using (exists (select 1 from public.video_lessons l join public.profiles p on p.id = (select auth.uid()) where l.id = lesson_id and l.owner_id = (select auth.uid()) and p.role = 'owner'));

drop policy video_checklist_owner_manage on public.video_lesson_checklist;
create policy video_checklist_owner_insert on public.video_lesson_checklist for insert to authenticated
with check (exists (select 1 from public.video_lessons l join public.profiles p on p.id = (select auth.uid()) where l.id = lesson_id and l.owner_id = (select auth.uid()) and p.role = 'owner'));
create policy video_checklist_owner_update on public.video_lesson_checklist for update to authenticated
using (exists (select 1 from public.video_lessons l join public.profiles p on p.id = (select auth.uid()) where l.id = lesson_id and l.owner_id = (select auth.uid()) and p.role = 'owner'))
with check (exists (select 1 from public.video_lessons l join public.profiles p on p.id = (select auth.uid()) where l.id = lesson_id and l.owner_id = (select auth.uid()) and p.role = 'owner'));
create policy video_checklist_owner_delete on public.video_lesson_checklist for delete to authenticated
using (exists (select 1 from public.video_lessons l join public.profiles p on p.id = (select auth.uid()) where l.id = lesson_id and l.owner_id = (select auth.uid()) and p.role = 'owner'));

drop policy video_placements_owner_manage on public.dashboard_placements;
create policy video_placements_owner_insert on public.dashboard_placements for insert to authenticated
with check (exists (select 1 from public.video_lessons l join public.profiles p on p.id = (select auth.uid()) where l.id = lesson_id and l.owner_id = (select auth.uid()) and p.role = 'owner'));
create policy video_placements_owner_update on public.dashboard_placements for update to authenticated
using (exists (select 1 from public.video_lessons l join public.profiles p on p.id = (select auth.uid()) where l.id = lesson_id and l.owner_id = (select auth.uid()) and p.role = 'owner'))
with check (exists (select 1 from public.video_lessons l join public.profiles p on p.id = (select auth.uid()) where l.id = lesson_id and l.owner_id = (select auth.uid()) and p.role = 'owner'));
create policy video_placements_owner_delete on public.dashboard_placements for delete to authenticated
using (exists (select 1 from public.video_lessons l join public.profiles p on p.id = (select auth.uid()) where l.id = lesson_id and l.owner_id = (select auth.uid()) and p.role = 'owner'));

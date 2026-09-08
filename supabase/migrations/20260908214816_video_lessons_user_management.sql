-- Every authenticated user can create and manage their own video lessons.
-- Published lessons remain visible across the learning library and dashboard.

drop policy if exists video_lessons_owner_insert on public.video_lessons;
drop policy if exists video_lessons_owner_update on public.video_lessons;
drop policy if exists video_lessons_owner_delete on public.video_lessons;

create policy video_lessons_user_insert on public.video_lessons for insert to authenticated
with check (owner_id = (select auth.uid()));
create policy video_lessons_user_update on public.video_lessons for update to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));
create policy video_lessons_user_delete on public.video_lessons for delete to authenticated
using (owner_id = (select auth.uid()));

drop policy if exists video_captions_owner_insert on public.video_lesson_captions;
drop policy if exists video_captions_owner_update on public.video_lesson_captions;
drop policy if exists video_captions_owner_delete on public.video_lesson_captions;
create policy video_captions_user_insert on public.video_lesson_captions for insert to authenticated
with check (exists (select 1 from public.video_lessons l where l.id = lesson_id and l.owner_id = (select auth.uid())));
create policy video_captions_user_update on public.video_lesson_captions for update to authenticated
using (exists (select 1 from public.video_lessons l where l.id = lesson_id and l.owner_id = (select auth.uid())))
with check (exists (select 1 from public.video_lessons l where l.id = lesson_id and l.owner_id = (select auth.uid())));
create policy video_captions_user_delete on public.video_lesson_captions for delete to authenticated
using (exists (select 1 from public.video_lessons l where l.id = lesson_id and l.owner_id = (select auth.uid())));

drop policy if exists video_rules_owner_insert on public.video_lesson_rules;
drop policy if exists video_rules_owner_update on public.video_lesson_rules;
drop policy if exists video_rules_owner_delete on public.video_lesson_rules;
create policy video_rules_user_insert on public.video_lesson_rules for insert to authenticated
with check (exists (select 1 from public.video_lessons l where l.id = lesson_id and l.owner_id = (select auth.uid())));
create policy video_rules_user_update on public.video_lesson_rules for update to authenticated
using (exists (select 1 from public.video_lessons l where l.id = lesson_id and l.owner_id = (select auth.uid())))
with check (exists (select 1 from public.video_lessons l where l.id = lesson_id and l.owner_id = (select auth.uid())));
create policy video_rules_user_delete on public.video_lesson_rules for delete to authenticated
using (exists (select 1 from public.video_lessons l where l.id = lesson_id and l.owner_id = (select auth.uid())));

drop policy if exists video_checklist_owner_insert on public.video_lesson_checklist;
drop policy if exists video_checklist_owner_update on public.video_lesson_checklist;
drop policy if exists video_checklist_owner_delete on public.video_lesson_checklist;
create policy video_checklist_user_insert on public.video_lesson_checklist for insert to authenticated
with check (exists (select 1 from public.video_lessons l where l.id = lesson_id and l.owner_id = (select auth.uid())));
create policy video_checklist_user_update on public.video_lesson_checklist for update to authenticated
using (exists (select 1 from public.video_lessons l where l.id = lesson_id and l.owner_id = (select auth.uid())))
with check (exists (select 1 from public.video_lessons l where l.id = lesson_id and l.owner_id = (select auth.uid())));
create policy video_checklist_user_delete on public.video_lesson_checklist for delete to authenticated
using (exists (select 1 from public.video_lessons l where l.id = lesson_id and l.owner_id = (select auth.uid())));

drop policy if exists video_placements_owner_insert on public.dashboard_placements;
drop policy if exists video_placements_owner_update on public.dashboard_placements;
drop policy if exists video_placements_owner_delete on public.dashboard_placements;
create policy video_placements_user_insert on public.dashboard_placements for insert to authenticated
with check (exists (select 1 from public.video_lessons l where l.id = lesson_id and l.owner_id = (select auth.uid())));
create policy video_placements_user_update on public.dashboard_placements for update to authenticated
using (exists (select 1 from public.video_lessons l where l.id = lesson_id and l.owner_id = (select auth.uid())))
with check (exists (select 1 from public.video_lessons l where l.id = lesson_id and l.owner_id = (select auth.uid())));
create policy video_placements_user_delete on public.dashboard_placements for delete to authenticated
using (exists (select 1 from public.video_lessons l where l.id = lesson_id and l.owner_id = (select auth.uid())));

drop policy if exists lesson_media_owner_insert on storage.objects;
drop policy if exists lesson_media_owner_update on storage.objects;
drop policy if exists lesson_media_owner_delete on storage.objects;
create policy lesson_media_user_insert on storage.objects for insert to authenticated
with check (bucket_id = 'trading-lessons' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy lesson_media_user_update on storage.objects for update to authenticated
using (bucket_id = 'trading-lessons' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'trading-lessons' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy lesson_media_user_delete on storage.objects for delete to authenticated
using (bucket_id = 'trading-lessons' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Premium video strategy learning. Media stays in private object storage;
-- only metadata, captions, rules, progress, and saves live in Postgres.

create table public.video_lessons (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  slug text not null unique,
  short_description text not null default '',
  description text not null default '',
  category text not null default 'Other',
  difficulty text not null default 'Beginner' check (difficulty in ('Beginner','Intermediate','Advanced')),
  timeframe text not null default 'Multiple',
  tags text[] not null default '{}',
  video_path text not null,
  thumbnail_path text,
  duration_seconds numeric(12,3) not null default 0 check (duration_seconds >= 0),
  audio_type text not null default 'original_video_audio' check (audio_type in ('original_video_audio','ai_voice','custom_voice')),
  captions_enabled boolean not null default true,
  autoplay boolean not null default false,
  published boolean not null default false,
  featured boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.video_lesson_captions (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.video_lessons(id) on delete cascade,
  start_time numeric(12,3) not null check (start_time >= 0),
  end_time numeric(12,3) not null check (end_time > start_time),
  text text not null check (char_length(text) > 0),
  sort_order integer not null default 0
);

create table public.video_lesson_rules (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.video_lessons(id) on delete cascade,
  text text not null check (char_length(text) > 0),
  sort_order integer not null default 0
);

create table public.video_lesson_checklist (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.video_lessons(id) on delete cascade,
  text text not null check (char_length(text) > 0),
  sort_order integer not null default 0
);

create table public.dashboard_placements (
  lesson_id uuid not null references public.video_lessons(id) on delete cascade,
  placement text not null check (placement in ('home_slider','featured','strategy_hub','popup_only','learn_only')),
  sort_order integer not null default 0,
  enabled boolean not null default true,
  primary key (lesson_id, placement)
);

create table public.lesson_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id uuid not null references public.video_lessons(id) on delete cascade,
  watched_seconds numeric(12,3) not null default 0 check (watched_seconds >= 0),
  percentage numeric(7,3) not null default 0 check (percentage between 0 and 100),
  completed boolean not null default false,
  last_watched_at timestamptz not null default now(),
  notes text not null default '',
  checklist_state jsonb not null default '{}'::jsonb,
  primary key (user_id, lesson_id)
);

create table public.saved_lessons (
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id uuid not null references public.video_lessons(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

create index video_lessons_published_sort_idx on public.video_lessons (published, featured desc, sort_order, updated_at desc);
create index video_lessons_category_idx on public.video_lessons (category) where published;
create index video_lesson_captions_timeline_idx on public.video_lesson_captions (lesson_id, start_time, sort_order);
create index lesson_progress_recent_idx on public.lesson_progress (user_id, last_watched_at desc);

drop trigger if exists video_lessons_set_updated_at on public.video_lessons;
create trigger video_lessons_set_updated_at before update on public.video_lessons
for each row execute procedure public.set_updated_at();

alter table public.video_lessons enable row level security;
alter table public.video_lesson_captions enable row level security;
alter table public.video_lesson_rules enable row level security;
alter table public.video_lesson_checklist enable row level security;
alter table public.dashboard_placements enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.saved_lessons enable row level security;

alter table public.video_lessons force row level security;
alter table public.video_lesson_captions force row level security;
alter table public.video_lesson_rules force row level security;
alter table public.video_lesson_checklist force row level security;
alter table public.dashboard_placements force row level security;
alter table public.lesson_progress force row level security;
alter table public.saved_lessons force row level security;

create policy video_lessons_read on public.video_lessons for select to authenticated
using (published or owner_id = (select auth.uid()));
create policy video_lessons_owner_insert on public.video_lessons for insert to authenticated
with check (owner_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'owner'));
create policy video_lessons_owner_update on public.video_lessons for update to authenticated
using (owner_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'owner'))
with check (owner_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'owner'));
create policy video_lessons_owner_delete on public.video_lessons for delete to authenticated
using (owner_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'owner'));

create policy video_captions_read on public.video_lesson_captions for select to authenticated
using (exists (select 1 from public.video_lessons l where l.id = lesson_id and (l.published or l.owner_id = (select auth.uid()))));
create policy video_captions_owner_manage on public.video_lesson_captions for all to authenticated
using (exists (select 1 from public.video_lessons l join public.profiles p on p.id = (select auth.uid()) where l.id = lesson_id and l.owner_id = (select auth.uid()) and p.role = 'owner'))
with check (exists (select 1 from public.video_lessons l join public.profiles p on p.id = (select auth.uid()) where l.id = lesson_id and l.owner_id = (select auth.uid()) and p.role = 'owner'));

create policy video_rules_read on public.video_lesson_rules for select to authenticated
using (exists (select 1 from public.video_lessons l where l.id = lesson_id and (l.published or l.owner_id = (select auth.uid()))));
create policy video_rules_owner_manage on public.video_lesson_rules for all to authenticated
using (exists (select 1 from public.video_lessons l join public.profiles p on p.id = (select auth.uid()) where l.id = lesson_id and l.owner_id = (select auth.uid()) and p.role = 'owner'))
with check (exists (select 1 from public.video_lessons l join public.profiles p on p.id = (select auth.uid()) where l.id = lesson_id and l.owner_id = (select auth.uid()) and p.role = 'owner'));

create policy video_checklist_read on public.video_lesson_checklist for select to authenticated
using (exists (select 1 from public.video_lessons l where l.id = lesson_id and (l.published or l.owner_id = (select auth.uid()))));
create policy video_checklist_owner_manage on public.video_lesson_checklist for all to authenticated
using (exists (select 1 from public.video_lessons l join public.profiles p on p.id = (select auth.uid()) where l.id = lesson_id and l.owner_id = (select auth.uid()) and p.role = 'owner'))
with check (exists (select 1 from public.video_lessons l join public.profiles p on p.id = (select auth.uid()) where l.id = lesson_id and l.owner_id = (select auth.uid()) and p.role = 'owner'));

create policy video_placements_read on public.dashboard_placements for select to authenticated
using (exists (select 1 from public.video_lessons l where l.id = lesson_id and (l.published or l.owner_id = (select auth.uid()))));
create policy video_placements_owner_manage on public.dashboard_placements for all to authenticated
using (exists (select 1 from public.video_lessons l join public.profiles p on p.id = (select auth.uid()) where l.id = lesson_id and l.owner_id = (select auth.uid()) and p.role = 'owner'))
with check (exists (select 1 from public.video_lessons l join public.profiles p on p.id = (select auth.uid()) where l.id = lesson_id and l.owner_id = (select auth.uid()) and p.role = 'owner'));

create policy lesson_progress_own on public.lesson_progress for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy saved_lessons_own on public.saved_lessons for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.video_lessons to authenticated;
grant select, insert, update, delete on public.video_lesson_captions to authenticated;
grant select, insert, update, delete on public.video_lesson_rules to authenticated;
grant select, insert, update, delete on public.video_lesson_checklist to authenticated;
grant select, insert, update, delete on public.dashboard_placements to authenticated;
grant select, insert, update, delete on public.lesson_progress to authenticated;
grant select, insert, update, delete on public.saved_lessons to authenticated;
revoke all on public.video_lessons, public.video_lesson_captions, public.video_lesson_rules,
  public.video_lesson_checklist, public.dashboard_placements, public.lesson_progress, public.saved_lessons from anon;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'trading-lessons', 'trading-lessons', false, 1073741824,
  array['video/mp4','video/webm','video/quicktime','image/jpeg','image/png','image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy lesson_media_owner_insert on storage.objects for insert to authenticated
with check (bucket_id = 'trading-lessons' and (storage.foldername(name))[1] = (select auth.uid())::text and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'owner'));
create policy lesson_media_read on storage.objects for select to authenticated
using (
  bucket_id = 'trading-lessons' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (select 1 from public.video_lessons l where l.published and (l.video_path = name or l.thumbnail_path = name))
  )
);
create policy lesson_media_owner_update on storage.objects for update to authenticated
using (bucket_id = 'trading-lessons' and (storage.foldername(name))[1] = (select auth.uid())::text and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'owner'))
with check (bucket_id = 'trading-lessons' and (storage.foldername(name))[1] = (select auth.uid())::text and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'owner'));
create policy lesson_media_owner_delete on storage.objects for delete to authenticated
using (bucket_id = 'trading-lessons' and (storage.foldername(name))[1] = (select auth.uid())::text and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'owner'));

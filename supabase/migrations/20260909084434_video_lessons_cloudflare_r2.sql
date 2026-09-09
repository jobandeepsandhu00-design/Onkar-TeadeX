-- Keep Supabase as the metadata/auth layer while lesson binaries move to R2.
-- Existing Supabase Storage paths remain valid until each object is migrated and verified.

alter table public.video_lessons
  add column if not exists video_storage_provider text not null default 'supabase_storage',
  add column if not exists video_object_key text,
  add column if not exists video_file_name text,
  add column if not exists video_size_bytes bigint,
  add column if not exists video_mime_type text,
  add column if not exists thumbnail_object_key text,
  add column if not exists caption_object_key text,
  add column if not exists audio_object_key text,
  add column if not exists upload_status text not null default 'ready',
  add column if not exists processing_status text not null default 'ready';

alter table public.video_lessons
  drop constraint if exists video_lessons_video_storage_provider_check,
  add constraint video_lessons_video_storage_provider_check
    check (video_storage_provider in ('supabase_storage', 'cloudflare_r2')),
  drop constraint if exists video_lessons_video_size_bytes_check,
  add constraint video_lessons_video_size_bytes_check
    check (video_size_bytes is null or video_size_bytes >= 0),
  drop constraint if exists video_lessons_upload_status_check,
  add constraint video_lessons_upload_status_check
    check (upload_status in ('pending', 'uploading', 'uploaded', 'processing', 'ready', 'failed')),
  drop constraint if exists video_lessons_processing_status_check,
  add constraint video_lessons_processing_status_check
    check (processing_status in ('pending', 'processing', 'ready', 'failed'));

update public.video_lessons
set video_storage_provider = 'supabase_storage',
    upload_status = 'ready',
    processing_status = 'ready'
where video_storage_provider is null
   or video_storage_provider = 'supabase_storage';

create index if not exists video_lessons_storage_provider_idx
  on public.video_lessons (video_storage_provider, upload_status)
  where published;

comment on column public.video_lessons.video_object_key is 'Private Cloudflare R2 object key. Signed playback URLs are never persisted.';
comment on column public.video_lessons.thumbnail_object_key is 'Private Cloudflare R2 thumbnail object key.';
comment on column public.video_lessons.video_path is 'Legacy-compatible media path; R2 lessons mirror video_object_key here for current clients.';

-- Queue existing Library content once so the new knowledge brain learns the
-- user's current catalog as well as all future uploads handled by triggers.
insert into public.onkar_ingestion_jobs(user_id,source_type,source_id,stage,next_attempt_at)
select owner_id,'VIDEO',id::text,'UPLOADED',now()
from public.video_lessons
where owner_id is not null
on conflict(user_id,source_type,source_id) do nothing;

insert into public.onkar_ingestion_jobs(user_id,source_type,source_id,stage,next_attempt_at)
select user_id,'LIBRARY','library','UPLOADED',now()
from public.app_state
on conflict(user_id,source_type,source_id) do nothing;

insert into public.onkar_ingestion_jobs(user_id,source_type,source_id,stage,next_attempt_at)
select user_id,'TRADE_RESULTS','journal','UPLOADED',now()
from public.app_state
where jsonb_typeof(data->'trades') = 'array'
  and jsonb_array_length(data->'trades') > 0
on conflict(user_id,source_type,source_id) do nothing;

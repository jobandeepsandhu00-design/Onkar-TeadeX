-- Central, authenticated notification threads. Trading UI components are read-only;
-- only trusted server workers may create or mutate trading alerts.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_key text not null,
  category text not null check (category in ('TRADING','SETUPS','AI','RISK','NEWS','SYSTEM')),
  priority text not null check (priority in ('INFO','IMPORTANT','HIGH','CRITICAL')),
  symbol text,
  timeframe text,
  setup_id text,
  trade_id text,
  agent_source text not null default 'MASTER_AI',
  title text not null,
  message text not null,
  evidence jsonb not null default '[]'::jsonb,
  lifecycle_state text,
  recommended_action text,
  actions jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  read_at timestamptz,
  acknowledged_at timestamptz,
  voice_spoken_at timestamptz,
  push_sent_at timestamptz,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','RESOLVED','INVALIDATED','EXPIRED')),
  unique (user_id, event_key)
);

create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_key text not null,
  lifecycle_state text,
  agent_source text not null,
  title text not null,
  message text not null,
  evidence jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (notification_id, event_key)
);

create table public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  channels jsonb not null default '{"INFO":{"inApp":true,"push":false,"voice":false,"sound":false},"IMPORTANT":{"inApp":true,"push":false,"voice":false,"sound":true},"HIGH":{"inApp":true,"push":true,"voice":true,"sound":true},"CRITICAL":{"inApp":true,"push":true,"voice":true,"sound":true}}'::jsonb,
  category_overrides jsonb not null default '{}'::jsonb,
  voice_enabled boolean not null default true,
  voice_volume double precision not null default 0.8 check (voice_volume between 0 and 1),
  push_enabled boolean not null default false,
  sound_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create index notifications_inbox_idx on public.notifications(user_id, status, updated_at desc);
create index notifications_unread_idx on public.notifications(user_id, priority, updated_at desc) where read_at is null;
create index notifications_candidate_idx on public.notifications(user_id, setup_id, symbol, timeframe, updated_at desc);
create index notification_events_timeline_idx on public.notification_events(user_id, notification_id, created_at desc);

alter table public.notifications enable row level security;
alter table public.notification_events enable row level security;
alter table public.notification_preferences enable row level security;

revoke all on public.notifications, public.notification_events, public.notification_preferences from anon, authenticated;
grant select on public.notifications, public.notification_events, public.notification_preferences to authenticated;
grant insert, update on public.notification_preferences to authenticated;
grant all on public.notifications, public.notification_events, public.notification_preferences to service_role;

create policy notifications_private_read on public.notifications
  for select to authenticated using ((select auth.uid()) = user_id);
create policy notification_events_private_read on public.notification_events
  for select to authenticated using ((select auth.uid()) = user_id);
create policy notification_preferences_private_read on public.notification_preferences
  for select to authenticated using ((select auth.uid()) = user_id);
create policy notification_preferences_private_insert on public.notification_preferences
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy notification_preferences_private_update on public.notification_preferences
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Realtime delivers only rows permitted by the subscriber's RLS policy.
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null;
end $$;

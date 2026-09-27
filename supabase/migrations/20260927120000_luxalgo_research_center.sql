-- Isolated LuxAlgo Research Center cache and user state. No row in these
-- tables is part of the Setup Library or authorized to influence execution.
create table public.luxalgo_cache_items (
  cache_key text primary key,
  tool_name text not null,
  arguments jsonb not null default '{}',
  payload jsonb not null,
  content_hash text not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index luxalgo_cache_expiry_idx on public.luxalgo_cache_items(expires_at);
create index luxalgo_cache_tool_idx on public.luxalgo_cache_items(tool_name,updated_at desc);

create table public.luxalgo_saved_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_type text not null check (item_type in ('CONCEPT','INDICATOR','FAMILY','EDGE_REPORT')),
  external_id text not null,
  name text not null,
  family text,
  official_url text,
  snapshot jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,item_type,external_id)
);
create index luxalgo_saved_user_idx on public.luxalgo_saved_items(user_id,created_at desc);

create table public.luxalgo_search_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  query text not null,
  filters jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index luxalgo_history_user_idx on public.luxalgo_search_history(user_id,created_at desc);

create table public.luxalgo_user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  cache_enabled boolean not null default true,
  cache_duration_minutes integer not null default 360 check (cache_duration_minutes between 5 and 10080),
  allow_master_ai boolean not null default true,
  allow_trend_ai boolean not null default true,
  allow_zone_ai boolean not null default true,
  allow_setup_ai boolean not null default true,
  allow_backtest_ai boolean not null default true,
  allow_insight_ai boolean not null default true,
  edge_stats_enabled boolean not null default true,
  saved_research_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.luxalgo_cache_items enable row level security;
alter table public.luxalgo_saved_items enable row level security;
alter table public.luxalgo_search_history enable row level security;
alter table public.luxalgo_user_settings enable row level security;

-- The shared cache is server-only. No browser grants or permissive policies.
revoke all on table public.luxalgo_cache_items from anon, authenticated;
grant select,insert,update,delete on table public.luxalgo_saved_items to authenticated;
grant select,insert,delete on table public.luxalgo_search_history to authenticated;
grant select,insert,update on table public.luxalgo_user_settings to authenticated;

create policy luxalgo_saved_owner_select on public.luxalgo_saved_items for select to authenticated using ((select auth.uid())=user_id);
create policy luxalgo_saved_owner_insert on public.luxalgo_saved_items for insert to authenticated with check ((select auth.uid())=user_id);
create policy luxalgo_saved_owner_update on public.luxalgo_saved_items for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy luxalgo_saved_owner_delete on public.luxalgo_saved_items for delete to authenticated using ((select auth.uid())=user_id);
create policy luxalgo_history_owner_select on public.luxalgo_search_history for select to authenticated using ((select auth.uid())=user_id);
create policy luxalgo_history_owner_insert on public.luxalgo_search_history for insert to authenticated with check ((select auth.uid())=user_id);
create policy luxalgo_history_owner_delete on public.luxalgo_search_history for delete to authenticated using ((select auth.uid())=user_id);
create policy luxalgo_settings_owner_select on public.luxalgo_user_settings for select to authenticated using ((select auth.uid())=user_id);
create policy luxalgo_settings_owner_insert on public.luxalgo_user_settings for insert to authenticated with check ((select auth.uid())=user_id);
create policy luxalgo_settings_owner_update on public.luxalgo_user_settings for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

comment on table public.luxalgo_cache_items is 'Server-only cache of untrusted public LuxAlgo MCP research responses; never execution authority.';
comment on table public.luxalgo_saved_items is 'User-saved LuxAlgo-attributed research, isolated from Onkar Setup Library records.';

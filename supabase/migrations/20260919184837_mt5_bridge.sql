-- MT5 metadata only. Broker passwords and bridge API keys never enter Supabase.
create table public.mt5_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  broker text,
  server text,
  masked_account text,
  account_type text check (account_type in ('DEMO','LIVE','CONTEST')),
  currency text,
  status text not null default 'DISCONNECTED' check (status in ('CONNECTED','CONNECTING','RECONNECTING','DISCONNECTED','STALE','MARKET_CLOSED','ERROR')),
  last_tick_at timestamptz,
  last_seen_at timestamptz,
  diagnostics jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id)
);

create table public.broker_symbol_map (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references public.mt5_connections(id) on delete cascade,
  internal_symbol text not null,
  broker_symbol text not null,
  confidence double precision not null default 0 check (confidence between 0 and 1),
  manually_confirmed boolean not null default false,
  updated_at timestamptz not null default now(),
  unique(connection_id,internal_symbol)
);

create table public.trade_execution_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  request_id text not null,
  candidate_id uuid,
  action text not null,
  request jsonb not null,
  status text not null check (status in ('PREPARED','CHECKED','CONFIRMED','SENT','REJECTED','FAILED','CANCELLED')),
  manually_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,request_id)
);

create table public.trade_execution_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null references public.trade_execution_requests(id) on delete cascade,
  mt5_order bigint,
  mt5_deal bigint,
  retcode integer,
  success boolean not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique(request_id)
);

do $$ declare t text; begin
  foreach t in array array['mt5_connections','broker_symbol_map','trade_execution_requests','trade_execution_results'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy private_read on public.%I for select to authenticated using (user_id = (select auth.uid()))', t);
  end loop;
end $$;

create index mt5_connection_status_idx on public.mt5_connections(user_id,status);
create index execution_request_timeline_idx on public.trade_execution_requests(user_id,created_at desc);

-- Merge one MT5 trade into the existing app_state journal. The existing
-- app_state trigger then refreshes normalized journal rows and learning jobs.
create function public.sync_mt5_journal_trades(
  p_user uuid,
  p_account jsonb,
  p_trades jsonb
) returns void
language plpgsql security invoker set search_path = '' as $$
declare current_state jsonb; next_state jsonb; accounts jsonb; trades jsonb; imported_ids text[];
begin
  if jsonb_typeof(p_trades) <> 'array' then
    raise exception 'p_trades must be an array';
  end if;
  select data into current_state from public.app_state where user_id=p_user for update;
  current_state := coalesce(current_state, '{}'::jsonb);
  accounts := coalesce(current_state->'tradingAccounts', '[]'::jsonb);
  accounts := coalesce((
    select jsonb_agg(item) from jsonb_array_elements(accounts) item
    where item->>'id' <> p_account->>'id'
  ), '[]'::jsonb) || jsonb_build_array(p_account);
  trades := coalesce(current_state->'trades', '[]'::jsonb);
  select coalesce(array_agg(item->>'id'), array[]::text[]) into imported_ids
  from jsonb_array_elements(p_trades) item;
  trades := coalesce((
    select jsonb_agg(item) from jsonb_array_elements(trades) item
    where not ((item->>'id') = any(imported_ids))
  ), '[]'::jsonb) || p_trades;
  next_state := jsonb_set(jsonb_set(current_state,'{tradingAccounts}',accounts,true),'{trades}',trades,true);
  if next_state = current_state then return; end if;
  perform public.sync_trading_state_for_user(p_user,next_state);
end $$;
revoke all on function public.sync_mt5_journal_trades(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.sync_mt5_journal_trades(uuid,jsonb,jsonb) to service_role;

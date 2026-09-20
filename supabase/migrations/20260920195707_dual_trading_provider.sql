alter table public.scanner_runtime_controls
  add column if not exists trading_source text not null default 'TWELVE_DATA'
    check (trading_source in ('MT5', 'TWELVE_DATA')),
  add column if not exists mt5_disconnect_behavior text not null default 'LOCK'
    check (mt5_disconnect_behavior in ('LOCK', 'PAPER', 'ANALYSIS')),
  add column if not exists auto_return_mt5 boolean not null default false,
  add column if not exists fallback_from_mt5 boolean not null default false,
  add column if not exists source_activated_at timestamptz not null default now();

update public.scanner_runtime_controls runtime
set trading_source = case
  when config.config ->> 'provider' = 'mt5' then 'MT5'
  else 'TWELVE_DATA'
end
from public.scanner_configs config
where config.id = runtime.scanner_config_id;

create table if not exists public.paper_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid not null references public.setup_candidates(id) on delete restrict,
  request_id text not null,
  account_id text not null,
  symbol text not null,
  direction text not null check (direction in ('BUY', 'SELL')),
  setup_id text,
  setup_version_id uuid not null references public.scanner_strategy_versions(id) on delete restrict,
  confirmation_candle timestamptz not null,
  entry numeric not null check (entry > 0),
  current_price numeric not null check (current_price > 0),
  stop_loss numeric not null check (stop_loss > 0),
  take_profit numeric not null check (take_profit > 0),
  position_size numeric not null check (position_size > 0),
  risk_percent numeric not null check (risk_percent > 0),
  status text not null default 'OPEN' check (status in ('OPEN', 'CLOSED', 'INVALIDATED')),
  close_price numeric,
  pnl numeric,
  r_multiple numeric,
  execution_provider text not null default 'PAPER' check (execution_provider = 'PAPER'),
  market_data_provider text not null default 'TWELVE_DATA' check (market_data_provider = 'TWELVE_DATA'),
  opened_at timestamptz not null default now(),
  last_managed_at timestamptz not null default now(),
  closed_at timestamptz,
  detail jsonb not null default '{}'::jsonb,
  unique(user_id, request_id)
);

alter table public.paper_trades enable row level security;
revoke all on public.paper_trades from anon, authenticated;
grant select on public.paper_trades to authenticated;
grant all on public.paper_trades to service_role;

create policy paper_trades_private_read on public.paper_trades
  for select to authenticated
  using (user_id = (select auth.uid()));

create index paper_trades_account_status_idx
  on public.paper_trades(user_id, account_id, status, opened_at desc);
create index paper_trades_management_idx
  on public.paper_trades(status, last_managed_at)
  where status = 'OPEN';

alter table public.scanner_execution_events
  add column if not exists execution_provider text
    check (execution_provider in ('MT5', 'PAPER')),
  add column if not exists market_data_provider text
    check (market_data_provider in ('MT5', 'TWELVE_DATA')),
  add column if not exists account_id text;

create or replace function public.upsert_paper_trade_journal(
  p_user uuid,
  p_trade jsonb
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_data jsonb;
  current_trades jsonb;
begin
  select data into current_data
  from public.app_state
  where user_id = p_user
  for update;

  if current_data is null then
    raise exception 'App state is unavailable';
  end if;

  current_trades := coalesce(current_data -> 'trades', '[]'::jsonb);
  current_trades := coalesce(
    (
      select jsonb_agg(item)
      from jsonb_array_elements(current_trades) item
      where coalesce(item ->> 'id', '') <> (p_trade ->> 'id')
    ),
    '[]'::jsonb
  ) || jsonb_build_array(p_trade);

  update public.app_state
  set data = jsonb_set(current_data, '{trades}', current_trades, true)
  where user_id = p_user;
end;
$$;

revoke all on function public.upsert_paper_trade_journal(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_paper_trade_journal(uuid, jsonb) to service_role;

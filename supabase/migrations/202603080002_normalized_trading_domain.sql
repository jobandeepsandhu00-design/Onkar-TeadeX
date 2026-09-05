-- Trading OS normalized records. `payload` retains forward-compatible UI fields
-- while the indexed columns support filtering and reporting.

create table if not exists public.trading_accounts (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  broker text,
  account_type text,
  currency text,
  starting_balance numeric,
  is_archived boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.trades (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  account_id text references public.trading_accounts(id) on delete set null,
  strategy_id text,
  setup_id text,
  trade_date date,
  symbol text,
  market text,
  side text,
  status text,
  entry_price numeric,
  exit_price numeric,
  net_pnl numeric,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.setups (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  market text,
  tags text[] not null default '{}',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.strategies (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  market text,
  timeframe text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.trading_plans (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan_type text not null default 'custom',
  title text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.psychology_entries (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entry_date date,
  mood text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.vault_entries (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  category text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.smc_entries (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  term text not null,
  category text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.daily_checkins (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  checkin_date date,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.pre_session_plans (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan_date date,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.session_plans (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  session_date date,
  session_name text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.prop_challenges (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  account_id text references public.trading_accounts(id) on delete set null,
  name text not null,
  status text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.user_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.trading_attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  storage_path text not null unique,
  entity_type text,
  entity_id text,
  file_name text,
  content_type text,
  byte_size bigint,
  created_at timestamptz not null default now()
);

create index if not exists trades_workspace_date_idx on public.trades (workspace_id, trade_date desc);
create index if not exists trades_workspace_account_idx on public.trades (workspace_id, account_id);
create index if not exists trades_workspace_symbol_idx on public.trades (workspace_id, symbol);
create index if not exists trading_accounts_workspace_idx on public.trading_accounts (workspace_id);
create index if not exists setups_workspace_idx on public.setups (workspace_id);
create index if not exists strategies_workspace_idx on public.strategies (workspace_id);
create index if not exists psychology_entries_workspace_date_idx on public.psychology_entries (workspace_id, entry_date desc);
create index if not exists daily_checkins_workspace_date_idx on public.daily_checkins (workspace_id, checkin_date desc);
create index if not exists pre_session_plans_workspace_date_idx on public.pre_session_plans (workspace_id, plan_date desc);
create index if not exists session_plans_workspace_date_idx on public.session_plans (workspace_id, session_date desc);
create index if not exists prop_challenges_workspace_idx on public.prop_challenges (workspace_id);
create index if not exists trading_attachments_workspace_entity_idx on public.trading_attachments (workspace_id, entity_type, entity_id);

-- Every mutable normalized record gets a consistent updated_at value.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'trading_accounts','trades','setups','strategies','trading_plans',
    'psychology_entries','vault_entries','smc_entries','daily_checkins',
    'pre_session_plans','session_plans','prop_challenges','user_settings'
  ] loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_set_updated_at', table_name);
    execute format('create trigger %I before update on public.%I for each row execute procedure public.set_updated_at()',
      table_name || '_set_updated_at', table_name);
  end loop;
end $$;
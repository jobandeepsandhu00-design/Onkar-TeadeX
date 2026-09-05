-- Auditable verification and non-destructive rollback guidance.
-- Supabase's migration history remains the source of applied-version truth.

create table if not exists public.schema_migration_metadata (
  version text primary key,
  name text not null,
  checksum_note text not null,
  rollback_strategy text not null,
  verified_at timestamptz,
  verified_by uuid references auth.users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.legacy_migrations add column if not exists source_checksum text;
alter table public.legacy_migrations add column if not exists verification jsonb not null default '{}'::jsonb;

create table if not exists public.migration_runs (
  id uuid primary key,
  status text not null check (status in ('running', 'completed', 'failed')),
  details jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.migration_checkpoints (
  run_id uuid not null references public.migration_runs(id) on delete cascade,
  legacy_user_id text not null,
  status text not null check (status in ('completed', 'failed')),
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (run_id, legacy_user_id)
);

insert into public.schema_migration_metadata
  (version, name, checksum_note, rollback_strategy)
values
  ('202603080001', 'core_identity_and_workspaces', 'Review committed SQL before applying.', 'Disable policies/triggers only after exporting dependent data; never drop populated tables.'),
  ('202603080002', 'normalized_trading_domain', 'Review committed SQL before applying.', 'Stop application writes and export rows; rollback is additive/manual to prevent data loss.'),
  ('202603080003', 'rls_storage_and_compatibility', 'Review committed SQL before applying.', 'Restore prior policies only after a security review; keep the bucket private.'),
  ('202603080004', 'migration_metadata', 'Review committed SQL before applying.', 'Metadata can be retained safely; no destructive rollback is required.')
on conflict (version) do update set
  name = excluded.name,
  checksum_note = excluded.checksum_note,
  rollback_strategy = excluded.rollback_strategy;

alter table public.schema_migration_metadata enable row level security;
alter table public.migration_runs enable row level security;
alter table public.migration_checkpoints enable row level security;
revoke all on public.schema_migration_metadata from anon, authenticated;
revoke all on public.migration_runs from anon, authenticated;
revoke all on public.migration_checkpoints from anon, authenticated;

create or replace function public.verify_trading_os_schema()
returns table (check_name text, passed boolean, detail text)
language sql
security definer
set search_path = public
as $$
  select 'private_attachment_bucket',
    exists (select 1 from storage.buckets where id = 'trading-attachments' and public = false),
    'trading-attachments bucket exists and is private'
  union all
  select 'app_state_compatibility',
    to_regclass('public.app_state') is not null,
    'legacy application state table exists'
  union all
  select 'normalized_trade_table',
    to_regclass('public.trades') is not null,
    'normalized trades table exists'
  union all
  select 'rls_on_trades',
    coalesce((select relrowsecurity from pg_class where oid = 'public.trades'::regclass), false),
    'row-level security is enabled for trades';
$$;

revoke all on function public.verify_trading_os_schema() from public;
grant execute on function public.verify_trading_os_schema() to service_role;
-- Exact AUTO account binding. Fingerprints are bridge-generated HMAC values
-- and remain server-side; authenticated browser roles receive no table grant.
create table public.mt5_account_bindings (
  user_id uuid not null references auth.users(id) on delete cascade,
  selected_account_id text not null,
  account_fingerprint text not null check (account_fingerprint ~ '^[a-f0-9]{64}$'),
  broker text not null,
  server text not null,
  last_verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, selected_account_id),
  unique (user_id, account_fingerprint)
);

alter table public.mt5_account_bindings enable row level security;
revoke all on public.mt5_account_bindings from public, anon, authenticated;
grant select, insert, update, delete on public.mt5_account_bindings to service_role;

create index mt5_account_binding_fingerprint_idx
  on public.mt5_account_bindings(user_id, account_fingerprint);

comment on table public.mt5_account_bindings is
  'Service-role-only exact identity binding between a selected app account and the connected MT5 login.';

-- A manually confirmed broker alias is valid only for the exact terminal
-- account that confirmed it. The older browser-facing broker_symbol_map remains
-- a presentation cache and is never trusted for replay into the bridge.
create table public.mt5_symbol_mapping_bindings (
  user_id uuid not null references auth.users(id) on delete cascade,
  account_fingerprint text not null check (account_fingerprint ~ '^[a-f0-9]{64}$'),
  internal_symbol text not null check (internal_symbol ~ '^[A-Z]{3}/[A-Z]{3}$'),
  broker_symbol text not null check (broker_symbol ~ '^[A-Za-z0-9._-]{3,40}$'),
  verified_at timestamptz not null default now(),
  primary key (user_id, account_fingerprint, internal_symbol)
);

alter table public.mt5_symbol_mapping_bindings enable row level security;
revoke all on public.mt5_symbol_mapping_bindings from public, anon, authenticated;
grant select, insert, update, delete on public.mt5_symbol_mapping_bindings to service_role;

comment on table public.mt5_symbol_mapping_bindings is
  'Service-role-only manual symbol aliases scoped to one exact connected MT5 account.';

-- Evidence that an MT5 candidate was calculated from one stable terminal
-- identity. This relation is intentionally separate from setup_candidates so
-- the browser-facing candidate payload can never disclose the bridge HMAC.
create table public.mt5_candidate_provenance (
  candidate_id uuid primary key,
  candidate_last_candle_at timestamptz not null,
  user_id uuid not null,
  config_id uuid not null,
  selected_account_id text not null,
  account_fingerprint text not null check (account_fingerprint ~ '^[a-f0-9]{64}$'),
  broker_symbol text not null,
  verified_before_at timestamptz not null,
  verified_after_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (candidate_id, user_id)
    references public.setup_candidates(id, user_id) on delete cascade,
  foreign key (config_id, user_id)
    references public.scanner_configs(id, user_id) on delete cascade,
  foreign key (user_id, selected_account_id)
    references public.mt5_account_bindings(user_id, selected_account_id) on delete cascade,
  check (verified_after_at >= verified_before_at)
);

alter table public.mt5_candidate_provenance enable row level security;
revoke all on public.mt5_candidate_provenance from public, anon, authenticated;
grant select, insert, update, delete on public.mt5_candidate_provenance to service_role;

create index mt5_candidate_provenance_account_idx
  on public.mt5_candidate_provenance(user_id, selected_account_id, account_fingerprint);

comment on table public.mt5_candidate_provenance is
  'Service-role-only MT5 terminal identity captured before and after the candle set used for a scanner candidate.';

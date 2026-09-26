-- One-time manual order preflights. The connected-account fingerprint is
-- deliberately isolated from browser-readable trade_execution_requests.
create table public.mt5_manual_preflight_bindings (
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  execution_request_id uuid not null references public.trade_execution_requests(id) on delete cascade,
  request_id text not null,
  account_fingerprint text not null check (account_fingerprint ~ '^[a-f0-9]{64}$'),
  selected_account_id text not null,
  internal_symbol text not null,
  broker_symbol text not null,
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  checked_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  primary key (user_id, request_id),
  unique (execution_request_id)
);

alter table public.mt5_manual_preflight_bindings enable row level security;
revoke all on public.mt5_manual_preflight_bindings from public, anon, authenticated;
grant select, insert, update, delete on public.mt5_manual_preflight_bindings to service_role;

create index mt5_manual_preflight_expiry_idx
  on public.mt5_manual_preflight_bindings(user_id, expires_at)
  where consumed_at is null;

comment on table public.mt5_manual_preflight_bindings is
  'Service-role-only one-time binding of a manual broker check to exact selected account, terminal identity, broker symbol and payload.';

-- A lost HTTP response after order_send is not a failure. Keep the request
-- globally locked until the original request id is reconciled against the
-- bridge's durable idempotency database and broker history.
alter table public.trade_execution_requests
  drop constraint if exists trade_execution_requests_status_check;
alter table public.trade_execution_requests
  add constraint trade_execution_requests_status_check
  check (status in (
    'PREPARED','CHECKED','CONFIRMED','UNCERTAIN','RECONCILING',
    'SENT','REJECTED','FAILED','CANCELLED'
  ));

create index if not exists mt5_execution_unresolved_user_idx
  on public.trade_execution_requests(user_id, updated_at)
  where status in ('CONFIRMED','UNCERTAIN','RECONCILING');

-- Serialize the manual CHECKED -> CONFIRMED transition without a partial unique
-- index. A unique index could make rollout fail if production already has
-- more than one crash-window CONFIRMED row. The advisory transaction lock is
-- non-destructive: old rows remain available for one-by-one reconciliation,
-- while no new manual request can join any unresolved manual or AUTO MT5
-- execution for this user. The target itself must still be manual.
create or replace function public.claim_mt5_manual_execution(
  p_user uuid,
  p_execution_request uuid,
  p_confirmed_at timestamptz
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare changed integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 260919));
  if exists (
    select 1
    from public.trade_execution_requests existing
    where existing.user_id = p_user
      and existing.id <> p_execution_request
      and existing.status in ('CONFIRMED','UNCERTAIN','RECONCILING')
  ) then
    return false;
  end if;

  update public.trade_execution_requests target
  set status = 'CONFIRMED',
      manually_confirmed_at = p_confirmed_at,
      updated_at = p_confirmed_at
  where target.id = p_execution_request
    and target.user_id = p_user
    and target.candidate_id is null
    and target.status = 'CHECKED';
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;
revoke all on function public.claim_mt5_manual_execution(uuid,uuid,timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_mt5_manual_execution(uuid,uuid,timestamptz)
  to service_role;

create table public.scanner_runtime_controls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  scanner_config_id uuid not null references public.scanner_configs(id) on delete cascade,
  scanner_state text not null default 'STOPPED' check (scanner_state in ('RUNNING','PAUSED','STOPPED')),
  trading_mode text not null default 'ANALYSIS' check (trading_mode in ('ANALYSIS','CONFIRM','AUTO')),
  auto_start boolean not null default false,
  auto_execution_enabled boolean not null default false,
  emergency_stop boolean not null default false,
  reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id),
  unique(scanner_config_id)
);

create table public.scanner_execution_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id uuid references public.setup_candidates(id) on delete set null,
  request_id text,
  state text not null check (state in ('RISK_CHECK','READY_TO_EXECUTE','EXECUTING','EXECUTED','INVALIDATED','BLOCKED','ERROR')),
  reason text,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.scanner_runtime_controls enable row level security;
alter table public.scanner_execution_events enable row level security;
revoke all on public.scanner_runtime_controls, public.scanner_execution_events from anon, authenticated;
grant select on public.scanner_runtime_controls, public.scanner_execution_events to authenticated;
grant all on public.scanner_runtime_controls, public.scanner_execution_events to service_role;

create policy scanner_runtime_private_read on public.scanner_runtime_controls
  for select to authenticated using (user_id = (select auth.uid()));
create policy scanner_execution_events_private_read on public.scanner_execution_events
  for select to authenticated using (user_id = (select auth.uid()));

create index scanner_runtime_state_idx on public.scanner_runtime_controls(user_id, scanner_state, trading_mode);
create index scanner_execution_timeline_idx on public.scanner_execution_events(user_id, created_at desc);

-- Keep the existing lease model, but do not lease paused/stopped scanners.
-- Configurations created before this feature continue to run until the user
-- saves a runtime preference, preserving existing behaviour.
create or replace function public.claim_scanner_job(p_config uuid default null)
returns setof public.scanner_configs language plpgsql security invoker set search_path = '' as $$
declare job_id uuid; begin
  select cfg.id into job_id
  from public.scanner_configs cfg
  left join public.scanner_runtime_controls runtime on runtime.scanner_config_id=cfg.id
  where cfg.enabled
    and (runtime.id is null or runtime.scanner_state='RUNNING')
    and cfg.next_run_at<=now()
    and (cfg.lease_until is null or cfg.lease_until<now())
    and (p_config is null or cfg.id=p_config)
  order by cfg.next_run_at for update of cfg skip locked limit 1;
  if job_id is null then return; end if;
  return query update public.scanner_configs set lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes'
    where id=job_id returning *;
end $$;

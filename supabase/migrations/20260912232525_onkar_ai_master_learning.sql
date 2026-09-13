-- Durable Onkar AI operational history and learning evidence. OpenAI is never
-- treated as storage; all rows remain scoped to the authenticated owner.
create table public.onkar_agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  request jsonb not null default '{}',
  intent text not null,
  agents_called text[] not null default '{}',
  data_status text not null check (data_status in ('verified','partial','unavailable')),
  status text not null check (status in ('pending','succeeded','failed')),
  output jsonb not null default '{}',
  command_log jsonb not null default '[]',
  model text,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_estimate numeric,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  error text,
  created_at timestamptz not null default now(),
  unique(id, user_id)
);
create index onkar_agent_runs_user_created_idx on public.onkar_agent_runs(user_id, created_at desc);

create table public.onkar_agent_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  agent text not null check (agent in ('master','trend','zone','setup','risk','news','backtest','journal','insight','execution')),
  status text not null check (status in ('complete','partial','unavailable','error')),
  data_status text not null check (data_status in ('verified','partial','unavailable')),
  sources jsonb not null default '[]',
  result jsonb not null default '{}',
  warnings jsonb not null default '[]',
  missing_data jsonb not null default '[]',
  duration_ms integer,
  created_at timestamptz not null default now(),
  foreign key(run_id,user_id) references public.onkar_agent_runs(id,user_id) on delete cascade
);
create index onkar_agent_results_user_run_idx on public.onkar_agent_results(user_id, run_id);

create table public.trade_learning_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_trade_id text not null,
  outcome text not null check (outcome in ('WIN','LOSS','BE','PARTIAL')),
  r_multiple numeric,
  setup_id text,
  strategy_version_id uuid,
  symbol text,
  timeframe text,
  session text,
  rules_matched jsonb not null default '[]',
  rules_failed jsonb not null default '[]',
  mistakes jsonb not null default '[]',
  strengths jsonb not null default '[]',
  evidence jsonb not null default '{}',
  lesson text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, source_trade_id)
);
create index trade_learning_user_setup_idx on public.trade_learning_records(user_id, setup_id);
create index trade_learning_user_symbol_idx on public.trade_learning_records(user_id, symbol);

create table public.learning_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  insight_key text not null,
  scope text not null check (scope in ('GLOBAL','STRATEGY','SYMBOL','SESSION','TIMEFRAME','BEHAVIOR','RISK','EXECUTION')),
  type text not null,
  title text not null,
  description text not null,
  evidence_json jsonb not null default '{}',
  sample_size integer not null check (sample_size >= 0),
  confidence text not null check (confidence in ('insufficient','very_low','early','moderate','stronger')),
  strategy_id text,
  symbol text,
  timeframe text,
  session text,
  first_detected_at timestamptz not null default now(),
  last_confirmed_at timestamptz not null default now(),
  active boolean not null default true,
  superseded_by uuid references public.learning_insights(id) on delete set null,
  unique(user_id, insight_key)
);
create index learning_insights_user_active_idx on public.learning_insights(user_id, active, last_confirmed_at desc);

create table public.onkar_learning_jobs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pending boolean not null default true,
  next_run_at timestamptz not null default now(),
  locked_until timestamptz,
  last_run_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
create index onkar_learning_jobs_due_idx on public.onkar_learning_jobs(next_run_at) where pending;

create schema if not exists private;
create function private.queue_onkar_learning_refresh()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Only queue when the journal collection changed. The worker performs all
  -- calculations in tested TypeScript and never sends the full state to OpenAI.
  if tg_op = 'INSERT' or (old.data->'trades') is distinct from (new.data->'trades') then
    insert into public.onkar_learning_jobs(user_id,pending,next_run_at,locked_until,last_error,updated_at)
    values(new.user_id,true,now(),null,null,now())
    on conflict(user_id) do update set pending=true,next_run_at=now(),locked_until=null,last_error=null,updated_at=now();
  end if;
  return new;
end $$;
revoke all on function private.queue_onkar_learning_refresh() from public,anon,authenticated;
create trigger app_state_queue_onkar_learning
after insert or update of data on public.app_state
for each row execute function private.queue_onkar_learning_refresh();

create function public.claim_onkar_learning_job()
returns uuid language plpgsql security invoker set search_path = '' as $$
declare claimed uuid;
begin
  select user_id into claimed from public.onkar_learning_jobs
  where pending and next_run_at <= now() and (locked_until is null or locked_until < now())
  order by next_run_at for update skip locked limit 1;
  if claimed is null then return null; end if;
  update public.onkar_learning_jobs set locked_until=now()+interval '2 minutes',updated_at=now() where user_id=claimed;
  return claimed;
end $$;
revoke all on function public.claim_onkar_learning_job() from public,anon,authenticated;
grant execute on function public.claim_onkar_learning_job() to service_role;

do $$ declare t text; begin
  foreach t in array array['onkar_agent_runs','onkar_agent_results','trade_learning_records','learning_insights','onkar_learning_jobs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    if t <> 'onkar_learning_jobs' then execute format('grant select on table public.%I to authenticated', t); end if;
    execute format('grant all on table public.%I to service_role', t);
    if t <> 'onkar_learning_jobs' then execute format('create policy owner_select on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t); end if;
  end loop;
end $$;

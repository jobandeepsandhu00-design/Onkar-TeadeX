-- Additive scanner foundation. Existing journal rows are rewritten by sync_trading_state;
-- source_setup_id/source_trade_id deliberately are NOT cascading foreign keys.
create table public.market_candles (
  provider text not null, symbol text not null, timeframe text not null,
  open_time bigint not null, o double precision not null, h double precision not null,
  l double precision not null, c double precision not null, v double precision,
  ingested_at timestamptz not null default now(),
  primary key(provider,symbol,timeframe,open_time),
  check(timeframe in ('1m','5m','15m','30m','1h','4h','1D','1W')),
  check(o>0 and c>0 and l>0 and h>=greatest(o,c) and l<=least(o,c) and (v is null or v>=0))
);
create table public.scanner_configs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  config jsonb not null default '{}', enabled boolean not null default false,
  next_run_at timestamptz not null default now(), lease_until timestamptz, lease_token uuid,
  cursor integer not null default 0, last_run_at timestamptz, last_duration_ms integer,
  health jsonb not null default '{}', last_error text, created_at timestamptz not null default now(),
  unique(user_id), unique(id,user_id)
);
create index scanner_due_idx on public.scanner_configs(next_run_at) where enabled;
create table public.scanner_strategy_versions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_setup_id text not null, name text not null, definition jsonb not null,
  fingerprint text not null, created_at timestamptz not null default now(),
  unique(user_id,source_setup_id,fingerprint), unique(id,user_id)
);
create table public.setup_candidates (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  config_id uuid not null, version_id uuid not null, symbol text not null, timeframe text not null,
  state text not null check(state in ('SCANNING','DEVELOPING','WATCH','READY','TRIGGERED','INVALIDATED','EXPIRED','COMPLETED')),
  score integer not null check(score between 0 and 100), payload jsonb not null, plan jsonb,
  fingerprint text not null, last_candle_at timestamptz not null, expires_at timestamptz not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(config_id,user_id) references public.scanner_configs(id,user_id) on delete cascade,
  foreign key(version_id,user_id) references public.scanner_strategy_versions(id,user_id),
  unique(user_id,fingerprint), unique(id,user_id)
);
create index candidate_rank_idx on public.setup_candidates(user_id,state,score desc);
create index candidate_version_idx on public.setup_candidates(version_id,symbol,timeframe);
create table public.setup_events (
  id uuid primary key default gen_random_uuid(), candidate_id uuid not null, user_id uuid not null,
  event_key text not null, kind text not null, detail jsonb not null default '{}', created_at timestamptz not null default now(),
  foreign key(candidate_id,user_id) references public.setup_candidates(id,user_id) on delete cascade,
  unique(candidate_id,event_key)
);
create index setup_events_timeline_idx on public.setup_events(candidate_id,created_at);
create table public.scanner_ai_runs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  candidate_id uuid not null, fingerprint text not null, purpose text not null default 'explanation',
  status text not null check(status in ('pending','succeeded','failed')), model text,
  input_tokens integer, output_tokens integer, latency_ms integer, cost_estimate numeric,
  output jsonb, tool_calls jsonb not null default '[]', error text, created_at timestamptz not null default now(),
  foreign key(candidate_id,user_id) references public.setup_candidates(id,user_id) on delete cascade,
  unique(user_id,fingerprint)
);
create index scanner_ai_budget_idx on public.scanner_ai_runs(user_id,created_at);
create table public.scanner_alerts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, candidate_id uuid not null,
  kind text not null, message text not null, dedup_key text not null, read_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key(candidate_id,user_id) references public.setup_candidates(id,user_id) on delete cascade,
  unique(user_id,dedup_key)
);
create index scanner_alerts_inbox_idx on public.scanner_alerts(user_id,created_at desc);
create table public.scanner_webhook_keys (
  config_id uuid primary key references public.scanner_configs(id) on delete cascade,
  secret_hash text not null, created_at timestamptz not null default now()
);
create table public.tradingview_webhook_events (
  id uuid primary key default gen_random_uuid(), config_id uuid not null, user_id uuid not null,
  event_id text not null, payload jsonb not null, created_at timestamptz not null default now(),
  foreign key(config_id,user_id) references public.scanner_configs(id,user_id) on delete cascade,
  unique(config_id,event_id)
);
create table public.scanner_trade_links (
  candidate_id uuid not null, user_id uuid not null, source_trade_id text not null,
  note text not null default '', created_at timestamptz not null default now(),
  foreign key(candidate_id,user_id) references public.setup_candidates(id,user_id) on delete cascade,
  primary key(candidate_id,source_trade_id)
);

-- All writes go through authenticated, validated server routes or the leased worker.
-- Even authenticated clients cannot manufacture scores, approvals or alerts directly.
do $$ declare t text; begin
  foreach t in array array['market_candles','scanner_configs','scanner_strategy_versions','setup_candidates','setup_events','scanner_ai_runs','scanner_alerts','scanner_webhook_keys','tradingview_webhook_events','scanner_trade_links'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    if t not in ('market_candles','scanner_webhook_keys') then
      execute format('grant select on public.%I to authenticated',t);
      execute format('create policy private_read on public.%I for select to authenticated using (user_id = (select auth.uid()))',t);
    end if;
  end loop;
end $$;

-- Lease one bounded job, safe across concurrent worker instances. Expired leases recover.
create function public.claim_scanner_job(p_config uuid default null)
returns setof public.scanner_configs language plpgsql security invoker set search_path = '' as $$
declare job_id uuid; begin
  select id into job_id from public.scanner_configs
   where enabled and next_run_at<=now() and (lease_until is null or lease_until<now())
   and (p_config is null or id=p_config)
   order by next_run_at for update skip locked limit 1;
  if job_id is null then return; end if;
  return query update public.scanner_configs set lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes'
    where id=job_id returning *;
end $$;
revoke all on function public.claim_scanner_job(uuid) from public,anon,authenticated;
grant execute on function public.claim_scanner_job(uuid) to service_role;

-- Candidate + timeline + alert committed together. Lease fencing prevents stale workers.
create function public.commit_scanner_candidate(p_config uuid,p_lease uuid,p_candidate jsonb,p_event jsonb,p_alert jsonb default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare cfg public.scanner_configs; cid uuid; begin
 select * into cfg from public.scanner_configs where id=p_config and lease_token=p_lease and lease_until>now() for update;
 if cfg.id is null then raise exception 'Scanner lease expired'; end if;
 cid := (p_candidate->>'id')::uuid;
 insert into public.setup_candidates(id,user_id,config_id,version_id,symbol,timeframe,state,score,payload,plan,fingerprint,last_candle_at,expires_at)
 values(cid,cfg.user_id,cfg.id,(p_candidate->>'version_id')::uuid,p_candidate->>'symbol',p_candidate->>'timeframe',p_candidate->>'state',
 (p_candidate->>'score')::integer,p_candidate->'payload',nullif(p_candidate->'plan','null'::jsonb),p_candidate->>'fingerprint',
 (p_candidate->>'last_candle_at')::timestamptz,(p_candidate->>'expires_at')::timestamptz)
 on conflict(id) do update set state=excluded.state,score=excluded.score,payload=excluded.payload,plan=excluded.plan,
 last_candle_at=excluded.last_candle_at,updated_at=now()
 where setup_candidates.user_id=cfg.user_id and setup_candidates.config_id=cfg.id;
 if p_event is not null then
 insert into public.setup_events(candidate_id,user_id,event_key,kind,detail)
 select cid,cfg.user_id,e->>'key',e->>'kind',e->'detail'
 from jsonb_array_elements(case when jsonb_typeof(p_event)='array' then p_event else jsonb_build_array(p_event) end) e
 on conflict do nothing;
 end if;
 if p_alert is not null and (select count(*) from public.scanner_alerts where user_id=cfg.user_id and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC') < coalesce((cfg.config->>'maxAlertsPerDay')::integer,10) then
 insert into public.scanner_alerts(user_id,candidate_id,kind,message,dedup_key)
 values(cfg.user_id,cid,p_alert->>'kind',p_alert->>'message',p_alert->>'key') on conflict do nothing;
 end if;
 return cid;
end $$;
revoke all on function public.commit_scanner_candidate(uuid,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.commit_scanner_candidate(uuid,uuid,jsonb,jsonb,jsonb) to service_role;

-- Market cache is bounded; immutable strategies and journal-linked candidates are retained.
create function public.cleanup_scanner_cache() returns void language sql security invoker set search_path='' as $$
 delete from public.market_candles where open_time < extract(epoch from now() - case when timeframe='1W' then interval '10 years' when timeframe='1D' then interval '2 years' else interval '400 days' end)*1000;
 delete from public.tradingview_webhook_events where created_at<now()-interval '90 days';
$$;
revoke all on function public.cleanup_scanner_cache() from public,anon,authenticated;
grant execute on function public.cleanup_scanner_cache() to service_role;

-- Atomic daily token-budget reservation shared by worker and authenticated chat.
create function public.reserve_scanner_ai(p_config uuid,p_candidate uuid,p_fingerprint text,p_purpose text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare cfg public.scanner_configs; rid uuid; begin
 select * into cfg from public.scanner_configs where id=p_config for update;
 if cfg.id is null or not exists(select 1 from public.setup_candidates where id=p_candidate and user_id=cfg.user_id) then return null; end if;
 if (select count(*) from public.scanner_ai_runs where user_id=cfg.user_id and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC') >= coalesce((cfg.config->>'maxAiCallsPerDay')::integer,10) then return null; end if;
 insert into public.scanner_ai_runs(user_id,candidate_id,fingerprint,purpose,status)
 values(cfg.user_id,p_candidate,p_fingerprint,p_purpose,'pending') on conflict do nothing returning id into rid;
 return rid;
end $$;
revoke all on function public.reserve_scanner_ai(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.reserve_scanner_ai(uuid,uuid,text,text) to service_role;

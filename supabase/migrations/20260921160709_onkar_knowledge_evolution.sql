-- Onkar AI Library Intelligence and Strategy Evolution.
-- The existing Library remains the source of truth; these tables store a
-- processed, provenance-linked representation and evidence from real results.
create extension if not exists vector with schema extensions;

create table public.onkar_knowledge_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_key text not null,
  kind text not null check (kind in ('VIDEO','SETUP','STRATEGY','DOCUMENT','PDF','DOCX','TEXT_NOTE','CHART','ANNOTATED_CHART','TRADING_LESSON','RULE','JOURNAL_LESSON','BACKTEST','TRADE_EXAMPLE','INSIGHT')),
  status text not null default 'AI_EXTRACTED' check (status in ('UNVERIFIED','AI_EXTRACTED','HUMAN_VERIFIED','HISTORICALLY_SUPPORTED','BACKTEST_VERIFIED','REPLAY_VERIFIED','SHADOW_VERIFIED','FORWARD_VERIFIED','PAPER_VERIFIED','LIVE_VERIFIED','NEEDS_REVIEW','REJECTED')),
  title text not null,
  summary text not null default '',
  structured_data jsonb not null default '{}',
  tags text[] not null default '{}',
  symbols text[] not null default '{}',
  timeframes text[] not null default '{}',
  confidence numeric(5,2) not null default 0 check (confidence between 0 and 100),
  human_verified boolean not null default false,
  may_influence_production boolean generated always as (
    human_verified and status in ('HUMAN_VERIFIED','HISTORICALLY_SUPPORTED','BACKTEST_VERIFIED','REPLAY_VERIFIED','SHADOW_VERIFIED','FORWARD_VERIFIED','PAPER_VERIFIED','LIVE_VERIFIED')
  ) stored,
  embedding extensions.vector(1536),
  search_document tsvector generated always as (
    to_tsvector('english'::regconfig, coalesce(title,'') || ' ' || coalesce(summary,''))
  ) stored,
  source_count integer not null default 0 check (source_count >= 0),
  evidence_count integer not null default 0 check (evidence_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,item_key),
  unique(id,user_id)
);
create index onkar_knowledge_user_status_idx on public.onkar_knowledge_items(user_id,status,updated_at desc);
create index onkar_knowledge_user_kind_idx on public.onkar_knowledge_items(user_id,kind,updated_at desc);
create index onkar_knowledge_tags_idx on public.onkar_knowledge_items using gin(tags);
create index onkar_knowledge_search_idx on public.onkar_knowledge_items using gin(search_document);
create index onkar_knowledge_embedding_idx on public.onkar_knowledge_items using hnsw (embedding extensions.vector_cosine_ops) where embedding is not null;

create table public.onkar_knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  knowledge_id uuid not null,
  source_type text not null,
  source_id text not null,
  source_title text not null,
  start_seconds numeric,
  end_seconds numeric,
  page_number integer,
  setup_id text,
  strategy_id text,
  trade_id text,
  confidence numeric(5,2) not null default 0 check (confidence between 0 and 100),
  verification_status text not null default 'AI_EXTRACTED',
  extracted_by text not null default 'ONKAR_AI',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(knowledge_id,user_id) references public.onkar_knowledge_items(id,user_id) on delete cascade,
  unique(user_id,knowledge_id,source_type,source_id)
);
create index onkar_knowledge_sources_item_idx on public.onkar_knowledge_sources(user_id,knowledge_id);
create index onkar_knowledge_sources_origin_idx on public.onkar_knowledge_sources(user_id,source_type,source_id);

create table public.onkar_knowledge_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  from_knowledge_id uuid not null,
  to_knowledge_id uuid not null,
  relationship text not null,
  confidence numeric(5,2) not null default 0 check (confidence between 0 and 100),
  evidence jsonb not null default '{}',
  created_at timestamptz not null default now(),
  foreign key(from_knowledge_id,user_id) references public.onkar_knowledge_items(id,user_id) on delete cascade,
  foreign key(to_knowledge_id,user_id) references public.onkar_knowledge_items(id,user_id) on delete cascade,
  check (from_knowledge_id <> to_knowledge_id),
  unique(user_id,from_knowledge_id,to_knowledge_id,relationship)
);
create index onkar_knowledge_links_from_idx on public.onkar_knowledge_links(user_id,from_knowledge_id);
create index onkar_knowledge_links_to_idx on public.onkar_knowledge_links(user_id,to_knowledge_id);

create table public.onkar_knowledge_conflicts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conflict_key text not null,
  left_knowledge_id uuid not null,
  right_knowledge_id uuid not null,
  description text not null,
  context jsonb not null default '{}',
  recommendation text,
  status text not null default 'NEEDS_REVIEW' check (status in ('NEEDS_REVIEW','KEEP_CONTEXT_SPECIFIC','PREFER_LEFT','PREFER_RIGHT','SPLIT_VERSIONS','RESOLVED','REJECTED')),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(left_knowledge_id,user_id) references public.onkar_knowledge_items(id,user_id) on delete cascade,
  foreign key(right_knowledge_id,user_id) references public.onkar_knowledge_items(id,user_id) on delete cascade,
  unique(user_id,conflict_key)
);
create index onkar_knowledge_conflicts_open_idx on public.onkar_knowledge_conflicts(user_id,status,updated_at desc);

create table public.onkar_ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null,
  source_id text not null,
  knowledge_id uuid,
  stage text not null default 'UPLOADED' check (stage in ('UPLOADED','PROCESSING','ANALYZING','EXTRACTING_KNOWLEDGE','LINKING','VALIDATING','READY','PROCESSING_FAILED')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  failed_stage text,
  last_error text,
  processing_log jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(knowledge_id,user_id) references public.onkar_knowledge_items(id,user_id) on delete set null,
  unique(user_id,source_type,source_id)
);
create index onkar_ingestion_jobs_due_idx on public.onkar_ingestion_jobs(stage,next_attempt_at) where stage <> 'READY';
create index onkar_ingestion_jobs_user_idx on public.onkar_ingestion_jobs(user_id,updated_at desc);

create table public.onkar_trade_autopsies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trade_id text not null,
  setup_id text,
  strategy_version_id uuid,
  classification text not null check (classification in ('VALID_WIN','VALID_LOSS','EXECUTION_ERROR','RULE_VIOLATION','BAD_REGIME','NEWS_EFFECT','EARLY_ENTRY','LATE_ENTRY','WRONG_ZONE','WEAK_CONFIRMATION','STOP_TOO_TIGHT','RISK_ISSUE','NORMAL_RANDOM_LOSS','NEEDS_REVIEW')),
  result jsonb not null default '{}',
  market_context jsonb not null default '{}',
  library_rules_used jsonb not null default '[]',
  rules_followed jsonb not null default '[]',
  rules_broken jsonb not null default '[]',
  ai_decisions jsonb not null default '[]',
  lessons jsonb not null default '[]',
  strategy_change_needed text not null default 'NEED_MORE_DATA' check (strategy_change_needed in ('YES','NO','NEED_MORE_DATA')),
  data_quality text not null default 'VALID' check (data_quality in ('VALID','PARTIAL','REJECTED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,trade_id)
);
create index onkar_trade_autopsy_setup_idx on public.onkar_trade_autopsies(user_id,setup_id,created_at desc);
create index onkar_trade_autopsy_class_idx on public.onkar_trade_autopsies(user_id,classification,created_at desc);

create table public.onkar_mistake_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mistake_key text not null,
  title text not null,
  occurrences integer not null default 0,
  total_effect_r numeric,
  most_common_symbol text,
  most_common_session text,
  related_rule_ids text[] not null default '{}',
  related_source_ids text[] not null default '{}',
  trend text not null default 'STABLE' check (trend in ('IMPROVING','STABLE','WORSENING','INSUFFICIENT')),
  evidence jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  unique(user_id,mistake_key)
);

create table public.onkar_strategy_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  candidate_key text not null,
  source_setup_id text,
  parent_version_id uuid,
  name text not null,
  proposed_definition jsonb not null,
  rationale text not null,
  evidence jsonb not null default '{}',
  evidence_strength text not null default 'LOW' check (evidence_strength in ('LOW','MEDIUM','HIGH')),
  status text not null default 'RESEARCH_CANDIDATE' check (status in ('DRAFT','RESEARCH_CANDIDATE','BACKTESTING','REPLAY_TESTING','SHADOW_TESTING','FORWARD_TESTING','READY_FOR_APPROVAL','APPROVED','REJECTED','ARCHIVED')),
  overfitting_risk text not null default 'HIGH' check (overfitting_risk in ('LOW','MEDIUM','HIGH','UNKNOWN')),
  live_eligible boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,candidate_key),
  unique(id,user_id)
);
create index onkar_candidates_status_idx on public.onkar_strategy_candidates(user_id,status,updated_at desc);

create table public.onkar_candidate_evaluations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  candidate_id uuid not null,
  test_type text not null check (test_type in ('BACKTEST','VALIDATION','OUT_OF_SAMPLE','WALK_FORWARD','REPLAY','SHADOW','FORWARD','RISK_REVIEW','MASTER_REVIEW')),
  status text not null check (status in ('QUEUED','RUNNING','PASSED','FAILED','INSUFFICIENT_DATA','ERROR')),
  metrics jsonb not null default '{}',
  assumptions jsonb not null default '{}',
  sample_size integer not null default 0,
  data_from timestamptz,
  data_to timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key(candidate_id,user_id) references public.onkar_strategy_candidates(id,user_id) on delete cascade
);
create index onkar_candidate_eval_idx on public.onkar_candidate_evaluations(user_id,candidate_id,test_type,created_at desc);

create table public.onkar_learning_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  auto_analysis boolean not null default true,
  auto_library_learning boolean not null default true,
  auto_video_analysis boolean not null default true,
  auto_trade_learning boolean not null default true,
  auto_pattern_discovery boolean not null default true,
  auto_backtest boolean not null default true,
  auto_replay boolean not null default true,
  auto_shadow boolean not null default true,
  auto_forward boolean not null default true,
  auto_live_rule_changes boolean not null default false,
  auto_strategy_promotion boolean not null default false,
  auto_live_new_strategies boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.onkar_learning_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_key text not null,
  event_type text not null,
  source_type text,
  source_id text,
  agent text not null default 'MASTER_AI',
  title text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique(user_id,event_key)
);
create index onkar_learning_audit_timeline_idx on public.onkar_learning_audit(user_id,created_at desc);

create function public.match_onkar_knowledge(
  query_text text,
  query_embedding extensions.vector(1536) default null,
  match_count integer default 20
)
returns table(id uuid,kind text,status text,title text,summary text,tags text[],symbols text[],timeframes text[],confidence numeric,similarity double precision)
language sql stable security invoker set search_path = '' as $$
  select k.id,k.kind,k.status,k.title,k.summary,k.tags,k.symbols,k.timeframes,k.confidence,
    case when query_embedding is not null and k.embedding is not null then 1 - (k.embedding operator(extensions.<=>) query_embedding) else 0 end as similarity
  from public.onkar_knowledge_items k
  where k.user_id = (select auth.uid())
    and (
      nullif(trim(query_text),'') is null
      or k.search_document @@ websearch_to_tsquery('english',query_text)
      or k.title ilike '%' || query_text || '%'
      or query_text = any(k.tags)
      or (query_embedding is not null and k.embedding is not null and k.embedding operator(extensions.<=>) query_embedding < 0.35)
    )
  order by
    case when query_embedding is not null and k.embedding is not null then k.embedding operator(extensions.<=>) query_embedding else 1 end,
    ts_rank(k.search_document,websearch_to_tsquery('english',coalesce(nullif(trim(query_text),''),'knowledge'))) desc,
    k.updated_at desc
  limit least(greatest(match_count,1),100)
$$;
revoke all on function public.match_onkar_knowledge(text,extensions.vector,integer) from public,anon;
grant execute on function public.match_onkar_knowledge(text,extensions.vector,integer) to authenticated;

create schema if not exists private;
create or replace function private.queue_video_knowledge_ingestion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.onkar_ingestion_jobs(user_id,source_type,source_id,stage,next_attempt_at,locked_until,failed_stage,last_error,updated_at)
  values(new.owner_id,'VIDEO',new.id::text,'UPLOADED',now(),null,null,null,now())
  on conflict(user_id,source_type,source_id) do update
  set stage='UPLOADED',
      next_attempt_at=now(),locked_until=null,failed_stage=null,last_error=null,updated_at=now();
  return new;
end $$;
revoke all on function private.queue_video_knowledge_ingestion() from public,anon,authenticated;
create trigger video_lessons_queue_knowledge
after insert or update of title,description,tags,processing_status on public.video_lessons
for each row execute function private.queue_video_knowledge_ingestion();

create or replace function private.queue_library_knowledge_ingestion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='INSERT' or (old.data->'setups') is distinct from (new.data->'setups') or (old.data->'strategies') is distinct from (new.data->'strategies') then
    insert into public.onkar_ingestion_jobs(user_id,source_type,source_id,stage,next_attempt_at,locked_until,failed_stage,last_error,updated_at)
    values(new.user_id,'LIBRARY','library','UPLOADED',now(),null,null,null,now())
    on conflict(user_id,source_type,source_id) do update
    set stage='UPLOADED',next_attempt_at=now(),locked_until=null,failed_stage=null,last_error=null,updated_at=now();
  end if;
  if tg_op='INSERT' or (old.data->'trades') is distinct from (new.data->'trades') then
    insert into public.onkar_ingestion_jobs(user_id,source_type,source_id,stage,next_attempt_at,locked_until,failed_stage,last_error,updated_at)
    values(new.user_id,'TRADE_RESULTS','journal','UPLOADED',now(),null,null,null,now())
    on conflict(user_id,source_type,source_id) do update
    set stage='UPLOADED',next_attempt_at=now(),locked_until=null,failed_stage=null,last_error=null,updated_at=now();
  end if;
  return new;
end $$;
revoke all on function private.queue_library_knowledge_ingestion() from public,anon,authenticated;
create trigger app_state_queue_library_knowledge
after insert or update of data on public.app_state
for each row execute function private.queue_library_knowledge_ingestion();

create function public.claim_onkar_ingestion_job()
returns uuid language plpgsql security invoker set search_path = '' as $$
declare claimed uuid;
begin
  select id into claimed from public.onkar_ingestion_jobs
  where stage <> 'READY' and stage <> 'PROCESSING_FAILED'
    and next_attempt_at <= now() and (locked_until is null or locked_until < now())
    and attempt_count < max_attempts
  order by next_attempt_at,created_at for update skip locked limit 1;
  if claimed is null then return null; end if;
  update public.onkar_ingestion_jobs
  set stage='PROCESSING',locked_until=now()+interval '4 minutes',attempt_count=attempt_count+1,updated_at=now()
  where id=claimed;
  return claimed;
end $$;
revoke all on function public.claim_onkar_ingestion_job() from public,anon,authenticated;
grant execute on function public.claim_onkar_ingestion_job() to service_role;

do $$ declare t text; begin
  foreach t in array array[
    'onkar_knowledge_items','onkar_knowledge_sources','onkar_knowledge_links','onkar_knowledge_conflicts',
    'onkar_ingestion_jobs','onkar_trade_autopsies','onkar_mistake_memory','onkar_strategy_candidates',
    'onkar_candidate_evaluations','onkar_learning_preferences','onkar_learning_audit'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from anon,authenticated',t);
    execute format('grant all on table public.%I to service_role',t);
    execute format('grant select on table public.%I to authenticated',t);
    execute format('create policy owner_select on public.%I for select to authenticated using ((select auth.uid()) = user_id)',t);
  end loop;
end $$;

grant update on public.onkar_knowledge_items,public.onkar_knowledge_conflicts,public.onkar_learning_preferences to authenticated;
create policy owner_update on public.onkar_knowledge_items for update to authenticated
using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy owner_update on public.onkar_knowledge_conflicts for update to authenticated
using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy owner_update on public.onkar_learning_preferences for update to authenticated
using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

comment on table public.onkar_knowledge_items is 'Shared provenance-linked Library brain used by Master AI and specialists. AI-extracted rows are never production-authoritative without verification.';
comment on column public.onkar_strategy_candidates.live_eligible is 'Must remain false until every configured evaluation passes and a human explicitly approves promotion.';

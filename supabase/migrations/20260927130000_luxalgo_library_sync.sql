-- Database-first LuxAlgo Library mirror. These records are untrusted external
-- research and are intentionally isolated from Setup Library / execution data.
create table public.luxalgo_families (
  key text primary key,
  name text not null,
  concept_count integer,
  official_url text,
  markdown_url text,
  content_markdown text,
  attribution text,
  license_url text,
  license_metadata jsonb not null default '{}',
  listing_response jsonb not null default '{}',
  raw_response jsonb not null default '{}',
  listing_hash text not null,
  content_hash text not null default '',
  detail_sync_needed boolean not null default true,
  last_synced_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.luxalgo_concepts (
  slug text primary key,
  name text not null,
  family text references public.luxalgo_families(key) on update cascade on delete set null,
  cluster text,
  aliases text[] not null default '{}',
  short_description text,
  content_markdown text,
  official_url text,
  markdown_url text,
  attribution text,
  license_url text,
  license_metadata jsonb not null default '{}',
  listing_response jsonb not null default '{}',
  raw_response jsonb not null default '{}',
  listing_hash text not null,
  content_hash text not null default '',
  detail_sync_needed boolean not null default true,
  last_synced_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.luxalgo_indicators (
  slug text primary key,
  name text not null,
  author text,
  family text references public.luxalgo_families(key) on update cascade on delete set null,
  description text,
  body_markdown text,
  tags jsonb not null default '[]',
  platforms text[] not null default '{}',
  tier text,
  image_url text,
  date_displayed date,
  official_url text,
  source_code_available boolean not null default false,
  attribution text,
  license_url text,
  license_metadata jsonb not null default '{}',
  listing_response jsonb not null default '{}',
  raw_response jsonb not null default '{}',
  listing_hash text not null,
  content_hash text not null default '',
  detail_sync_needed boolean not null default true,
  source_sync_needed boolean not null default false,
  last_synced_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.luxalgo_tags (
  id text primary key,
  name text not null,
  attribution text,
  license_url text,
  license_metadata jsonb not null default '{}',
  raw_response jsonb not null,
  content_hash text not null,
  last_synced_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.luxalgo_source_code (
  indicator_slug text primary key references public.luxalgo_indicators(slug) on update cascade on delete cascade,
  name text,
  language text not null default 'pine',
  source_code text not null,
  source_url text,
  attribution text,
  license_identifier text,
  license_url text,
  license_metadata jsonb not null default '{}',
  raw_response jsonb not null,
  content_hash text not null,
  last_synced_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.luxalgo_relationships (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_id text not null,
  relationship_type text not null,
  target_type text not null,
  target_id text not null,
  metadata jsonb not null default '{}',
  raw_response jsonb not null default '{}',
  content_hash text not null,
  last_synced_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_type, source_id, relationship_type, target_type, target_id)
);

create table public.luxalgo_sync_state (
  id text primary key,
  job_id uuid,
  initiated_by uuid references auth.users(id) on delete set null,
  status text not null default 'IDLE' check (status in ('IDLE','RUNNING','COMPLETED','FAILED','CANCELLED')),
  mode text not null default 'CHANGES' check (mode in ('FULL','CHANGES','RETRY')),
  stage text not null default 'READY',
  cursor jsonb not null default '{}',
  counters jsonb not null default '{}',
  content_changes integer not null default 0,
  failed_items jsonb not null default '[]',
  retry_queue jsonb not null default '[]',
  cancel_requested boolean not null default false,
  started_at timestamptz,
  locked_at timestamptz,
  completed_at timestamptz,
  last_successful_sync_at timestamptz,
  last_duration_ms integer,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.luxalgo_sync_state (id) values ('library') on conflict do nothing;

create index luxalgo_concepts_family_name_idx on public.luxalgo_concepts(family, name);
create index luxalgo_families_sync_idx on public.luxalgo_families(detail_sync_needed, key);
create index luxalgo_concepts_sync_idx on public.luxalgo_concepts(detail_sync_needed, slug);
create index luxalgo_indicators_family_name_idx on public.luxalgo_indicators(family, name);
create index luxalgo_indicators_detail_sync_idx on public.luxalgo_indicators(detail_sync_needed, slug);
create index luxalgo_indicators_source_sync_idx on public.luxalgo_indicators(source_sync_needed, slug) where source_code_available;
create index luxalgo_tags_name_idx on public.luxalgo_tags(name);
create index luxalgo_relationship_source_idx on public.luxalgo_relationships(source_type, source_id);
create index luxalgo_relationship_target_idx on public.luxalgo_relationships(target_type, target_id);
create index luxalgo_sync_status_idx on public.luxalgo_sync_state(status, updated_at desc);

alter table public.luxalgo_saved_items
  add column if not exists notes text,
  add column if not exists related_onkar_setups jsonb not null default '[]',
  add column if not exists attribution text,
  add column if not exists license_url text,
  add column if not exists license_metadata jsonb not null default '{}',
  add column if not exists last_synced_at timestamptz;

alter table public.luxalgo_user_settings
  add column if not exists manual_sync_enabled boolean not null default true,
  add column if not exists save_raw_responses boolean not null default true,
  add column if not exists save_public_source_code boolean not null default true,
  add column if not exists preserve_attribution boolean not null default true,
  add column if not exists preserve_license_metadata boolean not null default true;

alter table public.luxalgo_families enable row level security;
alter table public.luxalgo_concepts enable row level security;
alter table public.luxalgo_indicators enable row level security;
alter table public.luxalgo_tags enable row level security;
alter table public.luxalgo_source_code enable row level security;
alter table public.luxalgo_relationships enable row level security;
alter table public.luxalgo_sync_state enable row level security;

-- The imported corpus and global sync state are backend-only. Authenticated
-- users receive sanitized data through authenticated OnkarTradeX API routes.
revoke all on table public.luxalgo_families from anon, authenticated;
revoke all on table public.luxalgo_concepts from anon, authenticated;
revoke all on table public.luxalgo_indicators from anon, authenticated;
revoke all on table public.luxalgo_tags from anon, authenticated;
revoke all on table public.luxalgo_source_code from anon, authenticated;
revoke all on table public.luxalgo_relationships from anon, authenticated;
revoke all on table public.luxalgo_sync_state from anon, authenticated;
grant all on table public.luxalgo_families to service_role;
grant all on table public.luxalgo_concepts to service_role;
grant all on table public.luxalgo_indicators to service_role;
grant all on table public.luxalgo_tags to service_role;
grant all on table public.luxalgo_source_code to service_role;
grant all on table public.luxalgo_relationships to service_role;
grant all on table public.luxalgo_sync_state to service_role;

comment on table public.luxalgo_families is 'Backend-only mirror of actual LuxAlgo MCP Library family responses.';
comment on table public.luxalgo_concepts is 'Backend-only LuxAlgo MCP concept research; never trading authority.';
comment on table public.luxalgo_indicators is 'Backend-only LuxAlgo MCP indicator research; never executed.';
comment on table public.luxalgo_source_code is 'Untrusted public LuxAlgo source retained read-only; never evaluated or executed.';
comment on table public.luxalgo_relationships is 'Relationships extracted only from actual LuxAlgo MCP responses.';
comment on table public.luxalgo_sync_state is 'Singleton resumable LuxAlgo Library sync state and failure queue.';

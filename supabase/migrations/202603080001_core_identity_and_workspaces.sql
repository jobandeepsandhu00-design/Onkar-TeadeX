-- Trading OS: identity and tenant boundary.
-- Safe to run against the original app_state-only deployment.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'user' check (role in ('user', 'owner')),
  legacy_user_id text unique,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists role text not null default 'user';
alter table public.profiles add column if not exists legacy_user_id text;
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

create unique index if not exists profiles_legacy_user_id_key
  on public.profiles (legacy_user_id) where legacy_user_id is not null;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'My Trading Workspace',
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  member_role text not null default 'member' check (member_role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspaces_owner_id_idx on public.workspaces (owner_id);
create index if not exists workspace_members_user_id_idx on public.workspace_members (user_id);

-- SECURITY DEFINER avoids recursive RLS evaluation when policies check membership.
create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_workspace_owner(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspaces
    where id = target_workspace_id and owner_id = auth.uid()
  );
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_workspace_id uuid;
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'display_name')
  on conflict (id) do update set email = excluded.email;

  insert into public.workspaces (name, owner_id)
  values ('My Trading Workspace', new.id)
  returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, member_role)
  values (new_workspace_id, new.id, 'owner')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();

-- Existing users get exactly one personal workspace unless they already have one.
insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do update set email = excluded.email;

insert into public.workspaces (name, owner_id)
select 'My Trading Workspace', u.id
from auth.users u
where not exists (select 1 from public.workspaces w where w.owner_id = u.id);

insert into public.workspace_members (workspace_id, user_id, member_role)
select w.id, w.owner_id, 'owner'
from public.workspaces w
on conflict (workspace_id, user_id) do update set member_role = 'owner';

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute procedure public.set_updated_at();
drop trigger if exists workspaces_set_updated_at on public.workspaces;
create trigger workspaces_set_updated_at before update on public.workspaces
for each row execute procedure public.set_updated_at();
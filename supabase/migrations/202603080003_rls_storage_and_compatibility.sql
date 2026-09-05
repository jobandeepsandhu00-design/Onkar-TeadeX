-- RLS, private attachment storage, and the existing client compatibility table.

create table if not exists public.app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  schema_version integer not null default 1,
  migrated_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.app_state add column if not exists data jsonb not null default '{}'::jsonb;
alter table public.app_state add column if not exists schema_version integer not null default 1;
alter table public.app_state add column if not exists migrated_at timestamptz;
alter table public.app_state add column if not exists updated_at timestamptz not null default now();
drop trigger if exists app_state_set_updated_at on public.app_state;
create trigger app_state_set_updated_at before update on public.app_state
for each row execute procedure public.set_updated_at();

-- This is also written by the one-time legacy importer.
create table if not exists public.legacy_migrations (
  legacy_user_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  attachment_count integer not null default 0,
  migrated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.app_state enable row level security;
alter table public.legacy_migrations enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'trading_accounts','trades','setups','strategies','trading_plans',
    'psychology_entries','vault_entries','smc_entries','daily_checkins',
    'pre_session_plans','session_plans','prop_challenges','user_settings',
    'trading_attachments'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists workspace_member_access on public.%I', table_name);
    execute format(
      'create policy workspace_member_access on public.%I for all to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id))',
      table_name
    );
  end loop;
end $$;

drop policy if exists own_profile_access on public.profiles;
create policy own_profile_access on public.profiles for all to authenticated
using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists workspace_member_read on public.workspaces;
create policy workspace_member_read on public.workspaces for select to authenticated
using (public.is_workspace_member(id));
drop policy if exists workspace_owner_update on public.workspaces;
create policy workspace_owner_update on public.workspaces for update to authenticated
using (public.is_workspace_owner(id)) with check (public.is_workspace_owner(id));
drop policy if exists workspace_member_read on public.workspace_members;
create policy workspace_member_read on public.workspace_members for select to authenticated
using (public.is_workspace_member(workspace_id));
drop policy if exists workspace_owner_manage on public.workspace_members;
create policy workspace_owner_manage on public.workspace_members for all to authenticated
using (public.is_workspace_owner(workspace_id)) with check (public.is_workspace_owner(workspace_id));
drop policy if exists own_app_state_access on public.app_state;
create policy own_app_state_access on public.app_state for all to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Import records are intentionally service-role only; no authenticated policy.
revoke all on public.legacy_migrations from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trading-attachments', 'trading-attachments', false, 52428800, null)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists trading_attachments_select on storage.objects;
create policy trading_attachments_select on storage.objects for select to authenticated
using (bucket_id = 'trading-attachments' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists trading_attachments_insert on storage.objects;
create policy trading_attachments_insert on storage.objects for insert to authenticated
with check (bucket_id = 'trading-attachments' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists trading_attachments_update on storage.objects;
create policy trading_attachments_update on storage.objects for update to authenticated
using (bucket_id = 'trading-attachments' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'trading-attachments' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists trading_attachments_delete on storage.objects;
create policy trading_attachments_delete on storage.objects for delete to authenticated
using (bucket_id = 'trading-attachments' and (storage.foldername(name))[1] = auth.uid()::text);
-- Prevent profile-role self-escalation and lock down helper execution.

drop policy if exists own_profile_access on public.profiles;
drop policy if exists own_profile_read on public.profiles;
create policy own_profile_read on public.profiles for select to authenticated
using (id = auth.uid());

revoke insert, update, delete on public.profiles from authenticated;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
revoke all on function public.is_workspace_member(uuid) from public, anon;
revoke all on function public.is_workspace_owner(uuid) from public, anon;
revoke all on function public.set_updated_at() from public, anon, authenticated;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.is_workspace_owner(uuid) to authenticated;

alter table public.profiles force row level security;
alter table public.workspaces force row level security;
alter table public.workspace_members force row level security;
alter table public.app_state force row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'trading_accounts','trades','setups','strategies','trading_plans',
    'psychology_entries','vault_entries','smc_entries','daily_checkins',
    'pre_session_plans','session_plans','prop_challenges','user_settings',
    'trading_attachments'
  ] loop
    execute format('alter table public.%I force row level security', table_name);
  end loop;
end $$;

insert into public.schema_migration_metadata(version,name,checksum_note,rollback_strategy)
values
  ('202603080005','atomic_domain_sync','Review committed SQL before applying.','Retain app_state snapshots; stop writes before changing synchronization logic.'),
  ('202603080006','security_hardening','Review committed SQL before applying.','Do not relax role or RLS protections without a security review.')
on conflict(version) do update set name=excluded.name,checksum_note=excluded.checksum_note,rollback_strategy=excluded.rollback_strategy;
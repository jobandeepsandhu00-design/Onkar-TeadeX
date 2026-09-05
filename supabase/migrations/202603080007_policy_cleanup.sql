-- Remove policies left by the pre-migration manual cutover and avoid duplicate
-- permissive checks while preserving the same access boundaries.

drop policy if exists profiles_select_own on public.profiles;
drop policy if exists app_state_select_own on public.app_state;
drop policy if exists app_state_insert_own on public.app_state;
drop policy if exists app_state_update_own on public.app_state;

drop policy if exists attachments_select_own on storage.objects;
drop policy if exists attachments_insert_own on storage.objects;
drop policy if exists attachments_update_own on storage.objects;
drop policy if exists attachments_delete_own on storage.objects;

drop policy if exists workspace_owner_manage on public.workspace_members;
drop policy if exists workspace_owner_insert on public.workspace_members;
drop policy if exists workspace_owner_update on public.workspace_members;
drop policy if exists workspace_owner_delete on public.workspace_members;
create policy workspace_owner_insert on public.workspace_members for insert to authenticated
with check (public.is_workspace_owner(workspace_id));
create policy workspace_owner_update on public.workspace_members for update to authenticated
using (public.is_workspace_owner(workspace_id)) with check (public.is_workspace_owner(workspace_id));
create policy workspace_owner_delete on public.workspace_members for delete to authenticated
using (public.is_workspace_owner(workspace_id));

insert into public.schema_migration_metadata(version,name,checksum_note,rollback_strategy)
values ('202603080007','policy_cleanup','Review committed SQL before applying.','Restore only reviewed least-privilege policies; never restore duplicate permissive policies blindly.')
on conflict(version) do update set name=excluded.name,checksum_note=excluded.checksum_note,rollback_strategy=excluded.rollback_strategy;
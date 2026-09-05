-- The schema verifier is an administrative diagnostic, never a client RPC.

revoke all on function public.verify_trading_os_schema() from public, anon, authenticated;
grant execute on function public.verify_trading_os_schema() to service_role;

insert into public.schema_migration_metadata(version,name,checksum_note,rollback_strategy)
values ('202603080008','verification_grants','Review committed SQL before applying.','Keep schema diagnostics restricted to service-role administrators.')
on conflict(version) do update set name=excluded.name,checksum_note=excluded.checksum_note,rollback_strategy=excluded.rollback_strategy;
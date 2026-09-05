# Supabase migrations

These ordered migrations establish the Trading OS Supabase schema, including a
private `trading-attachments` bucket. They are additive and safe to apply to
the existing `profiles`, `app_state`, and `legacy_migrations` deployment.

1. Link the intended Supabase project: `supabase link --project-ref <ref>`.
2. Review the SQL, then apply in filename order with `supabase db push`.
3. Verify as a service-role/database administrator:
   `select * from public.verify_trading_os_schema();`
4. Run the existing legacy importer only after the migrations are applied.

Migration history is managed by the Supabase CLI. The
`schema_migration_metadata` table records verification and rollback guidance.
Rollback is intentionally manual and export-first: these migrations create
user trading data, so dropping tables or relaxing policies automatically would
be destructive or insecure.
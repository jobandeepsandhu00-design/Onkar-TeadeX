# Supabase migration rollout and rollback

`pnpm migrate:supabase` is resumable and keyset-paginates legacy users. Set
`MIGRATION_RUN_ID` when resuming a
specific run; otherwise the command creates a run ID.  It requires
`migration_runs` (`id`, `status`, `details jsonb`, timestamps) and
`migration_checkpoints` (`run_id`, `legacy_user_id`, `status`, `details jsonb`,
`updated_at`, unique `(run_id, legacy_user_id)`) in addition to the Supabase
application tables.  These operational tables must be created by the schema
owner before the command is run. On the first migration, set
`LEGACY_OWNER_EMAIL` to the explicitly reviewed owner account. Later runs
preserve the one existing owner mapping and fail on ambiguous ownership.

The command writes source checksums and per-category/attachment verification
hashes to `legacy_migrations`.  Attachment object names are content-addressed
under `<auth-user-id>/legacy/`; retries use Storage upsert and verify each
downloaded object's SHA-256.  A failure is fatal and is recorded in the
checkpoint rather than silently skipping a user or file.

## Required read-only rollback window

The API exposes only read-only rollback endpoints at
`/api/legacy-read/auth/login`, `/api/legacy-read/auth/me`, and
`/api/legacy-read/state`; there is no registration or state-write endpoint.
Keep this legacy service
available for at least **14 calendar days** after a completed migration run.
During that period, compare each checkpoint's checksums/counts, exercise
account recovery, and retain the legacy database backup.  If verification or
customer recovery fails, route reads back to the legacy service and restore
the verified legacy snapshot; do not run a reverse data migration.

Only after the window ends with written verification approval may old routes,
database credentials, and legacy backups be retired according to the
organization's retention policy.
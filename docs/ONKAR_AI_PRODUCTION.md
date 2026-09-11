# Onkar AI production setup

The app performs deterministic market calculations first and calls OpenAI only
for qualified-candidate explanations, authenticated coaching, screenshot OCR,
and lesson transcription. Live order execution remains disabled.

## Vercel server variables

Configure these for Production, Preview, and Development, then redeploy:

- `OPENAI_API_KEY` (server only)
- `OPENAI_MODEL=gpt-5-mini`
- `OPENAI_TRANSCRIPTION_MODEL=whisper-1`
- `SUPABASE_SERVICE_ROLE_KEY` (server only)
- `SCANNER_ENABLED=true`
- `CRON_SECRET` (at least 32 random characters)
- `TWELVE_DATA_API_KEY` (required for configured forex, metal, and index data)
- Existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`

Never prefix private keys with `VITE_`, `NEXT_PUBLIC_`, or `REACT_APP_`.

## Supabase migration and minute schedule

Apply all migrations, including `20260911120000_onkar_ai_scanner_cron.sql`.
Then run the following once in the Supabase SQL editor. Replace the second
placeholder with the exact same value used for `CRON_SECRET` in Vercel.

```sql
select vault.create_secret(
  'https://onkartradex.com',
  'onkar_scanner_base_url',
  'Onkar AI production API origin'
);

select vault.create_secret(
  'REPLACE_WITH_THE_SAME_LONG_CRON_SECRET',
  'onkar_scanner_cron_secret',
  'Authorizes Supabase Cron scanner calls'
);
```

The scheduled job calls `/api/market-brain/cron` once per minute. Each request
runs one bounded job and database leases prevent concurrent processing.

## Required in-app setup

Open **Onkar AI → Connected Scanner → Rules**, approve at least one structured
strategy version, then use **Settings** to choose symbols, timeframes, provider,
thresholds, and enable the scanner. Connection states are based on real health
checks and worker heartbeats; unavailable news is never reported as safe.

## Validation

After configuration:

1. Open **Connections** and run provider/OpenAI health checks.
2. Confirm `worker` reports a recent heartbeat within a few minutes.
3. Confirm candidates show real timestamps and do not show `STALE DATA`.
4. Review Supabase Cron run history and Vercel function logs for failures.

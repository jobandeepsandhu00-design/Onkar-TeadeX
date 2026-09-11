-- Runs one bounded, lease-protected scanner job every minute. Secrets are read
-- from Supabase Vault at execution time and are never stored in this migration.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.invoke_onkar_ai_scanner()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_url text;
  cron_secret text;
  request_id bigint;
begin
  select decrypted_secret into base_url
  from vault.decrypted_secrets where name = 'onkar_scanner_base_url' limit 1;
  select decrypted_secret into cron_secret
  from vault.decrypted_secrets where name = 'onkar_scanner_cron_secret' limit 1;

  if nullif(base_url, '') is null or nullif(cron_secret, '') is null then
    return null;
  end if;

  select net.http_post(
    url := rtrim(base_url, '/') || '/api/market-brain/cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Onkar-Cron-Secret', cron_secret
    ),
    body := jsonb_build_object(
      'source', 'supabase_cron',
      'requested_at', now()
    ),
    timeout_milliseconds := 55000
  ) into request_id;
  return request_id;
end;
$$;

revoke all on function private.invoke_onkar_ai_scanner() from public, anon, authenticated;

-- Lets the API validate a scheduler request against the Vault-held value. Only
-- the server-side service role can call this function; clients cannot inspect
-- or verify guesses against the secret.
create or replace function public.verify_onkar_scanner_cron_secret(candidate text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select candidate is not null
    and length(candidate) >= 32
    and extensions.digest(candidate, 'sha256') = extensions.digest(
      coalesce((
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'onkar_scanner_cron_secret'
        limit 1
      ), ''),
      'sha256'
    );
$$;

revoke all on function public.verify_onkar_scanner_cron_secret(text)
  from public, anon, authenticated;
grant execute on function public.verify_onkar_scanner_cron_secret(text)
  to service_role;

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'onkar-ai-scanner-every-minute';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
end $$;

select cron.schedule(
  'onkar-ai-scanner-every-minute',
  '* * * * *',
  'select private.invoke_onkar_ai_scanner();'
);

comment on function private.invoke_onkar_ai_scanner() is
  'Invokes the authenticated Onkar AI scanner endpoint using Supabase Vault secrets.';

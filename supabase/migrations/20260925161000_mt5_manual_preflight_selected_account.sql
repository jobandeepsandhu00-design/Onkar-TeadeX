-- Roll-forward compatibility for an environment that may already have
-- mt5_manual_preflight_bindings from the immediately preceding release.
-- Legacy rows cannot be backfilled safely because the selected app account
-- must be derived from server-side scanner state and never guessed. NULL remains
-- fail-closed in application validation, while every new preflight writes the
-- server-derived selected account id.
alter table public.mt5_manual_preflight_bindings
  add column if not exists selected_account_id text;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.mt5_manual_preflight_bindings'::regclass
      and conname = 'mt5_manual_preflight_selected_account_check'
  ) then
    alter table public.mt5_manual_preflight_bindings
      add constraint mt5_manual_preflight_selected_account_check
      check (
        selected_account_id is null
        or char_length(selected_account_id) between 1 and 180
      ) not valid;
  end if;
end
$$;

comment on column public.mt5_manual_preflight_bindings.selected_account_id is
  'Server-derived scanner account selected when this exact manual MT5 preflight was checked.';

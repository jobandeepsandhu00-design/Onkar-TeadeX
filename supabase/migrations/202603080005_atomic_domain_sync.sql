-- Atomically persist the compatibility snapshot and normalized user-owned rows.
-- Record IDs are namespaced by workspace so legacy client IDs cannot collide.

create or replace function public.sync_trading_state_for_user(target_user_id uuid, state jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ws uuid;
begin
  select id into ws from public.workspaces where owner_id = target_user_id order by created_at limit 1;
  if ws is null then
    insert into public.workspaces(name, owner_id) values ('My Trading Workspace', target_user_id) returning id into ws;
    insert into public.workspace_members(workspace_id, user_id, member_role)
    values (ws, target_user_id, 'owner') on conflict do nothing;
  end if;

  insert into public.app_state(user_id, data, schema_version)
  values(target_user_id, coalesce(state, '{}'::jsonb), 2)
  on conflict(user_id) do update set data=excluded.data, schema_version=2, updated_at=now();

  delete from public.trades where workspace_id=ws;
  delete from public.setups where workspace_id=ws;
  delete from public.strategies where workspace_id=ws;
  delete from public.trading_plans where workspace_id=ws;
  delete from public.psychology_entries where workspace_id=ws;
  delete from public.vault_entries where workspace_id=ws;
  delete from public.smc_entries where workspace_id=ws;
  delete from public.daily_checkins where workspace_id=ws;
  delete from public.pre_session_plans where workspace_id=ws;
  delete from public.session_plans where workspace_id=ws;
  delete from public.prop_challenges where workspace_id=ws;
  delete from public.trading_accounts where workspace_id=ws;
  delete from public.user_settings where workspace_id=ws;

  insert into public.trading_accounts(id,workspace_id,name,broker,account_type,currency,starting_balance,payload)
  select ws::text||':'||coalesce(x.item->>'id',x.ord::text),ws,
    coalesce(x.item->>'name','Trading Account'),x.item->>'broker',x.item->>'type',
    x.item->>'currency',case when x.item->>'startingBalance' ~ '^-?[0-9]+([.][0-9]+)?$' then (x.item->>'startingBalance')::numeric end,x.item
  from jsonb_array_elements(case when jsonb_typeof(state->'tradingAccounts')='array' then state->'tradingAccounts' else '[]'::jsonb end)
    with ordinality x(item,ord);

  if jsonb_typeof(state->'account')='object' then
    insert into public.trading_accounts(id,workspace_id,name,currency,starting_balance,payload)
    values(ws::text||':default',ws,'Primary Account',state#>>'{account,currency}',
      case when state#>>'{account,startingBalance}' ~ '^-?[0-9]+([.][0-9]+)?$' then (state#>>'{account,startingBalance}')::numeric end,state->'account')
    on conflict(id) do update set payload=excluded.payload,currency=excluded.currency,starting_balance=excluded.starting_balance;
  end if;

  insert into public.trades(id,workspace_id,trade_date,symbol,market,side,status,entry_price,exit_price,net_pnl,payload)
  select ws::text||':'||coalesce(x.item->>'id',x.ord::text),ws,
    case when x.item->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (x.item->>'date')::date end,
    x.item->>'symbol',x.item->>'market',x.item->>'side',x.item->>'status',
    case when x.item->>'entry' ~ '^-?[0-9]+([.][0-9]+)?$' then (x.item->>'entry')::numeric end,
    case when x.item->>'exit' ~ '^-?[0-9]+([.][0-9]+)?$' then (x.item->>'exit')::numeric end,
    case when x.item->>'pnl' ~ '^-?[0-9]+([.][0-9]+)?$' then (x.item->>'pnl')::numeric end,x.item
  from jsonb_array_elements(case when jsonb_typeof(state->'trades')='array' then state->'trades' else '[]'::jsonb end)
    with ordinality x(item,ord);

  insert into public.setups(id,workspace_id,name,market,payload)
  select ws::text||':'||coalesce(x.item->>'id',x.ord::text),ws,coalesce(x.item->>'name','Setup'),x.item->>'market',x.item
  from jsonb_array_elements(case when jsonb_typeof(state->'setups')='array' then state->'setups' else '[]'::jsonb end) with ordinality x(item,ord);
  insert into public.strategies(id,workspace_id,name,market,timeframe,payload)
  select ws::text||':'||coalesce(x.item->>'id',x.ord::text),ws,coalesce(x.item->>'name','Strategy'),x.item->>'marketType',x.item->>'timeframe',x.item
  from jsonb_array_elements(case when jsonb_typeof(state->'strategies')='array' then state->'strategies' else '[]'::jsonb end) with ordinality x(item,ord);
  insert into public.trading_plans(id,workspace_id,plan_type,title,payload)
  select ws::text||':'||x.key,ws,x.key,coalesce(x.value->>'title',x.key),x.value
  from jsonb_each(case when jsonb_typeof(state->'plans')='object' then state->'plans' else '{}'::jsonb end) x;

  insert into public.psychology_entries(id,workspace_id,entry_date,mood,payload)
  select ws::text||':'||coalesce(x.item->>'id',x.ord::text),ws,
    case when x.item->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (x.item->>'date')::date end,
    coalesce(x.item->>'mood',x.item->>'emotion'),x.item
  from jsonb_array_elements(case when jsonb_typeof(state->'psychology')='array' then state->'psychology' else '[]'::jsonb end) with ordinality x(item,ord);
  insert into public.vault_entries(id,workspace_id,title,category,payload)
  select ws::text||':'||coalesce(x.item->>'id',x.ord::text),ws,coalesce(x.item->>'title','Vault entry'),x.item->>'folder',x.item
  from jsonb_array_elements(case when jsonb_typeof(state->'vault')='array' then state->'vault' else '[]'::jsonb end) with ordinality x(item,ord);
  insert into public.smc_entries(id,workspace_id,term,category,payload)
  select ws::text||':'||coalesce(x.item->>'id',x.ord::text),ws,coalesce(x.item->>'term','SMC entry'),x.item->>'category',x.item
  from jsonb_array_elements(case when jsonb_typeof(state->'smc')='array' then state->'smc' else '[]'::jsonb end) with ordinality x(item,ord);
  insert into public.daily_checkins(id,workspace_id,checkin_date,payload)
  select ws::text||':'||coalesce(x.item->>'id',x.ord::text),ws,
    case when x.item->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (x.item->>'date')::date end,x.item
  from jsonb_array_elements(case when jsonb_typeof(state->'checkins')='array' then state->'checkins' else '[]'::jsonb end) with ordinality x(item,ord);
  insert into public.pre_session_plans(id,workspace_id,plan_date,payload)
  select ws::text||':'||coalesce(x.item->>'id',x.ord::text),ws,
    case when x.item->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (x.item->>'date')::date end,x.item
  from jsonb_array_elements(case when jsonb_typeof(state->'preSession')='array' then state->'preSession' else '[]'::jsonb end) with ordinality x(item,ord);
  insert into public.session_plans(id,workspace_id,session_date,session_name,payload)
  select ws::text||':'||coalesce(x.item->>'id',x.ord::text),ws,
    case when x.item->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (x.item->>'date')::date end,x.item->>'name',x.item
  from jsonb_array_elements(case when jsonb_typeof(state->'sessionPlans')='array' then state->'sessionPlans' else '[]'::jsonb end) with ordinality x(item,ord);
  insert into public.prop_challenges(id,workspace_id,name,status,payload)
  select ws::text||':'||coalesce(x.item->>'id',x.ord::text),ws,coalesce(x.item->>'name','Challenge'),x.item->>'status',x.item
  from jsonb_array_elements(case when jsonb_typeof(state->'propChallenges')='array' then state->'propChallenges' else '[]'::jsonb end) with ordinality x(item,ord);
  insert into public.user_settings(workspace_id,settings) values(ws,coalesce(state->'settings','{}'::jsonb));
end;
$$;

revoke all on function public.sync_trading_state_for_user(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sync_trading_state_for_user(uuid,jsonb) to service_role;

create or replace function public.save_trading_state(state jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  perform public.sync_trading_state_for_user(auth.uid(),state);
end; $$;
revoke all on function public.save_trading_state(jsonb) from public,anon;
grant execute on function public.save_trading_state(jsonb) to authenticated;

-- Backfill normalized rows for all compatibility snapshots already migrated.
do $$
declare r record;
begin
  for r in select user_id,data from public.app_state loop
    perform public.sync_trading_state_for_user(r.user_id,r.data);
  end loop;
end $$;
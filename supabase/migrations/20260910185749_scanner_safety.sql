-- Changing account/risk/rules atomically expires existing plans and fences old workers.
create function public.configure_scanner(p_user uuid,p_workspace uuid,p_config jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare cfg public.scanner_configs; cid uuid; changed boolean; begin
 if not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=p_user) then
   raise exception 'Workspace membership required';
 end if;
 select * into cfg from public.scanner_configs where user_id=p_user for update;
 changed := cfg.config is distinct from p_config;
 insert into public.scanner_configs(user_id,workspace_id,config,enabled)
 values(p_user,p_workspace,p_config,coalesce((p_config->>'enabled')::boolean,false))
 on conflict(user_id) do update set config=excluded.config,enabled=excluded.enabled,
 next_run_at=now(),lease_token=null,lease_until=null,cursor=0 returning id into cid;
 if changed then
   insert into public.setup_events(candidate_id,user_id,event_key,kind,detail)
   select id,user_id,'config:'||clock_timestamp()::text,'configuration_changed',jsonb_build_object('previous',state,'state','EXPIRED')
   from public.setup_candidates where config_id=cid and state not in ('EXPIRED','INVALIDATED','COMPLETED');
   update public.setup_candidates set state='EXPIRED',payload=jsonb_set(jsonb_set(payload,'{status}','"EXPIRED"'),'{stale}','true'),updated_at=now()
   where config_id=cid and state not in ('EXPIRED','INVALIDATED','COMPLETED');
 end if;
 return cid;
end $$;
revoke all on function public.configure_scanner(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.configure_scanner(uuid,uuid,jsonb) to service_role;

-- Explicit deny policies document the intentionally service-only cache/key tables.
create policy server_only on public.market_candles for all to authenticated using(false) with check(false);
create policy server_only on public.scanner_webhook_keys for all to authenticated using(false) with check(false);
comment on table public.market_candles is 'Real provider candle cache. Server-only; never mixed with legacy simulated backtest data.';
comment on table public.scanner_webhook_keys is 'SHA-256 webhook secret hashes. No frontend grants.';

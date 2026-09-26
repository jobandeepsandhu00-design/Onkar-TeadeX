-- Transactional smoke test: uses two existing workspace owners, leaves no records.
begin;
do $$
declare u1 uuid; u2 uuid; w1 uuid; w2 uuid; cfg uuid; v uuid; c uuid; lease uuid; body jsonb; rid uuid; auto_request uuid; auto_request_2 uuid; manual_request uuid;
begin
 select owner_id,id into u1,w1 from public.workspaces order by created_at limit 1;
 select owner_id,id into u2,w2 from public.workspaces where owner_id<>u1 order by created_at limit 1;
 if u1 is null or u2 is null then raise exception 'Two workspace owners required for isolation test'; end if;
 if exists(select 1 from public.scanner_configs where user_id in (u1,u2)) then raise exception 'Test requires unused scanner owners; do not overwrite existing configurations'; end if;
 perform set_config('test.scanner_user',u1::text,true);
 insert into public.scanner_configs(user_id,workspace_id,enabled,config) values(u1,w1,true,'{"maxAiCallsPerDay":2,"maxAlertsPerDay":2}') returning id into cfg;
 insert into public.scanner_configs(user_id,workspace_id,config) values(u2,w2,'{}');
 insert into public.scanner_strategy_versions(user_id,workspace_id,source_setup_id,name,definition,fingerprint)
 values(u1,w1,'test-only','transactional fixture','{}','test-only') returning id into v;
 select lease_token into lease from public.claim_scanner_job(cfg);
 if lease is null then raise exception 'Job not leased'; end if;
 if exists(select 1 from public.claim_scanner_job(cfg)) then raise exception 'Duplicate worker lease'; end if;
 c:=gen_random_uuid();
 body:=jsonb_build_object('id',c,'version_id',v,'symbol','TEST','timeframe','1m','state','READY','score',80,
 'payload','{}'::jsonb,'plan','{}'::jsonb,'fingerprint','test-candidate','last_candle_at',now(),'expires_at',now()+interval '1 hour');
 perform public.commit_scanner_candidate(cfg,lease,body,'{"key":"same-event","kind":"setup_ready","detail":{}}','{"key":"same-alert","kind":"setup_ready","message":"test only"}');
 perform public.commit_scanner_candidate(cfg,lease,body,'{"key":"same-event","kind":"setup_ready","detail":{}}','{"key":"same-alert","kind":"setup_ready","message":"test only"}');
 if (select count(*) from public.setup_events where candidate_id=c)<>1 then raise exception 'Duplicate timeline event'; end if;
 if (select count(*) from public.scanner_alerts where candidate_id=c)<>1 then raise exception 'Duplicate alert'; end if;
 insert into public.mt5_account_bindings(user_id,selected_account_id,account_fingerprint,broker,server)
 values(u1,'mt5-test-account',repeat('a',64),'Test Broker','Test-Demo');
 insert into public.mt5_symbol_mapping_bindings(user_id,account_fingerprint,internal_symbol,broker_symbol)
 values(u1,repeat('a',64),'XAU/USD','XAUUSD.test');
 insert into public.mt5_candidate_provenance(candidate_id,candidate_last_candle_at,user_id,config_id,selected_account_id,account_fingerprint,broker_symbol,verified_before_at,verified_after_at)
 values(c,now(),u1,cfg,'mt5-test-account',repeat('a',64),'XAUUSD.test',now(),now());
 if (select count(*) from public.mt5_candidate_provenance where candidate_id=c)<>1 then raise exception 'MT5 candidate provenance was not stored'; end if;
 insert into public.scanner_runtime_controls(
   user_id,workspace_id,scanner_config_id,scanner_state,trading_mode,
   auto_execution_enabled,trading_source
 ) values(u1,w1,cfg,'RUNNING','AUTO',true,'MT5');
 auto_request:=public.claim_mt5_auto_execution(
   u1,w1,c,'auto-test-request-1','MARKET_BUY',
   '{"requestId":"auto-test-request-1","symbol":"XAU/USD","action":"MARKET_BUY","volume":0.01,"confirmed":true}'::jsonb,
   now()
 );
 if auto_request is null then raise exception 'AUTO execution audit claim failed'; end if;
 if not public.confirm_mt5_auto_post_claim(u1,auto_request,cfg,now()) then
   raise exception 'AUTO post-claim execution fence failed';
 end if;
 auto_request_2:=public.claim_mt5_auto_execution(
   u1,w1,c,'auto-test-request-2','MARKET_BUY',
   '{"requestId":"auto-test-request-2","symbol":"XAU/USD","action":"MARKET_BUY","volume":0.01,"confirmed":true}'::jsonb,
   now()
 );
 if auto_request_2 is not null then raise exception 'Unresolved AUTO execution did not enforce global lock'; end if;
 if not public.mark_mt5_auto_execution_uncertain(u1,auto_request,now(),'transactional test') then
   raise exception 'AUTO uncertain transition failed';
 end if;
 if (select auto_execution_enabled from public.scanner_runtime_controls where user_id=u1) then
   raise exception 'AUTO uncertainty did not pause new automatic execution';
 end if;
 if not public.resolve_mt5_auto_execution(
   u1,auto_request,'REJECTED',
   '{"ok":false,"requestId":"auto-test-request-1","notSent":true}'::jsonb,
   now(),true
 ) then raise exception 'AUTO exact-request resolution failed'; end if;
 if (select status from public.trade_execution_requests where id=auto_request)<>'REJECTED' then
   raise exception 'AUTO execution audit was not terminalized';
 end if;
 if (select count(*) from public.trade_execution_results where request_id=auto_request)<>1 then
   raise exception 'AUTO execution result audit was not stored';
 end if;
 if (select state from public.setup_candidates where id=c)<>'INVALIDATED' then
   raise exception 'AUTO rejected result was not projected to candidate state';
 end if;
 update public.setup_candidates set state='READY' where id=c;
 insert into public.trade_execution_requests(
   user_id,workspace_id,request_id,candidate_id,action,request,status,updated_at
 ) values(
   u1,w1,'manual-test-request-1',null,'MARKET_BUY',
   '{"requestId":"manual-test-request-1","symbol":"XAU/USD","action":"MARKET_BUY","volume":0.01,"confirmed":true}'::jsonb,
   'CONFIRMED',now()
 ) returning id into manual_request;
 if not public.confirm_mt5_manual_post_claim(u1,manual_request,now()) then
   raise exception 'Manual post-claim execution fence failed';
 end if;
 if public.claim_mt5_manual_reconciliation(
   u1,manual_request,now(),now()-interval '30 seconds'
 ) then raise exception 'Fresh manual handoff was stolen by reconciliation'; end if;
 update public.trade_execution_requests
 set updated_at=now()-interval '31 seconds' where id=manual_request;
 if not public.claim_mt5_manual_reconciliation(
   u1,manual_request,now(),now()-interval '30 seconds'
 ) then raise exception 'Stale manual handoff could not be reconciled'; end if;
 insert into public.tradingview_webhook_events(config_id,user_id,event_id,payload) values(cfg,u1,'test-event','{}') on conflict do nothing;
 insert into public.tradingview_webhook_events(config_id,user_id,event_id,payload) values(cfg,u1,'test-event','{}') on conflict do nothing;
 if (select count(*) from public.tradingview_webhook_events where config_id=cfg)<>1 then raise exception 'Duplicate webhook'; end if;
 rid:=public.reserve_scanner_ai(cfg,c,'one','explanation');
 if rid is null then raise exception 'AI budget reservation failed'; end if;
 if public.reserve_scanner_ai(cfg,c,'one','explanation') is not null then raise exception 'AI duplicate reservation'; end if;
 perform public.reserve_scanner_ai(cfg,c,'two','explanation');
 if public.reserve_scanner_ai(cfg,c,'three','explanation') is not null then raise exception 'AI daily cap failed'; end if;
 perform public.configure_scanner(u1,w1,'{"enabled":false}');
 if (select state from public.setup_candidates where id=c)<>'EXPIRED' then raise exception 'Settings did not expire old candidate'; end if;
 begin
   perform public.commit_scanner_candidate(cfg,lease,body,null,null);
   raise exception 'Stale lease unexpectedly succeeded';
 exception when others then
   if sqlerrm='Stale lease unexpectedly succeeded' then raise; end if;
 end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.scanner_user'),true);
set local role authenticated;
do $$ begin
 if (select count(*) from public.scanner_configs)<>1 then raise exception 'Cross-user config leakage'; end if;
 if exists(select 1 from public.scanner_configs where user_id<>auth.uid()) then raise exception 'Cross-user private data leak'; end if;
 if has_table_privilege(current_user,'public.setup_candidates','INSERT') then raise exception 'Client can fabricate candidates'; end if;
 if has_table_privilege(current_user,'public.scanner_webhook_keys','SELECT') then raise exception 'Secret-hash read privilege'; end if;
 if has_table_privilege(current_user,'public.mt5_account_bindings','SELECT') then raise exception 'Client can read MT5 account fingerprints'; end if;
 if has_table_privilege(current_user,'public.mt5_symbol_mapping_bindings','SELECT') then raise exception 'Client can read account-scoped MT5 symbol mappings'; end if;
 if has_table_privilege(current_user,'public.mt5_manual_preflight_bindings','SELECT') then raise exception 'Client can read manual MT5 preflight fingerprints'; end if;
 if has_table_privilege(current_user,'public.mt5_candidate_provenance','SELECT') then raise exception 'Client can read MT5 candidate provenance'; end if;
 if has_function_privilege(current_user,'public.claim_scanner_job(uuid)','EXECUTE') then raise exception 'Client can claim worker jobs'; end if;
 if has_function_privilege(current_user,'public.claim_mt5_manual_execution(uuid,uuid,timestamptz)','EXECUTE') then raise exception 'Client can claim manual MT5 execution'; end if;
 if has_function_privilege(current_user,'public.claim_mt5_auto_execution(uuid,uuid,uuid,text,text,jsonb,timestamptz)','EXECUTE') then raise exception 'Client can claim AUTO MT5 execution'; end if;
 if has_function_privilege(current_user,'public.claim_mt5_manual_reconciliation(uuid,uuid,timestamptz,timestamptz)','EXECUTE') then raise exception 'Client can claim manual MT5 reconciliation'; end if;
 if has_function_privilege(current_user,'public.confirm_mt5_manual_post_claim(uuid,uuid,timestamptz)','EXECUTE') then raise exception 'Client can refresh a manual MT5 execution claim'; end if;
 if has_function_privilege(current_user,'public.claim_mt5_auto_reconciliation(uuid,uuid,timestamptz,timestamptz)','EXECUTE') then raise exception 'Client can claim AUTO MT5 reconciliation'; end if;
 if has_function_privilege(current_user,'public.confirm_mt5_auto_post_claim(uuid,uuid,uuid,timestamptz)','EXECUTE') then raise exception 'Client can refresh an AUTO MT5 execution claim'; end if;
 if has_function_privilege(current_user,'public.mark_mt5_auto_execution_uncertain(uuid,uuid,timestamptz,text)','EXECUTE') then raise exception 'Client can mutate AUTO uncertainty state'; end if;
 if has_function_privilege(current_user,'public.resolve_mt5_auto_execution(uuid,uuid,text,jsonb,timestamptz,boolean)','EXECUTE') then raise exception 'Client can resolve AUTO MT5 execution'; end if;
end $$;
reset role;
select 'PASS: RLS, MT5 provenance isolation, leases, transactional candidates, alerts, webhook idempotency, AI budgets, configuration fencing' as result;
rollback;

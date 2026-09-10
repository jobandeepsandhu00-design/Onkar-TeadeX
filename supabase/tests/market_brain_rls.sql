-- Transactional smoke test: uses two existing workspace owners, leaves no records.
begin;
do $$
declare u1 uuid; u2 uuid; w1 uuid; w2 uuid; cfg uuid; v uuid; c uuid; lease uuid; body jsonb; rid uuid;
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
 if has_function_privilege(current_user,'public.claim_scanner_job(uuid)','EXECUTE') then raise exception 'Client can claim worker jobs'; end if;
end $$;
reset role;
select 'PASS: RLS, leases, transactional candidates, alerts, webhook idempotency, AI budgets, configuration fencing' as result;
rollback;

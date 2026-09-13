begin;
do $$
declare u1 uuid; u2 uuid; run_id uuid;
begin
  select owner_id into u1 from public.workspaces order by created_at limit 1;
  select owner_id into u2 from public.workspaces where owner_id <> u1 order by created_at limit 1;
  if u1 is null or u2 is null then raise exception 'Two workspace owners required for isolation test'; end if;
  perform set_config('test.onkar_ai_user', u1::text, true);
  insert into public.onkar_agent_runs(user_id,intent,data_status,status)
  values(u1,'test','verified','succeeded') returning id into run_id;
  insert into public.onkar_agent_runs(user_id,intent,data_status,status)
  values(u2,'test','verified','succeeded');
  insert into public.onkar_agent_results(run_id,user_id,agent,status,data_status)
  values(run_id,u1,'journal','complete','verified');
end $$;
select set_config('request.jwt.claim.sub', current_setting('test.onkar_ai_user'), true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.onkar_agent_runs) <> 1 then raise exception 'Cross-user run leakage'; end if;
  if exists(select 1 from public.onkar_agent_runs where user_id <> auth.uid()) then raise exception 'Cross-user private data leak'; end if;
  if has_table_privilege(current_user,'public.onkar_agent_runs','INSERT') then raise exception 'Client can fabricate agent runs'; end if;
  if has_table_privilege(current_user,'public.learning_insights','UPDATE') then raise exception 'Client can overwrite learning evidence'; end if;
end $$;
reset role;
select 'PASS: Onkar AI learning tables are read-only and owner-scoped' as result;
rollback;

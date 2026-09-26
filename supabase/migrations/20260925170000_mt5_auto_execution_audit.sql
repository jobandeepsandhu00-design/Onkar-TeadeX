-- Candidate-backed MT5 AUTO execution ledger. All irreversible handoffs are
-- serialized with the same per-user advisory lock used by manual execution.
-- These functions are service-role-only and deliberately SECURITY INVOKER.

create index if not exists mt5_auto_execution_unresolved_idx
  on public.trade_execution_requests(user_id, updated_at)
  where candidate_id is not null
    and status in ('CONFIRMED','UNCERTAIN','RECONCILING');

-- Manual recovery uses the same database-side age fence as AUTO. The caller's
-- earlier read is advisory only; this predicate is re-evaluated while holding
-- the shared per-user transaction lock.
create or replace function public.claim_mt5_manual_reconciliation(
  p_user uuid,
  p_execution_request uuid,
  p_claimed_at timestamptz,
  p_stale_before timestamptz
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare changed integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 260919));
  update public.trade_execution_requests request
  set status = 'RECONCILING', updated_at = p_claimed_at
  where request.id = p_execution_request
    and request.user_id = p_user
    and request.candidate_id is null
    and (
      request.status = 'UNCERTAIN'
      or (
        request.status in ('CONFIRMED','RECONCILING')
        and request.updated_at < p_stale_before
      )
    );
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

-- Final fence after /trade/claim and all fresh account/symbol checks. A stale
-- reconciler and the order handler cannot both win this per-user lock.
create or replace function public.confirm_mt5_manual_post_claim(
  p_user uuid,
  p_execution_request uuid,
  p_refreshed_at timestamptz
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare changed integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 260919));
  update public.trade_execution_requests request
  set updated_at = p_refreshed_at
  where request.id = p_execution_request
    and request.user_id = p_user
    and request.candidate_id is null
    and request.status = 'CONFIRMED';
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

create or replace function public.claim_mt5_auto_execution(
  p_user uuid,
  p_workspace uuid,
  p_candidate uuid,
  p_request_id text,
  p_action text,
  p_request jsonb,
  p_confirmed_at timestamptz
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  claimed_id uuid;
  eligible_candidate uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 260919));

  if p_request_id is null
    or p_request_id !~ '^[A-Za-z0-9:_-]{8,120}$'
    or jsonb_typeof(p_request) <> 'object'
    or p_request->>'requestId' is distinct from p_request_id
    or p_request->>'action' is distinct from p_action
    or p_request->'confirmed' is distinct from 'true'::jsonb
  then
    raise exception 'Invalid MT5 AUTO execution claim';
  end if;

  -- Lock the exact ready candidate and prove that it belongs to this user's
  -- selected scanner workspace. A browser cannot call this RPC.
  select candidate.id into eligible_candidate
  from public.setup_candidates candidate
  join public.scanner_configs config
    on config.id = candidate.config_id
   and config.user_id = candidate.user_id
  where candidate.id = p_candidate
    and candidate.user_id = p_user
    and candidate.state = 'READY'
    and config.workspace_id = p_workspace
  for update of candidate;
  if eligible_candidate is null then return null; end if;

  -- One unresolved MT5 order of either origin blocks every new AUTO claim for
  -- this user. Manual execution uses the same advisory-lock key and predicate.
  if exists (
    select 1
    from public.trade_execution_requests existing
    where existing.user_id = p_user
      and existing.status in ('CONFIRMED','UNCERTAIN','RECONCILING')
  ) then
    return null;
  end if;

  insert into public.trade_execution_requests(
    user_id, workspace_id, request_id, candidate_id, action, request, status,
    created_at, updated_at
  ) values (
    p_user, p_workspace, p_request_id, p_candidate, p_action, p_request,
    'CONFIRMED', p_confirmed_at, p_confirmed_at
  )
  on conflict (user_id, request_id) do nothing
  returning id into claimed_id;

  return claimed_id;
end;
$$;

create or replace function public.claim_mt5_auto_reconciliation(
  p_user uuid,
  p_execution_request uuid,
  p_claimed_at timestamptz,
  p_stale_before timestamptz
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare changed integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 260919));

  update public.trade_execution_requests request
  set status = 'RECONCILING', updated_at = p_claimed_at
  where request.id = p_execution_request
    and request.user_id = p_user
    and request.candidate_id is not null
    and (
      request.status = 'UNCERTAIN'
      or (
        request.status in ('CONFIRMED','RECONCILING')
        and request.updated_at < p_stale_before
      )
    );
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

-- Final database fence after the bridge has durably CLAIMED (but not sent)
-- the request. If reconciliation won the user lock first, this returns false
-- and the handler must never call /trade/execute.
create or replace function public.confirm_mt5_auto_post_claim(
  p_user uuid,
  p_execution_request uuid,
  p_scanner_config uuid,
  p_refreshed_at timestamptz
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare changed integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 260919));
  update public.trade_execution_requests request
  set updated_at = p_refreshed_at
  where request.id = p_execution_request
    and request.user_id = p_user
    and request.candidate_id is not null
    and request.status = 'CONFIRMED'
    and exists (
      select 1
      from public.scanner_runtime_controls runtime
      where runtime.user_id = p_user
        and runtime.scanner_config_id = p_scanner_config
        and runtime.scanner_state = 'RUNNING'
        and runtime.trading_mode = 'AUTO'
        and runtime.auto_execution_enabled = true
        and runtime.emergency_stop = false
        and runtime.trading_source = 'MT5'
    );
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

create or replace function public.mark_mt5_auto_execution_uncertain(
  p_user uuid,
  p_execution_request uuid,
  p_observed_at timestamptz,
  p_reason text
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request public.trade_execution_requests;
  thread_id uuid;
  candidate_symbol text;
  candidate_timeframe text;
  critical_message text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 260919));

  select * into request
  from public.trade_execution_requests candidate_request
  where candidate_request.id = p_execution_request
    and candidate_request.user_id = p_user
    and candidate_request.candidate_id is not null
    and candidate_request.status in ('CONFIRMED','UNCERTAIN','RECONCILING')
  for update;
  if request.id is null then return false; end if;

  update public.trade_execution_requests
  set status = 'UNCERTAIN', updated_at = p_observed_at
  where id = request.id;

  -- Analysis remains RUNNING. Only new automatic order submission is paused;
  -- it is never silently re-enabled after reconciliation.
  update public.scanner_runtime_controls
  set auto_execution_enabled = false, updated_at = p_observed_at
  where user_id = p_user;

  critical_message := left(coalesce(p_reason,
    'MT5 execution outcome is uncertain; automatic execution was paused.'), 2000);
  select candidate.symbol, candidate.timeframe
  into candidate_symbol, candidate_timeframe
  from public.setup_candidates candidate
  where candidate.id = request.candidate_id
    and candidate.user_id = request.user_id;

  -- The critical alert is committed with the pause itself. The application
  -- NotificationService may enrich this same deduplicated thread, but a
  -- transient second HTTP write cannot make the safety alert disappear.
  insert into public.notifications(
    user_id,event_key,category,priority,symbol,timeframe,setup_id,agent_source,
    title,message,evidence,lifecycle_state,recommended_action,actions,metadata,
    status,updated_at,read_at
  ) values (
    request.user_id,
    'execution:' || request.request_id,
    'TRADING','CRITICAL',candidate_symbol,candidate_timeframe,
    request.candidate_id::text,'EXECUTION_AI',
    coalesce(candidate_symbol,'MT5') || ' · MT5 outcome uncertain',
    critical_message,
    jsonb_build_array(jsonb_build_object(
      'agent','EXECUTION_AI','provider','MT5','requestId',request.request_id,
      'auditStatus','UNCERTAIN','automaticExecutionPaused',true
    )),
    'UNCERTAIN',
    'Do not retry. Keep automation paused while the original request ID is reconciled with MT5.',
    jsonb_build_array(jsonb_build_object(
      'id','status','label','View execution status','href','/onkar-ai/integrations',
      'intent','NAVIGATE','confirm',false
    )),
    jsonb_build_object(
      'requestId',request.request_id,'automaticExecutionPaused',true,
      'voiceEligible',true
    ),
    'ACTIVE',p_observed_at,null
  )
  on conflict (user_id,event_key) do update
  set category='TRADING',priority='CRITICAL',symbol=excluded.symbol,
      timeframe=excluded.timeframe,setup_id=excluded.setup_id,
      agent_source='EXECUTION_AI',title=excluded.title,message=excluded.message,
      evidence=excluded.evidence,lifecycle_state='UNCERTAIN',
      recommended_action=excluded.recommended_action,actions=excluded.actions,
      metadata=excluded.metadata,status='ACTIVE',updated_at=p_observed_at,
      read_at=null
  returning id into thread_id;

  insert into public.notification_events(
    notification_id,user_id,event_key,lifecycle_state,agent_source,title,
    message,evidence,metadata,created_at
  ) values (
    thread_id,request.user_id,request.request_id || ':UNCERTAIN',
    'UNCERTAIN','EXECUTION_AI',
    coalesce(candidate_symbol,'MT5') || ' · MT5 outcome uncertain',
    critical_message,
    jsonb_build_array(jsonb_build_object(
      'agent','EXECUTION_AI','provider','MT5','requestId',request.request_id,
      'auditStatus','UNCERTAIN','automaticExecutionPaused',true
    )),
    jsonb_build_object('requestId',request.request_id,'voiceEligible',true),
    p_observed_at
  ) on conflict (notification_id,event_key) do nothing;

  insert into public.scanner_execution_events(
    user_id, workspace_id, candidate_id, request_id, state, reason,
    execution_provider, market_data_provider, account_id, detail, created_at
  ) values (
    request.user_id, request.workspace_id,
    case when exists(
      select 1 from public.setup_candidates candidate
      where candidate.id = request.candidate_id and candidate.user_id = request.user_id
    ) then request.candidate_id else null end,
    request.request_id, 'ERROR', critical_message,
    'MT5', 'MT5', null,
    jsonb_build_object(
      'executionRequestId', request.id,
      'auditStatus', 'UNCERTAIN',
      'automaticExecutionPaused', true,
      'requiresExactRequestReconciliation', true
    ),
    p_observed_at
  );
  return true;
end;
$$;

create or replace function public.resolve_mt5_auto_execution(
  p_user uuid,
  p_execution_request uuid,
  p_status text,
  p_result jsonb,
  p_resolved_at timestamptz,
  p_reconciled boolean default false
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request public.trade_execution_requests;
  next_candidate_state text;
  next_event_state text;
  thread_id uuid;
  candidate_symbol text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 260919));

  if p_status not in ('SENT','REJECTED')
    or jsonb_typeof(p_result) <> 'object'
    or (p_status = 'SENT' and p_result->'ok' is distinct from 'true'::jsonb)
    or (p_status = 'REJECTED' and p_result->'ok' is distinct from 'false'::jsonb)
  then
    raise exception 'Invalid MT5 AUTO resolution';
  end if;

  select * into request
  from public.trade_execution_requests candidate_request
  where candidate_request.id = p_execution_request
    and candidate_request.user_id = p_user
    and candidate_request.candidate_id is not null
    and candidate_request.status in ('CONFIRMED','UNCERTAIN','RECONCILING')
  for update;
  if request.id is null then return false; end if;

  insert into public.trade_execution_results(
    user_id, request_id, mt5_order, mt5_deal, retcode, success, result, created_at
  ) values (
    request.user_id,
    request.id,
    case when coalesce(p_result->>'order','') ~ '^[0-9]+$'
      then (p_result->>'order')::bigint else null end,
    case when coalesce(p_result->>'deal','') ~ '^[0-9]+$'
      then (p_result->>'deal')::bigint else null end,
    case when coalesce(p_result->>'retcode','') ~ '^-?[0-9]+$'
      then (p_result->>'retcode')::integer else null end,
    p_status = 'SENT',
    p_result,
    p_resolved_at
  )
  on conflict (request_id) do update
  set mt5_order = excluded.mt5_order,
      mt5_deal = excluded.mt5_deal,
      retcode = excluded.retcode,
      success = excluded.success,
      result = excluded.result;

  update public.trade_execution_requests
  set status = p_status, updated_at = p_resolved_at
  where id = request.id;

  select candidate.symbol into candidate_symbol
  from public.setup_candidates candidate
  where candidate.id = request.candidate_id
    and candidate.user_id = request.user_id;

  next_candidate_state := case when p_status = 'SENT'
    then 'TRIGGERED' else 'INVALIDATED' end;
  update public.setup_candidates
  set state = next_candidate_state, updated_at = p_resolved_at
  where id = request.candidate_id
    and user_id = request.user_id
    and (state = 'READY' or (p_status = 'SENT' and state in ('EXPIRED','INVALIDATED')));

  next_event_state := case when p_status = 'SENT' then 'EXECUTED' else 'ERROR' end;
  insert into public.scanner_execution_events(
    user_id, workspace_id, candidate_id, request_id, state, reason,
    execution_provider, market_data_provider, account_id, detail, created_at
  ) values (
    request.user_id, request.workspace_id,
    case when exists(
      select 1 from public.setup_candidates candidate
      where candidate.id = request.candidate_id and candidate.user_id = request.user_id
    ) then request.candidate_id else null end,
    request.request_id, next_event_state,
    case when p_status = 'SENT'
      then 'The exact MT5 request was accepted by the broker.'
      else 'The exact MT5 request was rejected or proved not sent.' end,
    'MT5', 'MT5', null,
    jsonb_build_object(
      'executionRequestId', request.id,
      'auditStatus', p_status,
      'reconciled', p_reconciled,
      'result', p_result
    ),
    p_resolved_at
  );

  -- If this request previously raised the critical uncertainty thread, close
  -- that exact thread in the same transaction as broker-truth projection.
  update public.notifications
  set priority = case when p_status='SENT' then 'HIGH' else 'IMPORTANT' end,
      agent_source = 'EXECUTION_AI',
      lifecycle_state = case when p_status='SENT' then 'ACTIVE' else 'REJECTED' end,
      title = coalesce(candidate_symbol,'MT5') || ' · MT5 ' || lower(p_status),
      message = case when p_status='SENT'
        then 'The original MT5 AUTO request was found and accepted. No retry was sent.'
        else 'The original MT5 AUTO request was found and rejected or proved not sent. No retry was sent.' end,
      recommended_action = case when p_status='SENT'
        then 'Open trade management and verify the broker position. Re-enable AUTO only after review.'
        else 'Review the broker result before explicitly re-enabling AUTO.' end,
      metadata = metadata || jsonb_build_object(
        'requestId',request.request_id,'reconciled',p_reconciled,
        'automaticExecutionPaused',true,'voiceEligible',true
      ),
      status = 'RESOLVED', updated_at = p_resolved_at
  where user_id = request.user_id
    and event_key = 'execution:' || request.request_id
  returning id into thread_id;

  if thread_id is not null then
    insert into public.notification_events(
      notification_id,user_id,event_key,lifecycle_state,agent_source,title,
      message,evidence,metadata,created_at
    ) values (
      thread_id,request.user_id,
      request.request_id || ':' || p_status || ':' || case when p_reconciled then 'reconciled' else 'direct' end,
      case when p_status='SENT' then 'ACTIVE' else 'REJECTED' end,
      'EXECUTION_AI',
      coalesce(candidate_symbol,'MT5') || ' · MT5 ' || lower(p_status),
      case when p_status='SENT'
        then 'The original MT5 AUTO request was found and accepted. No retry was sent.'
        else 'The original MT5 AUTO request was found and rejected or proved not sent. No retry was sent.' end,
      jsonb_build_array(jsonb_build_object(
        'agent','EXECUTION_AI','provider','MT5','requestId',request.request_id,
        'auditStatus',p_status,'reconciled',p_reconciled,'result',p_result
      )),
      jsonb_build_object(
        'requestId',request.request_id,'reconciled',p_reconciled,
        'automaticExecutionPaused',true,'voiceEligible',true
      ),
      p_resolved_at
    ) on conflict (notification_id,event_key) do nothing;
  end if;

  return true;
end;
$$;

revoke all on function public.claim_mt5_auto_execution(uuid,uuid,uuid,text,text,jsonb,timestamptz)
  from public, anon, authenticated;
revoke all on function public.claim_mt5_manual_reconciliation(uuid,uuid,timestamptz,timestamptz)
  from public, anon, authenticated;
revoke all on function public.confirm_mt5_manual_post_claim(uuid,uuid,timestamptz)
  from public, anon, authenticated;
revoke all on function public.claim_mt5_auto_reconciliation(uuid,uuid,timestamptz,timestamptz)
  from public, anon, authenticated;
revoke all on function public.confirm_mt5_auto_post_claim(uuid,uuid,uuid,timestamptz)
  from public, anon, authenticated;
revoke all on function public.mark_mt5_auto_execution_uncertain(uuid,uuid,timestamptz,text)
  from public, anon, authenticated;
revoke all on function public.resolve_mt5_auto_execution(uuid,uuid,text,jsonb,timestamptz,boolean)
  from public, anon, authenticated;

grant execute on function public.claim_mt5_auto_execution(uuid,uuid,uuid,text,text,jsonb,timestamptz)
  to service_role;
grant execute on function public.claim_mt5_manual_reconciliation(uuid,uuid,timestamptz,timestamptz)
  to service_role;
grant execute on function public.confirm_mt5_manual_post_claim(uuid,uuid,timestamptz)
  to service_role;
grant execute on function public.claim_mt5_auto_reconciliation(uuid,uuid,timestamptz,timestamptz)
  to service_role;
grant execute on function public.confirm_mt5_auto_post_claim(uuid,uuid,uuid,timestamptz)
  to service_role;
grant execute on function public.mark_mt5_auto_execution_uncertain(uuid,uuid,timestamptz,text)
  to service_role;
grant execute on function public.resolve_mt5_auto_execution(uuid,uuid,text,jsonb,timestamptz,boolean)
  to service_role;

comment on function public.claim_mt5_auto_execution(uuid,uuid,uuid,text,text,jsonb,timestamptz) is
  'Service-only, per-user serialized creation of a candidate-backed MT5 AUTO execution audit row.';

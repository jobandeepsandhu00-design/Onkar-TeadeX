import { randomUUID } from "node:crypto";
import {
  agentResultSchema,
  type AgentProgressEvent,
  type AgentResult,
  type MasterAIRequest,
  type MasterAIResponse,
  type OnkarAgentId,
  type OnkarAgentState,
} from "@workspace/api-zod";
import { openAIConfigured } from "../lib/openai";
import { journalSummary } from "../market-brain/journal";
import {
  ScannerStore,
  records,
  type CandidateRow,
  type ConfigRow,
  type VersionRow,
} from "../market-brain/store";
import { normalizeTrades, similarTrades, summarizeTrades } from "./learning";
import { persistLearningEvidence } from "./learning-worker";
import { planMasterRequest } from "./planner";
import { agentRegistry } from "./registry";
import { synthesizeMasterAnswer } from "./synthesis";

type Identity = { userId: string };
type Log = MasterAIResponse["commandLog"][number];
const now = () => new Date().toISOString();
const finiteObject = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
const compactTrade = (trade: ReturnType<typeof normalizeTrades>[number]) => ({
  id: trade.id,
  outcome: trade.outcome,
  pnl: trade.pnl,
  rMultiple: trade.rMultiple,
  symbol: trade.symbol,
  direction: trade.direction,
  setupId: trade.setupId,
  setupName: trade.setupName,
  strategyVersionId: trade.strategyVersionId,
  timeframe: trade.timeframe,
  session: trade.session,
  mistakes: trade.mistakes,
  strengths: trade.strengths,
  rulesPassed: trade.rulesPassed,
  rulesFailed: trade.rulesFailed,
  date: trade.date,
  notes: String(trade.raw.reviewNotes || trade.raw.notes || "").slice(0, 1000),
});

function envelope(
  agent: OnkarAgentId,
  result: Record<string, unknown>,
  source: string[],
  missingData: string[] = [],
  warnings: string[] = [],
): AgentResult {
  const stamp = now();
  return agentResultSchema.parse({
    agent,
    status: missingData.length
      ? Object.keys(result).length
        ? "partial"
        : "unavailable"
      : "complete",
    dataStatus: missingData.length
      ? Object.keys(result).length
        ? "partial"
        : "unavailable"
      : "verified",
    startedAt: stamp,
    completedAt: stamp,
    source,
    result: finiteObject(result),
    warnings,
    missingData,
    confidenceInData: missingData.length ? "low" : "high",
  });
}

function deterministicAnswer(
  intent: string,
  evidence: Record<string, unknown>,
) {
  const journal = evidence.journal as
    | ReturnType<typeof summarizeTrades>
    | undefined;
  if (intent === "journal_review" && journal) {
    const mistake = journal.mistakes[0];
    return journal.sample
      ? `Journal review: ${journal.sample} closed recorded trades, ${journal.winRate?.toFixed(1) ?? "unavailable"}% win rate and ${journal.averageR?.toFixed(2) ?? "unavailable"}R average. ${mistake ? `Most frequent saved mistake: ${mistake.name} (${mistake.occurrences} occurrences).` : "No user-confirmed mistake tags are available."} ${journal.confidence.label}.`
      : "No closed trades with a recorded outcome are available yet. Add exit or broker P&L data to your journal.";
  }
  if (intent === "best_setup" && journal) {
    const best =
      journal.bySetup.find((row) => row.sample >= 5 && row.averageR !== null) ??
      journal.bySetup[0];
    return best
      ? `${best.key} currently ranks highest in your recorded data: ${best.sample} trades, ${best.winRate?.toFixed(1) ?? "unavailable"}% wins and ${best.averageR?.toFixed(2) ?? "unavailable"}R average. ${best.confidence.label}; this is historical evidence, not a guarantee.`
      : "Your journal has no closed setup-tagged trades to compare.";
  }
  if (intent === "last_trade")
    return evidence.lastTrade
      ? `The latest recorded closed trade is included in the evidence, but an AI explanation is temporarily unavailable. Review its saved rules, notes and mistake tags; no behavior has been inferred from the outcome alone.`
      : "No closed trade was found in your journal.";
  if (intent === "live_market")
    return evidence.candidate
      ? "Verified scanner evidence is available, but the AI explanation is temporarily unavailable. Review the deterministic trend, setup, risk and news results shown in the connected scanner."
      : "Live market data is not connected for this request. Journal, strategy and historical analysis remain available.";
  return "Verified OnkarTradex data was retrieved, but the AI explanation is temporarily unavailable. No market facts or statistics were invented.";
}

export async function runMasterAI(args: {
  identity: Identity;
  user: ScannerStore;
  config?: ConfigRow;
  input: MasterAIRequest;
  onProgress?: (event: AgentProgressEvent) => void;
}): Promise<MasterAIResponse> {
  const runId = randomUUID(),
    started = Date.now(),
    plan = planMasterRequest(args.input.question);
  const progress = (agent: OnkarAgentId, state: OnkarAgentState) =>
    args.onProgress?.({
      type: "agent-state",
      runId,
      agent,
      state,
      timestamp: now(),
    });
  progress("master", "thinking");
  const logs: Log[] = [
    {
      timestamp: now(),
      source: "USER",
      target: "MASTER AI",
      action: args.input.question,
      status: "received",
      durationMs: 0,
      summary: "Authenticated request received.",
    },
  ];
  const knowledgeTerms = [...new Set(args.input.question.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])]
    .filter((term) => !["what","does","about","show","from","with","that","this","have","your","onkar"].includes(term))
    .slice(0, 6);
  const knowledgeQuery: Record<string, string> = knowledgeTerms.length
    ? { status: "neq.REJECTED", or: `(${knowledgeTerms.flatMap((term) => [`title.ilike.*${term}*`,`summary.ilike.*${term}*`]).join(",")})`, order: "confidence.desc,updated_at.desc", limit: "20" }
    : { status: "neq.REJECTED", order: "updated_at.desc", limit: "12" };
  const [source, candidates, versions, knowledgeItems] = await Promise.all([
    args.user.source(args.identity.userId),
    args.user.request<CandidateRow[]>("setup_candidates", {
      order: "updated_at.desc",
      limit: "100",
    }),
    args.user.request<VersionRow[]>("scanner_strategy_versions", {
      order: "created_at.desc",
      limit: "100",
    }),
    args.user.request<Array<Record<string, unknown>>>("onkar_knowledge_items", knowledgeQuery).catch(() => []),
  ]);
  const knowledgeIds = knowledgeItems.map((item) => String(item.id)).filter(Boolean);
  const knowledgeSources = knowledgeIds.length
    ? await args.user.request<Array<Record<string, unknown>>>("onkar_knowledge_sources", {
        knowledge_id: `in.(${knowledgeIds.join(",")})`, order: "created_at.asc", limit: "100",
      }).catch(() => [])
    : [];
  const trades = normalizeTrades(source),
    journal = summarizeTrades(trades);
  const compactJournal = {
    ...journal,
    bySetup: journal.bySetup.slice(0, 20),
    bySymbol: journal.bySymbol.slice(0, 20),
    bySession: journal.bySession.slice(0, 12),
    byTimeframe: journal.byTimeframe.slice(0, 12),
    mistakes: journal.mistakes.slice(0, 20),
  };
  const candidate = args.input.candidateId
    ? candidates.find((row) => row.id === args.input.candidateId)
    : candidates.find((row) => !plan.symbol || row.symbol === plan.symbol);
  const sortedClosed = trades
    .filter((trade) => trade.closed)
    .sort((a, b) => b.date.localeCompare(a.date));
  const lastTrade = args.input.tradeId
    ? trades.find((trade) => trade.id === args.input.tradeId)
    : sortedClosed[0];
  const setupQuery =
    lastTrade ??
    (candidate
      ? {
          symbol: candidate.symbol,
          timeframe: candidate.timeframe,
          setupId: candidate.version_id,
          setupName: String(candidate.payload.strategyName || ""),
          direction: candidate.payload.direction,
        }
      : { symbol: plan.symbol || "" });
  const similar = similarTrades(trades, setupQuery, 5);
  const compactSimilar = similar.map((row) => ({
    score: row.score,
    matches: row.matches,
    trade: compactTrade(row.trade),
  }));
  const data: Record<string, unknown> = {
    intent: plan.intent,
    question: args.input.question,
    requestedSymbol: plan.symbol ?? null,
    journal: compactJournal,
    lastTrade: lastTrade ? compactTrade(lastTrade) : null,
    similarTrades: compactSimilar,
    candidate: candidate
      ? {
          id: candidate.id,
          symbol: candidate.symbol,
          timeframe: candidate.timeframe,
          state: candidate.state,
          score: candidate.score,
          evidence: {
            strategyName: candidate.payload.strategyName,
            direction: candidate.payload.direction,
            marketBias: candidate.payload.marketBias,
            session: candidate.payload.session,
            passed: candidate.payload.passed,
            total: candidate.payload.total,
            rules: candidate.payload.rules,
            warnings: candidate.payload.warnings,
            stale: candidate.payload.stale,
            analyzedAt: candidate.payload.analyzedAt,
            lastCandleAt: candidate.payload.lastCandleAt,
            higherTimeframe: candidate.payload.higherTimeframe,
            primaryTimeframe: candidate.payload.primaryTimeframe,
            entryZone: candidate.payload.entryZone,
            invalidation: candidate.payload.invalidation,
            targets: candidate.payload.targets,
            news: candidate.payload.news,
            globalWorkflow: candidate.payload.globalWorkflow,
            setupWorkflow: candidate.payload.setupWorkflow,
          },
          plan: candidate.plan,
        }
      : null,
    approvedStrategies: versions
      .filter((row) => row.definition.approval === "approved")
      .map((row) => ({
        id: row.id,
        sourceSetupId: row.source_setup_id,
        name: row.name,
        definition: row.definition,
      }))
      .slice(0, 20),
    library: records(source.setups)
      .map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        direction: row.direction,
        timeframe: row.timeframe,
        rules: row.rules,
      }))
      .slice(0, 30),
    sharedLibraryKnowledge: knowledgeItems.map((item) => ({
      id: item.id, kind: item.kind, status: item.status, title: item.title, summary: item.summary,
      tags: item.tags, symbols: item.symbols, timeframes: item.timeframes, confidence: item.confidence,
      mayInfluenceProduction: item.may_influence_production,
      structuredData: item.structured_data,
      sources: knowledgeSources.filter((source) => source.knowledge_id === item.id).map((source) => ({
        type: source.source_type, id: source.source_id, title: source.source_title,
        startSeconds: source.start_seconds, endSeconds: source.end_seconds, page: source.page_number,
        confidence: source.confidence, verification: source.verification_status,
      })),
    })),
    knowledgeSafety: "Only rows with mayInfluenceProduction=true may support a production trading decision. Review-only knowledge may be explained but cannot unlock execution.",
  };
  const results: AgentResult[] = [];
  progress("master", "delegating");
  for (const agent of plan.agents.filter((id) => id !== "insight")) {
    const stamp = Date.now();
    let result: AgentResult;
    // These operations retrieve/evaluate recorded evidence, not a new live market scan.
    progress(agent, "reviewing");
    if (agent === "journal")
      result = envelope(
        agent,
        {
          statistics: compactJournal,
          lastTrade: lastTrade ? compactTrade(lastTrade) : null,
          similarTrades: compactSimilar,
        },
        ["app_state.trades"],
      );
    else if (agent === "trend")
      result = candidate
        ? envelope(
            agent,
            candidate.payload.globalWorkflow
              ? {
                  symbol: candidate.symbol,
                  fourHour: candidate.payload.globalWorkflow.fourHour,
                  oneHour: {
                    bias: candidate.payload.globalWorkflow.oneHour.bias,
                    alignment:
                      candidate.payload.globalWorkflow.oneHour.alignment,
                  },
                  hierarchy: "4H main direction → 1H structural alignment",
                }
              : {
                  bias: candidate.payload.marketBias,
                  symbol: candidate.symbol,
                  timeframe: candidate.timeframe,
                },
            ["setup_candidates", "market_candles"],
            [],
            candidate.payload.stale ? ["Market evidence is stale."] : [],
          )
        : envelope(agent, {}, [], ["live market candidate"]);
    else if (agent === "zone")
      result = candidate
        ? envelope(
            agent,
            candidate.payload.globalWorkflow
              ? {
                  fourHour: {
                    support: candidate.payload.globalWorkflow.fourHour.support,
                    resistance:
                      candidate.payload.globalWorkflow.fourHour.resistance,
                  },
                  oneHour: {
                    support: candidate.payload.globalWorkflow.oneHour.support,
                    resistance:
                      candidate.payload.globalWorkflow.oneHour.resistance,
                    setupZone:
                      candidate.payload.globalWorkflow.oneHour.setupZone,
                  },
                  thirtyMinute: {
                    support:
                      candidate.payload.globalWorkflow.thirtyMinute.support,
                    resistance:
                      candidate.payload.globalWorkflow.thirtyMinute.resistance,
                  },
                  priceLocation: candidate.payload.globalWorkflow.priceLocation,
                  availableRange:
                    candidate.payload.globalWorkflow.availableRange,
                }
              : {
                  entryZone: candidate.payload.entryZone,
                  invalidation: candidate.payload.invalidation,
                  targets: candidate.payload.targets,
                },
            ["setup_candidates", "market_candles"],
          )
        : envelope(agent, {}, [], ["live market candidate"]);
    else if (agent === "setup")
      result = candidate
        ? envelope(
            agent,
            {
              strategyVersionId: candidate.version_id,
              strategyName: candidate.payload.strategyName,
              score: candidate.score,
              state: candidate.state,
              passed: candidate.payload.passed,
              total: candidate.payload.total,
              rules: candidate.payload.rules,
              parentGate: candidate.payload.globalWorkflow?.gate ?? null,
              thirtyMinuteConfirmation:
                candidate.payload.globalWorkflow?.thirtyMinute ?? null,
              setupWorkflow: candidate.payload.setupWorkflow ?? null,
            },
            ["scanner_strategy_versions", "setup_candidates"],
          )
        : envelope(
            agent,
            {
              approvedStrategies: data.approvedStrategies,
              library: data.library,
            },
            ["app_state.setups", "scanner_strategy_versions"],
            versions.length ? [] : ["approved strategy version"],
          );
    else if (agent === "risk")
      result = candidate?.plan
        ? envelope(agent, { ...candidate.plan, executionEnabled: false }, [
            "setup_candidates.plan",
            "app_state.tradingAccounts",
          ])
        : envelope(
            agent,
            { executionEnabled: false },
            [],
            ["verified entry, stop and instrument specification"],
          );
    else if (agent === "news")
      result = candidate?.payload.news
        ? envelope(
            agent,
            candidate.payload.news as unknown as Record<string, unknown>,
            ["setup_candidates.payload.news"],
            candidate.payload.news.status === "unavailable"
              ? ["connected news provider"]
              : [],
          )
        : envelope(agent, {}, [], ["connected news provider"]);
    else if (agent === "backtest")
      result = envelope(
        agent,
        {},
        [],
        [
          "strategy, symbol and date range required to run a deterministic backtest",
        ],
      );
    else if (agent === "execution")
      result = candidate?.payload.globalWorkflow
        ? envelope(
            agent,
            {
              executionEnabled: false,
              timingState: candidate.payload.globalWorkflow.masterStatus,
              candleClosed:
                candidate.payload.globalWorkflow.thirtyMinute.candle.closed,
              setupGate: candidate.payload.globalWorkflow.gate.status,
            },
            ["setup_candidates.payload.globalWorkflow", "system configuration"],
            ["broker execution telemetry"],
          )
        : envelope(
            agent,
            { executionEnabled: false },
            ["system configuration"],
            ["broker execution telemetry"],
          );
    else result = envelope(agent, {}, [], ["required evidence"]);
    results.push(result);
    logs.push({
      timestamp: now(),
      source: agentRegistry[agent].name,
      target: "MASTER AI",
      action: agentRegistry[agent].description,
      status: result.status,
      durationMs: Date.now() - stamp,
      summary: result.missingData.length
        ? `Missing: ${result.missingData.join(", ")}`
        : "Structured evidence returned.",
    });
    progress(
      agent,
      result.status === "complete"
        ? "success"
        : result.status === "unavailable"
          ? "unavailable"
          : "warning",
    );
  }
  let answer = "",
    model: string | null = null,
    inputTokens = 0,
    outputTokens = 0;
  if (openAIConfigured())
    try {
      progress("master", "synthesizing");
      progress("insight", "thinking");
      logs.push({
        timestamp: now(),
        source: "MASTER AI",
        target: "INSIGHT AI",
        action: "Synthesize verified evidence",
        status: "started",
        durationMs: 0,
        summary: "No private reasoning is logged.",
      });
      const response = await synthesizeMasterAnswer(
        { ...data, specialistResults: results },
        args.input.deepAnalysis,
      );
      answer = response.output.answer;
      model = response.model;
      inputTokens = response.inputTokens;
      outputTokens = response.outputTokens;
      results.push(
        envelope("insight", { explanationGenerated: true }, [
          "verified specialist results",
        ]),
      );
      progress("insight", "success");
    } catch {
      answer = deterministicAnswer(plan.intent, data);
      results.push(
        envelope(
          "insight",
          {},
          [],
          ["OpenAI explanation"],
          ["AI explanation temporarily unavailable."],
        ),
      );
      progress("insight", "unavailable");
    }
  else {
    answer = deterministicAnswer(plan.intent, data);
    results.push(envelope("insight", {}, [], ["OpenAI explanation"]));
    progress("insight", "unavailable");
  }
  logs.push({
    timestamp: now(),
    source: "MASTER AI",
    target: "USER",
    action: "Synthesis completed",
    status: "complete",
    durationMs: Date.now() - started,
    summary: "Evidence-based response prepared.",
  });
  const animationStates = Object.fromEntries(
    Object.keys(agentRegistry).map((id) => [id, "idle"]),
  ) as Record<OnkarAgentId, OnkarAgentState>;
  for (const result of results)
    animationStates[result.agent] =
      result.status === "error" || result.status === "partial"
        ? "warning"
        : result.status === "unavailable"
          ? "unavailable"
          : "success";
  animationStates.master = "idle"; // Speaking is controlled by actual text/audio playback in the client.
  const response: MasterAIResponse = {
    runId,
    intent: plan.intent,
    answer,
    dataStatus: results.some((row) => row.dataStatus === "verified")
      ? results.some((row) => row.dataStatus !== "verified")
        ? "partial"
        : "verified"
      : "unavailable",
    agents: results,
    commandLog: logs,
    usage: { model, inputTokens, outputTokens },
    animationStates,
  };
  try {
    const service = ScannerStore.service();
    await service.request(
      "onkar_agent_runs",
      {},
      "POST",
      {
        id: runId,
        user_id: args.identity.userId,
        workspace_id: args.config?.workspace_id ?? null,
        request: args.input,
        intent: plan.intent,
        agents_called: plan.agents,
        data_status: response.dataStatus,
        output: { answer },
        command_log: logs,
        model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        duration_ms: Date.now() - started,
        status: "succeeded",
      },
      "return=minimal",
    );
    await service.request(
      "onkar_agent_results",
      {},
      "POST",
      results.map((result) => ({
        run_id: runId,
        user_id: args.identity.userId,
        agent: result.agent,
        status: result.status,
        data_status: result.dataStatus,
        sources: result.source,
        result: result.result,
        warnings: result.warnings,
        missing_data: result.missingData,
      })),
      "return=minimal",
    );
    await persistLearningEvidence(service, args.identity.userId, source);
  } catch {
    /* A missing migration must not hide deterministic analysis. */
  }
  progress("master", "idle");
  return response;
}

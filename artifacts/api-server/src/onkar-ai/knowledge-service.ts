import { createHash } from "node:crypto";
import { NotificationService } from "../notifications/service";
import { ScannerStore, records } from "../market-brain/store";

export type KnowledgeStatus =
  | "UNVERIFIED" | "AI_EXTRACTED" | "HUMAN_VERIFIED" | "HISTORICALLY_SUPPORTED"
  | "BACKTEST_VERIFIED" | "REPLAY_VERIFIED" | "SHADOW_VERIFIED" | "FORWARD_VERIFIED"
  | "PAPER_VERIFIED" | "LIVE_VERIFIED" | "NEEDS_REVIEW" | "REJECTED";

type KnowledgeRow = {
  id: string; user_id: string; item_key: string; kind: string; status: KnowledgeStatus;
  title: string; summary: string; structured_data: Record<string, unknown>;
  tags: string[]; symbols: string[]; timeframes: string[]; confidence: number;
  human_verified: boolean; may_influence_production: boolean; source_count: number;
  evidence_count: number; created_at: string; updated_at: string;
};
type CaptionRow = { start_time: number; end_time: number; text: string; sort_order: number };
type VideoRow = {
  id: string; title: string; short_description: string; description: string; category: string;
  timeframe: string; tags: string[]; processing_status: string; upload_status: string;
  duration_seconds: number; video_storage_provider: string; video_object_key: string | null;
  created_at: string; updated_at: string;
  video_lesson_captions?: CaptionRow[];
  video_lesson_rules?: Array<{ id: string; text: string; sort_order: number }>;
};

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
const textArray = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
const unique = (items: string[], limit = 40) => [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(0, limit);
const serialized = (value: unknown) => JSON.stringify(value ?? {}).toUpperCase();
const symbolsFrom = (value: unknown) => unique(serialized(value).match(/\b(?:XAUUSD|GBPJPY|EURUSD|USDJPY|GBPUSD|AUDUSD|USDCAD|NZDUSD|BTCUSD|ETHUSD)\b/g) ?? []);
const timeframesFrom = (value: unknown) => unique(serialized(value).match(/\b(?:1M|5M|15M|30M|1H|2H|4H|1D|DAILY)\b/g) ?? []);
const ruleKind = (rule: string) => /invalid|cancel|fail/i.test(rule) ? "INVALIDATION"
  : /stop|\bsl\b/i.test(rule) ? "STOP_LOSS"
    : /target|take profit|\btp\b/i.test(rule) ? "TAKE_PROFIT"
      : /break.?even|partial|trail|manage|close trade/i.test(rule) ? "MANAGEMENT"
        : /confirm|candle close|wait.*close/i.test(rule) ? "CONFIRMATION"
          : /entry|enter|trigger/i.test(rule) ? "ENTRY"
            : /zone|support|resistance|supply|demand/i.test(rule) ? "ZONE"
              : /trend|structure|bias/i.test(rule) ? "CONTEXT" : "GENERAL";
const wordSet = (value: string) => new Set(value.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
function locateCaption(rule: string, captions: CaptionRow[]) {
  const terms = wordSet(rule);
  let best: { caption: CaptionRow; score: number } | null = null;
  for (const caption of captions) {
    const words = wordSet(caption.text);
    const score = [...terms].filter((term) => words.has(term)).length;
    if (!best || score > best.score) best = { caption, score };
  }
  return best && best.score >= Math.min(2, terms.size) ? best.caption : null;
}

async function upsertKnowledge(store: ScannerStore, row: Omit<KnowledgeRow, "id" | "user_id" | "may_influence_production" | "created_at" | "updated_at"> & { user_id: string }) {
  const [saved] = await store.request<KnowledgeRow[]>("onkar_knowledge_items", { on_conflict: "user_id,item_key" }, "POST", {
    ...row, updated_at: new Date().toISOString(),
  }, "resolution=merge-duplicates,return=representation");
  if (!saved) throw new Error("Knowledge item could not be saved.");
  return saved;
}

async function upsertSource(store: ScannerStore, row: Record<string, unknown>) {
  await store.request("onkar_knowledge_sources", { on_conflict: "user_id,knowledge_id,source_type,source_id" }, "POST", {
    ...row, updated_at: new Date().toISOString(),
  }, "resolution=merge-duplicates,return=minimal");
}

async function audit(store: ScannerStore, userId: string, eventKey: string, eventType: string, title: string, detail: Record<string, unknown>, sourceType?: string, sourceId?: string) {
  await store.request("onkar_learning_audit", { on_conflict: "user_id,event_key" }, "POST", {
    user_id: userId, event_key: eventKey, event_type: eventType, source_type: sourceType ?? null,
    source_id: sourceId ?? null, agent: "MASTER_AI", title, detail,
  }, "resolution=ignore-duplicates,return=minimal");
}

export async function ingestVideoKnowledge(store: ScannerStore, userId: string, video: VideoRow) {
  const captions = [...(video.video_lesson_captions ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const rules = [...(video.video_lesson_rules ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const transcript = captions.map((caption) => caption.text).join(" ");
  const baseConfidence = Math.min(82, 35 + (transcript ? 20 : 0) + Math.min(rules.length * 3, 21) + (video.processing_status === "ready" ? 6 : 0));
  const tags = unique([...(video.tags ?? []), video.category, video.timeframe, ...symbolsFrom(video), ...timeframesFrom(video)]);
  const base = await upsertKnowledge(store, {
    user_id: userId, item_key: `video:${video.id}`, kind: "VIDEO",
    status: video.processing_status === "ready" ? "AI_EXTRACTED" : "UNVERIFIED",
    title: video.title, summary: video.short_description || video.description || "Video uploaded to the OnkarTradeX Library.",
    structured_data: {
      category: video.category, timeframe: video.timeframe, durationSeconds: Number(video.duration_seconds || 0),
      transcriptAvailable: Boolean(transcript), transcriptQuality: transcript ? "AVAILABLE" : "MISSING",
      ruleCount: rules.length, processingStatus: video.processing_status, uploadStatus: video.upload_status,
      storageProvider: video.video_storage_provider, objectKeyStoredServerSide: Boolean(video.video_object_key),
    }, tags, symbols: symbolsFrom([video, transcript]), timeframes: unique([video.timeframe, ...timeframesFrom([video, transcript])]),
    confidence: baseConfidence, human_verified: false, source_count: 1, evidence_count: captions.length,
  });
  await upsertSource(store, {
    user_id: userId, knowledge_id: base.id, source_type: "VIDEO", source_id: video.id, source_title: video.title,
    confidence: baseConfidence, verification_status: "AI_EXTRACTED", extracted_by: "LIBRARY_INGESTION",
    metadata: { storageProvider: video.video_storage_provider, durationSeconds: video.duration_seconds },
  });

  const ruleItems: KnowledgeRow[] = [];
  for (const [index, rule] of rules.entries()) {
    const caption = locateCaption(rule.text, captions);
    const category = ruleKind(rule.text);
    const confidence = Math.min(78, 48 + (caption ? 18 : 0) + (rule.text.length >= 20 ? 7 : 0));
    const item = await upsertKnowledge(store, {
      user_id: userId, item_key: `video:${video.id}:rule:${hash(rule.text)}`, kind: "RULE", status: "NEEDS_REVIEW",
      title: rule.text.slice(0, 160), summary: `AI-extracted ${category.toLowerCase().replaceAll("_", " ")} rule from ${video.title}.`,
      structured_data: { rule: rule.text, ruleType: category, sourceVideoId: video.id, sourceVideoTitle: video.title,
        timestamp: caption ? { startSeconds: Number(caption.start_time), endSeconds: Number(caption.end_time) } : null,
        productionAuthority: false },
      tags: unique([...tags, category, "AI Extracted"]), symbols: symbolsFrom([rule.text, video]),
      timeframes: unique([...timeframesFrom(rule.text), video.timeframe]), confidence, human_verified: false,
      source_count: 1, evidence_count: caption ? 1 : 0,
    });
    await upsertSource(store, {
      user_id: userId, knowledge_id: item.id, source_type: "VIDEO", source_id: `${video.id}:rule:${rule.id || index}`,
      source_title: video.title, start_seconds: caption?.start_time ?? null, end_seconds: caption?.end_time ?? null,
      confidence, verification_status: "NEEDS_REVIEW", extracted_by: "LIBRARY_AI",
      metadata: { videoId: video.id, ruleId: rule.id, ruleType: category },
    });
    await store.request("onkar_knowledge_links", { on_conflict: "user_id,from_knowledge_id,to_knowledge_id,relationship" }, "POST", {
      user_id: userId, from_knowledge_id: base.id, to_knowledge_id: item.id, relationship: "TEACHES",
      confidence, evidence: { sourceVideoId: video.id, timestamp: caption ? [caption.start_time, caption.end_time] : null },
    }, "resolution=ignore-duplicates,return=minimal");
    ruleItems.push(item);
  }
  await audit(store, userId, `video:${video.id}:learned:${hash([video.updated_at, rules.length, captions.length])}`, "VIDEO_LEARNED", `${video.title} processed`, {
    knowledgeId: base.id, rulesExtracted: ruleItems.length, captions: captions.length, confidence: baseConfidence,
  }, "VIDEO", video.id);
  return { base, rules: ruleItems };
}

export function setupApproved(setup: Record<string, unknown>) {
  return setup.approved === true || /^approved(?:_canonical)?$/i.test(String(setup.approval || ""));
}
async function ingestLibraryRecord(store: ScannerStore, userId: string, kind: "SETUP" | "STRATEGY", source: Record<string, unknown>, index: number, approvedOverride = false) {
  const sourceId = String(source.id || `${kind.toLowerCase()}-${index}`);
  const title = String(source.name || source.title || `${kind} ${index + 1}`);
  const approved = approvedOverride || setupApproved(source);
  const rawRules = records(source.rules).map((rule) => String(rule.text || rule.name || rule.id || "")).filter(Boolean);
  const fallbackRules = textArray(source.conditions);
  const rules = unique([...rawRules, ...fallbackRules]);
  const confidence = approved ? 90 : Math.min(70, 35 + rules.length * 4);
  const item = await upsertKnowledge(store, {
    user_id: userId, item_key: `${kind.toLowerCase()}:${sourceId}`, kind,
    status: approved ? "HUMAN_VERIFIED" : "UNVERIFIED", title,
    summary: String(source.description || source.notes || `${kind} stored in the OnkarTradeX Library.`),
    structured_data: { ...source, normalizedRules: rules, productionAuthority: approved },
    tags: unique([kind, ...textArray(source.tags), ...symbolsFrom(source), ...timeframesFrom(source)]),
    symbols: symbolsFrom(source), timeframes: timeframesFrom(source), confidence,
    human_verified: approved, source_count: 1, evidence_count: rules.length,
  });
  await upsertSource(store, {
    user_id: userId, knowledge_id: item.id, source_type: kind === "SETUP" ? "SETUP_LIBRARY" : "STRATEGY_LIBRARY",
    source_id: sourceId, source_title: title, setup_id: kind === "SETUP" ? sourceId : null,
    strategy_id: kind === "STRATEGY" ? sourceId : null, confidence,
    verification_status: approved ? "HUMAN_VERIFIED" : "UNVERIFIED", extracted_by: approved ? "HUMAN" : "LIBRARY_INGESTION",
    metadata: { approved, ruleCount: rules.length },
  });
  return item;
}

export async function syncLibraryKnowledge(userId: string) {
  const store = ScannerStore.service();
  const source = await store.source(userId);
  const [videos, approvedVersions] = await Promise.all([
    store.request<VideoRow[]>("video_lessons", {
      owner_id: `eq.${userId}`,
      select: "id,title,short_description,description,category,timeframe,tags,processing_status,upload_status,duration_seconds,video_storage_provider,video_object_key,created_at,updated_at,video_lesson_captions(start_time,end_time,text,sort_order),video_lesson_rules(id,text,sort_order)",
      order: "updated_at.desc", limit: "500",
    }),
    store.request<Array<{ source_setup_id: string; definition: Record<string, unknown> }>>("scanner_strategy_versions", {
      user_id: `eq.${userId}`, select: "source_setup_id,definition", limit: "500",
    }),
  ]);
  const approvedSetupIds = new Set(
    approvedVersions
      .filter((version) => String(version.definition?.approval || "") === "approved")
      .map((version) => String(version.source_setup_id)),
  );
  const results = { videos: 0, setups: 0, strategies: 0, rules: 0 };
  for (const video of videos) {
    const learned = await ingestVideoKnowledge(store, userId, video);
    results.videos += 1; results.rules += learned.rules.length;
  }
  const setups = records(source.setups);
  for (const [index, setup] of setups.entries()) {
    await ingestLibraryRecord(store, userId, "SETUP", setup, index, approvedSetupIds.has(String(setup.id || "")));
    results.setups += 1;
  }
  const strategies = records(source.strategies);
  for (const [index, strategy] of strategies.entries()) { await ingestLibraryRecord(store, userId, "STRATEGY", strategy, index); results.strategies += 1; }
  await store.request("onkar_learning_preferences", { on_conflict: "user_id" }, "POST", { user_id: userId }, "resolution=ignore-duplicates,return=minimal");
  await detectKnowledgeConflicts(store, userId);
  await audit(store, userId, `library-sync:${new Date().toISOString().slice(0, 13)}`, "LIBRARY_SYNC", "Library knowledge synchronized", results);
  return results;
}

async function detectKnowledgeConflicts(store: ScannerStore, userId: string) {
  const rules = await store.request<KnowledgeRow[]>("onkar_knowledge_items", { user_id: `eq.${userId}`, kind: "eq.RULE", status: "neq.REJECTED", limit: "500" });
  const wait = rules.filter((rule) => /wait.*(?:candle )?close|after.*close/i.test(String(rule.structured_data.rule || rule.title)));
  const immediate = rules.filter((rule) => /immediate|before.*close|on (?:the )?(?:first )?touch/i.test(String(rule.structured_data.rule || rule.title)));
  for (const left of wait) for (const right of immediate) {
    const contextOverlap = left.symbols.some((symbol) => right.symbols.includes(symbol)) || left.timeframes.some((tf) => right.timeframes.includes(tf));
    if (!contextOverlap && (left.symbols.length || right.symbols.length || left.timeframes.length || right.timeframes.length)) continue;
    const [a, b] = [left.id, right.id].sort();
    await store.request("onkar_knowledge_conflicts", { on_conflict: "user_id,conflict_key" }, "POST", {
      user_id: userId, conflict_key: `entry-timing:${a}:${b}`, left_knowledge_id: left.id, right_knowledge_id: right.id,
      description: "Library sources appear to disagree about waiting for a candle close versus immediate entry.",
      context: { sharedSymbols: left.symbols.filter((value) => right.symbols.includes(value)), sharedTimeframes: left.timeframes.filter((value) => right.timeframes.includes(value)) },
      recommendation: "Keep both blocked from automatic production influence until the context is reviewed.", status: "NEEDS_REVIEW",
      updated_at: new Date().toISOString(),
    }, "resolution=merge-duplicates,return=minimal");
  }
}

export async function runNextKnowledgeJob() {
  const store = ScannerStore.service();
  let jobId: string | null;
  try { jobId = await store.rpc<string | null>("claim_onkar_ingestion_job", {}); }
  catch { return { status: "unavailable" as const, error: "Knowledge migration is not installed." }; }
  if (!jobId) return { status: "idle" as const };
  const [job] = await store.request<Array<{ id: string; user_id: string; source_type: string; source_id: string; attempt_count: number; max_attempts: number }>>("onkar_ingestion_jobs", { id: `eq.${jobId}`, limit: "1" });
  if (!job) return { status: "idle" as const };
  try {
    await store.request("onkar_ingestion_jobs", { id: `eq.${job.id}` }, "PATCH", { stage: "ANALYZING", updated_at: new Date().toISOString() });
    if (job.source_type === "VIDEO") {
      const [video] = await store.request<VideoRow[]>("video_lessons", {
        id: `eq.${job.source_id}`, owner_id: `eq.${job.user_id}`,
        select: "id,title,short_description,description,category,timeframe,tags,processing_status,upload_status,duration_seconds,video_storage_provider,video_object_key,created_at,updated_at,video_lesson_captions(start_time,end_time,text,sort_order),video_lesson_rules(id,text,sort_order)", limit: "1",
      });
      if (!video) throw new Error("The source video no longer exists.");
      await store.request("onkar_ingestion_jobs", { id: `eq.${job.id}` }, "PATCH", { stage: "EXTRACTING_KNOWLEDGE", updated_at: new Date().toISOString() });
      const learned = await ingestVideoKnowledge(store, job.user_id, video);
      await store.request("onkar_ingestion_jobs", { id: `eq.${job.id}` }, "PATCH", { knowledge_id: learned.base.id, stage: "READY", locked_until: null, failed_stage: null, last_error: null, processing_log: [{ at: new Date().toISOString(), event: "READY", rules: learned.rules.length }], updated_at: new Date().toISOString() });
      await new NotificationService(store).upsert({ userId: job.user_id, eventKey: `learning:video:${video.id}`, eventVersion: `${video.updated_at}:ready`, category: "AI", priority: "IMPORTANT", agentSource: "MASTER_AI", lifecycleState: "READY", title: `${video.title} · learned`, message: `Library AI linked ${learned.rules.length} extracted rules to their source. Unverified rules remain review-only.`, recommendedAction: "Review extracted knowledge before it can influence production.", actions: [{ id: "knowledge", label: "Open Knowledge Center", href: "/onkar-ai/knowledge", intent: "NAVIGATE", confirm: false }], metadata: { voiceEligible: learned.rules.length > 0, knowledgeId: learned.base.id } });
      return { status: "complete" as const, jobId, sourceType: job.source_type, rules: learned.rules.length };
    }
    await syncLibraryKnowledge(job.user_id);
    await store.request("onkar_ingestion_jobs", { id: `eq.${job.id}` }, "PATCH", { stage: "READY", locked_until: null, updated_at: new Date().toISOString() });
    return { status: "complete" as const, jobId, sourceType: job.source_type };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message.slice(0, 500) : "Knowledge ingestion failed";
    const terminal = job.attempt_count >= job.max_attempts;
    await store.request("onkar_ingestion_jobs", { id: `eq.${job.id}` }, "PATCH", {
      stage: terminal ? "PROCESSING_FAILED" : "UPLOADED", locked_until: null,
      next_attempt_at: new Date(Date.now() + Math.min(3_600_000, 60_000 * 2 ** Math.max(0, job.attempt_count - 1))).toISOString(),
      failed_stage: "ANALYZING", last_error: message,
      processing_log: [{ at: new Date().toISOString(), event: "FAILED", message }], updated_at: new Date().toISOString(),
    });
    return { status: "failed" as const, jobId, error: message };
  }
}

export async function knowledgeDashboard(userId: string) {
  const store = ScannerStore.service();
  await store.request("onkar_learning_preferences", { on_conflict: "user_id" }, "POST", { user_id: userId }, "resolution=ignore-duplicates,return=minimal");
  const [items, jobs, conflicts, candidates, evaluations, autopsies, mistakes, activity, preferences] = await Promise.all([
    store.request<KnowledgeRow[]>("onkar_knowledge_items", { user_id: `eq.${userId}`, order: "updated_at.desc", limit: "500" }),
    store.request<Array<Record<string, unknown>>>("onkar_ingestion_jobs", { user_id: `eq.${userId}`, order: "updated_at.desc", limit: "100" }),
    store.request<Array<Record<string, unknown>>>("onkar_knowledge_conflicts", { user_id: `eq.${userId}`, order: "updated_at.desc", limit: "100" }),
    store.request<Array<Record<string, unknown>>>("onkar_strategy_candidates", { user_id: `eq.${userId}`, order: "updated_at.desc", limit: "100" }),
    store.request<Array<Record<string, unknown>>>("onkar_candidate_evaluations", { user_id: `eq.${userId}`, order: "created_at.desc", limit: "200" }),
    store.request<Array<Record<string, unknown>>>("onkar_trade_autopsies", { user_id: `eq.${userId}`, order: "updated_at.desc", limit: "100" }),
    store.request<Array<Record<string, unknown>>>("onkar_mistake_memory", { user_id: `eq.${userId}`, order: "occurrences.desc", limit: "100" }),
    store.request<Array<Record<string, unknown>>>("onkar_learning_audit", { user_id: `eq.${userId}`, order: "created_at.desc", limit: "100" }),
    store.request<Array<Record<string, unknown>>>("onkar_learning_preferences", { user_id: `eq.${userId}`, limit: "1" }),
  ]);
  const count = (predicate: (item: KnowledgeRow) => boolean) => items.filter(predicate).length;
  return {
    metrics: {
      libraryItems: items.length, videosAnalyzed: count((item) => item.kind === "VIDEO"),
      setupsUnderstood: count((item) => item.kind === "SETUP"), strategiesKnown: count((item) => item.kind === "STRATEGY"),
      rulesExtracted: count((item) => item.kind === "RULE"), verifiedRules: count((item) => item.kind === "RULE" && item.may_influence_production),
      needsReview: count((item) => item.status === "NEEDS_REVIEW" || item.status === "UNVERIFIED"),
      conflicts: conflicts.filter((item) => item.status === "NEEDS_REVIEW").length,
      tradesLearnedFrom: autopsies.length, mistakesDetected: mistakes.reduce((sum, item) => sum + Number(item.occurrences || 0), 0),
      candidatesTesting: candidates.filter((item) => /TESTING$/.test(String(item.status))).length,
      candidatesApproved: candidates.filter((item) => item.status === "APPROVED").length,
      learningErrors: jobs.filter((item) => item.stage === "PROCESSING_FAILED").length,
    },
    items: items.slice(0, 60), jobs, conflicts, candidates, evaluations, autopsies, mistakes, activity,
    preferences: preferences[0] ?? null,
    generatedAt: new Date().toISOString(),
  };
}

export async function searchKnowledge(userId: string, query: string) {
  const term = query.trim().replace(/[,*()]/g, " ").replace(/\s+/g, " ").slice(0, 120);
  if (!term) return [];
  const clauses = term.split(" ").filter((part) => part.length > 1).slice(0, 8)
    .flatMap((part) => [`title.ilike.*${part}*`, `summary.ilike.*${part}*`]);
  return ScannerStore.service().request<KnowledgeRow[]>("onkar_knowledge_items", {
    user_id: `eq.${userId}`, or: `(${clauses.join(",")})`, order: "confidence.desc,updated_at.desc", limit: "50",
  });
}

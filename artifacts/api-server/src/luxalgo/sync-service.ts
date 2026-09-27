import { createHash, randomUUID } from "node:crypto";
import type { SupabaseIdentity } from "../lib/supabase-auth";
import { ScannerStore } from "../market-brain/store";
import { luxAlgoMCP } from "./mcp-service";

type Json = Record<string, unknown>;
type SyncMode = "FULL" | "CHANGES" | "RETRY";
type SyncStatus = "IDLE" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
type Failure = { type: "FAMILY" | "CONCEPT" | "INDICATOR" | "SOURCE"; id: string; error: string; attempts: number };
export type LuxSyncState = {
  id: string;
  job_id: string | null;
  initiated_by: string | null;
  status: SyncStatus;
  mode: SyncMode;
  stage: string;
  cursor: Json;
  counters: Json;
  content_changes: number;
  failed_items: Failure[];
  retry_queue: Failure[];
  cancel_requested: boolean;
  started_at: string | null;
  locked_at: string | null;
  completed_at: string | null;
  last_successful_sync_at: string | null;
  last_duration_ms: number | null;
  last_error: string | null;
  updated_at: string;
};

type SyncOptions = {
  saveRaw: boolean;
  saveSource: boolean;
  preserveAttribution: boolean;
  preserveLicense: boolean;
  full?: boolean;
};

const BATCH = 3;
const PAGE_CONCEPTS = 200;
const PAGE_INDICATORS = 100;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const record = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const list = (value: unknown): Json[] => Array.isArray(value) ? value.map(record).filter((item) => Object.keys(item).length > 0) : [];
const text = (value: unknown, max = 100_000) => typeof value === "string" ? value.trim().slice(0, max) : "";
const maybeText = (value: unknown, max?: number) => text(value, max) || null;
const integer = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0;
const safeId = (value: unknown) => {
  const id = text(value, 180);
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) throw new Error("LuxAlgo returned an invalid identifier.");
  return id;
};
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Json).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
};
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const now = () => new Date().toISOString();
const errorText = (value: unknown) => (value instanceof Error ? value.message : String(value)).slice(0, 500);
const optionsFrom = (cursor: Json): SyncOptions => ({
  saveRaw: cursor.saveRaw !== false,
  saveSource: cursor.saveSource !== false,
  preserveAttribution: cursor.preserveAttribution !== false,
  preserveLicense: cursor.preserveLicense !== false,
});
const counters = (state: LuxSyncState) => ({ ...record(state.counters) });
const bump = (values: Json, key: string, amount = 1) => ({ ...values, [key]: integer(values[key]) + amount });
const sourceFields = (raw: Json, content = "") => {
  const licenseUrl = content.match(/https:\/\/(?:www\.)?luxalgo\.com\/library\/license\/?/i)?.[0]
    ?? content.match(/https:\/\/mozilla\.org\/MPL\/2\.0\/?/i)?.[0]
    ?? null;
  const licenseIdentifier = /Mozilla Public License 2\.0|MPL-2\.0/i.test(content) ? "MPL-2.0" : null;
  return {
    attribution: maybeText(raw.author) ?? "LuxAlgo",
    licenseUrl,
    licenseIdentifier,
    licenseMetadata: licenseIdentifier || licenseUrl ? { identifier: licenseIdentifier, url: licenseUrl } : {},
  };
};

async function state(): Promise<LuxSyncState> {
  const rows = await ScannerStore.service().request<LuxSyncState[]>("luxalgo_sync_state", { id: "eq.library", limit: "1" });
  if (!rows[0]) throw new Error("LuxAlgo sync migration is not installed.");
  return rows[0];
}

async function patchState(jobId: string, body: Partial<LuxSyncState>): Promise<LuxSyncState> {
  const rows = await ScannerStore.service().request<LuxSyncState[]>("luxalgo_sync_state", { id: "eq.library", job_id: `eq.${jobId}` }, "PATCH", { ...body, updated_at: now(), locked_at: now() }, "return=representation");
  if (!rows[0]) throw new Error("LuxAlgo sync lease no longer belongs to this job.");
  return rows[0];
}

async function existing(table: string, idColumn: string, ids: string[], select: string) {
  if (!ids.length) return new Map<string, Json>();
  const rows = await ScannerStore.service().request<Json[]>(table, { [idColumn]: `in.(${ids.join(",")})`, select });
  return new Map(rows.map((row) => [text(row[idColumn]), row]));
}

async function upsert(table: string, conflict: string, rows: Json[]) {
  if (!rows.length) return;
  await ScannerStore.service().request(table, { on_conflict: conflict }, "POST", rows, "resolution=merge-duplicates,return=minimal");
}

async function replaceRelationships(sourceType: string, sourceId: string, raw: Json, relationships: Array<{ relationship: string; targetType: string; targetId: string; metadata?: Json }>) {
  const store = ScannerStore.service();
  await store.request("luxalgo_relationships", { source_type: `eq.${sourceType}`, source_id: `eq.${sourceId}` }, "DELETE", undefined, "return=minimal");
  const stamp = now();
  await upsert("luxalgo_relationships", "source_type,source_id,relationship_type,target_type,target_id", relationships.map((row) => {
    const payload = { sourceType, sourceId, ...row };
    return {
      source_type: sourceType, source_id: sourceId, relationship_type: row.relationship,
      target_type: row.targetType, target_id: row.targetId, metadata: row.metadata ?? {},
      raw_response: row.metadata ?? {}, content_hash: digest(payload), last_synced_at: stamp, updated_at: stamp,
    };
  }));
}

function markdownRelationships(markdown: string) {
  const rows: Array<{ relationship: string; targetType: string; targetId: string; metadata?: Json }> = [];
  const seen = new Set<string>();
  for (const match of markdown.matchAll(/https:\/\/(?:www\.)?luxalgo\.com\/library\/(concept|indicator)\/([a-z0-9-]+)\/?/gi)) {
    const targetType = match[1].toUpperCase();
    const targetId = match[2].toLowerCase();
    const key = `${targetType}:${targetId}`;
    if (!seen.has(key)) { seen.add(key); rows.push({ relationship: targetType === "CONCEPT" ? "RELATED_CONCEPT" : "IMPLEMENTED_BY", targetType, targetId, metadata: { url: match[0] } }); }
  }
  return rows;
}

async function syncFamilyDetail(key: string, options: SyncOptions) {
  const raw = record(await luxAlgoMCP.callTool("library_get_family", { key }));
  const content = text(raw.content_markdown ?? raw.body_markdown, 1_000_000);
  const current = await existing("luxalgo_families", "key", [key], "key,content_hash");
  const hash = digest(raw), changed = current.get(key)?.content_hash !== hash;
  const attribution = sourceFields(raw, content);
  await ScannerStore.service().request("luxalgo_families", { key: `eq.${key}` }, "PATCH", {
    name: maybeText(raw.name) ?? key, content_markdown: content || null,
    official_url: maybeText(raw.url), markdown_url: maybeText(raw.md_url),
    attribution: options.preserveAttribution ? attribution.attribution : null,
    license_url: options.preserveLicense ? attribution.licenseUrl : null,
    license_metadata: options.preserveLicense ? attribution.licenseMetadata : {},
    raw_response: options.saveRaw ? raw : {}, content_hash: hash, detail_sync_needed: false,
    last_synced_at: now(), updated_at: now(),
  }, "return=minimal");
  return changed;
}

async function syncConceptDetail(slug: string, options: SyncOptions) {
  const raw = record(await luxAlgoMCP.callTool("library_get_concept", { slug }));
  const actualSlug = safeId(raw.slug || slug);
  const content = text(raw.content_markdown, 2_000_000);
  const current = await existing("luxalgo_concepts", "slug", [actualSlug], "slug,content_hash");
  const hash = digest(raw), changed = current.get(actualSlug)?.content_hash !== hash;
  const attribution = sourceFields(raw, content);
  await ScannerStore.service().request("luxalgo_concepts", { slug: `eq.${actualSlug}` }, "PATCH", {
    name: maybeText(raw.name) ?? actualSlug, family: maybeText(raw.family),
    cluster: maybeText(raw.cluster), aliases: Array.isArray(raw.aliases) ? raw.aliases.map((item) => text(item, 200)).filter(Boolean) : [],
    short_description: content.split(/\n\s*\n/).find((part) => part && !part.startsWith("#"))?.slice(0, 600) ?? null,
    content_markdown: content || null, official_url: maybeText(raw.url), markdown_url: maybeText(raw.md_url),
    attribution: options.preserveAttribution ? attribution.attribution : null,
    license_url: options.preserveLicense ? attribution.licenseUrl : null,
    license_metadata: options.preserveLicense ? attribution.licenseMetadata : {},
    raw_response: options.saveRaw ? raw : {}, content_hash: hash, detail_sync_needed: false,
    last_synced_at: now(), updated_at: now(),
  }, "return=minimal");
  await replaceRelationships("CONCEPT", actualSlug, options.saveRaw ? raw : {}, markdownRelationships(content));
  return changed;
}

async function syncIndicatorDetail(slug: string, options: SyncOptions) {
  const raw = record(await luxAlgoMCP.callTool("library_get_indicator", { slug }));
  const actualSlug = safeId(raw.slug || slug);
  const body = text(raw.body_markdown ?? raw.content_markdown, 2_000_000);
  const current = await existing("luxalgo_indicators", "slug", [actualSlug], "slug,content_hash,source_sync_needed");
  const hash = digest(raw), changed = current.get(actualSlug)?.content_hash !== hash;
  const code = record(raw.code), codeAvailable = code.available === true;
  const attribution = sourceFields(raw, body);
  const concepts = list(raw.concepts);
  const tags = Array.isArray(raw.tags) ? raw.tags : [];
  await ScannerStore.service().request("luxalgo_indicators", { slug: `eq.${actualSlug}` }, "PATCH", {
    name: maybeText(raw.name) ?? actualSlug, author: maybeText(raw.author),
    family: maybeText(raw.family), description: maybeText(raw.description, 20_000), body_markdown: body || null,
    tags, platforms: Array.isArray(raw.platforms) ? raw.platforms.map((item) => text(item, 80)).filter(Boolean) : [],
    tier: maybeText(raw.tier, 80), image_url: maybeText(raw.image_url, 1000), date_displayed: maybeText(raw.date_displayed, 10),
    official_url: maybeText(raw.url, 1000), source_code_available: codeAvailable,
    attribution: options.preserveAttribution ? attribution.attribution : null,
    license_url: options.preserveLicense ? attribution.licenseUrl : null,
    license_metadata: options.preserveLicense ? attribution.licenseMetadata : {},
    raw_response: options.saveRaw ? raw : {}, content_hash: hash, detail_sync_needed: false,
    source_sync_needed: options.saveSource && codeAvailable && (options.full === true || changed || current.get(actualSlug)?.source_sync_needed === true),
    last_synced_at: now(), updated_at: now(),
  }, "return=minimal");
  const relationships: Array<{ relationship: string; targetType: string; targetId: string; metadata?: Json }> = concepts.map((item) => ({ relationship: item.primary === true ? "PRIMARY_CONCEPT" : "RELATED_CONCEPT", targetType: "CONCEPT", targetId: safeId(item.slug), metadata: { name: maybeText(item.name), primary: item.primary === true } }));
  for (const item of tags) {
    const tag = typeof item === "string" ? { id: item } : record(item);
    const id = tag.id || tag.slug ? safeId(tag.id || tag.slug) : "";
    if (id) relationships.push({ relationship: "TAGGED_WITH", targetType: "TAG", targetId: id, metadata: { name: maybeText(tag.name) } });
  }
  await replaceRelationships("INDICATOR", actualSlug, options.saveRaw ? raw : {}, relationships);
  return changed;
}

async function syncSource(slug: string, options: SyncOptions) {
  const raw = record(await luxAlgoMCP.callTool("library_get_source_code", { slug }));
  const source = text(raw.source, 5_000_000);
  if (raw.available !== true || !source) {
    await ScannerStore.service().request("luxalgo_indicators", { slug: `eq.${slug}` }, "PATCH", { source_code_available: false, source_sync_needed: false, updated_at: now() }, "return=minimal");
    return false;
  }
  const current = await existing("luxalgo_source_code", "indicator_slug", [slug], "indicator_slug,content_hash");
  const indicators = await existing("luxalgo_indicators", "slug", [slug], "slug,official_url");
  const hash = digest(raw), changed = current.get(slug)?.content_hash !== hash;
  const attribution = sourceFields(raw, source);
  await upsert("luxalgo_source_code", "indicator_slug", [{
    indicator_slug: slug, name: maybeText(raw.name), language: "pine", source_code: source,
    source_url: maybeText(raw.url) ?? maybeText(indicators.get(slug)?.official_url), attribution: options.preserveAttribution ? attribution.attribution : null,
    license_identifier: options.preserveLicense ? attribution.licenseIdentifier : null,
    license_url: options.preserveLicense ? attribution.licenseUrl : null,
    license_metadata: options.preserveLicense ? attribution.licenseMetadata : {},
    raw_response: options.saveRaw ? raw : {}, content_hash: hash, last_synced_at: now(), updated_at: now(),
  }]);
  await ScannerStore.service().request("luxalgo_indicators", { slug: `eq.${slug}` }, "PATCH", { source_sync_needed: false, updated_at: now() }, "return=minimal");
  return changed;
}

async function failure(stateValue: LuxSyncState, item: Omit<Failure, "attempts">) {
  const queued = [...(stateValue.retry_queue ?? []), { ...item, attempts: 0 }].slice(-2000);
  const failed = [...(stateValue.failed_items ?? []), { ...item, attempts: 0 }].slice(-2000);
  return { retry_queue: queued, failed_items: failed };
}

export async function startLuxAlgoSync(identity: SupabaseIdentity, mode: Exclude<SyncMode, "RETRY">, options: SyncOptions) {
  const current = await state();
  if (current.status === "RUNNING" && current.locked_at && Date.now() - new Date(current.locked_at).getTime() < 5 * 60_000) return current;
  if (current.status === "RUNNING") await ScannerStore.service().request("luxalgo_sync_state", { id: "eq.library" }, "PATCH", { status: "FAILED", last_error: "Previous sync lease expired and can be resumed safely.", updated_at: now() }, "return=minimal");
  const jobId = randomUUID(), stamp = now();
  const rows = await ScannerStore.service().request<LuxSyncState[]>("luxalgo_sync_state", { id: "eq.library", status: "neq.RUNNING" }, "PATCH", {
    job_id: jobId, initiated_by: identity.userId, status: "RUNNING", mode, stage: "FAMILIES",
    cursor: { page: 0, ...options }, counters: {}, content_changes: 0, failed_items: [], retry_queue: [],
    cancel_requested: false, started_at: stamp, locked_at: stamp, completed_at: null, last_duration_ms: null,
    last_error: null, updated_at: stamp,
  }, "return=representation");
  if (!rows[0]) throw new Error("A LuxAlgo Library sync is already running.");
  return rows[0];
}

export async function resumeLuxAlgoSync(identity: SupabaseIdentity) {
  const current = await state();
  if (current.status === "RUNNING") return current;
  if (!current.job_id || !current.started_at || current.stage === "COMPLETE") throw new Error("There is no incomplete LuxAlgo sync to resume.");
  const rows = await ScannerStore.service().request<LuxSyncState[]>("luxalgo_sync_state", { id: "eq.library", status: "neq.RUNNING" }, "PATCH", {
    initiated_by: identity.userId, status: "RUNNING", cancel_requested: false, locked_at: now(), last_error: null, updated_at: now(),
  }, "return=representation");
  if (!rows[0]) throw new Error("A LuxAlgo Library sync is already running.");
  return rows[0];
}

export async function retryLuxAlgoFailures(identity: SupabaseIdentity) {
  const current = await state();
  if (current.status === "RUNNING") return current;
  if (!current.retry_queue?.length) throw new Error("There are no failed LuxAlgo items to retry.");
  const jobId = randomUUID(), stamp = now();
  const rows = await ScannerStore.service().request<LuxSyncState[]>("luxalgo_sync_state", { id: "eq.library", status: "neq.RUNNING" }, "PATCH", {
    job_id: jobId, initiated_by: identity.userId, status: "RUNNING", mode: "RETRY", stage: "RETRY",
    cursor: { ...record(current.cursor), retryStartedAt: stamp }, cancel_requested: false, started_at: stamp,
    locked_at: stamp, completed_at: null, last_error: null, updated_at: stamp,
  }, "return=representation");
  if (!rows[0]) throw new Error("A LuxAlgo Library sync is already running.");
  return rows[0];
}

export async function cancelLuxAlgoSync(identity: SupabaseIdentity) {
  const current = await state();
  if (current.status !== "RUNNING") return current;
  if (current.initiated_by && current.initiated_by !== identity.userId) throw new Error("Only the user who started this sync can cancel it.");
  const stamp = now();
  const duration = current.started_at ? Date.now() - new Date(current.started_at).getTime() : null;
  return patchState(current.job_id!, { status: "CANCELLED", cancel_requested: true, completed_at: stamp, last_duration_ms: duration, last_error: "Cancelled by user." });
}

async function complete(current: LuxSyncState) {
  const stamp = now();
  const duration = current.started_at ? Date.now() - new Date(current.started_at).getTime() : 0;
  return patchState(current.job_id!, {
    status: "COMPLETED", stage: "COMPLETE", completed_at: stamp, last_successful_sync_at: stamp,
    last_duration_ms: duration, cancel_requested: false, last_error: current.failed_items?.length ? `${current.failed_items.length} item(s) remain in the retry queue.` : null,
  });
}

export async function stepLuxAlgoSync(identity: SupabaseIdentity, jobId: string) {
  let current = await state();
  if (current.job_id !== jobId) throw new Error("This LuxAlgo sync job is no longer active.");
  if (current.initiated_by && current.initiated_by !== identity.userId) throw new Error("Only the user who started this sync can continue it.");
  if (current.status !== "RUNNING") return current;
  if (current.cancel_requested) return cancelLuxAlgoSync(identity);
  const store = ScannerStore.service(), options = { ...optionsFrom(record(current.cursor)), full: current.mode === "FULL" };
  let count = counters(current), changes = integer(current.content_changes);
  try {
    if (current.stage === "FAMILIES") {
      const raw = record(await luxAlgoMCP.callTool("library_list_families", {}));
      const items = list(raw.families), ids = items.map((item) => safeId(item.key));
      const old = await existing("luxalgo_families", "key", ids, "key,listing_hash,content_hash,raw_response,detail_sync_needed");
      const stamp = now();
      await upsert("luxalgo_families", "key", items.map((item) => {
        const key = safeId(item.key), listingHash = digest(item), previous = old.get(key);
        return { key, name: maybeText(item.name) ?? key, concept_count: integer(item.concept_count), official_url: maybeText(item.url), markdown_url: maybeText(item.md_url), attribution: options.preserveAttribution ? "LuxAlgo" : null, listing_response: options.saveRaw ? item : {}, raw_response: previous?.raw_response ?? (options.saveRaw ? item : {}), listing_hash: listingHash, content_hash: previous?.content_hash ?? listingHash, detail_sync_needed: current.mode === "FULL" || previous?.detail_sync_needed === true || previous?.listing_hash !== listingHash, last_synced_at: stamp, updated_at: stamp };
      }));
      count = { ...count, families: items.length };
      return patchState(jobId, { stage: "FAMILY_DETAILS", counters: count, cursor: { ...record(current.cursor), page: 0 } });
    }
    if (current.stage === "FAMILY_DETAILS") {
      const items = await store.request<Json[]>("luxalgo_families", { detail_sync_needed: "eq.true", select: "key", order: "key.asc", limit: String(BATCH) });
      if (!items.length) return patchState(jobId, { stage: "TAGS" });
      for (const item of items) {
        const id = safeId(item.key);
        try { if (await syncFamilyDetail(id, options)) changes += 1; count = bump(count, "familyDetails"); }
        catch (error) { const extra = await failure(current, { type: "FAMILY", id, error: errorText(error) }); current = { ...current, ...extra }; await store.request("luxalgo_families", { key: `eq.${id}` }, "PATCH", { detail_sync_needed: false }, "return=minimal"); }
        await delay(120);
      }
      return patchState(jobId, { counters: count, content_changes: changes, retry_queue: current.retry_queue, failed_items: current.failed_items });
    }
    if (current.stage === "TAGS") {
      const raw = record(await luxAlgoMCP.callTool("library_list_tags", {})), items = list(raw.tags), stamp = now();
      await upsert("luxalgo_tags", "id", items.map((item) => ({ id: safeId(item.id), name: maybeText(item.name) ?? text(item.id, 180), attribution: options.preserveAttribution ? "LuxAlgo" : null, license_url: null, license_metadata: {}, raw_response: options.saveRaw ? item : {}, content_hash: digest(item), last_synced_at: stamp, updated_at: stamp })));
      count = { ...count, tags: items.length };
      return patchState(jobId, { stage: "CONCEPT_LIST", counters: count, cursor: { ...record(current.cursor), page: 0 } });
    }
    if (current.stage === "CONCEPT_LIST") {
      const page = integer(record(current.cursor).page), raw = record(await luxAlgoMCP.callTool("library_list_concepts", { page, page_size: PAGE_CONCEPTS }));
      const items = list(raw.concepts), ids = items.map((item) => safeId(item.slug));
      const old = await existing("luxalgo_concepts", "slug", ids, "slug,listing_hash,detail_sync_needed");
      const stamp = now();
      await upsert("luxalgo_concepts", "slug", items.map((item) => {
        const slug = safeId(item.slug), listingHash = digest(item), previous = old.get(slug);
        return { slug, name: maybeText(item.name) ?? slug, family: maybeText(item.family), cluster: maybeText(item.cluster), aliases: Array.isArray(item.aliases) ? item.aliases.map((alias) => text(alias, 200)).filter(Boolean) : [], official_url: maybeText(item.url), listing_response: options.saveRaw ? item : {}, listing_hash: listingHash, detail_sync_needed: current.mode === "FULL" || previous?.detail_sync_needed === true || previous?.listing_hash !== listingHash, last_synced_at: stamp, updated_at: stamp };
      }));
      count = { ...count, conceptsListed: integer(count.conceptsListed) + items.length, conceptsTotal: integer(raw.total) };
      const done = (page + 1) * PAGE_CONCEPTS >= integer(raw.total) || !items.length;
      return patchState(jobId, { stage: done ? "INDICATOR_LIST" : "CONCEPT_LIST", counters: count, cursor: { ...record(current.cursor), page: done ? 0 : page + 1 } });
    }
    if (current.stage === "INDICATOR_LIST") {
      const page = integer(record(current.cursor).page), raw = record(await luxAlgoMCP.callTool("library_list_indicators", { page, page_size: PAGE_INDICATORS, sort: "name", direction: "asc" }));
      const items = list(raw.indicators), ids = items.map((item) => safeId(item.slug));
      const old = await existing("luxalgo_indicators", "slug", ids, "slug,listing_hash,detail_sync_needed,source_sync_needed");
      const stamp = now();
      await upsert("luxalgo_indicators", "slug", items.map((item) => {
        const slug = safeId(item.slug), listingHash = digest(item), previous = old.get(slug);
        return { slug, name: maybeText(item.name) ?? slug, family: maybeText(item.family), description: maybeText(item.description, 20_000), tags: Array.isArray(item.tags) ? item.tags : [], image_url: maybeText(item.image_url, 1000), date_displayed: maybeText(item.date_displayed, 10), official_url: maybeText(item.url, 1000), listing_response: options.saveRaw ? item : {}, listing_hash: listingHash, detail_sync_needed: current.mode === "FULL" || previous?.detail_sync_needed === true || previous?.listing_hash !== listingHash, source_sync_needed: current.mode === "FULL" ? previous?.source_sync_needed === true : previous?.source_sync_needed === true, last_synced_at: stamp, updated_at: stamp };
      }));
      count = { ...count, indicatorsListed: integer(count.indicatorsListed) + items.length, indicatorsTotal: integer(raw.total) };
      const done = (page + 1) * PAGE_INDICATORS >= integer(raw.total) || !items.length;
      return patchState(jobId, { stage: done ? "CONCEPT_DETAILS" : "INDICATOR_LIST", counters: count, cursor: { ...record(current.cursor), page: done ? 0 : page + 1 } });
    }
    if (current.stage === "CONCEPT_DETAILS" || current.stage === "INDICATOR_DETAILS" || current.stage === "SOURCE_CODE") {
      const isConcept = current.stage === "CONCEPT_DETAILS", isSource = current.stage === "SOURCE_CODE";
      const table = isConcept ? "luxalgo_concepts" : "luxalgo_indicators", idColumn = "slug";
      const filter: Record<string, string> = isSource
        ? { source_sync_needed: "eq.true", source_code_available: "eq.true" }
        : { detail_sync_needed: "eq.true" };
      const items = await store.request<Json[]>(table, { ...filter, select: idColumn, order: `${idColumn}.asc`, limit: String(BATCH) });
      if (!items.length) return patchState(jobId, { stage: isConcept ? "INDICATOR_DETAILS" : current.stage === "INDICATOR_DETAILS" ? "SOURCE_CODE" : "COMPLETE" });
      for (const item of items) {
        const id = safeId(item[idColumn]);
        try {
          const changed = isSource ? await syncSource(id, options) : isConcept ? await syncConceptDetail(id, options) : await syncIndicatorDetail(id, options);
          if (changed) changes += 1;
          count = bump(count, isSource ? "sourceFiles" : isConcept ? "conceptDetails" : "indicatorDetails");
        } catch (error) {
          const type: Failure["type"] = isSource ? "SOURCE" : isConcept ? "CONCEPT" : "INDICATOR";
          const extra = await failure(current, { type, id, error: errorText(error) }); current = { ...current, ...extra };
          await store.request(table, { [idColumn]: `eq.${id}` }, "PATCH", isSource ? { source_sync_needed: false } : { detail_sync_needed: false }, "return=minimal");
        }
        await delay(120);
      }
      return patchState(jobId, { counters: count, content_changes: changes, retry_queue: current.retry_queue, failed_items: current.failed_items });
    }
    if (current.stage === "RETRY") {
      const queue = [...(current.retry_queue ?? [])];
      const item = queue.shift();
      if (!item) return complete(current);
      try {
        const changed = item.type === "FAMILY" ? await syncFamilyDetail(item.id, options) : item.type === "CONCEPT" ? await syncConceptDetail(item.id, options) : item.type === "INDICATOR" ? await syncIndicatorDetail(item.id, options) : await syncSource(item.id, options);
        if (changed) changes += 1;
        const remainingFailed = (current.failed_items ?? []).filter((row) => !(row.type === item.type && row.id === item.id));
        return patchState(jobId, { retry_queue: queue, failed_items: remainingFailed, content_changes: changes, counters: bump(count, "retried") });
      } catch (error) {
        const next = { ...item, error: errorText(error), attempts: item.attempts + 1 };
        if (next.attempts < 3) queue.push(next);
        const failed = (current.failed_items ?? []).filter((row) => !(row.type === item.type && row.id === item.id)).concat(next);
        return patchState(jobId, { retry_queue: queue, failed_items: failed, last_error: next.error });
      }
    }
    if (current.stage === "COMPLETE") return complete(current);
    throw new Error(`Unknown LuxAlgo sync stage '${current.stage}'.`);
  } catch (error) {
    return patchState(jobId, { status: "FAILED", last_error: errorText(error) });
  }
}

export async function luxAlgoSyncStatus() {
  const current = await state();
  const store = ScannerStore.service();
  const [families, concepts, indicators, tags, sources] = await Promise.all([
    store.request<Json[]>("luxalgo_families", { select: "key", limit: "1000" }),
    store.request<Json[]>("luxalgo_concepts", { select: "slug", limit: "2000" }),
    store.request<Json[]>("luxalgo_indicators", { select: "slug", limit: "2000" }),
    store.request<Json[]>("luxalgo_tags", { select: "id", limit: "1000" }),
    store.request<Json[]>("luxalgo_source_code", { select: "indicator_slug", limit: "2000" }),
  ]);
  return { state: current, database: { families: families.length, concepts: concepts.length, indicators: indicators.length, tags: tags.length, sourceFiles: sources.length } };
}

export async function luxAlgoLocalOverview() {
  await luxAlgoMCP.discoverTools().catch(() => null);
  const status = await luxAlgoSyncStatus();
  return { ...status, health: luxAlgoMCP.health() };
}

export const luxAlgoSyncInternals = { digest, markdownRelationships, sourceFields, safeId };

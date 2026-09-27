import { ScannerStore } from "../market-brain/store";

type Json = Record<string, unknown>;
const text = (value: unknown, max = 200) => typeof value === "string" ? value.trim().slice(0, max) : "";
const id = (value: unknown) => {
  const clean = text(value, 180);
  return /^[a-z0-9][a-z0-9-]*$/i.test(clean) ? clean : "";
};
const searchTerm = (value: unknown) => text(value).replace(/[^a-z0-9\s/-]/gi, " ").replace(/\s+/g, " ").trim();
const pageNumber = (value: unknown, fallback = 0) => Number.isInteger(Number(value)) ? Math.max(0, Number(value)) : fallback;
const inFilter = (values: string[]) => `in.(${values.join(",")})`;

async function savedIds(identity: { userId: string }, type: "CONCEPT" | "INDICATOR") {
  const rows = await ScannerStore.service().request<Json[]>("luxalgo_saved_items", {
    user_id: `eq.${identity.userId}`, item_type: `eq.${type}`, select: "external_id", limit: "2000",
  });
  return rows.map((row) => id(row.external_id)).filter(Boolean);
}

async function decorate(items: Json[], sourceType: "CONCEPT" | "INDICATOR") {
  const ids = items.map((item) => id(item.slug)).filter(Boolean);
  if (!ids.length) return items;
  const relations = await ScannerStore.service().request<Json[]>("luxalgo_relationships", {
    source_type: `eq.${sourceType}`, source_id: inFilter(ids),
    select: "source_id,relationship_type,target_type,target_id,metadata", limit: "5000",
  });
  const bySource = new Map<string, Json[]>();
  for (const relation of relations) {
    const source = text(relation.source_id);
    bySource.set(source, [...(bySource.get(source) ?? []), relation]);
  }
  return items.map((item) => ({ ...item, relationships: bySource.get(text(item.slug)) ?? [] }));
}

export async function listLocalLuxAlgo(identity: { userId: string }, kind: "concepts" | "indicators", filters: Json) {
  const page = pageNumber(filters.page), pageSize = Math.min(100, Math.max(1, pageNumber(filters.page_size, 24)));
  const query: Record<string, string> = {
    select: kind === "concepts"
      ? "slug,name,family,cluster,aliases,short_description,official_url,attribution,license_url,last_synced_at"
      : "slug,name,author,family,description,tags,platforms,tier,image_url,official_url,source_code_available,attribution,license_url,last_synced_at",
    limit: String(pageSize), offset: String(page * pageSize),
  };
  const family = id(filters.family);
  if (family) query.family = `eq.${family}`;
  const term = searchTerm(filters.q);
  if (term) {
    const pattern = `*${term.replaceAll(" ", "*")}*`;
    query.or = kind === "concepts"
      ? `(name.ilike.${pattern},short_description.ilike.${pattern},cluster.ilike.${pattern})`
      : `(name.ilike.${pattern},description.ilike.${pattern},author.ilike.${pattern})`;
  }
  if (kind === "indicators" && filters.source_code === true) query.source_code_available = "eq.true";
  if (kind === "indicators" && text(filters.platform, 80)) query.platforms = `cs.{${text(filters.platform, 80)}}`;
  if (kind === "indicators" && id(filters.tier)) query.tier = `eq.${id(filters.tier)}`;
  const tag = text(filters.tag, 180);
  if (kind === "indicators" && tag) {
    const relations = await ScannerStore.service().request<Json[]>("luxalgo_relationships", {
      source_type: "eq.INDICATOR", target_type: "eq.TAG", target_id: `eq.${tag}`, select: "source_id", limit: "2000",
    });
    const ids = relations.map((row) => id(row.source_id)).filter(Boolean);
    if (!ids.length) return { items: [], page, pageSize, hasMore: false };
    query.slug = inFilter(ids);
  }
  if (filters.saved === true) {
    const ids = await savedIds(identity, kind === "concepts" ? "CONCEPT" : "INDICATOR");
    if (!ids.length) return { items: [], page, pageSize, hasMore: false };
    const activeIds = query.slug ? new Set(query.slug.replace(/^in\.\(|\)$/g, "").split(",")) : null;
    const narrowed = activeIds ? ids.filter((item) => activeIds.has(item)) : ids;
    if (!narrowed.length) return { items: [], page, pageSize, hasMore: false };
    query.slug = inFilter(narrowed);
  }
  const sort = ["name", "family", "last_synced_at", "date_displayed"].includes(text(filters.sort)) ? text(filters.sort) : "name";
  query.order = `${sort}.${text(filters.direction) === "desc" ? "desc" : "asc"}`;
  const items = await ScannerStore.service().request<Json[]>(kind === "concepts" ? "luxalgo_concepts" : "luxalgo_indicators", query);
  return { items: await decorate(items, kind === "concepts" ? "CONCEPT" : "INDICATOR"), page, pageSize, hasMore: items.length === pageSize };
}

export async function searchLocalLuxAlgo(identity: { userId: string }, query: string, kind: "all" | "concepts" | "indicators" = "all", filters: Json = {}) {
  const tasks: Array<Promise<{ items: Json[] }>> = [];
  if (kind !== "indicators") tasks.push(listLocalLuxAlgo(identity, "concepts", { ...filters, q: query, page_size: 30 }));
  if (kind !== "concepts") tasks.push(listLocalLuxAlgo(identity, "indicators", { ...filters, q: query, page_size: 30 }));
  const groups = await Promise.all(tasks);
  return groups.flatMap((group) => group.items).slice(0, 50);
}

export async function getLocalLuxAlgo(kind: "concept" | "indicator", slugValue: string) {
  const slug = id(slugValue);
  if (!slug) throw new Error("Invalid LuxAlgo identifier.");
  const table = kind === "concept" ? "luxalgo_concepts" : "luxalgo_indicators";
  const rows = await ScannerStore.service().request<Json[]>(table, { slug: `eq.${slug}`, select: "*", limit: "1" });
  if (!rows[0]) return null;
  return (await decorate(rows, kind === "concept" ? "CONCEPT" : "INDICATOR"))[0];
}

export async function getLocalLuxAlgoSource(slugValue: string) {
  const slug = id(slugValue);
  if (!slug) throw new Error("Invalid LuxAlgo identifier.");
  const rows = await ScannerStore.service().request<Json[]>("luxalgo_source_code", { indicator_slug: `eq.${slug}`, select: "*", limit: "1" });
  return rows[0] ?? null;
}

export async function localLuxAlgoTaxonomy() {
  const store = ScannerStore.service();
  const [families, tags] = await Promise.all([
    store.request<Json[]>("luxalgo_families", { select: "key,name,concept_count,official_url,last_synced_at", order: "name.asc", limit: "100" }),
    store.request<Json[]>("luxalgo_tags", { select: "id,name,last_synced_at", order: "name.asc", limit: "500" }),
  ]);
  return { families, tags };
}

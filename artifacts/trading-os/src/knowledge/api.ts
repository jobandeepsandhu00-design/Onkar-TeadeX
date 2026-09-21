import { getAccessToken } from "../api";

export type KnowledgeItem = {
  id: string; kind: string; status: string; title: string; summary: string;
  tags: string[]; symbols: string[]; timeframes: string[]; confidence: number;
  human_verified: boolean; may_influence_production: boolean; source_count: number;
  evidence_count: number; structured_data: Record<string, unknown>; updated_at: string;
};
export type LearningPreferences = Record<string, boolean> & { user_id?: string };
export type KnowledgeDashboard = {
  metrics: Record<string, number>;
  items: KnowledgeItem[];
  jobs: Array<Record<string, unknown>>;
  conflicts: Array<Record<string, unknown>>;
  candidates: Array<Record<string, unknown>>;
  evaluations: Array<Record<string, unknown>>;
  autopsies: Array<Record<string, unknown>>;
  mistakes: Array<Record<string, unknown>>;
  activity: Array<Record<string, unknown>>;
  preferences: LearningPreferences | null;
  generatedAt: string;
};
export type KnowledgeDetail = { item: KnowledgeItem; sources: Array<Record<string, unknown>>; links: Array<Record<string, unknown>> };

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new Error("Please sign in to access Onkar AI knowledge.");
  const response = await fetch(`/api/onkar-ai${path}`, {
    method, signal: AbortSignal.timeout(method === "GET" ? 25_000 : 55_000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => ({ error: "Knowledge service unavailable." }));
  if (!response.ok) throw new Error(payload.error || "Knowledge request failed.");
  return payload as T;
}
export const getKnowledgeDashboard = () => request<KnowledgeDashboard>("/knowledge");
export const syncKnowledge = () => request<Record<string, unknown>>("/knowledge/sync", "POST", {});
export const searchKnowledge = (query: string) => request<{ items: KnowledgeItem[] }>(`/knowledge/search?q=${encodeURIComponent(query)}`);
export const getKnowledgeDetail = (id: string) => request<KnowledgeDetail>(`/knowledge/${encodeURIComponent(id)}`);
export const reviewKnowledge = (id: string, action: "APPROVE" | "REJECT" | "TEST_FIRST") => request<KnowledgeItem>(`/knowledge/${encodeURIComponent(id)}`, "PATCH", { action });
export const retryKnowledgeJob = (id: string) => request<Record<string, unknown>>(`/knowledge/jobs/${encodeURIComponent(id)}/retry`, "POST", {});
export const saveLearningPreferences = (preferences: LearningPreferences) => request<LearningPreferences>("/learning/preferences", "PUT", preferences);

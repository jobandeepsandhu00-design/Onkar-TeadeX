import type { SupabaseIdentity } from "../lib/supabase-auth";
import type {
  CandidateState,
  ScannerConfig,
  StrategyVersion,
} from "@workspace/api-zod";
import type { Analysis } from "./evaluation";

export class ScannerError extends Error {
  constructor(
    message: string,
    public status = 503,
  ) {
    super(message);
  }
}
export class ScannerStore {
  constructor(
    private url: string,
    private key: string,
    private authorization = `Bearer ${key}`,
  ) {}
  static user(identity: SupabaseIdentity) {
    return new ScannerStore(
      identity.supabaseUrl,
      identity.apiKey,
      identity.authorization,
    );
  }
  static service() {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
      key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key || key.startsWith("your_"))
      throw new ScannerError(
        "Scanner backend needs SUPABASE_SERVICE_ROLE_KEY. Existing journal and videos are unaffected.",
      );
    return new ScannerStore(url, key);
  }
  async request<T>(
    table: string,
    query: Record<string, string> = {},
    method = "GET",
    body?: unknown,
    preference?: string,
  ): Promise<T> {
    const endpoint = `${this.url.replace(/\/$/, "")}/rest/v1/${table}?${new URLSearchParams(query)}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(endpoint, {
        method,
        signal: AbortSignal.timeout(12_000),
        headers: {
          apikey: this.key,
          Authorization: this.authorization,
          "Content-Type": "application/json",
          Prefer: preference ?? "return=representation",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (response.ok) {
        const text = await response.text();
        return (text ? JSON.parse(text) : null) as T;
      }
      if (response.status === 409)
        throw new ScannerError(
          "This record already exists. Refresh to see the latest state.",
          409,
        );
      if (attempt < 2 && response.status >= 500 && method === "GET") {
        await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
        continue;
      }
      throw new ScannerError(
        response.status === 404
          ? "Scanner migration is not installed yet."
          : `Scanner database request failed (${response.status}).`,
        response.status === 401 || response.status === 403 ? 403 : 503,
      );
    }
    throw new ScannerError("Scanner database unavailable");
  }
  rpc<T>(name: string, body: unknown) {
    return this.request<T>(`rpc/${name}`, {}, "POST", body);
  }
  async source(userId: string) {
    const rows = await this.request<Array<{ data: Record<string, unknown> }>>(
      "app_state",
      { user_id: `eq.${userId}`, select: "data", limit: "1" },
    );
    return rows[0]?.data ?? {};
  }
}
export type ConfigRow = {
  id: string;
  user_id: string;
  workspace_id: string;
  config: ScannerConfig;
  enabled: boolean;
  cursor: number;
  lease_token: string;
  last_run_at: string | null;
  last_duration_ms: number | null;
  health: Record<string, unknown>;
  last_error: string | null;
};
export type VersionRow = {
  id: string;
  source_setup_id: string;
  name: string;
  definition: StrategyVersion;
  created_at: string;
};
export type CandidateRow = {
  id: string;
  user_id: string;
  config_id: string;
  version_id: string;
  symbol: string;
  timeframe: string;
  state: CandidateState;
  score: number;
  payload: Analysis & {
    historical?: unknown;
    provider?: string;
    strategyName?: string;
    scopeAccountId?: string | null;
    tradingViewEvidence?: Array<{ payload: unknown; created_at: string }>;
  };
  plan: Analysis["risk"] | null;
  fingerprint: string;
  last_candle_at: string;
  expires_at: string;
  created_at?: string;
  updated_at?: string;
};
export const records = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value) ? value.filter((v) => v && typeof v === "object") : [];
export const numeric = (v: unknown): number | null =>
  v === "" || v === null || v === undefined
    ? null
    : Number.isFinite(Number(String(v).replace(",", ".")))
      ? Number(String(v).replace(",", "."))
      : null;

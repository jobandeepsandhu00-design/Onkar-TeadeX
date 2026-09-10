import { scannerToolInputSchema } from "@workspace/api-zod";
import {
  ScannerStore,
  ScannerError,
  type CandidateRow,
  type ConfigRow,
  type VersionRow,
} from "./store";
import { journalSummary } from "./journal";

/** Read-only, user-scoped tools. No raw SQL, user-id arguments, arbitrary URLs or order actions. */
export class ScannerTools {
  readonly executions: Array<{
    name: string;
    status: string;
    latencyMs: number;
  }> = [];
  constructor(
    private store: ScannerStore,
    private config: ConfigRow,
  ) {}
  async execute(input: unknown): Promise<{
    name: string;
    source: "recorded_and_calculated";
    data: unknown;
  }> {
    const args = scannerToolInputSchema.parse(input),
      start = Date.now();
    let data: unknown;
    if (args.name === "get_journal_statistics")
      data = journalSummary(
        await this.store.source(this.config.user_id),
        this.config.config,
      );
    else if (args.name === "get_active_setup_candidates")
      data = (
        await this.store.request<CandidateRow[]>("setup_candidates", {
          user_id: `eq.${this.config.user_id}`,
          config_id: `eq.${this.config.id}`,
          order: "score.desc",
          limit: "20",
          state: "in.(READY,WATCH,DEVELOPING,TRIGGERED)",
        })
      ).map((c) => ({
        id: c.id,
        symbol: c.symbol,
        score: c.score,
        state: c.state,
        dataAt: c.last_candle_at,
        analyzedAt: c.payload.analyzedAt,
        stale: c.payload.stale,
      }));
    else {
      if (!args.candidateId)
        throw new ScannerError("Candidate is required for this tool", 400);
      const [c] = await this.store.request<CandidateRow[]>("setup_candidates", {
        id: `eq.${args.candidateId}`,
        user_id: `eq.${this.config.user_id}`,
        config_id: `eq.${this.config.id}`,
        limit: "1",
      });
      if (!c) throw new ScannerError("Candidate not found", 404);
      switch (args.name) {
        case "get_market_context":
          data = {
            symbol: c.symbol,
            state: c.state,
            score: c.score,
            bias: c.payload.marketBias,
            session: c.payload.session,
            contexts: c.payload.contexts,
            analyzedAt: c.payload.analyzedAt,
            stale:
              c.payload.stale ||
              Date.now() - Date.parse(c.payload.analyzedAt) >
                this.config.config.frequencySeconds * 2000,
          };
          break;
        case "evaluate_setup_rules":
          data = c.payload.rules;
          break;
        case "calculate_risk":
          data = {
            frozenPlan: c.plan,
            latestRisk: c.payload.risk,
            warnings: c.payload.warnings,
          };
          break;
        case "get_historical_matches":
          data = c.payload.historical ?? { sample: 0, unavailable: true };
          break;
        case "get_economic_events":
          data = c.payload.news;
          break;
        case "get_strategy_rules":
          data =
            (
              await this.store.request<VersionRow[]>(
                "scanner_strategy_versions",
                {
                  id: `eq.${c.version_id}`,
                  user_id: `eq.${this.config.user_id}`,
                  limit: "1",
                },
              )
            )[0]?.definition ?? null;
          break;
      }
    }
    // Finite JSON boundary: models never receive runtime objects or unconstrained tool access.
    const serialized = JSON.stringify(data);
    if (serialized === undefined || serialized.length > 90_000)
      throw new ScannerError(
        "Tool context exceeds the safe analysis limit",
        422,
      );
    this.executions.push({
      name: args.name,
      status: "succeeded",
      latencyMs: Date.now() - start,
    });
    return {
      name: args.name,
      source: "recorded_and_calculated",
      data: JSON.parse(serialized),
    };
  }
}

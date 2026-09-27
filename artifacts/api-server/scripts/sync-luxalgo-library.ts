const apiBase = (process.env.LUXALGO_SYNC_API_URL || "http://localhost:3000/api").replace(/\/$/, "");
const token = process.env.LUXALGO_SYNC_ACCESS_TOKEN;
const mode = process.argv.includes("--changes") ? "CHANGES" : "FULL";

if (!token) throw new Error("Set LUXALGO_SYNC_ACCESS_TOKEN to a current private OnkarTradeX user access token.");

async function request(path: string, body?: unknown) {
  const response = await fetch(`${apiBase}/luxalgo${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60_000),
  });
  const data = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

const started = await request("/sync/start", { mode });
let state = started.state;
console.log(`LuxAlgo ${mode} sync ${state.job_id} started.`);

while (state.status === "RUNNING") {
  const result = await request("/sync/step", { jobId: state.job_id });
  state = result.state;
  console.log(JSON.stringify({ status: state.status, stage: state.stage, counters: state.counters, changes: state.content_changes, failed: state.failed_items?.length ?? 0 }));
  if (state.status === "RUNNING") await new Promise((resolve) => setTimeout(resolve, 300));
}

if (state.status !== "COMPLETED") throw new Error(`LuxAlgo sync ended with ${state.status}: ${state.last_error || "unknown error"}`);
console.log(`LuxAlgo sync completed in ${state.last_duration_ms}ms.`);

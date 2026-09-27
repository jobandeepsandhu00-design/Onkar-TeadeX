import assert from "node:assert/strict";
import test from "node:test";
import { LuxAlgoMCPService } from "./mcp-service";

const sse = (data: unknown, status = 200) => new Response(`event: message\ndata: ${JSON.stringify(data)}\n\n`, {
  status, headers: { "content-type": "text/event-stream" },
});

test("discovers only approved public research tools and injects hosted context", async () => {
  const calls: Array<Record<string, any>> = [];
  const fetcher: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)); calls.push(body);
    if (body.method === "tools/list") return sse({ jsonrpc: "2.0", id: body.id, result: { tools: [
      { name: "library_search", inputSchema: { required: ["query", "context"] } },
      { name: "journal_write_note", inputSchema: {} },
      { name: "edge_report", inputSchema: { required: ["preset", "symbol", "context"] } },
    ] } });
    return sse({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: JSON.stringify({ results: [{ slug: "liquidity-sweep" }] }) }] } });
  };
  const service = new LuxAlgoMCPService("https://mcp.luxalgo.com/mcp", fetcher);
  const tools = await service.discoverTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ["edge_report", "library_search"]);
  const result = await service.callTool<any>("library_search", { query: "liquidity" });
  assert.equal(result.results[0].slug, "liquidity-sweep");
  assert.match(calls[1].params.arguments.context, /public technical-analysis research/i);
  assert.equal(service.health().status, "CONNECTED");
});

test("rejects protected or unknown tools before sending a call", async () => {
  let requests = 0;
  const fetcher: typeof fetch = async () => { requests += 1; return sse({ result: { tools: [] }, jsonrpc: "2.0", id: 1 }); };
  const service = new LuxAlgoMCPService("https://mcp.luxalgo.com/mcp", fetcher);
  await assert.rejects(() => service.callTool("journal_write_note", {}), /not permitted/);
  assert.equal(requests, 0);
});

test("reports auth-required without retrying protected challenges", async () => {
  let requests = 0;
  const fetcher: typeof fetch = async () => { requests += 1; return new Response("Unauthorized", { status: 401 }); };
  const service = new LuxAlgoMCPService("https://mcp.luxalgo.com/mcp", fetcher);
  await assert.rejects(() => service.discoverTools(true), /Sign-In Required/);
  assert.equal(requests, 1);
  assert.equal(service.health().status, "AUTH_REQUIRED");
});

test("deduplicates identical in-flight MCP calls", async () => {
  let toolCalls = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.method === "tools/list") return sse({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "library_get_concept", inputSchema: { required: ["slug", "context"] } }] } });
    toolCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return sse({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "{\"slug\":\"bos\"}" }] } });
  };
  const service = new LuxAlgoMCPService("https://mcp.luxalgo.com/mcp", fetcher);
  await Promise.all([service.callTool("library_get_concept", { slug: "bos" }), service.callTool("library_get_concept", { slug: "bos" })]);
  assert.equal(toolCalls, 1);
});

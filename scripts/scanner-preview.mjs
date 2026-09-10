// Development-only component harness. Never included in the production build.
// No authentication, database or provider calls are made by this harness.
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { scannerConfigSchema } from "../lib/api-zod/src/market-brain.ts";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../artifacts/trading-os",
);
const require = createRequire(path.join(root, "package.json"));
const { createServer } = await import(
  pathToFileURL(require.resolve("vite")).href
);
const snapshot = {
  config: null,
  defaults: scannerConfigSchema.parse({}),
  candidates: [],
  versions: [],
  alerts: [],
  runs: [],
  accounts: [
    {
      id: "fixture-account",
      name: "Browser test only",
      currency: "USD",
      type: "Demo",
    },
  ],
  setups: [
    {
      id: "fixture-setup",
      name: "Browser test setup · not saved",
      direction: "long",
    },
  ],
  connection: {
    database: "test_fixture",
    backend: "configured",
    market: "offline",
    worker: "not_running_or_stale",
    mcp: "optional_not_configured",
    execution: "disabled",
  },
  journal: null,
};
const server = await createServer({
  root,
  configFile: false,
  server: { host: "127.0.0.1", port: 5187, strictPort: true },
  resolve: { alias: { "@": path.join(root, "src") } },
  esbuild: { jsx: "automatic" },
  plugins: [
    {
      name: "scanner-test-harness",
      enforce: "pre",
      transform(_code, id) {
        if (id.replaceAll("\\", "/").endsWith("/src/api.ts"))
          return 'export async function getAccessToken(){return "test-fixture-token-not-valid"}';
      },
      resolveId(id, importer) {
        if (id === "virtual:scanner-preview") return "\0scanner-preview";
        if (
          id === "../api" &&
          importer?.replaceAll("\\", "/").includes("/market-brain/")
        )
          return "\0fixture-auth";
      },
      load(id) {
        if (id === "\0fixture-auth")
          return 'export async function getAccessToken(){return "test-fixture-token-not-valid"}';
        if (id === "\0scanner-preview")
          return `import React from 'react';import{createRoot}from'react-dom/client';import MarketBrain from '/src/market-brain/MarketBrain.tsx';createRoot(document.getElementById('root')).render(React.createElement(MarketBrain,{onJournal:()=>{},journalTrades:[]}));`;
      },
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          if (req.url?.startsWith("/api/market-brain")) {
            res.setHeader("Content-Type", "application/json");
            if (req.method === "GET")
              return void res.end(JSON.stringify(snapshot));
            res.statusCode = 503;
            return void res.end(
              JSON.stringify({
                error: "Browser harness: writes are intentionally disabled.",
              }),
            );
          }
          if (req.url === "/")
            return void res.end(
              '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scanner component test</title><style>body{margin:0;padding:16px;background:#050914;font-family:system-ui}*{box-sizing:border-box}#root{max-width:1100px;margin:auto}</style></head><body><p style="color:#fbbf24;text-align:center">DEVELOPMENT TEST · no live data or writes</p><div id="root"></div><script type="module" src="/@vite/client"></script><script type="module" src="/@id/virtual:scanner-preview"></script></body></html>',
            );
          next();
        });
      },
    },
  ],
});
await server.listen();
console.log(
  "Scanner component harness: http://127.0.0.1:5187 (test fixtures only)",
);

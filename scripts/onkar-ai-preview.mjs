// Isolated UI preview: no auth replacement, account mutation, or production API requests.
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../artifacts/trading-os",
);
const require = createRequire(path.join(root, "package.json"));
const { createServer, transformWithEsbuild } = await import(
  pathToFileURL(require.resolve("vite")).href
);
const tailwind = (
  await import(pathToFileURL(require.resolve("@tailwindcss/vite")).href)
).default;
const server = await createServer({
  root,
  configFile: false,
  resolve: { alias: { "@": path.join(root, "src") } },
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 5188, strictPort: true },
  plugins: [
    tailwind(),
    {
      name: "onkar-ai-design-preview",
      transform(code, id) {
        if (id === "\0onkar-ai-preview.tsx")
          return transformWithEsbuild(code, "preview.tsx", {
            loader: "tsx",
            jsx: "automatic",
          });
      },
      resolveId(id) {
        if (id === "virtual:onkar-ai-preview") return "\0onkar-ai-preview.tsx";
      },
      load(id) {
        if (id === "\0onkar-ai-preview.tsx")
          return `import React,{useState,useEffect} from 'react';import{createRoot}from'react-dom/client';import Workspace from '/src/onkar-ai/OnkarAIWorkspace.tsx';import {OnkarAIRecentSlider}from'/src/onkar-ai/RecentSlider.tsx';import{OnkarAIEntryButton}from'/src/onkar-ai/ui.tsx';import'/src/index.css';function Preview(){const[path,setPath]=useState(location.pathname);useEffect(()=>{const sync=()=>setPath(location.pathname);addEventListener('popstate',sync);return()=>removeEventListener('popstate',sync)},[]);const navigate=p=>{history.pushState({},'',p);setPath(p);scrollTo(0,0)};return path.startsWith('/onkar-ai')?<Workspace path={path} onNavigate={navigate} onExit={()=>navigate('/')} accountName="Preview account"/>:<div style={{maxWidth:1500,margin:'auto',padding:24}} className="oai"><header style={{display:'flex',alignItems:'center',gap:12,marginBottom:22}}><img src="/onkar-tradex-logo.png" style={{width:38}}/><h1 style={{fontSize:21}}>OnkarTradex · Dashboard preview</h1></header><OnkarAIEntryButton onClick={()=>navigate('/onkar-ai')}/><div style={{marginTop:24}}><OnkarAIRecentSlider onNavigate={navigate}/></div><p style={{color:'#879db9',padding:24}}>Your existing dashboard widgets remain unchanged in the app. This isolated preview shows only the new UI.</p></div>};createRoot(document.getElementById('root')).render(<Preview/>);`;
      },
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          if (req.url?.startsWith("/api/")) {
            res.statusCode = 503;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                error:
                  "Isolated design preview: connected backend unavailable here. Use the authenticated app.",
              }),
            );
            return;
          }
          if (
            req.url === "/" ||
            /^\/onkar-ai(?:\/[^.?]*)?(?:\?.*)?$/.test(req.url ?? "")
          ) {
            res.setHeader("Content-Type", "text/html");
            res.end(
              '<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Onkar AI — UI preview</title><style>body{margin:0;background:#060c17}</style></head><body><div id="root"></div><script type="module" src="/@vite/client"></script><script type="module" src="/@id/virtual:onkar-ai-preview"></script></body></html>',
            );
            return;
          }
          next();
        });
      },
    },
  ],
});
await server.listen();
console.log("Onkar AI UI preview: http://127.0.0.1:5188/onkar-ai");

import React from "react";
import { createRoot } from "react-dom/client";
import Jarvis from "./Jarvis";
import { installJarvisBridge } from "./app-bridge";
if (
  !import.meta.env.DEV ||
  !["localhost", "127.0.0.1"].includes(location.hostname)
)
  throw new Error("This fixture is local-development only.");
const originalFetch = window.fetch;
window.fetch = (input, options) => {
  const url = String(input);
  if (/\/api\/|supabase\./.test(url))
    return Promise.reject(new Error("Isolated QA: backend calls disabled."));
  return originalFetch(input, options);
};
let page = "TradeX / home";
installJarvisBridge({
  navigate(destination) {
    page =
      destination === "tradex" ? "TradeX / home" : `/onkar-ai/${destination}`;
  },
  context: () => ({ page, account: null, accountId: null }),
  hasPendingSave: () => false,
});
createRoot(document.getElementById("jarvis-qa")!).render(
  <React.StrictMode>
    <Jarvis />
  </React.StrictMode>,
);

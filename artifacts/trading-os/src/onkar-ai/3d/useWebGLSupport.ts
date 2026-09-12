import { useEffect, useState } from "react";

type WebGLSupport = "checking" | "supported" | "unsupported";

let cachedSupport: Exclude<WebGLSupport, "checking"> | null = null;

export function useWebGLSupport() {
  const [support, setSupport] = useState<WebGLSupport>(cachedSupport ?? "checking");

  useEffect(() => {
    if (cachedSupport) {
      setSupport(cachedSupport);
      return;
    }

    try {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("webgl2", { powerPreference: "low-power" })
        ?? canvas.getContext("webgl", { powerPreference: "low-power" });
      cachedSupport = context ? "supported" : "unsupported";
    } catch {
      cachedSupport = "unsupported";
    }
    setSupport(cachedSupport);
  }, []);

  return support;
}


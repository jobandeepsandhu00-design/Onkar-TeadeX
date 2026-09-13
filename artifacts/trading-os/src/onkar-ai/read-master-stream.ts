import {
  masterStreamEventSchema,
  type AgentProgressEvent,
  type MasterAIResponse,
} from "@workspace/api-zod";

export async function readMasterStream(
  body: ReadableStream<Uint8Array>,
  onProgress?: (event: AgentProgressEvent) => void,
): Promise<MasterAIResponse> {
  const reader = body.getReader(),
    decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 2_000_000)
        throw new Error("Analysis response exceeded the safe size limit.");
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const raw = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!raw) continue;
        const parsed = masterStreamEventSchema.safeParse(JSON.parse(raw));
        if (!parsed.success)
          throw new Error("Invalid analysis response. Please retry.");
        const event = parsed.data;
        if (event.type === "error") throw new Error(event.error);
        if (event.type === "result") return event.data;
        onProgress?.(event);
      }
      if (done)
        throw new Error(
          "Analysis connection ended before completion. Please retry.",
        );
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

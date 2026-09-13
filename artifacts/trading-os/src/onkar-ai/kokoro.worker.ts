/// <reference lib="webworker" />

import { KokoroTTS } from "kokoro-js";
import { kokoroRuntimeAttempts } from "./kokoro-runtime";

type KokoroDevice = "webgpu" | "wasm";
type RequestMessage =
  | { type: "load"; id: string }
  | {
      type: "generate";
      id: string;
      text: string;
      voice: string;
      speed: number;
    };

type Runtime = {
  device: KokoroDevice;
  tts: Awaited<ReturnType<typeof KokoroTTS.from_pretrained>>;
};

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
let runtimePromise: Promise<Runtime> | null = null;

function progressValue(item: unknown) {
  if (!item || typeof item !== "object" || !("progress" in item))
    return undefined;
  return typeof item.progress === "number" ? item.progress : undefined;
}

function report(
  id: string,
  phase: "loading" | "fallback",
  device: KokoroDevice,
  progress?: number,
) {
  self.postMessage({ type: "status", id, phase, device, progress });
}

async function createRuntime(id: string): Promise<Runtime> {
  const attempts = kokoroRuntimeAttempts("gpu" in navigator);
  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      report(
        id,
        attempt.device === "wasm" && lastError ? "fallback" : "loading",
        attempt.device,
        0,
      );
      const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
        device: attempt.device,
        dtype: attempt.dtype,
        progress_callback: (item) =>
          report(id, "loading", attempt.device, progressValue(item)),
      });
      return { device: attempt.device, tts };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("No compatible local Kokoro runtime is available.");
}

function runtime(id: string) {
  return (runtimePromise ??= createRuntime(id).catch((error) => {
    runtimePromise = null;
    throw error;
  }));
}

self.onmessage = async (event: MessageEvent<RequestMessage>) => {
  const message = event.data;
  try {
    const loaded = await runtime(message.id);
    if (message.type === "load") {
      self.postMessage({
        type: "ready",
        id: message.id,
        device: loaded.device,
      });
      return;
    }

    const audio = await loaded.tts.generate(message.text, {
      voice: message.voice as Parameters<
        typeof loaded.tts.generate
      >[1] extends {
        voice?: infer Voice;
      }
        ? Voice
        : never,
      speed: message.speed,
    });
    const buffer = await audio.toBlob().arrayBuffer();
    self.postMessage(
      { type: "audio", id: message.id, device: loaded.device, buffer },
      [buffer],
    );
  } catch (error) {
    self.postMessage({
      type: "error",
      id: message.id,
      message:
        error instanceof Error
          ? error.message
          : "Kokoro voice could not generate audio.",
    });
  }
};

export {};

import test from "node:test";
import assert from "node:assert/strict";
import { localSpeechAvailable, createJarvisMicrophone } from "./speech";

test("unsupported local recognition never silently falls back to remote wake", async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  let starts = 0;
  class RemoteOnly {
    start() {
      starts++;
    }
  }
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { SpeechRecognition: RemoteOnly, isSecureContext: true },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  });
  assert.equal(await localSpeechAvailable(), false);
  const mic = createJarvisMicrophone({
    transcript() {},
    state() {},
    blocked: () => false,
  });
  await assert.rejects(mic.start("local-wake"), /unavailable/);
  assert.equal(starts, 0);
});
test("local wake has explicit local processing, one microphone lock, playback guard and stop", async (t) => {
  const saved = ["window", "navigator", "document"].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  t.after(() => {
    for (const [key, value] of saved) {
      if (value) Object.defineProperty(globalThis, key, value);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  let current: Local | null = null,
    locked = false,
    blocked = false,
    received = 0,
    starts = 0;
  class Local {
    processLocally = false;
    onresult: any;
    onstart: any;
    onend: any;
    onerror: any;
    static async available() {
      return "available";
    }
    start() {
      assert.equal(this.processLocally, true);
      starts++;
      current = this;
      this.onstart?.();
    }
    abort() {
      this.onend?.();
    }
  }
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { SpeechRecognition: Local, isSecureContext: true },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { hidden: false },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      locks: {
        async request(
          _name: string,
          _opts: unknown,
          callback: (lock: unknown) => Promise<void>,
        ) {
          if (locked) return callback(null);
          locked = true;
          try {
            await callback({});
          } finally {
            locked = false;
          }
        },
      },
    },
  });
  const callbacks = {
    transcript() {
      received++;
    },
    state() {},
    blocked: () => blocked,
  };
  const mic = createJarvisMicrophone(callbacks),
    second = createJarvisMicrophone(callbacks);
  await mic.start("local-wake");
  assert.equal(starts, 1);
  await assert.rejects(second.start("local-wake"), /another tab/);
  const event = {
    resultIndex: 0,
    results: [
      {
        isFinal: true,
        0: { transcript: "Jarvis open scanner", confidence: 1 },
      },
    ],
  };
  (current as unknown as Local).onresult(event);
  assert.equal(received, 1);
  blocked = true;
  (current as unknown as Local).onresult(event);
  assert.equal(received, 1);
  mic.stop();
  blocked = false;
  (current as unknown as Local).onresult(event);
  assert.equal(received, 1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(locked, false);
});

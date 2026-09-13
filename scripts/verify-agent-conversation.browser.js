// Isolated UI integration test: fixture stream + simulated device voice, NEVER production.
(async () => {
  if (
    location.origin !== "http://127.0.0.1:5188" ||
    !location.pathname.endsWith("/assistant")
  )
    throw new Error("Open the local preview assistant first");
  const { supabase } = await import("/src/api.ts");
  const { agentRuntime, AGENT_IDS } =
    await import("/src/onkar-ai/agent-runtime.ts");
  const { agentVoice } = await import("/src/onkar-ai/agent-voice.ts");
  const original = {
    fetch: window.fetch,
    session: supabase.auth.getSession,
    speak: speechSynthesis.speak,
    cancel: speechSynthesis.cancel,
    settings: agentVoice.getSnapshot().settings,
  };
  let utterance = null,
    voiceStarts = 0,
    failure = false;
  const check = (ok, message) => {
    if (!ok) throw new Error(message);
  };
  const until = async (condition) => {
    for (let i = 0; i < 100; i++) {
      if (condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("UI test timed out");
  };
  const button = (text) =>
    [...document.querySelectorAll("button")].find(
      (node) => node.textContent.trim() === text,
    );
  try {
    supabase.auth.getSession = async () => ({
      data: { session: { access_token: "LOCAL_TEST_ONLY" } },
      error: null,
    });
    speechSynthesis.speak = (next) => {
      utterance = next;
      voiceStarts++;
      next.onstart?.(new Event("start"));
    };
    speechSynthesis.cancel = () => {};
    agentVoice.configure({ enabled: true, autoSpeak: false, volume: 0.8 });
    window.fetch = async (url, init) => {
      if (url !== "/api/onkar-ai/master") return original.fetch(url, init);
      if (failure)
        return new Response(JSON.stringify({ error: "Fixture failure" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      const runId = "76129217-b596-4fb7-b7ae-cf811820ca20",
        timestamp = new Date().toISOString();
      const result = {
        runId,
        intent: "journal_review",
        answer:
          "Fixture report: no real trading data was used in this UI test.",
        dataStatus: "unavailable",
        agents: [],
        commandLog: [],
        usage: { model: null, inputTokens: 0, outputTokens: 0 },
        animationStates: Object.fromEntries(
          AGENT_IDS.map((id) => [id, "idle"]),
        ),
      };
      const events = [
        ["master", "thinking"],
        ["journal", "reviewing"],
        ["journal", "success"],
        ["insight", "unavailable"],
        ["master", "idle"],
      ].map(([agent, state]) => ({
        type: "agent-state",
        runId,
        timestamp,
        agent,
        state,
      }));
      events.push({ type: "result", data: result });
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream({
          async start(controller) {
            for (const event of events) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
              );
              await new Promise((resolve) => setTimeout(resolve, 90));
            }
            controller.close();
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    };
    button("Analyze my trading performance").click();
    await until(() => document.body.textContent.includes("Fixture report:"));
    check(voiceStarts === 0, "Auto speak must default OFF");
    check(
      agentRuntime.snapshot("master").state === "idle",
      "Completed report must not imply speaking",
    );
    button("Read response aloud").click();
    await until(() => agentRuntime.snapshot("master").isSpeaking);
    check(
      document.querySelector(".oai-assistant-agent-presence .oai-robot-avatar")
        .dataset.state === "speaking",
      "Voice must animate Master",
    );
    utterance.onend?.(new Event("end"));
    await until(() => !agentRuntime.snapshot("master").isSpeaking);
    const selector = document.querySelector('[aria-label="Response agent"]');
    selector.value = "insight";
    selector.dispatchEvent(new Event("change", { bubbles: true }));
    await until(
      () =>
        document.querySelector(
          ".oai-assistant-agent-presence .oai-robot-avatar",
        ).dataset.agent === "insight",
    );
    button("Read response aloud").click();
    await until(() => agentRuntime.snapshot("insight").isSpeaking);
    button("Stop voice").click();
    await until(() => !agentRuntime.snapshot("insight").isSpeaking);
    failure = true;
    button("Analyze my trading performance").click();
    await until(() => document.body.textContent.includes("Fixture failure"));
    check(
      !agentRuntime.snapshot("master").isWorking,
      "Error must end work state",
    );
    return {
      fixture: true,
      realBackend: false,
      masterRequestToIdle: true,
      autoSpeakOff: true,
      masterSpeakingAndEnded: true,
      insightSpeakingAndStopped: true,
      errorRecovery: true,
    };
  } finally {
    agentVoice.stop();
    agentVoice.configure(original.settings);
    agentRuntime.reset();
    window.fetch = original.fetch;
    supabase.auth.getSession = original.session;
    speechSynthesis.speak = original.speak;
    speechSynthesis.cancel = original.cancel;
  }
})();

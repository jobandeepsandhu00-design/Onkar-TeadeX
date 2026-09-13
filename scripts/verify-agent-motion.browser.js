// Run ONLY in the isolated localhost UI preview via agent-browser eval --stdin.
// Exercises real components/state with explicitly synthetic lifecycle events; no API calls.
(async () => {
  if (location.hostname !== "127.0.0.1" || location.port !== "5188")
    throw new Error("Use the isolated preview, never production.");
  const { agentRuntime, AGENT_IDS } =
    await import("/src/onkar-ai/agent-runtime.ts");
  const frame = () => new Promise((resolve) => setTimeout(resolve, 45));
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const roots = () => [
    ...document.querySelectorAll(".oai-agent-grid .oai-robot-avatar"),
  ];
  check(roots().length === 10, "All ten grid avatars must be rendered");
  check(
    roots().every(
      (node) => node.querySelectorAll(".oai-eye-aperture").length === 2,
    ),
    "Each avatar needs two actual eye masks",
  );
  const states = [
    "idle",
    "thinking",
    "scanning",
    "speaking",
    "success",
    "warning",
    "alert",
    "offline",
  ];
  agentRuntime.begin("browser-test");
  for (const state of states) {
    for (const id of AGENT_IDS) agentRuntime.event("browser-test", id, state);
    await frame();
    check(
      roots().every((node) => node.dataset.state === state),
      `State failed: ${state}`,
    );
  }
  agentRuntime.reset();
  await frame();
  check(
    roots().every((node) => node.dataset.state === "idle"),
    "Reset must return preview poses",
  );
  agentRuntime.speaking("insight", true);
  await frame();
  check(
    roots().filter((node) => node.dataset.state === "speaking").length === 1,
    "Exactly one speaking avatar",
  );
  agentRuntime.speaking("master", true);
  await frame();
  check(
    roots().filter((node) => node.dataset.state === "speaking").length === 1,
    "Voice handoff cannot overlap",
  );
  agentRuntime.reset();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "hidden",
  });
  document.dispatchEvent(new Event("visibilitychange"));
  await frame();
  check(
    roots().every((node) => node.dataset.paused === "true"),
    "Hidden tab must pause all avatars",
  );
  delete document.visibilityState;
  document.dispatchEvent(new Event("visibilitychange"));
  await frame();
  const svgIds = [
    ...document.querySelectorAll(".oai-robot-eye-svg clipPath"),
  ].map((node) => node.id);
  check(
    new Set(svgIds).size === svgIds.length,
    "Eye mask IDs must remain unique",
  );
  check(
    document.documentElement.scrollWidth <= innerWidth + 1,
    "Page must not overflow horizontally",
  );
  return {
    agents: roots().length,
    statesPerAgent: states.length,
    twoEyesEach: true,
    oneSpeaker: true,
    hiddenPause: true,
    uniqueMasks: true,
    pageOverflow: false,
    testData: "Synthetic lifecycle events only; no live market/backend claim",
  };
})();

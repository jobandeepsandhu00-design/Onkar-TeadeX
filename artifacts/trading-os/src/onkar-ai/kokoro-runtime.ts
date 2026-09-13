export type KokoroRuntimeAttempt = {
  device: "webgpu" | "wasm";
  dtype: "fp32" | "q8";
};

export function kokoroRuntimeAttempts(
  hasWebGpu: boolean,
): KokoroRuntimeAttempt[] {
  return [
    ...(hasWebGpu ? ([{ device: "webgpu", dtype: "fp32" }] as const) : []),
    { device: "wasm", dtype: "q8" },
  ];
}

import { useEffect, useRef } from "react";

type AudioGraph = {
  context: AudioContext;
  analyser: AnalyserNode;
  values: Uint8Array<ArrayBuffer>;
};

const graphs = new WeakMap<HTMLMediaElement, AudioGraph>();

export function useAgentAudioLevel(
  audioElement: HTMLMediaElement | null | undefined,
  enabled: boolean,
) {
  const level = useRef(0);

  useEffect(() => {
    if (!audioElement || !enabled || typeof window === "undefined" || !window.AudioContext) {
      level.current = 0;
      return;
    }

    let frame = 0;
    let graph = graphs.get(audioElement);
    const start = () => {
      try {
        if (!graph) {
          const context = new AudioContext();
          const analyser = context.createAnalyser();
          analyser.fftSize = 64;
          const source = context.createMediaElementSource(audioElement);
          source.connect(analyser);
          analyser.connect(context.destination);
          graph = { context, analyser, values: new Uint8Array(analyser.frequencyBinCount) };
          graphs.set(audioElement, graph);
        }
        void graph.context.resume();
        const sample = () => {
          if (!graph || audioElement.paused) return;
          graph.analyser.getByteFrequencyData(graph.values);
          const total = graph.values.reduce((sum, value) => sum + value, 0);
          level.current = Math.min(1, total / graph.values.length / 150);
          frame = window.requestAnimationFrame(sample);
        };
        sample();
      } catch {
        level.current = 0.25;
      }
    };
    const stop = () => {
      window.cancelAnimationFrame(frame);
      level.current = 0;
    };

    audioElement.addEventListener("play", start);
    audioElement.addEventListener("pause", stop);
    audioElement.addEventListener("ended", stop);
    if (!audioElement.paused) start();
    return () => {
      stop();
      audioElement.removeEventListener("play", start);
      audioElement.removeEventListener("pause", stop);
      audioElement.removeEventListener("ended", stop);
    };
  }, [audioElement, enabled]);

  return level;
}


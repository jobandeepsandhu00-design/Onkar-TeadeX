import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

type MotionPermission = "available" | "enabled" | "denied" | "unavailable";
type OrientationWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

const clamp = (value: number) => Math.max(-1, Math.min(1, value));

/** Transient motion never enters form state or causes per-frame React renders. */
export function useLoginMotion(rootRef: RefObject<HTMLDivElement | null>) {
  const [deviceMotion, setDeviceMotion] =
    useState<MotionPermission>("unavailable");
  const sensorEnabled = useRef(false);
  const resetSensor = useRef<() => void>(() => {});

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection;
    const saveData = Boolean(connection?.saveData);
    let frame = 0;
    let previousTime = 0;
    let x = 0;
    let y = 0;
    let targetX = 0;
    let targetY = 0;
    let sensorBaseline: { beta: number; gamma: number } | null = null;
    let focused = document.hasFocus();
    const permitted = () => !reduced.matches && !saveData;
    const active = () => permitted() && !document.hidden && focused;

    const paint = () => {
      root.style.setProperty("--login-tilt-x", `${(-y * 3).toFixed(3)}deg`);
      root.style.setProperty("--login-tilt-y", `${(x * 3).toFixed(3)}deg`);
      root.style.setProperty("--login-depth-x", `${(x * 7).toFixed(2)}px`);
      root.style.setProperty("--login-depth-y", `${(y * 5).toFixed(2)}px`);
    };
    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      previousTime = 0;
      x = y = targetX = targetY = 0;
      sensorBaseline = null;
      paint();
    };
    const tick = (time: number) => {
      frame = 0;
      if (!active()) return;
      const elapsed = previousTime ? Math.min(time - previousTime, 40) : 16;
      previousTime = time;
      const ease = 1 - Math.exp(-elapsed / 90);
      x += (targetX - x) * ease;
      y += (targetY - y) * ease;
      paint();
      if (Math.abs(targetX - x) + Math.abs(targetY - y) > 0.001)
        frame = requestAnimationFrame(tick);
      else previousTime = 0;
    };
    const move = (nextX: number, nextY: number) => {
      if (!active()) return;
      targetX = clamp(nextX);
      targetY = clamp(nextY);
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const pointerMove = (event: PointerEvent) => {
      if (
        sensorEnabled.current ||
        !finePointer.matches ||
        event.pointerType !== "mouse"
      )
        return;
      move(
        (event.clientX / window.innerWidth - 0.5) * 2,
        (event.clientY / window.innerHeight - 0.5) * 2,
      );
    };
    const pointerLeave = () => move(0, 0);
    const orientation = (event: DeviceOrientationEvent) => {
      if (!sensorEnabled.current || !active()) return;
      if (event.beta === null || event.gamma === null) return;
      if (!Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return;
      sensorBaseline ??= { beta: event.beta, gamma: event.gamma };
      const angle = window.screen.orientation?.angle ?? 0;
      const horizontal = (event.gamma - sensorBaseline.gamma) / 18;
      const vertical = (event.beta - sensorBaseline.beta) / 18;
      if (Math.abs(angle) === 90)
        move(
          angle > 0 ? vertical : -vertical,
          angle > 0 ? -horizontal : horizontal,
        );
      else move(horizontal, vertical);
    };
    const sync = () => {
      root.dataset.motionPaused = String(!active());
      root.dataset.motionReduced = String(!permitted());
      if (!active()) stop();
      if (!permitted()) {
        sensorEnabled.current = false;
        setDeviceMotion("unavailable");
      } else if (
        window.isSecureContext &&
        navigator.maxTouchPoints > 0 &&
        "DeviceOrientationEvent" in window
      ) {
        setDeviceMotion(sensorEnabled.current ? "enabled" : "available");
      }
    };
    const blur = () => {
      focused = false;
      sync();
    };
    const focus = () => {
      focused = true;
      sync();
    };
    resetSensor.current = stop;
    sync();
    root.addEventListener("pointermove", pointerMove, { passive: true });
    root.addEventListener("pointerleave", pointerLeave, { passive: true });
    window.addEventListener("deviceorientation", orientation, {
      passive: true,
    });
    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);
    window.addEventListener("orientationchange", stop);
    document.addEventListener("visibilitychange", sync);
    reduced.addEventListener("change", sync);
    return () => {
      stop();
      resetSensor.current = () => {};
      root.removeEventListener("pointermove", pointerMove);
      root.removeEventListener("pointerleave", pointerLeave);
      window.removeEventListener("deviceorientation", orientation);
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
      window.removeEventListener("orientationchange", stop);
      document.removeEventListener("visibilitychange", sync);
      reduced.removeEventListener("change", sync);
    };
  }, [rootRef]);

  const toggleDeviceMotion = useCallback(async () => {
    if (deviceMotion === "enabled") {
      sensorEnabled.current = false;
      resetSensor.current();
      setDeviceMotion("available");
      return;
    }
    try {
      const orientation =
        window.DeviceOrientationEvent as OrientationWithPermission;
      // iOS asks only after this explicit button press, never during page load.
      const permission = await orientation.requestPermission?.();
      if (permission === "denied") {
        setDeviceMotion("denied");
        return;
      }
      sensorEnabled.current = true;
      resetSensor.current();
      setDeviceMotion("enabled");
    } catch {
      setDeviceMotion("denied");
    }
  }, [deviceMotion]);

  return { deviceMotion, toggleDeviceMotion };
}

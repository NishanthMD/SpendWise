import { useEffect, useLayoutEffect, useRef, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** True when the visitor asked the OS for less motion. Updates live if they change it. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => (typeof matchMedia === "undefined" ? false : matchMedia(QUERY).matches));
  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const mq = matchMedia(QUERY);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

const easeOutCubic = (p) => 1 - Math.pow(1 - p, 3);

/**
 * Animates from 0 up to `target` with an ease-out curve every time `target` or `resetKey` changes.
 * With reduced motion it returns the final value straight away.
 */
export function useAnimatedValue(target, { duration = 1100, delay = 0, resetKey } = {}) {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(reduced ? target : 0);
  useEffect(() => {
    if (reduced) {
      setValue(target);
      return undefined;
    }
    let raf;
    const t0 = performance.now() + delay;
    setValue(0);
    const tick = (now) => {
      const p = Math.min(1, Math.max(0, (now - t0) / duration));
      setValue(target * easeOutCubic(p));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, resetKey, reduced, duration, delay]);
  return value;
}

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** Progress 0..1 (eased) of a stage that starts `delay` ms into the clock and lasts `duration` ms. */
export const stage = (t, delay, duration) => easeOutCubic(clamp((t - delay) / duration, 0, 1));

/**
 * A clock in ms that runs from 0 to `endMs` and restarts whenever `resetKey` changes, so several rings and
 * numbers can share one timeline. With reduced motion it sits at the end straight away.
 */
export function useClock(resetKey, endMs) {
  const reduced = useReducedMotion();
  const [t, setT] = useState(reduced ? endMs : 0);
  useEffect(() => {
    if (reduced) {
      setT(endMs);
      return undefined;
    }
    let raf;
    const t0 = performance.now();
    setT(0);
    const tick = (now) => {
      const e = Math.min(endMs, now - t0);
      setT(e);
      if (e < endMs) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [resetKey, reduced, endMs]);
  return t;
}

/** Width of an element in px, kept current with a ResizeObserver. */
export function useElementWidth(ref, fallback = 600) {
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const read = () => setWidth(Math.max(240, Math.round(el.getBoundingClientRect().width)));
    read();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/** Remembers the previous value of something between renders. */
export function usePrevious(value) {
  const ref = useRef();
  useEffect(() => {
    ref.current = value;
  });
  return ref.current;
}

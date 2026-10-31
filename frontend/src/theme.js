import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

/* "system" follows the device; "light" and "dark" are your choice. The resolved value (light or dark) is written to
 * <html data-theme> so the stylesheet only ever has two palettes. index.html does the same before first paint. */
const KEY = "sw-theme";
const QUERY = "(prefers-color-scheme: dark)";

export const readPref = () => {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
};

const resolve = (pref) => (pref === "system" ? (typeof matchMedia !== "undefined" && matchMedia(QUERY).matches ? "dark" : "light") : pref);

export function useTheme() {
  const [pref, setPref] = useState(readPref); // what the switch shows (moves the moment you tap)
  const [applied, setApplied] = useState(pref); // what the page is actually using
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme = resolve(applied);
    };
    apply();
    try {
      localStorage.setItem(KEY, applied);
    } catch {
      /* storage can be blocked; the choice then lasts for this visit only */
    }
    if (applied !== "system" || typeof matchMedia === "undefined") return undefined;
    const mq = matchMedia(QUERY);
    mq.addEventListener("change", apply); // Auto keeps following the device
    return () => mq.removeEventListener("change", apply);
  }, [applied]);

  // The switch's thumb slides first; then the whole page cross-fades as one picture so text and background change together.
  const change = (next) => {
    setPref(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const run = () => {
        document.documentElement.dataset.theme = resolve(next);
        flushSync(() => setApplied(next));
      };
      const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (document.startViewTransition && !reduced) document.startViewTransition(run);
      else run();
    }, 320);
  };
  return [pref, change];
}

import { useLayoutEffect, useRef, useState } from "react";
import { haptic } from "./haptics.js";
import { useLang } from "./i18n.jsx";

/** The section tabs with one highlight that slides to the chosen tab. Used in the page and in the bar that drops down on scroll. */
export default function TabBar({ tabs, tab, onTab, badges = {}, className = "", focusable = true }) {
  const { t, lang } = useLang();
  const ref = useRef(null);
  const [thumb, setThumb] = useState(null);

  useLayoutEffect(() => {
    const nav = ref.current;
    if (!nav) return undefined;
    const measure = () => {
      const el = nav.querySelector(".tab.on");
      if (el) setThumb((p) => (p && p.x === el.offsetLeft && p.w === el.offsetWidth ? p : { x: el.offsetLeft, w: el.offsetWidth }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    nav.querySelectorAll(".tab").forEach((b) => ro.observe(b));
    if (document.fonts?.ready) document.fonts.ready.then(measure);
    return () => ro.disconnect();
  }, [tab, lang]);

  return (
    <nav className={"tabs " + className} aria-label={t("Sections")} ref={ref} style={thumb ? { "--x": thumb.x + "px", "--w": thumb.w + "px" } : undefined}>
      {thumb && <span className="tab-thumb" aria-hidden="true" />}
      {tabs.map(([id, label]) => (
        <button key={id} className={"tab" + (tab === id ? " on" : "")} aria-current={tab === id ? "page" : undefined} tabIndex={focusable ? 0 : -1} onClick={() => {
            if (tab !== id) haptic();
            onTab(id);
          }}>
          {t(label)}
          {badges[id] > 0 && <span className="badge">{badges[id]}</span>}
        </button>
      ))}
    </nav>
  );
}

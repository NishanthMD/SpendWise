import { useEffect, useState } from "react";
import TabBar from "./TabBar.jsx";

let lockedUntil = 0;
let lockedTo = false;
let apply = () => {};
/** Force the bar shown or hidden for a moment, ignoring scrolling (used while the page glides to a newly chosen section). */
export const holdDash = (ms, shown) => {
  lockedUntil = performance.now() + ms;
  lockedTo = shown;
  apply(shown);
};

/** True while the page is being scrolled down (past `min` pixels); false near the top and as soon as you scroll up. */
function useScrollingDown(min = 260, delta = 6) {
  const [down, setDown] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    let ticking = false;
    apply = setDown;
    const run = () => {
      ticking = false;
      const y = window.scrollY;
      if (performance.now() < lockedUntil) {
        last = y;
        setDown(lockedTo);
        return;
      }
      if (y < min) setDown(false);
      else if (y > last + delta) setDown(true);
      else if (y < last - delta) setDown(false);
      if (Math.abs(y - last) > delta) last = y;
    };
    const on = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(run);
      }
    };
    window.addEventListener("scroll", on, { passive: true });
    return () => {
      window.removeEventListener("scroll", on);
      apply = () => {};
    };
  }, [min, delta]);
  return down;
}

/** The same tab bar as the page, pinned: it drops down when you scroll down and slides away when you scroll up. */
export default function StickyDash({ tabs, tab, onTab, badges }) {
  const show = useScrollingDown();
  // While this bar is down, the page's own copy of the tabs is hidden, so you never see two at once.
  useEffect(() => {
    document.documentElement.classList.toggle("dash-on", show);
    return () => document.documentElement.classList.remove("dash-on");
  }, [show]);
  return (
    <div className={"sticky-dash" + (show ? " show" : "")} aria-hidden={!show} inert={!show ? "" : undefined}>
      <TabBar tabs={tabs} tab={tab} onTab={onTab} badges={badges} focusable={show} />
    </div>
  );
}

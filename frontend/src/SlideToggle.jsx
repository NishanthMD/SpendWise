/* A segmented control whose highlight slides (with a little spring) to the chosen option, like an iOS switch. */
import { haptic } from "./haptics.js";

export default function SlideToggle({ options, value, onChange, label, className = "", fast = false }) {
  const i = Math.max(0, options.findIndex(([v]) => v === value));
  return (
    <div className={"slide-toggle " + (fast ? "fast " : "") + className} role="group" aria-label={label} style={{ "--n": options.length, "--i": i }}>
      <span className="thumb" aria-hidden="true" />
      {options.map(([v, text, lang]) => (
        <button key={v} type="button" lang={lang} aria-pressed={v === value} onClick={() => {
            if (v !== value) haptic();
            onChange(v);
          }}>
          {text}
        </button>
      ))}
    </div>
  );
}

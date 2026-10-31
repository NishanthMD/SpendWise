import { stage, useClock } from "./hooks";

/* Activity-style rings, drawn as plain SVG arcs.
 *
 * `frac` is 1 for 100%. Past 100% the ring is already full, so a darker second lap starts over the first.
 * Every ring and number reads one shared clock, so they fill together, ease out, and replay when `resetKey`
 * changes (a new period, a new upload). With reduced motion the clock starts at its end: final state, no motion.
 */
const RING_MS = 1100;
const STAGGER_MS = 140;

function Arcs({ cx, cy, r, w, frac, color, dark, track }) {
  const circ = 2 * Math.PI * r;
  const lap1 = Math.min(frac, 1);
  const lap2 = Math.min(Math.max(frac - 1, 0), 1);
  const arc = (f, stroke, extra) =>
    f > 0.002 ? (
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={stroke}
        strokeWidth={w}
        strokeLinecap="round"
        strokeDasharray={`${f * circ} ${circ}`}
        transform={`rotate(-90 ${cx} ${cy})`}
        {...extra}
      />
    ) : null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={track || color} strokeOpacity={track ? 1 : 0.16} strokeWidth={w} />
      {arc(lap1, color)}
      {arc(lap2, dark || color, { className: "lap2" })}
    </g>
  );
}

const pct = (frac) => `${Math.round(frac * 100)}%`;

/**
 * rings: outermost first, each { id, label, frac (null when there is no target yet), color, dark, sub, action }.
 */
export function ConcentricRings({ rings, size = 224, resetKey = "", ariaLabel }) {
  const key = resetKey + "|" + rings.map((r) => (r.frac == null ? "x" : r.frac.toFixed(3))).join(",");
  const t = useClock(key, RING_MS + STAGGER_MS * rings.length);
  const w = Math.max(12, Math.round(size * 0.07));
  const gap = 5;
  const c = size / 2;
  const lead = rings.find((r) => r.frac != null);
  const leadProgress = lead ? stage(t, rings.indexOf(lead) * STAGGER_MS, RING_MS) : 0;

  return (
    <div className="rings">
      <svg className="rings-svg" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={ariaLabel}>
        {rings.map((r, i) => (
          <Arcs
            key={r.id}
            cx={c}
            cy={c}
            r={c - w / 2 - 2 - i * (w + gap)}
            w={w}
            frac={r.frac == null ? 0 : r.frac * stage(t, i * STAGGER_MS, RING_MS)}
            color={r.color}
            dark={r.dark}
          />
        ))}
        {lead && (
          <g textAnchor="middle" className="rings-center">
            <text x={c} y={c + 4} className="rings-num">
              {pct(lead.frac * leadProgress)}
            </text>
            <text x={c} y={c + 22} className="rings-cap">
              {lead.short || lead.label}
            </text>
          </g>
        )}
      </svg>
      <ul className="ring-legend">
        {rings.map((r, i) => {
          const shown = r.frac == null ? null : r.frac * stage(t, i * STAGGER_MS, RING_MS);
          return (
            <li key={r.id}>
              <span className="ring-swatch" style={{ background: r.color }} aria-hidden="true" />
              <div>
                <div className="ring-line">
                  <span className="ring-label">{r.label}</span>
                  <strong className="ring-value">{shown == null ? "–" : pct(shown)}</strong>
                </div>
                <small>
                  {r.sub}
                  {r.frac != null && r.frac > 1 && <span className="lap-note"> Second lap: over by {pct(r.frac - 1)}.</span>}
                  {r.action && (
                    <>
                      {" "}
                      <button className="link" onClick={r.action.onClick}>
                        {r.action.label}
                      </button>
                    </>
                  )}
                </small>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * A single ring with a caption, for anything that has a target.
 * `center` overrides the middle text: { value, suffix } counts up to `value`.
 */
export function MiniRing({ frac, color, dark, label, sub, center, size = 84, resetKey = "", delay = 0, bare = false }) {
  const key = resetKey + "|" + frac.toFixed(3);
  const t = useClock(key, RING_MS + delay);
  const p = stage(t, delay, RING_MS);
  const w = Math.max(8, Math.round(size * 0.12));
  const c = size / 2;
  const mid = center ? `${Math.round(center.value * p)}${center.suffix || ""}` : pct(frac * p);
  if (bare) {
    return (
      <span className="mini-ring bare">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}: ${pct(frac)} of the monthly budget used`}>
          <Arcs cx={c} cy={c} r={c - w / 2 - 1} w={w} frac={frac * p} color={color} dark={dark} />
          <text x={c} y={c + 4} textAnchor="middle" className="mini-num small">
            {pct(frac * p)}
          </text>
        </svg>
      </span>
    );
  }
  return (
    <figure className="mini-ring">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}: ${center ? center.value + (center.suffix || "") : pct(frac)}`}>
        <Arcs cx={c} cy={c} r={c - w / 2 - 1} w={w} frac={frac * p} color={color} dark={dark} />
        <text x={c} y={c + 5} textAnchor="middle" className="mini-num">
          {mid}
        </text>
      </svg>
      <figcaption>
        <strong>{label}</strong>
        {sub && <small>{sub}</small>}
      </figcaption>
    </figure>
  );
}

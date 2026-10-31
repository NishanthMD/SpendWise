import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { clamp, useElementWidth } from "./hooks";
import { colorFor, dmy, longDate, monthLabel, plural, rupee, shortDate, weekdayDate } from "./format";
import { useLang } from "./i18n.jsx";
import SlideToggle from "./SlideToggle.jsx";

/* Hand-written SVG charts. Recharts cannot snap a guide line and dot to the nearest date under a finger,
 * pin a tooltip on tap, scrub with touch while the page still scrolls, and follow arrow keys, so these do.
 *
 * Pointer model (one code path for mouse, pen and touch):
 *  - hover / touch-drag: a guide line and dot snap to the nearest date, tooltip follows
 *  - click, tap, or lifting a dragging finger: pin that date (click it again to unpin) and report it via onPin
 *  - keyboard: arrow keys move, Enter or Space pins, Escape unpins
 * The wrapper uses touch-action: pan-y, so vertical swipes still scroll the page and horizontal ones scrub.
 */

const PAD = { l: 46, r: 12, t: 14, b: 26 };
const TAP_SLOP_PX = 6;
const FINGER_GAP_PX = 38; // how far above the fingertip the tooltip sits on touch

function niceScale(min, max, ticks = 4) {
  if (!(max > min)) max = min + 1;
  const raw = (max - min) / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const values = [];
  for (let v = lo; v <= hi + step / 2; v += step) values.push(Math.round(v * 100) / 100);
  return { lo, hi, values };
}

const compact = (v) => {
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (a >= 100000) return `${sign}${+(a / 100000).toFixed(1)}L`;
  if (a >= 1000) return `${sign}${+(a / 1000).toFixed(1)}k`;
  return `${sign}${a}`;
};

/* ------------------------------------------------------------------------------------------------ */
/* The scrubbable chart                                                                              */
/* ------------------------------------------------------------------------------------------------ */
export function ScrubChart({ points, kind = "bars", height = 280, color = "var(--blue)", renderTip, announce, onPin, resetKey, ariaLabel, hint }) {
  const wrapRef = useRef(null);
  const tipRef = useRef(null);
  const gesture = useRef(null);
  const W = useElementWidth(wrapRef);
  const [hover, setHover] = useState(null); // { i, x, y, touch, key }
  const [pinned, setPinned] = useState(null);
  const [tip, setTip] = useState({ w: 200, h: 140 });

  const n = points.length;
  const H = height;
  const plotW = W - PAD.l - PAD.r;
  const step = plotW / Math.max(n, 1);
  const xc = (i) => PAD.l + (i + 0.5) * step;
  const scale = useMemo(() => niceScale(Math.min(0, ...points.map((p) => p.value)), Math.max(1, ...points.map((p) => p.value))), [points]);
  const yv = (v) => PAD.t + (1 - (v - scale.lo) / (scale.hi - scale.lo)) * (H - PAD.t - PAD.b);
  const base = yv(0);

  // New data (another period or grain) invalidates any pin.
  useEffect(() => {
    setPinned(null);
    setHover(null);
  }, [resetKey]);
  useEffect(() => {
    onPin?.(pinned == null ? null : points[pinned] || null);
  }, [pinned]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = hover ? hover.i : pinned;
  const p = shown != null ? points[shown] : null;

  useLayoutEffect(() => {
    if (tipRef.current) {
      const r = tipRef.current.getBoundingClientRect();
      if (Math.abs(r.width - tip.w) > 1 || Math.abs(r.height - tip.h) > 1) setTip({ w: r.width, h: r.height });
    }
  });

  const rel = (e) => {
    const r = wrapRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const idxAt = (x) => clamp(Math.floor((x - PAD.l) / step), 0, n - 1);

  const down = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const { x, y } = rel(e);
    gesture.current = { x0: e.clientX, moved: false, touch: e.pointerType !== "mouse" };
    setHover({ i: idxAt(x), x, y, touch: gesture.current.touch });
  };
  const move = (e) => {
    const g = gesture.current;
    if (e.pointerType === "mouse" || g) {
      if (g && Math.abs(e.clientX - g.x0) > TAP_SLOP_PX) g.moved = true;
      const { x, y } = rel(e);
      setHover({ i: idxAt(x), x, y, touch: e.pointerType !== "mouse" });
    }
  };
  const up = (e) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    const i = idxAt(rel(e).x);
    setPinned((cur) => (g.moved ? i : cur === i ? null : i));
    if (g.touch) setHover(null);
  };
  const cancel = () => {
    // The browser took the gesture for a vertical scroll.
    gesture.current = null;
    setHover(null);
  };
  const leave = (e) => {
    if (e.pointerType === "mouse" && !gesture.current) setHover(null);
  };

  const keys = (e) => {
    const cur = hover?.i ?? pinned;
    const go = (i) => {
      e.preventDefault();
      const j = clamp(i, 0, n - 1);
      setHover({ i: j, x: xc(j), y: PAD.t, key: true });
    };
    if (e.key === "ArrowRight") go(cur == null ? 0 : cur + 1);
    else if (e.key === "ArrowLeft") go(cur == null ? n - 1 : cur - 1);
    else if (e.key === "PageDown") go((cur ?? 0) + 7);
    else if (e.key === "PageUp") go((cur ?? 0) - 7);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(n - 1);
    else if ((e.key === "Enter" || e.key === " ") && cur != null) {
      e.preventDefault();
      setPinned((c) => (c === cur ? null : cur));
    } else if (e.key === "Escape") {
      setPinned(null);
      setHover(null);
    }
  };

  // Tooltip position: above the fingertip on touch, beside the guide line otherwise.
  let tipStyle = { visibility: "hidden" };
  if (p) {
    let left;
    let top;
    if (hover?.touch) {
      left = clamp(hover.x - tip.w / 2, 4, W - tip.w - 4);
      top = hover.y - FINGER_GAP_PX - tip.h;
    } else {
      const gx = xc(shown);
      left = gx + 14 + tip.w > W - 4 ? gx - 14 - tip.w : gx + 14;
      left = Math.max(4, left);
      top = hover && !hover.key ? clamp(hover.y - tip.h / 2, 4, Math.max(4, H - tip.h - 4)) : PAD.t;
    }
    tipStyle = { left, top };
  }

  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 70))));
  const barW = Math.max(1.5, Math.min(step * 0.74, 30));
  if (!n) return <p className="msg">There is nothing to chart for this period.</p>;
  const linePath = kind === "line" ? points.map((q, i) => `${i ? "L" : "M"}${xc(i).toFixed(1)} ${yv(q.value).toFixed(1)}`).join(" ") : "";

  return (
    <div className="scrub-wrap">
      <div
        ref={wrapRef}
        className="scrub"
        style={{ height: H }}
        tabIndex={0}
        role="group"
        aria-roledescription="interactive chart"
        aria-label={ariaLabel}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={cancel}
        onPointerLeave={leave}
        onKeyDown={keys}
        onBlur={() => hover?.key && setHover(null)}
      >
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          {scale.values.map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={W - PAD.r} y1={yv(v)} y2={yv(v)} className={v === 0 ? "ax-zero" : "ax-grid"} />
              <text x={PAD.l - 8} y={yv(v) + 4} textAnchor="end" className="ax-label">
                {compact(v)}
              </text>
            </g>
          ))}
          {points.map((q, i) =>
            i % every === 0 ? (
              <text key={q.key} x={xc(i)} y={H - 7} textAnchor="middle" className="ax-label">
                {q.label}
              </text>
            ) : null
          )}

          {kind === "bars" &&
            points.map((q, i) => {
              let y = base;
              const dim = shown != null && shown !== i;
              return (
                <g key={q.key} opacity={dim ? 0.42 : 1}>
                  {(q.stack || []).map((seg) => {
                    const h = (seg.value / (scale.hi - scale.lo)) * (H - PAD.t - PAD.b);
                    y -= h;
                    return <rect key={seg.cat} x={xc(i) - barW / 2} y={y} width={barW} height={Math.max(h, 0)} fill={seg.color} />;
                  })}
                  {q.value === 0 && <rect x={xc(i) - barW / 2} y={base - 1.5} width={barW} height={1.5} fill="var(--rule)" />}
                </g>
              );
            })}

          {kind === "line" && (
            <>
              <path d={`${linePath} L${xc(n - 1)} ${base} L${xc(0)} ${base} Z`} fill={color} opacity="0.12" />
              <path d={linePath} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
            </>
          )}

          {pinned != null && pinned !== shown && (
            <line x1={xc(pinned)} x2={xc(pinned)} y1={PAD.t} y2={H - PAD.b} className="guide pinned" />
          )}
          {shown != null && (
            <g pointerEvents="none">
              <line x1={xc(shown)} x2={xc(shown)} y1={PAD.t} y2={H - PAD.b} className={"guide" + (pinned === shown ? " pinned" : "")} />
              <circle cx={xc(shown)} cy={yv(points[shown].value)} r="5.5" className="guide-dot" />
            </g>
          )}
        </svg>

        <div ref={tipRef} className={"tip" + (pinned === shown && !hover ? " is-pinned" : "")} style={tipStyle} aria-hidden="true">
          {p && renderTip(p)}
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {p && (hover?.key || !hover) ? announce(p) : ""}
      </p>
      {hint && <small className="chart-hint">{hint}</small>}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* Tooltip bodies                                                                                    */
/* ------------------------------------------------------------------------------------------------ */
function SpendTip({ p }) {
  const { t, cat } = useLang();
  const cats = Object.entries(p.by || {});
  const top = cats.slice(0, 5);
  const rest = cats.slice(5).reduce((a, [, v]) => a + v, 0);
  return (
    <>
      <div className="tip-title">{p.title}</div>
      <div className="tip-amount">
        {p.total ? rupee(p.total) : t("No spending")}
        {p.total > 0 && <span> {t("in")} {plural(p.count, "payment")}</span>}
      </div>
      {top.length > 0 && (
        <ul className="tip-cats">
          {top.map(([c, a]) => (
            <li key={c}>
              <span className="dot" style={{ background: colorFor(c) }} />
              {cat(c)}
              <b>{rupee(a)}</b>
            </li>
          ))}
          {rest > 0 && (
            <li>
              <span className="dot" style={{ background: "var(--rule)" }} />
              {t("Other categories")}
              <b>{rupee(rest)}</b>
            </li>
          )}
        </ul>
      )}
      {p.largest && (
        <div className="tip-row">
          {t("Largest")} <span>{p.largest.merchant}</span>
          <b>{rupee(p.largest.amount)}</b>
        </div>
      )}
      {p.balance != null && (
        <div className="tip-row">
          {t("Balance at end")} <b>{rupee(p.balance, 2)}</b>
        </div>
      )}
    </>
  );
}

function BalanceTip({ p }) {
  const { t } = useLang();
  return (
    <>
      <div className="tip-title">{p.title}</div>
      <div className="tip-amount">{rupee(p.value, 2)}</div>
      <div className="tip-row">
        {t("Money in")} <b>{rupee(p.income)}</b>
      </div>
      <div className="tip-row">
        {t("Spent")}{" "}
        <span>
          {plural(p.count, "payment")}
        </span>
        <b>{rupee(p.total)}</b>
      </div>
      {p.largest && (
        <div className="tip-row">
          {t("Largest")} <span>{p.largest.merchant}</span>
          <b>{rupee(p.largest.amount)}</b>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* The transactions behind a pinned date                                                             */
/* ------------------------------------------------------------------------------------------------ */
export function PinnedTransactions({ range, title, onClose }) {  // range: { start, end, account }
  const { t, cat } = useLang();
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    setRows(null);
    setErr("");
    api
      .transactions({ start: range.start, end: range.end, account: range.account, order: "file", limit: 500 })
      .then((r) => live && setRows(r))
      .catch((e) => live && setErr(e.message));
    return () => {
      live = false;
    };
  }, [range.start, range.end, range.account]);

  return (
    <div className="pinned-tx" role="region" aria-label={title}>
      <div className="row-between">
        <h3>{title}</h3>
        <button className="link" onClick={onClose}>
          {t("Close")}
        </button>
      </div>
      {err && <p className="msg err">{err}</p>}
      {!err && rows === null && <p className="msg">{t("Loading…")}</p>}
      {rows && rows.length === 0 && <p className="msg">{t("Nothing was paid or received in this period.")}</p>}
      {rows && rows.length > 0 && (
        <div className="table-scroll">
          <table className="ledger">
            <thead>
              <tr>
                <th>{t("Date")}</th>
                <th>{t("Particulars")}</th>
                <th className="num">{t("Amount")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{dmy(r.date)}</td>
                  <td>
                    {r.merchant}
                    {r.reversed ? (
                      <span className="tag">{t("Reversed")}</span>
                    ) : (
                      <small className="inline-cat">
                        <span className="dot" style={{ background: colorFor(r.category) }} />
                        {cat(r.category)}
                      </small>
                    )}
                  </td>
                  <td className={"num " + (r.kind === "credit" ? "in" : "out")}>
                    {r.kind === "credit" ? "+" : "−"}
                    {rupee(r.amount, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* Spending over time (daily, weekly, monthly) and balance over time                                 */
/* ------------------------------------------------------------------------------------------------ */
const GRAINS = ["Daily", "Weekly", "Monthly"];

export function SpendOverTime({ s, resetKey, account }) {
  const { t, cat } = useLang();
  const [grain, setGrain] = useState("Weekly");
  const [pin, setPin] = useState(null);
  const order = useMemo(() => s.categories.map((c) => c.category), [s]);

  const points = useMemo(() => {
    const mk = (b, key, label, title, start, end) => ({
      key, label, title, start, end,
      value: b.total, total: b.total, count: b.count, by: b.by_category, largest: b.largest, balance: b.balance,
      stack: order.filter((c) => b.by_category[c]).map((c) => ({ cat: c, color: colorFor(c), value: b.by_category[c] })),
    });
    if (grain === "Daily") return s.daily.map((d) => mk(d, d.date, shortDate(d.date), weekdayDate(d.date), d.date, d.date));
    if (grain === "Weekly")
      return s.weekly.map((w) =>
        mk(w, w.period, shortDate(w.start), `${t("Week of")} ${shortDate(w.start)}${w.start !== w.end ? ` ${t("to")} ${shortDate(w.end)}` : ""}`, w.start, w.end)
      );
    return s.monthly.map((m) => mk(m, m.period, monthLabel(m.period).split(" ")[0].slice(0, 3), monthLabel(m.period), m.start, m.end));
  }, [s, grain, order]);

  return (
    <section aria-labelledby="time-h">
      <div className="row-between">
        <h2 id="time-h">{t("Spending over time")}</h2>
        <SlideToggle label={t("Group by")} value={grain} onChange={setGrain} options={GRAINS.map((g) => [g, t(g)])} />
      </div>
      <ScrubChart
        points={points}
        kind="bars"
        resetKey={`${resetKey}|${grain}`}
        ariaLabel={`${t(grain)}. ${t("Use the left and right arrow keys to move between dates, Enter to pin one.")}`}
        renderTip={(p) => <SpendTip p={p} />}
        announce={(p) => `${p.title}: ${p.total ? `${rupee(p.total)} ${t("in")} ${plural(p.count, "payment")}` : t("no spending")}${p.balance != null ? `, ${t("balance")} ${rupee(p.balance, 2)}` : ""}`}
        onPin={(p) => setPin(p)}
        hint={t("Hover, touch or use the arrow keys to read a date. Click or tap to pin it and see its transactions.")}
      />
      <div className="legend-inline" aria-hidden="true">
        {order.slice(0, 8).map((c) => (
          <span key={c}>
            <span className="dot" style={{ background: colorFor(c) }} />
            {cat(c)}
          </span>
        ))}
      </div>
      {pin && (
        <PinnedTransactions
          range={{ start: pin.start, end: pin.end, account }}
          title={pin.start === pin.end ? `${t("Transactions on")} ${longDate(pin.start)}` : `${t("Transactions")}, ${pin.title}`}
          onClose={() => setPin(null)}
        />
      )}
    </section>
  );
}

export function BalanceOverTime({ s, resetKey, account }) {
  const { t } = useLang();
  const [pin, setPin] = useState(null);
  const hasBalance = s.daily.length > 0 && s.daily[0].balance != null;
  const points = useMemo(
    () =>
      hasBalance
        ? s.daily.map((d) => ({
            key: d.date, label: shortDate(d.date), title: weekdayDate(d.date), start: d.date, end: d.date,
            value: d.balance, income: d.income, total: d.amount, count: d.count, largest: d.largest,
          }))
        : [],
    [s, hasBalance]
  );
  return (
    <section aria-labelledby="bal-h">
      <h2 id="bal-h">{t("Balance over time")}</h2>
      {!hasBalance ? (
        <p className="msg">{t("There is no running balance to chart. Either the statement has no balance column, or several accounts are mixed: pick one account at the top.")}</p>
      ) : (
        <>
          <ScrubChart
            points={points}
            kind="line"
            height={240}
            color="var(--green)"
            resetKey={resetKey}
            ariaLabel={`${t("Balance at the end of each day.")} ${t("Use the left and right arrow keys to move between dates, Enter to pin one.")}`}
            renderTip={(p) => <BalanceTip p={p} />}
            announce={(p) => `${p.title}: ${t("balance")} ${rupee(p.value, 2)}`}
            onPin={(p) => setPin(p)}
          />
          {pin && (
            <PinnedTransactions range={{ start: pin.start, end: pin.end, account }} title={`${t("Transactions on")} ${longDate(pin.start)}`} onClose={() => setPin(null)} />
          )}
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* Category donut + legend table                                                                     */
/* ------------------------------------------------------------------------------------------------ */
const polar = (cx, cy, r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];

function slicePath(cx, cy, R, r, a0, a1) {
  const sweep = Math.min(a1 - a0, Math.PI * 2 - 0.0001);
  const e = a0 + sweep;
  const large = sweep > Math.PI ? 1 : 0;
  const [x0, y0] = polar(cx, cy, R, a0);
  const [x1, y1] = polar(cx, cy, R, e);
  const [x2, y2] = polar(cx, cy, r, e);
  const [x3, y3] = polar(cx, cy, r, a0);
  return `M${x0} ${y0} A${R} ${R} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${r} ${r} 0 ${large} 0 ${x3} ${y3} Z`;
}

export function Donut({ cats, total, size = 240 }) {
  const { t, cat } = useLang();
  const [active, setActive] = useState(null);
  const svgRef = useRef(null);
  const c = size / 2;
  const R = c - 10;
  const r = R * 0.62;
  const sum = cats.reduce((a, x) => a + x.amount, 0) || 1;
  const slices = useMemo(() => {
    let a = -Math.PI / 2;
    return cats.map((x) => {
      const span = (x.amount / sum) * Math.PI * 2;
      const out = { ...x, a0: a, a1: a + span };
      a += span;
      return out;
    });
  }, [cats, sum]);

  const pick = (e) => {
    const box = svgRef.current.getBoundingClientRect();
    const k = size / box.width;
    const dx = (e.clientX - box.left) * k - c;
    const dy = (e.clientY - box.top) * k - c;
    const dist = Math.hypot(dx, dy);
    if (dist > R * 1.1 || dist < r * 0.8) return null;
    let ang = Math.atan2(dy, dx);
    if (ang < -Math.PI / 2) ang += Math.PI * 2;
    const i = slices.findIndex((s) => ang >= s.a0 && ang < s.a1);
    return i === -1 ? slices.length - 1 : i;
  };

  const on = (e) => {
    if (e.pointerType === "mouse" || e.type === "pointerdown" || e.buttons) {
      const i = pick(e);
      if (i != null || e.pointerType === "mouse") setActive(i);
    }
  };
  const cur = active != null ? slices[active] : null;

  return (
    <div className="donut-wrap">
      <svg
        ref={svgRef}
        className="donut"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${t("Spending by category")}. ${cats.map((x) => `${cat(x.category)} ${x.percent}%`).join(", ")}`}
        onPointerMove={on}
        onPointerDown={on}
        onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
      >
        {slices.map((s, i) => {
          const mid = (s.a0 + s.a1) / 2;
          const lift = active === i ? 6 : 0;
          return (
            <path
              key={s.category}
              d={slicePath(c, c, R, r, s.a0, s.a1)}
              fill={colorFor(s.category)}
              stroke="var(--paper)"
              strokeWidth="2"
              opacity={active == null || active === i ? 1 : 0.35}
              transform={`translate(${Math.cos(mid) * lift} ${Math.sin(mid) * lift})`}
              style={{ transition: "opacity .15s, transform .15s" }}
            />
          );
        })}
        <g textAnchor="middle" pointerEvents="none">
          <text x={c} y={c - 14} className="donut-cap">
            {cur ? cat(cur.category) : t("Spent")}
          </text>
          <text x={c} y={c + 10} className="donut-num">
            {rupee(cur ? cur.amount : total)}
          </text>
          <text x={c} y={c + 30} className="donut-cap">
            {cur ? `${cur.percent}% · ${plural(cur.count, "payment")}` : `${plural(cats.reduce((a, x) => a + x.count, 0), "payment")}`}
          </text>
        </g>
      </svg>
      <table className="ledger legend">
        <thead>
          <tr>
            <th>{t("Category")}</th>
            <th className="num">{t("Payments")}</th>
            <th className="num">{t("Amount")}</th>
            <th className="num">{t("Share")}</th>
          </tr>
        </thead>
        <tbody>
          {cats.map((x, i) => (
            <tr
              key={x.category}
              className={active === i ? "hot" : ""}
              tabIndex={0}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              onClick={() => setActive((a) => (a === i ? null : i))}
            >
              <td>
                <span className="dot" style={{ background: colorFor(x.category) }} />
                {cat(x.category)}
              </td>
              <td className="num">{x.count}</td>
              <td className="num">{rupee(x.amount)}</td>
              <td className="num">{x.percent}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

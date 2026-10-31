import { useEffect, useState } from "react";
import { api } from "./api";
import { Piggy } from "./Critters.jsx";
import { MiniRing } from "./Rings.jsx";
import { BUDGET_CATEGORIES, colorFor, darken, monthLabel, rupee } from "./format";
import { useLang } from "./i18n.jsx";

const toDraft = (b) => ({
  overall: b.overall ? String(b.overall) : "",
  savings_goal: b.savings_goal ? String(b.savings_goal) : "",
  categories: Object.fromEntries(BUDGET_CATEGORIES.map((c) => [c, b.categories[c] ? String(b.categories[c]) : ""])),
});
const num = (v) => (v === "" || v == null ? null : Number(v));

export default function Budgets({ range, version, onSaved }) {
  const { t, cat } = useLang();
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [s, setS] = useState(null);
  const [msg, setMsg] = useState({ text: "", error: false });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .budgets()
      .then((b) => {
        setSaved(b);
        setDraft(toDraft(b));
      })
      .catch((e) => setMsg({ text: e.message, error: true }));
  }, []);

  useEffect(() => {
    api.summary(range.start, range.end, range.account).then(setS).catch(() => setS({ empty: true }));
  }, [range.start, range.end, range.account, version]);

  if (!draft) return <p className="msg">{msg.text || t("Loading…")}</p>;

  const status = s && !s.empty ? s.budget_status : null;
  const byCat = Object.fromEntries((status?.categories || []).map((c) => [c.category, c]));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setMsg({ text: "", error: false });
    try {
      const body = {
        overall: num(draft.overall),
        savings_goal: num(draft.savings_goal),
        categories: Object.fromEntries(Object.entries(draft.categories).map(([c, v]) => [c, num(v)])),
      };
      const b = await api.saveBudgets(body);
      setSaved(b);
      setDraft(toDraft(b));
      setMsg({ text: t("Saved. Your rings now use these budgets."), error: false });
      onSaved();
    } catch (x) {
      setMsg({ text: x.message, error: true });
    }
    setBusy(false);
  }

  const setCat = (c, v) => setDraft({ ...draft, categories: { ...draft.categories, [c]: v } });
  const goal = num(draft.savings_goal);
  const piggyTips = [
    goal ? t("{a} a month is {b} a year.", { a: rupee(goal), b: rupee(goal * 12) }) : t("Pick a monthly goal and I will keep count."),
    t("Small, steady coins fill me up fastest."),
  ];

  return (
    <section aria-labelledby="bud-h">
      <div className="row-between">
        <h2 id="bud-h">{t("Budgets")}</h2>
        <span className="hint">{t("All amounts are per month. Leave a box empty for no budget.")}</span>
      </div>

      <form onSubmit={save}>
        <div className="budget-top">
          <div className="budget-fields">
            <label className="field">
              <span className="field-label">{t("Monthly budget, all spending (₹)")}</span>
              <input type="number" inputMode="decimal" min="0" step="1" value={draft.overall} onChange={(e) => setDraft({ ...draft, overall: e.target.value })} placeholder={t("For example 12000")} />
            </label>
            <label className="field">
              <span className="field-label">{t("Monthly savings goal (₹)")}</span>
              <input type="number" inputMode="decimal" min="0" step="1" value={draft.savings_goal} onChange={(e) => setDraft({ ...draft, savings_goal: e.target.value })} placeholder={t("For example 2000")} />
            </label>
          </div>
          <div className="piggy-spot">
            <Piggy size={104} align="end" tips={piggyTips} />
          </div>
        </div>

        <h3 className="budget-sub">{t("By category")}{status ? `, ${monthLabel(status.month)}` : ""}</h3>
        <div className="budget-list" role="table" aria-label={t("Category budgets")}>
          {BUDGET_CATEGORIES.map((c) => {
            const row = byCat[c];
            return (
              <div className="budget-row" role="row" key={c}>
                <span role="cell" className="budget-cat">
                  <span className="dot" style={{ background: colorFor(c) }} />
                  {cat(c)}
                </span>
                <span role="cell" className="budget-ring">
                  {row ? (
                    <MiniRing bare size={52} frac={row.ratio} label={cat(c)} color={colorFor(c)} dark={darken(colorFor(c))} resetKey={`${range.start}|${range.end}|${version}|${saved.categories[c]}`} />
                  ) : (
                    <span className="budget-none">–</span>
                  )}
                </span>
                <span role="cell" className="budget-spent">
                  {row ? t("{a} of {b}", { a: rupee(row.spent), b: rupee(row.monthly) }) : ""}
                </span>
                <label role="cell" className="budget-input">
                  <span className="sr-only">{t("Monthly budget for")} {cat(c)}</span>
                  <input type="number" inputMode="decimal" min="0" step="1" value={draft.categories[c]} onChange={(e) => setCat(c, e.target.value)} placeholder={t("No budget")} />
                </label>
              </div>
            );
          })}
        </div>

        <div className="row-gap budget-actions">
          <button className="btn primary" disabled={busy}>
            {busy ? t("Saving…") : t("Save budgets")}
          </button>
          {msg.text && (
            <span className={msg.error ? "err" : "ok-note"} role="status">
              {msg.text}
            </span>
          )}
        </div>
      </form>
    </section>
  );
}

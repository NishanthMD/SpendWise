import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { BalanceOverTime, Donut, SpendOverTime } from "./Charts.jsx";
import { Cat, Squirrel, TurtleLoader } from "./Critters.jsx";
import Empty from "./Empty.jsx";
import { ConcentricRings, MiniRing } from "./Rings.jsx";
import { colorFor, darken, longDate, monthLabel, plural, rupee, shortDate, tone } from "./format";
import { useLang } from "./i18n.jsx";
import { tr } from "./lang.js";

export default function Overview({ range, version, hasData, quiet, goTo }) {
  const { t } = useLang();
  const [s, setS] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    setError("");
    api
      .summary(range.start, range.end, range.account)
      .then((r) => live && setS(r))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [range.start, range.end, range.account, version]);

  if (error) return <p className="msg err">{t("Could not load the summary")}: {error}. {t("Is the server running?")}</p>;
  if (!s) return <TurtleLoader text={t("Reading your numbers…")} />;

  if (s.empty) {
    return (
      <Empty
        title={hasData ? t("No spending in this period") : t("Start with your bank statement")}
        tips={hasData ? [t("Try another period."), t("Or upload a newer statement.")] : [t("Upload a statement and I will hop through it."), t("Your PDF never leaves this computer.")]}
      >
        <p>
          {hasData
            ? t("Pick another period above, or upload a newer statement.")
            : t("Download a PDF statement from your bank's net banking, then choose Upload statement at the top right. Password-protected PDFs are supported.")}
        </p>
      </Empty>
    );
  }

  const resetKey = `${range.start || ""}|${range.end || ""}|${range.account || ""}|${version}`;
  return (
    <div className="stack">
      <Hero s={s} resetKey={resetKey} quiet={quiet} goTo={goTo} />
      <Facts s={s} />
      <Targets s={s} resetKey={resetKey} goTo={goTo} />
      <SpendOverTime s={s} resetKey={resetKey} account={range.account} />
      <BalanceOverTime s={s} resetKey={resetKey} account={range.account} />
      <section aria-labelledby="cat-h">
        <h2 id="cat-h">{t("Where it went, by category")}</h2>
        <Donut cats={s.categories} total={s.total_spent} />
      </section>
      <div className="two">
        <Payees s={s} />
        <Calculator s={s} quiet={quiet} account={range.account} />
      </div>
      <Summary range={range} />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ */
function catTips(s, mood, ov) {
  const tips = [];
  const day = s.highest_spend_day;
  const food = s.top_merchants.find((m) => (m.category === "Food" || m.category === "Groceries") && m.count >= 2);
  if (food) {
    const order = food.amount / food.count;
    if (day && order > 0 && day.amount / order >= 1.5) tips.push(tr("Your busiest day, {amount}, is about {n} {shop} orders.", { amount: rupee(day.amount), n: Math.round(day.amount / order), shop: food.merchant }));
    tips.push(tr("An average day costs {amount}. That is {n} {shop} orders.", { amount: rupee(s.avg_daily_spend), n: (s.avg_daily_spend / order).toFixed(1), shop: food.merchant }));
  }
  if (mood === "alert" && ov) tips.push(tr("You have used {n}% of this month's budget.", { n: Math.round(ov.ratio * 100) }));
  if (mood === "stirring") tips.push(tr("The last week averaged {a} a day, above your {b} norm.", { a: rupee(s.recent_avg_daily_spend), b: rupee(s.avg_daily_spend) }));
  if (mood === "asleep") tips.push(tr("Shh. Spending is calm lately, so I am napping."));
  if (s.largest_transaction) tips.push(tr("Your largest payment was {amount} on {date}.", { amount: rupee(s.largest_transaction.amount), date: shortDate(s.largest_transaction.date) }));
  return tips.slice(0, 4);
}

function Hero({ s, resetKey, quiet, goTo }) {
  const { t, cat } = useLang();
  const top = s.top_category;
  const b = s.budget_status || {};
  const ov = b.overall;
  const rings = [
    {
      id: "budget", label: t("Month budget used"), short: t("of budget"), color: tone("#2a5fd0"), dark: tone("#16398a"),
      frac: ov ? ov.ratio : null,
      sub: ov ? t("{spent} of {budget} in {month}.", { spent: rupee(ov.spent), budget: rupee(ov.monthly), month: monthLabel(b.month) }) : t("No monthly budget yet."),
      action: ov ? undefined : { label: t("Set a budget"), onClick: () => goTo("Budgets") },
    },
    {
      id: "pace", label: t("Average day vs daily budget"), color: tone("#e07a1f"), dark: tone("#8f4300"),
      frac: ov ? ov.pace_ratio : null,
      sub: ov ? t("{avg} a day against {budget}.", { avg: rupee(ov.avg_daily), budget: rupee(ov.daily_budget) }) : t("Fills once you set a monthly budget."),
    },
    {
      id: "save", label: t("Savings rate"), short: t("saved"), color: tone("#1b8a6b"), dark: tone("#0b5a44"),
      frac: s.savings_rate == null ? null : Math.max(0, s.savings_rate),
      sub: s.savings_rate == null ? t("No income in this period.") : s.net >= 0 ? t("{net} kept from {income} received.", { net: rupee(s.net), income: rupee(s.total_income) }) : t("You spent {amount} more than came in.", { amount: rupee(-s.net) }),
    },
  ];
  const mood = ov && (ov.ratio > 1 || ov.pace_ratio > 1) ? "alert" : s.recent_avg_daily_spend > s.avg_daily_spend * 1.15 ? "stirring" : "asleep";

  return (
    <section className="hero" aria-labelledby="hero-h">
      <div className="hero-left">
        <p className="hero-kicker">{t("Spent in this period")}</p>
        <h1 id="hero-h" className="hero-amount">
          {rupee(s.total_spent)}
        </h1>
        {top && (
          <p className="hero-line">
            {t("Most of it, {amount}, went to", { amount: rupee(top.amount) })} <strong>{cat(top.category)}</strong> ({top.percent}%).
          </p>
        )}
        <div className="strip" role="img" aria-label={t("Spending split by category")}>
          {s.categories.map((c) => (
            <span key={c.category} className="seg" style={{ width: `${c.percent}%`, background: colorFor(c.category) }} title={`${cat(c.category)}: ${rupee(c.amount)} (${c.percent}%)`} />
          ))}
        </div>
        {s.reversed_entries > 0 && (
          <small className="hero-note">
            {plural(s.reversed_entries, "entry", "entries")} {t("(a failed payment and its refund) left out of these totals.")}
          </small>
        )}
      </div>
      <div className="hero-right">
        <ConcentricRings
          rings={rings}
          resetKey={resetKey}
          ariaLabel={`${t("Rings")}: ${rings.map((r) => `${r.label} ${r.frac == null ? t("not set") : Math.round(r.frac * 100) + "%"}`).join(", ")}`}
        />
        {!quiet && (
          <div className="cat-spot">
            <Cat mood={mood} size={104} align="end" tips={catTips(s, mood, ov)} />
          </div>
        )}
      </div>
    </section>
  );
}

function Facts({ s }) {
  const { t } = useLang();
  const items = [
    [t("Average per day"), rupee(s.avg_daily_spend), t("over {n} days", { n: s.days })],
    [t("Money in"), rupee(s.total_income), t("{n} transactions in total", { n: s.transactions })],
    [t("Left over"), rupee(s.net), s.net >= 0 ? t("income minus spending") : t("spent more than came in")],
    s.highest_spend_day && [t("Busiest day"), rupee(s.highest_spend_day.amount), `${longDate(s.highest_spend_day.date)}, ${plural(s.highest_spend_day.count, "payment")}`],
    s.largest_transaction && [t("Largest payment"), rupee(s.largest_transaction.amount), `${s.largest_transaction.merchant}, ${shortDate(s.largest_transaction.date)}`],
    s.closing_balance != null && [t("Balance at end"), rupee(s.closing_balance, 2), t("from the statement")],
  ].filter(Boolean);
  return (
    <dl className="facts">
      {items.map(([k, v, note]) => (
        <div key={k} className="fact">
          <dt>{k}</dt>
          <dd>{v}</dd>
          <small>{note}</small>
        </div>
      ))}
    </dl>
  );
}

/* Anything with a target gets a ring: each category budget, the no-spend streak, the savings goal. */
function Targets({ s, resetKey, goTo }) {
  const { t, cat } = useLang();
  const b = s.budget_status || {};
  const ns = s.no_spend;
  const cats = b.categories || [];
  const goal = b.savings_goal;
  return (
    <section aria-labelledby="targets-h">
      <div className="row-between">
        <h2 id="targets-h">{t("Targets")}</h2>
        <span className="hint">{t("Budgets are monthly, so these show")} {b.month ? monthLabel(b.month) : t("the latest month")}.</span>
      </div>
      <div className="mini-rings">
        <MiniRing
          label={t("No-spend streak")}
          frac={ns.current / ns.target}
          color={tone("#0e9cb5")}
          dark={darken(tone("#0e9cb5"))}
          center={{ value: ns.current, suffix: "d" }}
          sub={t("Best run {n}. Goal {goal}.", { n: plural(ns.best, "day"), goal: ns.target })}
          resetKey={resetKey}
        />
        {goal ? (
          <MiniRing
            label={t("Savings goal")}
            frac={goal.ratio}
            color={tone("#0f8f5a")}
            dark={darken(tone("#0f8f5a"))}
            sub={t("{a} of {b}", { a: rupee(Math.max(goal.saved, 0)), b: rupee(goal.monthly) })}
            resetKey={resetKey}
            delay={120}
          />
        ) : (
          <div className="mini-ring ghost">
            <p>
              <strong>{t("Savings goal")}</strong>
              <small>
                {t("Not set.")} <button className="link" onClick={() => goTo("Budgets")}>{t("Add a goal")}</button>
              </small>
            </p>
          </div>
        )}
        {cats.map((c, i) => (
          <MiniRing
            key={c.category}
            label={cat(c.category)}
            frac={c.ratio}
            color={colorFor(c.category)}
            dark={darken(colorFor(c.category))}
            sub={t("{a} of {b}", { a: rupee(c.spent), b: rupee(c.monthly) })}
            resetKey={resetKey}
            delay={240 + i * 90}
          />
        ))}
        {cats.length === 0 && (
          <div className="mini-ring ghost">
            <p>
              <strong>{t("Category budgets")}</strong>
              <small>
                {t("None yet.")} <button className="link" onClick={() => goTo("Budgets")}>{t("Set one")}</button>
              </small>
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function Payees({ s }) {
  const { t, cat } = useLang();
  return (
    <section aria-labelledby="payees-h">
      <h2 id="payees-h">{t("Top payees")}</h2>
      <table className="ledger">
        <thead>
          <tr>
            <th>{t("Payee")}</th>
            <th>{t("Category")}</th>
            <th className="num">{t("Payments")}</th>
            <th className="num">{t("Amount")}</th>
          </tr>
        </thead>
        <tbody>
          {s.top_merchants.map((m) => (
            <tr key={m.merchant}>
              <td>{m.merchant}</td>
              <td>
                <span className="dot" style={{ background: colorFor(m.category) }} />
                {cat(m.category)}
              </td>
              <td className="num">{m.count}</td>
              <td className="num">{rupee(m.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Calculator({ s, quiet, account }) {
  const { t } = useLang();
  const [start, setStart] = useState(s.start);
  const [end, setEnd] = useState(s.end);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    setStart(s.start);
    setEnd(s.end);
    setErr("");
    setRes({ days: s.days, total_spent: s.total_spent, avg_daily_spend: s.avg_daily_spend, payments: s.categories.reduce((a, c) => a + c.count, 0) });
  }, [s.start, s.end, s.total_spent]); // eslint-disable-line react-hooks/exhaustive-deps

  async function calc(e) {
    e.preventDefault();
    setErr("");
    try {
      setRes(await api.averageDaily(start, end, account));
    } catch (x) {
      setRes(null);
      setErr(x.message);
    }
  }

  const tips = res
    ? [
        t("{avg} a day adds up to about {month} in a month.", { avg: rupee(res.avg_daily_spend), month: rupee(res.avg_daily_spend * 30) }),
        res.payments ? t("That is {n} payments a day.", { n: (res.payments / Math.max(res.days, 1)).toFixed(1) }) : "",
        t("Try a festival week or a trip to compare it with a normal day."),
      ]
    : [t("Pick two dates and I will count the acorns.")];

  return (
    <section aria-labelledby="calc-h" className="calc-section">
      <h2 id="calc-h">{t("Average daily spending")}</h2>
      <p className="hint">{t("Pick any two dates, such as a trip or a festival week, to see what a typical day cost.")}</p>
      <div className="calc-row">
        <div className="calc-main">
          <form className="calc" onSubmit={calc}>
            <label className="field">
              <span className="field-label">{t("From")}</span>
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
            </label>
            <label className="field">
              <span className="field-label">{t("To")}</span>
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} required />
            </label>
            <button className="btn">{t("Calculate")}</button>
          </form>
          {err && <p className="msg err">{err}</p>}
          {res && (
            <p className="calc-out" aria-live="polite">
              <strong>{rupee(res.avg_daily_spend, 2)}</strong> {t("a day")}
              <small>
                {rupee(res.total_spent)} {t("over")} {plural(res.days, "day")}
                {res.payments ? `, ${plural(res.payments, "payment")}` : ""}
              </small>
              {res.note && <small>{res.note}</small>}
            </p>
          )}
        </div>
        {!quiet && (
          <div className="squirrel-spot">
            <Squirrel size={96} align="end" tips={tips.filter(Boolean)} />
          </div>
        )}
      </div>
    </section>
  );
}

function Summary({ range }) {
  const { t } = useLang();
  const [withNotes, setWithNotes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function download() {
    setBusy(true);
    setErr("");
    try {
      await api.downloadReport(range.start, range.end, withNotes, range.account);
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  }
  return (
    <section aria-labelledby="sum-h" className="summary">
      <h2 id="sum-h">{t("PDF report")}</h2>
      <p className="hint">{t("KPIs, the category chart and table, month by month, top payees, budgets and highlights for the period shown above.")}</p>
      <div className="row-gap">
        <button className="btn primary" onClick={download} disabled={busy}>
          {busy ? t("Reading…") : t("Download PDF report")}
        </button>
        <label className="check">
          <input type="checkbox" checked={withNotes} onChange={(e) => setWithNotes(e.target.checked)} />
          {t("Include my notes")}
        </label>
        {err && <span className="err">{err}</span>}
      </div>
    </section>
  );
}

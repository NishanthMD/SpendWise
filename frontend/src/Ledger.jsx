import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { Piggy } from "./Critters.jsx";
import Empty from "./Empty.jsx";
import { longDate, rupee, todayISO } from "./format";
import { useLang } from "./i18n.jsx";
import SlideToggle from "./SlideToggle.jsx";

/* Split a bill with friends, and keep a dated list of who owes whom. All of it stays in the local SQLite file. */

const cents = (v) => Math.round(Number(v || 0) * 100);
const fromCents = (c) => c / 100;
const tidy = (n) => (n === n.toLowerCase() ? n.replace(/(^|\s)\S/g, (c) => c.toUpperCase()) : n);
let nextId = 1;
const newPerson = (name = "") => ({ id: nextId++, name });

/** Equal shares in whole paise: the leftover paise go to the first people, you first, so nobody is charged extra. */
function equalShares(total, count) {
  const t = cents(total);
  const base = Math.floor(t / count);
  const extra = t - base * count;
  return Array.from({ length: count }, (_, i) => fromCents(base + (i < extra ? 1 : 0)));
}

export default function Ledger({ version, onChanged, splitFrom, clearSplitFrom }) {
  const { t } = useLang();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [panel, setPanel] = useState(null); // null | "split" | "iou"
  const [view, setView] = useState("open"); // open | settled | all
  const [who, setWho] = useState(""); // filter to one person
  const [notice, setNotice] = useState("");

  const load = useCallback(
    () =>
      api
        .ledger()
        .then((d) => {
          setData(d);
          setError("");
        })
        .catch((e) => setError(e.message)),
    []
  );
  useEffect(() => {
    load();
  }, [load, version]);

  // "Split" on a passbook row opens the form already filled in.
  useEffect(() => {
    if (splitFrom) setPanel("split");
  }, [splitFrom]);

  const changed = () => {
    load();
    onChanged();
  };

  if (error && !data) return <p className="msg err">{t("Could not load the list")}: {error}</p>;
  if (!data) return <p className="msg">{t("Loading…")}</p>;

  const { totals, people, entries } = data;
  const shown = entries.filter((e) => (view === "all" || (view === "open" ? !e.settled : e.settled)) && (!who || e.person === who));
  const names = [...new Set(entries.map((e) => e.person))];
  const tips = [
    totals.they_owe > 0 ? t("Friends owe you {amount} in all.", { amount: rupee(totals.they_owe, 2) }) : t("Nobody owes you anything right now."),
    totals.i_owe > 0 ? t("You owe {amount}. Pay it back soon.", { amount: rupee(totals.i_owe, 2) }) : t("You do not owe anyone. Nice."),
  ];

  return (
    <section aria-labelledby="owed-h">
      <div className="row-between">
        <h2 id="owed-h">{t("Owed money")}</h2>
        <div className="piggy-spot">
          <Piggy size={92} align="end" tips={tips} />
        </div>
      </div>
      <p className="hint">{t("Split a dinner or a cab, and keep track of who still owes whom, with dates. Mark money as paid back when it arrives.")}</p>

      <dl className="facts owed-facts">
        <div className="fact">
          <dt>{t("Friends owe you")}</dt>
          <dd className="in">{rupee(totals.they_owe, 2)}</dd>
        </div>
        <div className="fact">
          <dt>{t("You owe")}</dt>
          <dd className="out">{rupee(totals.i_owe, 2)}</dd>
        </div>
        <div className="fact">
          <dt>{t("Net")}</dt>
          <dd>{rupee(totals.net, 2)}</dd>
          <small>{totals.net > 0 ? t("more is coming to you") : totals.net < 0 ? t("more is going out") : t("all even")}</small>
        </div>
      </dl>

      <div className="row-gap owed-actions">
        <button className={"btn primary"} aria-expanded={panel === "split"} onClick={() => setPanel(panel === "split" ? null : "split")}>
          {t("Split a bill")}
        </button>
        <button className="btn" aria-expanded={panel === "iou"} onClick={() => setPanel(panel === "iou" ? null : "iou")}>
          {t("Add money owed")}
        </button>
      </div>

      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}

      {panel === "split" && (
        <SplitForm
          key={splitFrom ? splitFrom.id : "new"}
          names={names}
          from={splitFrom}
          onCancel={() => {
            setPanel(null);
            clearSplitFrom();
          }}
          onDone={(msg) => {
            setPanel(null);
            clearSplitFrom();
            setNotice(msg);
            changed();
          }}
        />
      )}
      {panel === "iou" && (
        <IouForm
          names={names}
          onCancel={() => setPanel(null)}
          onDone={(msg) => {
            setPanel(null);
            setNotice(msg);
            changed();
          }}
        />
      )}

      {entries.length === 0 ? (
        <Empty compact title={t("Nothing owed yet")} tips={[t("Split your next dinner here."), t("I will remember who owes what.")]}>
          <p>{t("Use Split a bill after a shared meal or ride, or Add money owed for a simple loan.")}</p>
        </Empty>
      ) : (
        <>
          <h3 className="budget-sub">{t("By person")}</h3>
          <div className="people-chips" role="group" aria-label={t("By person")}>
            {people.map((p) => (
              <button key={p.person} className={"person-chip" + (who === p.person ? " on" : "")} aria-pressed={who === p.person} onClick={() => setWho(who === p.person ? "" : p.person)}>
                <strong>{p.person}</strong>
                <span className={p.net > 0 ? "in" : p.net < 0 ? "out" : ""}>
                  {p.net > 0 ? t("owes you {amount}", { amount: rupee(p.net, 2) }) : p.net < 0 ? t("you owe {amount}", { amount: rupee(-p.net, 2) }) : t("all even")}
                </span>
              </button>
            ))}
          </div>

          <div className="row-between owed-list-head">
            <h3 className="budget-sub">{who ? who : t("Every entry")}</h3>
            <SlideToggle label={t("Show")} value={view} onChange={setView} options={[["open", t("Still owed")], ["settled", t("Paid back")], ["all", t("All")]]} />
          </div>

          {shown.length === 0 ? (
            <p className="msg">{view === "open" ? t("Everything here is paid back.") : t("No entries to show.")}</p>
          ) : (
            <ul className="debts">
              {shown.map((e) => (
                <Debt key={e.id} e={e} onChanged={changed} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------------------------------------ */
function Debt({ e, onChanged }) {
  const { t } = useLang();
  const [paying, setPaying] = useState(false);
  const [amount, setAmount] = useState("");
  const [sure, setSure] = useState(false);
  const [error, setError] = useState("");
  const mine = e.direction === "i_owe";

  async function record(value) {
    try {
      await api.payLedger(e.id, value);
      setPaying(false);
      setAmount("");
      onChanged();
    } catch (x) {
      setError(x.message);
    }
  }
  async function remove() {
    try {
      await api.deleteLedger(e.id);
      onChanged();
    } catch (x) {
      setError(x.message);
    }
  }

  return (
    <li className={"debt" + (e.settled ? " settled" : "") + (mine ? " mine" : "")}>
      <div className="debt-main">
        <div className="debt-who">
          <strong>{e.person}</strong>
          <span className="debt-dir">{mine ? t("you owe") : t("owes you")}</span>
          {e.settled && <span className="tag ok">{t("Paid back")}</span>}
          {e.overdue && <span className="tag warn">{t("Overdue")}</span>}
        </div>
        <small className="debt-note">
          {e.note ? `${e.note} · ` : ""}
          {t("From {date}", { date: longDate(e.date) })}
          {e.due_date ? ` · ${t("due {date}", { date: longDate(e.due_date) })}` : ""}
        </small>
        {e.payments.length > 0 && (
          <small className="debt-pays">
            {e.payments.map((p) => `${rupee(p.amount, 2)} ${t("on {date}", { date: longDate(p.date) })}`).join(" · ")}
          </small>
        )}
        {error && <small className="err">{error}</small>}
      </div>

      <div className="debt-amount">
        <strong>{rupee(e.settled ? e.amount : e.remaining, 2)}</strong>
        {!e.settled && e.paid > 0 && <small>{t("of {amount}", { amount: rupee(e.amount, 2) })}</small>}
      </div>

      <div className="debt-actions">
        {!e.settled && !paying && (
          <>
            <button className="btn" onClick={() => record()}>
              {mine ? t("I paid it") : t("Got it back")}
            </button>
            <button className="link" onClick={() => setPaying(true)}>
              {t("Part payment")}
            </button>
          </>
        )}
        {paying && (
          <form
            className="part-pay"
            onSubmit={(ev) => {
              ev.preventDefault();
              record(Number(amount));
            }}
          >
            <input aria-label={t("Amount paid")} type="number" inputMode="decimal" min="0.01" max={e.remaining} step="0.01" autoFocus required value={amount} onChange={(ev) => setAmount(ev.target.value)} placeholder="₹" />
            <button className="btn">{t("Record")}</button>
            <button type="button" className="link" onClick={() => setPaying(false)}>
              {t("Cancel")}
            </button>
          </form>
        )}
        {sure ? (
          <>
            <button className="btn danger" onClick={remove}>
              {t("Delete")}
            </button>
            <button className="link" onClick={() => setSure(false)}>
              {t("Keep")}
            </button>
          </>
        ) : (
          !paying && (
            <button className="link" onClick={() => setSure(true)}>
              {t("Delete")}
            </button>
          )
        )}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------------------------------------ */
function SplitForm({ names, from, onCancel, onDone }) {
  const { t } = useLang();
  const [title, setTitle] = useState(from ? from.merchant : "");
  const [total, setTotal] = useState(from ? String(from.amount) : "");
  const [date, setDate] = useState(from ? from.date : todayISO());
  const [people, setPeople] = useState(() => [newPerson(), newPerson()]);
  const [equal, setEqual] = useState(true);
  const [custom, setCustom] = useState({}); // id (or "me") -> typed amount, when not splitting equally
  const [paidBy, setPaidBy] = useState("me");
  const [due, setDue] = useState("");
  const [remind, setRemind] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const filled = people.filter((p) => p.name.trim());
  const count = filled.length + 1; // you are one of them
  const totalNum = Number(total) || 0;
  const eq = useMemo(() => equalShares(totalNum, count), [totalNum, count]);

  // The shares that would be sent: equal, or what you typed.
  const myShare = equal ? eq[0] : Number(custom.me || 0);
  const shares = filled.map((p, i) => ({ name: p.name.trim(), share: equal ? eq[i + 1] : Number(custom[p.id] || 0) }));
  const assigned = fromCents(cents(myShare) + shares.reduce((a, s) => a + cents(s.share), 0));
  const left = fromCents(cents(totalNum) - cents(assigned));

  const setName = (id, name) => setPeople(people.map((p) => (p.id === id ? { ...p, name } : p)));

  async function submit(ev) {
    ev.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api.split({
        title: title.trim(), total: totalNum, my_share: myShare, paid_by: paidBy, people: shares,
        date, due_date: due || null, tx_id: from ? from.id : null, remind: Boolean(due) && remind,
      });
      onDone(
        paidBy === "me"
          ? t("Saved. {names} will owe you for {title}.", { names: shares.map((s) => tidy(s.name)).join(", "), title: title.trim() })
          : t("Saved. You owe {name} {amount} for {title}.", { name: tidy(paidBy), amount: rupee(myShare, 2), title: title.trim() })
      );
    } catch (x) {
      setError(x.message);
      setBusy(false);
    }
  }

  return (
    <form className="split-form glass" onSubmit={submit} aria-label={t("Split a bill")}>
      <datalist id="owed-names">
        {names.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <div className="split-top">
        <label className="field grow">
          <span className="field-label">{t("What was it for")}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder={t("Dinner, cab, movie…")} />
        </label>
        <label className="field">
          <span className="field-label">{t("Bill total (₹)")}</span>
          <input type="number" inputMode="decimal" min="0.01" step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">{t("Date")}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
      </div>
      {from && <small className="hint">{t("Filled in from your passbook entry. Change anything you like.")}</small>}

      <fieldset className="split-people">
        <legend>{t("Who shared it")}</legend>
        <div className="split-line me">
          <span className="split-name">{t("You")}</span>
          {equal ? <span className="split-amt">{rupee(eq[0], 2)}</span> : <ShareInput value={custom.me} onChange={(v) => setCustom({ ...custom, me: v })} label={t("Your share")} />}
        </div>
        {people.map((p, i) => {
          const idx = filled.findIndex((f) => f.id === p.id);
          return (
            <div className="split-line" key={p.id}>
              <input className="split-name" list="owed-names" aria-label={t("Friend's name")} placeholder={t("Friend's name")} value={p.name} onChange={(e) => setName(p.id, e.target.value)} />
              {equal ? (
                <span className="split-amt">{idx >= 0 ? rupee(eq[idx + 1], 2) : "–"}</span>
              ) : (
                <ShareInput value={custom[p.id]} onChange={(v) => setCustom({ ...custom, [p.id]: v })} label={t("Share of {name}", { name: p.name || String(i + 1) })} />
              )}
              {people.length > 1 && (
                <button type="button" className="link" onClick={() => setPeople(people.filter((x) => x.id !== p.id))} aria-label={t("Remove {name}", { name: p.name || String(i + 1) })}>
                  ✕
                </button>
              )}
            </div>
          );
        })}
        <div className="row-gap">
          <button type="button" className="btn" onClick={() => setPeople([...people, newPerson()])}>
            + {t("Add a friend")}
          </button>
          <label className="check">
            <input type="checkbox" checked={equal} onChange={(e) => setEqual(e.target.checked)} />
            {t("Split equally")}
          </label>
        </div>
        {!equal && totalNum > 0 && (
          <small className={Math.abs(left) < 0.005 ? "ok-note" : "err"} role="status">
            {Math.abs(left) < 0.005 ? t("Shares add up to the total.") : left > 0 ? t("{amount} still to assign.", { amount: rupee(left, 2) }) : t("{amount} too much.", { amount: rupee(-left, 2) })}
          </small>
        )}
      </fieldset>

      <div className="split-top">
        <label className="field">
          <span className="field-label">{t("Who paid the bill")}</span>
          <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
            <option value="me">{t("I did")}</option>
            {filled.map((p) => (
              <option key={p.id} value={p.name.trim()}>
                {p.name.trim()}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t("Pay back by (optional)")}</span>
          <input type="date" value={due} min={date} onChange={(e) => setDue(e.target.value)} />
        </label>
        {due && (
          <label className="check split-remind">
            <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} />
            {t("Add a reminder for that day")}
          </label>
        )}
      </div>

      <p className="hint split-sum" aria-live="polite">
        {paidBy === "me"
          ? t("You paid {total}. Your share is {mine}, so friends owe you {owed}.", { total: rupee(totalNum, 2), mine: rupee(myShare, 2), owed: rupee(Math.max(totalNum - myShare, 0), 2) })
          : t("{name} paid. You owe {name} your share, {mine}.", { name: paidBy, mine: rupee(myShare, 2) })}
      </p>
      {error && <p className="err" role="alert">{error}</p>}
      <div className="row-gap">
        <button className="btn primary" disabled={busy || filled.length === 0 || (!equal && Math.abs(left) >= 0.005)}>
          {busy ? t("Saving…") : t("Save split")}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          {t("Cancel")}
        </button>
        {filled.length === 0 && <small>{t("Type at least one friend's name.")}</small>}
      </div>
    </form>
  );
}

function ShareInput({ value, onChange, label }) {
  return <input className="split-amt-in" type="number" inputMode="decimal" min="0" step="0.01" aria-label={label} placeholder="₹" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
}

/* ------------------------------------------------------------------------------------------------ */
function IouForm({ names, onCancel, onDone }) {
  const { t } = useLang();
  const [d, setD] = useState({ person: "", direction: "they_owe", amount: "", note: "", date: todayISO(), due: "", remind: true });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setD({ ...d, [k]: v });

  async function submit(ev) {
    ev.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.addLedger({ person: d.person, direction: d.direction, amount: Number(d.amount), note: d.note, date: d.date, due_date: d.due || null, remind: Boolean(d.due) && d.remind });
      onDone(d.direction === "they_owe" ? t("Saved. {name} owes you {amount}.", { name: tidy(d.person.trim()), amount: rupee(d.amount, 2) }) : t("Saved. You owe {name} {amount}.", { name: tidy(d.person.trim()), amount: rupee(d.amount, 2) }));
    } catch (x) {
      setError(x.message);
      setBusy(false);
    }
  }

  return (
    <form className="split-form glass" onSubmit={submit} aria-label={t("Add money owed")}>
      <datalist id="owed-names-2">
        {names.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <SlideToggle label={t("Who owes whom")} value={d.direction} onChange={(v) => set("direction", v)} options={[["they_owe", t("They owe me")], ["i_owe", t("I owe them")]]} />
      <div className="split-top">
        <label className="field grow">
          <span className="field-label">{t("Person")}</span>
          <input list="owed-names-2" value={d.person} onChange={(e) => set("person", e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">{t("Amount (₹)")}</span>
          <input type="number" inputMode="decimal" min="0.01" step="0.01" value={d.amount} onChange={(e) => set("amount", e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">{t("Date")}</span>
          <input type="date" value={d.date} onChange={(e) => set("date", e.target.value)} required />
        </label>
      </div>
      <div className="split-top">
        <label className="field grow">
          <span className="field-label">{t("What for (optional)")}</span>
          <input value={d.note} onChange={(e) => set("note", e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">{t("Pay back by (optional)")}</span>
          <input type="date" value={d.due} min={d.date} onChange={(e) => set("due", e.target.value)} />
        </label>
        {d.due && (
          <label className="check split-remind">
            <input type="checkbox" checked={d.remind} onChange={(e) => set("remind", e.target.checked)} />
            {t("Add a reminder for that day")}
          </label>
        )}
      </div>
      {error && <p className="err" role="alert">{error}</p>}
      <div className="row-gap">
        <button className="btn primary" disabled={busy}>
          {busy ? t("Saving…") : t("Save")}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          {t("Cancel")}
        </button>
      </div>
    </form>
  );
}

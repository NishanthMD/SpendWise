import { useState } from "react";
import { api } from "./api";
import { Owl } from "./Critters.jsx";
import Empty from "./Empty.jsx";
import { longDate, plural, rupee, todayISO } from "./format";
import { useLang } from "./i18n.jsx";

export default function Reminders({ items, onChanged }) {
  const { t } = useLang();
  const [draft, setDraft] = useState({ title: "", due: todayISO(), amount: "" });
  const [error, setError] = useState("");
  const [perm, setPerm] = useState(typeof Notification === "undefined" ? "unsupported" : Notification.permission);

  async function add(e) {
    e.preventDefault();
    try {
      await api.addReminder(draft.title.trim(), draft.due, draft.amount ? Number(draft.amount) : null);
      setDraft({ title: "", due: todayISO(), amount: "" });
      setError("");
      onChanged();
    } catch (x) {
      setError(x.message);
    }
  }

  const toggle = async (r) => {
    await api.doneReminder(r.id, !r.done);
    onChanged();
  };
  const remove = async (r) => {
    await api.deleteReminder(r.id);
    onChanged();
  };

  const today = todayISO();
  const due = items.filter((r) => !r.done && r.due_date <= today);
  const owlTips = due.length
    ? [
        `${plural(due.length, "reminder")} ${t("due")}: ${due.slice(0, 3).map((r) => r.title).join(", ")}.`,
        due.some((r) => r.amount) ? t("That is {amount} to pay.", { amount: rupee(due.reduce((a, r) => a + (r.amount || 0), 0)) }) : t("Tick it off once it is done."),
      ]
    : [];

  return (
    <section aria-labelledby="rem-h" className="narrow">
      <div className="row-between">
        <h2 id="rem-h">{t("Reminders")}</h2>
        {due.length > 0 && (
          <div className="owl-spot">
            <Owl size={92} align="end" tips={owlTips} />
          </div>
        )}
      </div>
      <p className="hint">{t("For rent, a credit card bill, a subscription renewal, or paying someone back.")}</p>
      <form className="rem-form" onSubmit={add}>
        <label className="field grow">
          <span className="field-label">{t("What is due")}</span>
          <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required />
        </label>
        <label className="field">
          <span className="field-label">{t("Due date")}</span>
          <input type="date" value={draft.due} onChange={(e) => setDraft({ ...draft, due: e.target.value })} required />
        </label>
        <label className="field">
          <span className="field-label">{t("Amount (optional)")}</span>
          <input type="number" min="0" step="0.01" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
        </label>
        <button className="btn primary">{t("Add reminder")}</button>
      </form>
      {perm === "default" && (
        <p className="hint">
          {t("Want a pop-up when something is due?")}{" "}
          <button className="link" onClick={() => Notification.requestPermission().then(setPerm)}>
            {t("Allow notifications")}
          </button>
          . {t("They appear while this page is open.")}
        </p>
      )}
      {perm === "denied" && <p className="hint">{t("Notifications are blocked for this site, so reminders show as a banner only.")}</p>}
      {error && <p className="msg err">{error}</p>}
      {items.length === 0 ? (
        <Empty compact title={t("No reminders yet")} tips={[t("Add the first bill you do not want to miss."), t("Rent, recharge, a friend to pay back.")]}>
          <p>{t("Add the first bill or payment you do not want to miss.")}</p>
        </Empty>
      ) : (
        <table className="ledger">
          <thead>
            <tr>
              <th>{t("Done")}</th>
              <th>{t("What")}</th>
              <th>{t("Due")}</th>
              <th className="num">{t("Amount")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((r) => {
              const overdue = !r.done && r.due_date < today;
              const dueToday = !r.done && r.due_date === today;
              return (
                <tr key={r.id} className={r.done ? "done" : ""}>
                  <td>
                    <input type="checkbox" aria-label={`${t("Mark as done")}: ${r.title}`} checked={!!r.done} onChange={() => toggle(r)} />
                  </td>
                  <td>{r.title}</td>
                  <td className="nowrap">
                    {longDate(r.due_date)}
                    {overdue && <span className="tag warn">{t("Overdue")}</span>}
                    {dueToday && <span className="tag warn">{t("Due today")}</span>}
                  </td>
                  <td className="num">{r.amount ? rupee(r.amount) : ""}</td>
                  <td className="num">
                    <button className="link" onClick={() => remove(r)}>
                      {t("Delete")}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

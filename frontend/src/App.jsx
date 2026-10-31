import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import Budgets from "./Budgets.jsx";
import Ledger from "./Ledger.jsx";
import Logo from "./Logo.jsx";
import SlideToggle from "./SlideToggle.jsx";
import TabBar from "./TabBar.jsx";
import StickyDash, { holdDash } from "./StickyDash.jsx";
import Rajyotsava from "./Rajyotsava.jsx";
import { useLang } from "./i18n.jsx";
import { CritterDefs, Piggy, TurtleLoader } from "./Critters.jsx";
import { longDate, monthLabel, monthRange, plural, rupee, todayISO } from "./format";
import Notes from "./Notes.jsx";
import Overview from "./Overview.jsx";
import Passbook from "./Passbook.jsx";
import Reminders from "./Reminders.jsx";
import { useTheme } from "./theme";

const TABS = [["Overview", "Overview"], ["Transactions", "Transactions"], ["Owed", "Owed money"], ["Budgets", "Budgets"], ["Notes", "Notes"], ["Reminders", "Reminders"]];

function stored(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

export default function App() {
  const { t, shown, setLang } = useLang();
  const [splitFrom, setSplitFrom] = useState(null); // a passbook entry being split
  const [tab, setTab] = useState("Overview");
  const [version, setVersion] = useState(0); // bump to refetch after uploads/edits
  const [all, setAll] = useState(null); // summary of every transaction, used for the month list
  const [period, setPeriod] = useState("all"); // "all" | "YYYY-MM" | "custom"
  const [custom, setCustom] = useState({ start: "", end: "" });
  const [reminders, setReminders] = useState([]);
  const [upload, setUpload] = useState({ phase: "idle" });
  const [clearing, setClearing] = useState(false);
  const [theme, setTheme] = useTheme();
  const [bankInfo, setBankInfo] = useState({ banks: [], account_types: [] });
  const [accounts, setAccounts] = useState([]);
  const [account, setAccount] = useState(""); // "" = every account; otherwise an account id such as "axis|current" or "none"
  const [pick, setPick] = useState(() => stored("sw-pick", { bank: "auto", type: "savings" })); // what the next upload is from

  // Choosing a section from the pinned tabs: the page eases until the page's own tab bar sits exactly where the pinned bar
  // is, then the two swap places without any visible change, and the new section fades in underneath. The old section
  // stays in place while the page moves, so the page height never changes under you.
  const chooseTab = useCallback((id) => {
    const home = document.querySelector(".shell > .tabs");
    const pinned = document.documentElement.classList.contains("dash-on");
    const y0 = window.scrollY;
    const target = home ? Math.max(0, home.getBoundingClientRect().top + y0 - 10) : 0;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!pinned || reduced || y0 <= target + 8) {
      setTab(id);
      return;
    }
    holdDash(3000, true);
    const ms = Math.min(900, 450 + (y0 - target) * 0.12);
    const t0 = performance.now();
    let stop = false;
    const cancel = () => (stop = true);
    window.addEventListener("touchstart", cancel, { passive: true, once: true });
    const arrive = () => {
      window.removeEventListener("touchstart", cancel);
      const el = document.documentElement;
      el.classList.add("handoff"); // swap the two bars with no transition so it looks like one bar that stayed put
      holdDash(600, false);
      setTab(id);
      setTimeout(() => el.classList.remove("handoff"), 250);
    };
    const step = (now) => {
      if (stop) return arrive();
      const p = Math.min(1, (now - t0) / ms);
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; // ease in and out
      window.scrollTo(0, y0 + (target - y0) * e);
      if (p < 1) requestAnimationFrame(step);
      else {
        window.scrollTo(0, target);
        arrive();
      }
    };
    requestAnimationFrame(step);
  }, []);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    api.banks().then(setBankInfo).catch(() => {});
  }, []);

  useEffect(() => {
    api.accounts().then(setAccounts).catch(() => {});
  }, [version]);

  useEffect(() => {
    try {
      localStorage.setItem("sw-pick", JSON.stringify(pick));
    } catch {
      /* storage can be blocked; the choice just is not remembered */
    }
  }, [pick]);

  // If the account you were viewing no longer exists (rows deleted or reassigned), go back to all accounts.
  useEffect(() => {
    if (account && accounts.length && !accounts.some((a) => a.id === account)) setAccount("");
  }, [accounts, account]);

  useEffect(() => {
    api.summary(undefined, undefined, account || undefined).then(setAll).catch(() => setAll({ empty: true, error: true }));
  }, [version, account]);

  // Reminders: banner while due, plus a browser notification once per day per reminder while the page is open.
  useEffect(() => {
    let live = true;
    const check = () =>
      api
        .reminders()
        .then((rs) => {
          if (!live) return;
          setReminders(rs);
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            rs.filter((r) => !r.done && r.due_date <= todayISO()).forEach((r) => {
              const key = `notified-${r.id}-${todayISO()}`;
              try {
                if (sessionStorage.getItem(key)) return;
                sessionStorage.setItem(key, "1");
              } catch {
                /* storage blocked: at worst the notification repeats on the next check */
              }
              new Notification(t("Reminder") + ": " + r.title, { body: r.amount ? `${t("Due")} ${longDate(r.due_date)}, ${rupee(r.amount)}` : `${t("Due")} ${longDate(r.due_date)}` });
            });
          }
        })
        .catch(() => {});
    check();
    const id = setInterval(check, 60000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [version]);
  const dueReminders = useMemo(() => reminders.filter((r) => !r.done && r.due_date <= todayISO()), [reminders]);


  const months = useMemo(() => (all && !all.empty ? all.monthly.map((m) => m.period).reverse() : []), [all]);

  const range = useMemo(() => {
    const acct = account || undefined;
    if (period === "all") return { start: undefined, end: undefined, account: acct };
    if (period === "custom") return { start: custom.start || undefined, end: custom.end || undefined, account: acct };
    return { ...monthRange(period), account: acct };
  }, [period, custom, account]);

  const rangeLabel =
    period === "all"
      ? all && !all.empty
        ? `${longDate(all.start)} ${t("to")} ${longDate(all.end)}`
        : t("No statement yet")
      : period === "custom"
      ? `${custom.start ? longDate(custom.start) : "…"} ${t("to")} ${custom.end ? longDate(custom.end) : "…"}`
      : monthLabel(period);

  return (
    <div className="shell">
      <CritterDefs />
      <StickyDash tabs={TABS} tab={tab} onTab={chooseTab} badges={{ Reminders: dueReminders.length }} />
      <a className="skip" href="#main">
        {t("Skip to content")}
      </a>
      <header className="top">
        <div className="brand">
          <Logo size={52} className="brand-logo" />
          <div className="brand-text">
            <span className="brand-name">SpendWise</span>
            <span className="brand-sub">
              {rangeLabel}
              {accounts.length === 1 && accounts[0].id !== "none" ? ` · ${accounts[0].label}` : ""}
            </span>
          </div>
        </div>
        <div className="top-switches">
          <SlideToggle className="lang-toggle" label={t("Language")} value={shown} onChange={setLang} options={[["en", "English", "en"], ["kn", "ಕನ್ನಡ", "kn"]]} />
          <SlideToggle className="theme-switch" fast label={t("Colour theme")} value={theme} onChange={setTheme} options={[["system", t("Auto")], ["light", t("Light")], ["dark", t("Dark")]]} />
        </div>
      </header>

      <TabBar tabs={TABS} tab={tab} onTab={chooseTab} badges={{ Reminders: dueReminders.length }} />

      {clearing && (
        <ClearAll
          onCancel={() => setClearing(false)}
          onDone={() => {
            setClearing(false);
            setPeriod("all");
            setAccount("");
            setUpload({ phase: "idle" });
            reload();
          }}
        />
      )}
      <Rajyotsava />
      <SourceBar
        pick={pick}
        setPick={setPick}
        info={bankInfo}
        upload={<UploadButton state={upload} setState={setUpload} onDone={reload} pick={pick} />}
        view={
<>
      <label className="field">
        <span className="field-label">{t("Period")}</span>
        <select value={period} onChange={(e) => setPeriod(e.target.value)}>
          <option value="all">{t("All time")}</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
          <option value="custom">{t("Custom range")}</option>
        </select>
      </label>
      {accounts.length > 1 && (
        <label className="field">
          <span className="field-label">{t("Account")}</span>
          <select value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="">{t("All accounts")}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} ({a.count})
              </option>
            ))}
          </select>
        </label>
      )}
      {period === "custom" && (
        <>
          <label className="field">
            <span className="field-label">{t("From")}</span>
            <input type="date" value={custom.start} onChange={(e) => setCustom({ ...custom, start: e.target.value })} />
          </label>
          <label className="field">
            <span className="field-label">{t("To")}</span>
            <input type="date" value={custom.end} onChange={(e) => setCustom({ ...custom, end: e.target.value })} />
          </label>
        </>
      )}
      {accounts.length > 0 && (
        <button className="btn" onClick={() => setClearing(true)}>
          {t("Clear all")}
        </button>
      )}
      </>
        }
      />
      <UploadStatus state={upload} setState={setUpload} />
      <Unassigned accounts={accounts} info={bankInfo} defaults={pick} onDone={reload} />


      {dueReminders.length > 0 && tab !== "Reminders" && (
        <div className="banner" role="status">
          <strong>{dueReminders.length === 1 ? t("1 reminder is due") : t("{n} reminders are due", { n: dueReminders.length })}:</strong>{" "}
          {dueReminders.slice(0, 3).map((r) => r.title).join(", ")}
          <button className="link" onClick={() => setTab("Reminders")}>
            {t("Open reminders")}
          </button>
        </div>
      )}

      <main id="main">
        <div key={tab} className="panel">
        {tab === "Overview" && <Overview range={range} version={version} hasData={all && !all.empty} quiet={upload.phase === "busy" || upload.phase === "done"} goTo={setTab} />}
        {tab === "Transactions" && (
          <Passbook
            range={range}
            version={version}
            onChanged={reload}
            onSplit={(e) => {
              setSplitFrom(e);
              setTab("Owed");
            }}
          />
        )}
        {tab === "Owed" && <Ledger version={version} onChanged={reload} splitFrom={splitFrom} clearSplitFrom={() => setSplitFrom(null)} />}
        {tab === "Budgets" && <Budgets range={range} version={version} onSaved={reload} />}
        {tab === "Notes" && <Notes />}
        {tab === "Reminders" && <Reminders items={reminders} version={version} onChanged={reload} />}
        </div>
      </main>

      <footer className="foot">
        <strong>{t("Stored in this browser only.")}</strong>{" "}
        {t("Your transactions, notes, reminders, budgets and owed money are saved in this browser on this device, and nobody else can see them. When you upload a statement, the PDF is sent to the server just long enough to be read, then discarded: it is never saved or logged. There are no accounts and no bank connection.")}
        <DataBackup onDone={reload} />
      </footer>
    </div>
  );
}

/** Your data lives in this browser, so offer a way to keep a copy and to move it to another device. */
function DataBackup({ onDone }) {
  const { t } = useLang();
  const input = useRef(null);
  const [msg, setMsg] = useState({ text: "", error: false });
  async function download() {
    const data = await api.exportBackup();
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `spendwise-backup-${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    setMsg({ text: t("Backup saved. It is plain text: keep it somewhere private."), error: false });
  }
  async function restore(file) {
    if (!file) return;
    try {
      if (!window.confirm(t("Restoring replaces everything in this browser with the backup. Continue?"))) return;
      const r = await api.importBackup(JSON.parse(await file.text()));
      setMsg({ text: t("Restored {n} transactions.", { n: r.transactions }), error: false });
      onDone();
    } catch (e) {
      setMsg({ text: e instanceof SyntaxError ? t("That file is not a SpendWise backup.") : e.message, error: true });
    }
    if (input.current) input.current.value = "";
  }
  return (
    <div className="backup row-gap">
      <button className="btn" onClick={download}>
        {t("Download backup")}
      </button>
      <button className="btn" onClick={() => input.current.click()}>
        {t("Restore backup")}
      </button>
      <input ref={input} type="file" accept="application/json,.json" hidden onChange={(e) => restore(e.target.files[0])} />
      {msg.text && (
        <span className={msg.error ? "err" : "ok-note"} role="status">
          {msg.text}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ */
function UploadButton({ state, setState, onDone, pick }) {
  const { t } = useLang();
  const input = useRef(null);
  const [pending, setPending] = useState(null); // file waiting for a password
  const [password, setPassword] = useState("");

  async function send(file, pw) {
    setState({ phase: "busy" });
    try {
      const r = await api.upload(file, pw, pick.bank, pick.type);
      setPending(null);
      setPassword("");
      setState({ phase: "done", result: r });
      onDone();
    } catch (e) {
      const needsPassword = /password/i.test(e.message);
      if (needsPassword) setPending(file);
      setState({ phase: "error", message: e.message, needsPassword });
    }
    if (input.current) input.current.value = "";
  }

  return (
    <div className="upload">
      <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => e.target.files[0] && send(e.target.files[0])} />
      <button className="btn primary" disabled={state.phase === "busy"} onClick={() => input.current.click()}>
        {state.phase === "busy" ? t("Reading…") : t("Upload statement")}
      </button>
      {pending && (
        <form
          className="pw"
          onSubmit={(e) => {
            e.preventDefault();
            send(pending, password);
          }}
        >
          <input type="password" aria-label={t("PDF password")} autoFocus placeholder={t("PDF password")} value={password} onChange={(e) => setPassword(e.target.value)} />
          <button className="btn">{t("Unlock")}</button>
        </form>
      )}
    </div>
  );
}

const bankName = (id) => ({ canara: "Canara Bank", axis: "Axis Bank", sbi: "State Bank of India", hdfc: "HDFC Bank", icici: "ICICI Bank", kotak: "Kotak Mahindra Bank" }[id] || id);

const CONFIDENCE = {
  real: "Built on a real statement from this bank, read and reconciled to the rupee.",
  layout: "The column layout and narration shapes were checked against a statement from this bank.",
  public: "Based on publicly shared sample statements, not yet tested on a real file. The reader still finds the columns itself, and the balance check will tell you if anything was misread.",
};

/** Which bank and account the next upload is from, and how that bank's statements are read. */
function SourceBar({ pick, setPick, info, upload, view }) {
  const { t } = useLang();
  const bank = info.banks.find((b) => b.id === pick.bank);
  const type = info.account_types.find((ty) => ty.id === pick.type);
  return (
    <section className="source-bar control-panel" aria-label={t("Where the next statement is from")}>
      <div className="cp-group">
        <span className="cp-title">{t("Statement")}</span>
        <div className="cp-row">
      <label className="field">
        <span className="field-label">{t("Bank")}</span>
        <select value={pick.bank} onChange={(e) => setPick({ ...pick, bank: e.target.value })}>
          <option value="auto">{t("Detect from the PDF")}</option>
          {info.banks.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">{t("Account type")}</span>
        <select value={pick.type} onChange={(e) => setPick({ ...pick, type: e.target.value })}>
          {info.account_types.map((ty) => (
            <option key={ty.id} value={ty.id}>
              {t(ty.name)}
            </option>
          ))}
        </select>
      </label>
      {upload}
        </div>
      </div>
      <div className="cp-group">
        <span className="cp-title">{t("View")}</span>
        <div className="cp-row">{view}</div>
      </div>
      <details className="bank-how">
        <summary>{bank ? t("How {bank}'s statements are read", { bank: bank.name }) : t("How your bank's statements are read")}</summary>
        {bank ? (
          <dl>
            <dt>{t("Columns")}</dt>
            <dd>{bank.columns}</dd>
            <dt>{t("Amounts")}</dt>
            <dd>{bank.amounts}</dd>
            <dt>{t("Dates")}</dt>
            <dd>{bank.dates}</dd>
            <dt>{t("Payee in the narration")}</dt>
            <dd>
              <code>{bank.narration}</code>
            </dd>
            <dt>{t("Row order")}</dt>
            <dd>{bank.order}. {t("The reader checks which direction the balance reconciles, so a newest-first statement is put oldest first.")}</dd>
            <dt>{t("How sure we are")}</dt>
            <dd>{t(CONFIDENCE[bank.confidence])}</dd>
            {bank.notes && (
              <>
                <dt>{t("Note")}</dt>
                <dd>{bank.notes}</dd>
              </>
            )}
          </dl>
        ) : (
          <p>
            With "Detect from the PDF", the bank is recognised from its name or IFSC code at the top of the first page. Either way the reader finds the
            columns itself (Date, Narration or Particulars, Debit and Credit or one Amount with Dr/Cr, Balance), works out whether the statement runs
            newest first, and checks every row against the running balance.
          </p>
        )}
        {type && <p className="hint">{type.name}: {type.note}</p>}
      </details>
    </section>
  );
}

/** Rows saved before you chose a bank have no account. Say which one they are, once. */
function Unassigned({ accounts, info, defaults, onDone }) {
  const { t } = useLang();
  const none = accounts.find((a) => a.id === "none");
  const [bank, setBank] = useState(defaults.bank === "auto" ? "" : defaults.bank);
  const [type, setType] = useState(defaults.type);
  const [busy, setBusy] = useState(false);
  if (!none || !info.banks.length) return null;
  async function assign() {
    setBusy(true);
    try {
      await api.assignAccount("none", bank, type);
      onDone();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="banner assign" role="status">
      <span>
        <strong>{plural(none.count, "saved transaction")}</strong> {none.count === 1 ? t("has no bank set. Which account is it from?") : t("have no bank set. Which account are they from?")}
      </span>
      <select aria-label={t("Bank for the saved transactions")} value={bank} onChange={(e) => setBank(e.target.value)}>
        <option value="">{t("Choose a bank")}</option>
        {info.banks.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      <select aria-label={t("Account type for the saved transactions")} value={type} onChange={(e) => setType(e.target.value)}>
        {info.account_types.map((ty) => (
          <option key={ty.id} value={ty.id}>
            {t(ty.name)}
          </option>
        ))}
      </select>
      <button className="btn" disabled={!bank || busy} onClick={assign}>
        {t("Save")}
      </button>
    </div>
  );
}

/** Start over: remove everything you uploaded and set up. The PDFs themselves are never kept. */
function ClearAll({ onCancel, onDone }) {
  const { t } = useLang();
  const [notes, setNotes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function go() {
    setBusy(true);
    try {
      await api.resetAll(notes);
      onDone();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  return (
    <div className="banner clear-all" role="alertdialog" aria-label={t("Clear all data")}>
      <p>
        <strong>{t("Clear everything?")}</strong>{" "}
        {t("This removes every transaction, the record of each upload, the categories you chose and your budgets, and puts the app back as it was before your first upload. Your PDFs are not stored, so there is nothing else to delete. This cannot be undone.")}
      </p>
      <label className="check">
        <input type="checkbox" checked={notes} onChange={(e) => setNotes(e.target.checked)} />
        {t("Also delete my notes, reminders and owed money")}
      </label>
      <div className="row-gap">
        <button className="btn danger" onClick={go} disabled={busy}>
          {busy ? t("Clearing…") : t("Clear all")}
        </button>
        <button className="btn" onClick={onCancel} disabled={busy}>
          {t("Keep my data")}
        </button>
        {error && <span className="err">{error}</span>}
      </div>
    </div>
  );
}

function UploadStatus({ state, setState }) {
  const { t } = useLang();
  useEffect(() => {
    if (state.phase !== "done") return undefined;
    const t = setTimeout(() => setState({ phase: "idle" }), 14000);
    return () => clearTimeout(t);
  }, [state, setState]);

  if (state.phase === "busy") return <div className="upload-banner"><TurtleLoader text={t("Reading your statement, one row at a time…")} /></div>;
  if (state.phase === "error")
    return (
      <div className="upload-banner err" role="alert">
        <p>{state.message}</p>
        <button className="link" onClick={() => setState({ phase: "idle" })}>
          {t("Dismiss")}
        </button>
      </div>
    );
  if (state.phase !== "done") return null;

  const r = state.result;
  return (
    <div className="upload-banner ok" role="status">
      <Piggy celebrate size={84} align="start" tips={[t("Tucked away safely, only in this browser."), t("{n} saved.", { n: plural(r.added, "new entry", "new entries") })]} />
      <div>
        <p>
          <strong>
            {r.added > 0 ? t("Added {n}", { n: plural(r.added, "transaction") }) : t("Nothing new to add")}
          </strong>
          {r.duplicates_skipped > 0 && ` (${t("{n} already saved", { n: r.duplicates_skipped })})`}.{" "}
          {r.balance_check_passed ? (
            <span className="check-ok">{t("Balance check passed")}</span>
          ) : (
            <span className="check-bad">{plural(r.balance_mismatches, "row")} {r.balance_mismatches === 1 ? t("does") : t("do")} {t("not match the running balance")}</span>
          )}
          {r.balance_check_passed ? ": " + t("every row follows from the one before it.") : ". " + t("Compare them with your statement.")}
        </p>
        <small>
          {t("Read as")} {r.account_label}
          {r.bank_detected && r.bank_detected !== r.bank ? ` (${t("the PDF looks like")} ${bankName(r.bank_detected)})` : r.bank_detected ? ` (${t("detected from the PDF")})` : ""}.
          {r.order === "newest_first" ? " " + t("The bank lists newest first, so I read it oldest first.") : ""}
        </small>
        {r.bank_warning && <small className="err"> {r.bank_warning}</small>}
        {r.reversals > 0 && <small> {plural(r.reversals, "failed payment")} {t("and its refund were found and are left out of your totals.")}</small>}
      </div>
      <button className="link" onClick={() => setState({ phase: "idle" })}>
        {t("Dismiss")}
      </button>
    </div>
  );
}

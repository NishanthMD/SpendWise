import { Fragment, useEffect, useState } from "react";
import { api } from "./api";
import Empty from "./Empty.jsx";
import { colorFor, dmy, plural, rupee } from "./format";
import { useLang } from "./i18n.jsx";
import SlideToggle from "./SlideToggle.jsx";

const PAGE = 15; // a quiet page-break divider every this many entries, like the pages of a printed passbook
const money = (n) => Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const SORTS = [
  ["statement", "Statement order"],
  ["date_desc", "Date, newest first"],
  ["date_asc", "Date, oldest first"],
  ["payee_asc", "Payee, A to Z"],
  ["payee_desc", "Payee, Z to A"],
  ["amount_desc", "Amount, highest first"],
  ["amount_asc", "Amount, lowest first"],
  ["category", "Category"],
];
const SORT_LABEL = Object.fromEntries(SORTS);
// Clicking a column heading cycles through these, then back to statement order.
const HEAD_CYCLE = { date: ["date_desc", "date_asc"], payee: ["payee_asc", "payee_desc"], amount: ["amount_desc", "amount_asc"] };

export default function Passbook({ range, version, onChanged, onSplit }) {
  const { t, cat } = useLang();
  const [data, setData] = useState(null);
  const [cats, setCats] = useState([]);
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState(""); // "" | "in" | "out"
  const [minAmt, setMinAmt] = useState("");
  const [maxAmt, setMaxAmt] = useState("");
  const [sort, setSort] = useState("statement");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [compact, setCompact] = useState(() => {
    try {
      return localStorage.getItem("sw-compact") === "1";
    } catch {
      return false;
    }
  });
  const [applyAll, setApplyAll] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    api.categories().then(setCats).catch(() => {});
  }, []);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      api
        .passbook({ start: range.start, end: range.end, account: range.account, category, q, sort, kind, min_amount: minAmt, max_amount: maxAmt })
        .then((r) => live && (setData(r), setError("")))
        .catch((e) => live && setError(e.message));
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [range.start, range.end, range.account, category, q, sort, kind, minAmt, maxAmt, version]);

  const active = Boolean(category || q || kind || minAmt || maxAmt);
  const filterCount = [kind, category, minAmt || maxAmt].filter(Boolean).length;
  const reset = () => {
    setCategory("");
    setQ("");
    setKind("");
    setMinAmt("");
    setMaxAmt("");
    setSort("statement");
  };

  function toggleCompact(on) {
    setCompact(on);
    try {
      localStorage.setItem("sw-compact", on ? "1" : "0");
    } catch {
      /* storage can be blocked; the toggle still works for this visit */
    }
  }

  function clickHead(which) {
    const [first, second] = HEAD_CYCLE[which];
    setSort(sort === first ? second : sort === second ? "statement" : first);
  }
  const ariaSort = (which) => {
    const [first, second] = HEAD_CYCLE[which];
    return sort === first ? (which === "date" || which === "amount" ? "descending" : "ascending") : sort === second ? (which === "date" || which === "amount" ? "ascending" : "descending") : "none";
  };

  async function change(e, value) {
    try {
      await api.setCategory(e.id, value, applyAll);
      setNotice(
        applyAll
          ? t("Saved. {payee} is now filed under {category}, and future uploads will file it there too.", { payee: e.merchant, category: cat(value) })
          : t("Saved for this one payment to {payee}.", { payee: e.merchant })
      );
      onChanged();
    } catch (x) {
      setError(x.message);
    }
  }

  if (error && !data) return <p className="msg err">{t("Could not load the passbook")}: {error}. {t("Is the server running?")}</p>;
  if (!data) return <p className="msg">{t("Loading…")}</p>;

  if (data.empty && !active) {
    return (
      <Empty title={t("No transactions in this period")} tips={[t("Upload a statement and I will hop through it."), t("Try another period, or upload a newer statement.")]}>
        <p>{t("Choose Upload statement at the top, or pick a different period. Everything you upload stays on this computer.")}</p>
      </Empty>
    );
  }

  const entries = data.entries || [];
  const inStatementOrder = !data.sorted && !data.filtered;
  const headSort = (which, label, right) => (
    <span role="columnheader" className={right ? "pb-num" : ""} aria-sort={ariaSort(which)}>
      <button className={"head-sort" + (ariaSort(which) !== "none" ? " on" : "")} onClick={() => clickHead(which)} title={t("Click to sort, again to reverse, a third time to clear")}>
        {label}
        <span aria-hidden="true">{ariaSort(which) === "ascending" ? " ↑" : ariaSort(which) === "descending" ? " ↓" : ""}</span>
      </button>
    </span>
  );

  return (
    <section aria-labelledby="pb-h">
      <h2 id="pb-h">{t("Transactions")}</h2>

      {!data.empty && <Summary d={data} />}

      <div className="toolbar glass" role="search">
        <div className="tb-row">
          <label className="tb-search">
            <span className="sr-only">{t("Search payee or narration")}</span>
            <input type="search" placeholder={t("Search payee or narration")} value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <label className="tb-sort">
            <span className="sr-only">{t("Sort by")}</span>
            <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label={t("Sort by")}>
              {SORTS.map(([v, l]) => (
                <option key={v} value={v}>
                  {v === "statement" ? t("Sort: statement order") : t(l)}
                </option>
              ))}
            </select>
          </label>
          <button className={"btn tb-more" + (filtersOpen ? " on" : "")} aria-expanded={filtersOpen} aria-controls="more-filters" onClick={() => setFiltersOpen(!filtersOpen)}>
            {t("Filters")}{filterCount > 0 ? ` · ${filterCount}` : ""}
          </button>
        </div>
        {filtersOpen && (
          <div id="more-filters" className="tb-panel">
            <SlideToggle label={t("Money in or out")} value={kind} onChange={setKind} options={[["", t("All")], ["in", t("Money in")], ["out", t("Money out")]]} />
            <label className="field">
              <span className="field-label">{t("Category")}</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">{t("Any category")}</option>
                {cats.map((c) => (
                  <option key={c} value={c}>{cat(c)}</option>
                ))}
              </select>
            </label>
            <div className="field tb-amt">
              <span className="field-label">{t("Amount (₹)")}</span>
              <div className="tb-amt-row">
                <input aria-label={t("Amount from")} type="number" inputMode="decimal" min="0" step="any" value={minAmt} onChange={(e) => setMinAmt(e.target.value)} placeholder={t("From")} />
                <span aria-hidden="true">{t("to")}</span>
                <input aria-label={t("Amount to")} type="number" inputMode="decimal" min="0" step="any" value={maxAmt} onChange={(e) => setMaxAmt(e.target.value)} placeholder={t("To")} />
              </div>
            </div>
            <div className="tb-opts">
              <label className="check">
                <input type="checkbox" checked={compact} onChange={(e) => toggleCompact(e.target.checked)} />
                {t("Compact table")}
              </label>
              <label className="check">
                <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} />
                {t("A category change applies to the whole payee")}
              </label>
            </div>
          </div>
        )}
        {(active || sort !== "statement") && (
          <button className="link tb-clear" onClick={reset}>
            {t("Clear sort and filters")}
          </button>
        )}
      </div>

      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && <p className="msg err">{error}</p>}

      {!data.empty && (data.filtered || data.sorted) && (
        <p className="hint view-line" role="status">
          {t("Showing {shown} of {total}", { shown: entries.length, total: plural(data.entry_count, "entry", "entries") })}
          {data.sorted ? `, ${t("sorted by")} ${t(SORT_LABEL[data.sort]).toLowerCase()}` : ""}. {t("In")} {rupee(data.shown_in, 2)}, {t("out")} {rupee(data.shown_out, 2)}.
          {data.sorted && " " + t("The Balance column is the bank's balance after each entry, so it only reads straight down in statement order.")}
        </p>
      )}

      {entries.length === 0 ? (
        <p className="msg">{t("No entries match. Clear the filters or widen the amount range.")}</p>
      ) : (
        <div className={"passbook" + (compact ? " compact" : "")} role="table" aria-label={t("Passbook entries")}>
          <div className="pb-row pb-head" role="row">
            {headSort("date", t("Date"))}
            {headSort("payee", t("Particulars"))}
            <span role="columnheader" className="pb-num" aria-sort={ariaSort("amount")}>
              <button className={"head-sort" + (ariaSort("amount") !== "none" ? " on" : "")} onClick={() => clickHead("amount")} title={t("Sort by amount")}>
                {t("Deposits")}
              </button>
            </span>
            <span role="columnheader" className="pb-num" aria-sort={ariaSort("amount")}>
              <button className={"head-sort" + (ariaSort("amount") !== "none" ? " on" : "")} onClick={() => clickHead("amount")} title={t("Sort by amount")}>
                {t("Withdrawals")}<span aria-hidden="true">{ariaSort("amount") === "ascending" ? " ↑" : ariaSort("amount") === "descending" ? " ↓" : ""}</span>
              </button>
            </span>
            <span role="columnheader" className="pb-num">{t("Balance")}</span>
          </div>

          {inStatementOrder && data.opening_balance != null && (
            <div className="pb-row pb-edge" role="row">
              <span role="cell" />
              <span role="cell" className="pb-edge-label">{t("Opening balance")}</span>
              <span role="cell" className="pb-num" />
              <span role="cell" className="pb-num" />
              <span role="cell" className="pb-num pb-bal" data-label={t("Balance")}>{money(data.opening_balance)}</span>
            </div>
          )}

          {entries.map((e, i) => (
            <Fragment key={e.id}>
              {inStatementOrder && i > 0 && i % PAGE === 0 && (
                <div className="pb-page" aria-hidden="true">
                  <span>{t("Page")} {i / PAGE + 1}</span>
                </div>
              )}
              <Entry e={e} cats={cats} compact={compact} onChange={change} onSplit={onSplit} />
            </Fragment>
          ))}

          {inStatementOrder && data.closing_balance != null && (
            <div className="pb-row pb-edge pb-closing" role="row">
              <span role="cell" />
              <span role="cell" className="pb-edge-label">{t("Closing balance")}</span>
              <span role="cell" className="pb-num" />
              <span role="cell" className="pb-num" />
              <span role="cell" className="pb-num pb-bal" data-label={t("Balance")}>{money(data.closing_balance)}</span>
            </div>
          )}
        </div>
      )}

    </section>
  );
}

function Summary({ d }) {
  const { t } = useLang();
  const passed = d.balance_check_passed;
  return (
    <div className="pb-summary" role="group" aria-label={t("Statement summary")}>
      {d.accounts?.length > 0 && (
        <p className="pb-source">
          <span>{t("Statement")}</span> {d.accounts.join(" and ")}
        </p>
      )}
      <dl>
        <div>
          <dt>{t("Period")}</dt>
          <dd>
            {dmy(d.start)} {t("to")} {dmy(d.end)}
          </dd>
        </div>
        <div>
          <dt>{t("Opening balance")}</dt>
          <dd>{d.opening_balance == null ? "–" : money(d.opening_balance)}</dd>
        </div>
        <div>
          <dt>{t("Closing balance")}</dt>
          <dd>{d.closing_balance == null ? "–" : money(d.closing_balance)}</dd>
        </div>
        <div>
          <dt>{t("Total in")}</dt>
          <dd className="in">{money(d.total_in)}</dd>
        </div>
        <div>
          <dt>{t("Total out")}</dt>
          <dd>{money(d.total_out)}</dd>
        </div>
        <div>
          <dt>{t("Entries")}</dt>
          <dd>{d.entry_count}</dd>
        </div>
      </dl>
      <p className="pb-foot">
        {passed === true && <span className="check-ok">{t("Balance check passed")}</span>}
        {passed === false && <span className="check-bad">{d.balance_mismatches} {d.balance_mismatches === 1 ? t("row does") : t("rows do")} {t("not match the running balance")}</span>}
        {passed === null && (
          <span className="check-na">
            {d.balances_mixed ? t("Balances from different accounts do not chain, so the balance check is off. Pick one account at the top.") : t("This statement has no running balance to check")}
          </span>
        )}
        {d.reversed_pairs > 0 && (
          <small>
            {" "}
            {t("Includes {n} failed payment and its refund, which are left out of your spending and income totals.", { n: d.reversed_pairs })}
          </small>
        )}
      </p>
    </div>
  );
}

function Entry({ e, cats, compact, onChange, onSplit }) {
  const { t, cat } = useLang();
  const editable = e.kind === "debit" && !e.reversed;
  return (
    <div className={"pb-row pb-entry" + (e.reversed ? " is-reversed" : "")} role="row">
      <span role="cell" className="pb-date nowrap" data-label={t("Date")}>
        {dmy(e.date)}
      </span>
      <div role="cell" className="pb-part">
        <div className="pb-payee">
          {e.merchant}
          {e.reversed && (
            <span className="tag" title={t("A failed payment and its refund cancel out, so neither counts")}>
              {t("Reversed")}
            </span>
          )}
        </div>
        {e.remark && !compact && <small className="pb-remark">{e.remark}</small>}
        <div className="pb-meta">
          {editable ? (
            <label className="cat">
              <span className="dot" style={{ background: colorFor(e.category) }} />
              <select aria-label={`${t("Category for")} ${e.merchant}`} value={e.category} onChange={(ev) => onChange(e, ev.target.value)}>
                {cats.filter((c) => c !== "Income" && c !== "Reversed").map((c) => (
                  <option key={c} value={c}>{cat(c)}</option>
                ))}
              </select>
            </label>
          ) : (
            !e.reversed && <span className="tag">{t("Income")}</span>
          )}
          <details className="pb-raw">
            <summary>{t("Narration")}</summary>
            <code>{e.description}</code>
          </details>
          {editable && onSplit && (
            <button className="link split-link" onClick={() => onSplit(e)}>
              {t("Split this bill")}
            </button>
          )}
        </div>
      </div>
      <span role="cell" className="pb-num in" data-label={t("Deposits")}>
        {e.deposit != null ? money(e.deposit) : ""}
      </span>
      <span role="cell" className="pb-num" data-label={t("Withdrawals")}>
        {e.withdrawal != null ? money(e.withdrawal) : ""}
      </span>
      <span role="cell" className="pb-num pb-bal" data-label={t("Balance")}>
        {e.balance != null ? money(e.balance) : ""}
      </span>
    </div>
  );
}

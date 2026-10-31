import * as store from "./store.js";

/* Your data never leaves your browser (see store.js). The only things sent to the server are a statement PDF to be read,
 * and the rows to add up for a chart or a report; the server answers and forgets. */
const BASE = (import.meta.env && import.meta.env.VITE_API_BASE) || "/api";

async function req(path, opts = {}) {
  let res;
  try {
    res = await fetch(BASE + path, opts);
  } catch {
    throw new Error("Could not reach the SpendWise server. Check your connection and try again.");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
      if (Array.isArray(detail)) detail = "Something in the request was not valid.";
    } catch {
      /* response had no JSON body */
    }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return res;
}
const post = (path, body) => req(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const local = (fn) => new Promise((resolve, reject) => {
  try {
    resolve(fn());
  } catch (e) {
    reject(e);
  }
});

let bankCache;
const banks = () => (bankCache ||= req("/banks").then((r) => r.json()).catch((e) => ((bankCache = null), Promise.reject(e))));
let catCache;

const accountLabel = (account, info) => {
  if (!account) return "Bank not set";
  const [bank, kind] = account.split("|");
  const b = info.banks.find((x) => x.id === bank) || info.banks.find((x) => x.id === "other");
  const t = (info.account_types.find((x) => x.id === kind) || { name: kind }).name;
  return `${b.name}, ${t.toLowerCase()}`;
};
const accountId = (bank, type) => `${bank || "other"}|${type || "savings"}`;

/** Rows plus the filters every server calculation takes. */
const scopeBody = (p = {}) => ({ rows: store.rowsForServer(), start: p.start || null, end: p.end || null, account: p.account || null });

export const api = {
  /* ---- the server reads and adds up; it stores nothing */
  upload: async (file, password, bank, accountType) => {
    const fd = new FormData();
    fd.append("file", file);
    if (password) fd.append("password", password);
    if (bank) fd.append("bank", bank);
    if (accountType) fd.append("account_type", accountType);
    fd.append("overrides", JSON.stringify(store.getOverrides()));
    fd.append("saved_merchants", JSON.stringify(store.knownMerchants()));
    const res = await (await req("/parse", { method: "POST", body: fd })).json();
    const saved = store.addParsed(res);
    const { transactions, rename, overrides, ...info } = res;
    return { ...info, ...saved };
  },
  banks,
  categories: () => (catCache ||= req("/categories").then((r) => r.json()).catch((e) => ((catCache = null), Promise.reject(e)))),
  summary: async (start, end, account) => (await post("/summary", { ...scopeBody({ start, end, account }), budgets: store.getBudgets() })).json(),
  passbook: async (p) =>
    (await post("/passbook", {
      ...scopeBody(p), category: p.category || null, q: p.q || null, sort: p.sort || "statement", kind: p.kind || null,
      min_amount: p.min_amount === "" || p.min_amount == null ? null : Number(p.min_amount),
      max_amount: p.max_amount === "" || p.max_amount == null ? null : Number(p.max_amount),
    })).json(),
  averageDaily: async (start, end, account) => (await post("/average-daily", scopeBody({ start, end, account }))).json(),
  downloadReport: async (start, end, includeNotes, account) => {
    const body = { ...scopeBody({ start, end, account }), budgets: store.getBudgets(), notes: includeNotes ? store.listNotes() : [] };
    const blob = await (await post("/report", body)).blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "spending-report.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  },

  /* ---- everything below lives in this browser only */
  accounts: async () => {
    const info = await banks();
    return store.listAccounts().map((a) => ({ ...a, id: a.account || "none", label: accountLabel(a.account, info) }));
  },
  assignAccount: async (from_account, bank, account_type) => {
    const info = await banks();
    if (!info.banks.some((b) => b.id === bank) || !info.account_types.some((t) => t.id === account_type)) throw new Error("Unknown bank or account type.");
    return store.assignAccount(from_account, accountId(bank, account_type));
  },
  transactions: (params) => local(() => store.listTransactions(params)),
  setCategory: (id, category, apply_to_merchant) => local(() => store.setCategory(id, category, apply_to_merchant)),
  resetAll: (includeNotes) => local(() => store.resetAll(includeNotes)),
  budgets: () => local(() => store.getBudgets()),
  saveBudgets: (body) => local(() => store.saveBudgets(body)),
  notes: () => local(() => store.listNotes()),
  addNote: (title, body) => local(() => store.addNote(title, body)),
  editNote: (id, title, body) => local(() => store.editNote(id, title, body)),
  deleteNote: (id) => local(() => store.deleteNote(id)),
  reminders: () => local(() => store.listReminders()),
  addReminder: (title, due_date, amount) => local(() => store.addReminder(title, due_date, amount)),
  doneReminder: (id, done) => local(() => store.setReminderDone(id, done)),
  deleteReminder: (id) => local(() => store.deleteReminder(id)),
  ledger: () => local(() => store.ledgerView()),
  addLedger: (body) => local(() => store.addLedger(body)),
  split: (body) => local(() => store.addSplit(body)),
  payLedger: (id, amount) => local(() => store.payLedger(id, amount)),
  deleteLedger: (id) => local(() => store.deleteLedger(id)),
  exportBackup: () => local(() => store.exportBackup()),
  importBackup: (raw) => local(() => store.importBackup(raw)),
};

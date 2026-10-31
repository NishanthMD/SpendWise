import staticData from "./data/static.json";
import * as engine from "./engine.js";
import * as store from "./store.js";

/* Your data never leaves your browser (see store.js). The statement reader and the sums behind the charts run in the
 * browser too (engine.js), so by default nothing is sent anywhere. Set VITE_API_BASE (for example
 * "https://reader.example.com/api") to use a SpendWise server for that work instead; it answers and forgets. */
const BASE = (import.meta.env && import.meta.env.VITE_API_BASE) || "";

async function serverReq(path, opts = {}) {
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
const PATHS = { summary: "/summary", passbook: "/passbook", average_daily: "/average-daily", report: "/report" };

/** One operation, wherever it runs: in this browser (default) or on a server. */
async function compute(op, payload) {
  if (!BASE) return engine.run(op, payload);
  const res = await serverReq(PATHS[op], { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  return op === "report" ? new Uint8Array(await res.arrayBuffer()) : res.json();
}

async function parseStatement(file, fields) {
  if (!BASE) return engine.run("parse", fields, await file.arrayBuffer());
  const fd = new FormData();
  fd.append("file", file);
  Object.entries(fields).forEach(([k, v]) => v && fd.append(k, v));
  return (await serverReq("/parse", { method: "POST", body: fd })).json();
}

const local = (fn) => new Promise((resolve, reject) => {
  try {
    resolve(fn());
  } catch (e) {
    reject(e);
  }
});

const banks = () => Promise.resolve(staticData.banks); // static: no need to wake Python for it

const accountLabel = (account, info) => {
  if (!account) return "Bank not set";
  const [bank, kind] = account.split("|");
  const b = info.banks.find((x) => x.id === bank) || info.banks.find((x) => x.id === "other");
  const t = (info.account_types.find((x) => x.id === kind) || { name: kind }).name;
  return `${b.name}, ${t.toLowerCase()}`;
};
const accountId = (bank, type) => `${bank || "other"}|${type || "savings"}`;

/** Rows plus the filters every calculation takes. */
const scopeBody = (p = {}) => ({ rows: store.rowsForServer(), start: p.start || null, end: p.end || null, account: p.account || null });

const emptyPassbook = { empty: true, entries: [] };

export const api = {
  /* ---- reading a statement and adding things up (in this browser, or on a server if VITE_API_BASE is set) */
  upload: async (file, password, bank, accountType) => {
    const res = await parseStatement(file, {
      password: password || "", bank: bank || "", account_type: accountType || "",
      overrides: JSON.stringify(store.getOverrides()), saved_merchants: JSON.stringify(store.knownMerchants()),
    });
    const saved = store.addParsed(res);
    const { transactions, rename, overrides, ...info } = res;
    return { ...info, ...saved };
  },
  banks,
  categories: () => Promise.resolve(staticData.categories),
  summary: async (start, end, account) => {
    const body = scopeBody({ start, end, account });
    if (!body.rows.length) return { empty: true };
    return compute("summary", { ...body, budgets: store.getBudgets() });
  },
  passbook: async (p) => {
    const body = scopeBody(p);
    if (!body.rows.length) return emptyPassbook;
    return compute("passbook", {
      ...body, category: p.category || null, q: p.q || null, sort: p.sort || "statement", kind: p.kind || null,
      min_amount: p.min_amount === "" || p.min_amount == null ? null : Number(p.min_amount),
      max_amount: p.max_amount === "" || p.max_amount == null ? null : Number(p.max_amount),
    });
  },
  averageDaily: (start, end, account) => compute("average_daily", scopeBody({ start, end, account })),
  downloadReport: async (start, end, includeNotes, account) => {
    const bytes = await compute("report", { ...scopeBody({ start, end, account }), budgets: store.getBudgets(), notes: includeNotes ? store.listNotes() : [] });
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
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

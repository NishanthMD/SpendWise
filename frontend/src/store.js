/* Everything you own lives here, in YOUR browser (IndexedDB): transactions, budgets, notes, reminders, owed money and the
 * category choices you made. The server never stores any of it, so people using the same website never see or mix each
 * other's data. This file has no UI and no network code, so it can be tested on its own (tests/store.test.mjs). */

const DB_NAME = "spendwise";
const KEY = "state";
const LS_KEY = "sw-state";

/** Categories a payment can be filed under by hand (Income and Reversed are decided by the reader). */
export const SPENDING_CATEGORIES = [
  "Food", "Entertainment", "Local Shops", "Person", "Transport", "Shopping", "Bills & Utilities", "Health",
  "Subscriptions", "Cash", "Other", "Groceries", "Education", "Savings", "Bank Charges",
];
export const ALL_CATEGORIES = [...SPENDING_CATEGORIES.slice(0, 11), "Income", ...SPENDING_CATEGORIES.slice(11), "Reversed"];

export class StoreError extends Error {}
const fail = (msg) => {
  throw new StoreError(msg);
};

export const emptyState = () => ({
  app: "spendwise", version: 1,
  uploads: [], transactions: [], overrides: {},
  budgets: { overall: null, savings_goal: null, categories: {} },
  notes: [], reminders: [], ledger: [], payments: [], splits: [],
});

let state = emptyState();
let persistTimer = null;
let ready = false;

const nextId = (list) => list.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1;
const nowISO = () => new Date().toISOString().slice(0, 19);
export const todayISO = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/* ------------------------------------------------------------------ persistence */
function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no indexedDB"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const idb = async (mode, fn) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv", mode);
    const out = fn(tx.objectStore("kv"));
    tx.oncomplete = () => {
      db.close();
      resolve(out && out.result);
    };
    tx.onerror = () => reject(tx.error);
  });
};

/** Make a loaded object safe to use, whatever an older version or a hand-edited backup left in it. */
export function normalize(raw) {
  const s = emptyState();
  if (!raw || typeof raw !== "object") return s;
  for (const k of ["uploads", "transactions", "notes", "reminders", "ledger", "payments", "splits"]) if (Array.isArray(raw[k])) s[k] = raw[k];
  if (raw.overrides && typeof raw.overrides === "object" && !Array.isArray(raw.overrides)) s.overrides = raw.overrides;
  const b = raw.budgets || {};
  s.budgets = { overall: b.overall || null, savings_goal: b.savings_goal || null, categories: b.categories && typeof b.categories === "object" ? b.categories : {} };
  return s;
}

/** Load what this browser saved. Call once before the app draws. */
export async function initStore() {
  let raw = null;
  try {
    raw = await idb("readonly", (st) => st.get(KEY));
  } catch {
    try {
      raw = JSON.parse(localStorage.getItem(LS_KEY));
    } catch {
      /* private window or blocked storage: the app still works, it just forgets when the tab closes */
    }
  }
  state = normalize(raw);
  ready = true;
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); // ask the browser not to evict it
  } catch {
    /* optional */
  }
  return state;
}

function persistNow() {
  persistTimer = null;
  const snapshot = JSON.parse(JSON.stringify(state));
  idb("readwrite", (st) => st.put(snapshot, KEY)).catch(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(snapshot));
    } catch {
      /* nowhere to save: the data lives until the tab closes */
    }
  });
}
function changed() {
  if (typeof window === "undefined") return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistNow, 150);
}
export const flushStore = () => persistTimer && (clearTimeout(persistTimer), persistNow());
if (typeof window !== "undefined") window.addEventListener("pagehide", () => flushStore());

/** Test hook: start from a given state with no storage involved. */
export function _setState(s) {
  state = normalize(s);
  ready = true;
}
export const _getState = () => state;
export const isReady = () => ready;

/* ------------------------------------------------------------------ transactions */
const uploadById = () => new Map(state.uploads.map((u) => [u.id, u]));

/** Transactions in each statement's own order: the running balance only reconciles that way. */
export function fileOrdered(rows = state.transactions) {
  const ups = uploadById();
  const first = (t) => (ups.get(t.upload_id) && ups.get(t.upload_id).first_date) || t.date;
  return [...rows].sort((a, b) => {
    const fa = first(a), fb = first(b);
    if (fa !== fb) return fa < fb ? -1 : 1;
    if ((a.upload_id || 0) !== (b.upload_id || 0)) return (a.upload_id || 0) - (b.upload_id || 0);
    if ((a.seq || 0) !== (b.seq || 0)) return (a.seq || 0) - (b.seq || 0);
    return a.id - b.id;
  });
}

/** What the server needs to do its sums (it keeps none of it). */
export const rowsForServer = () =>
  fileOrdered().map((t) => ({
    id: t.id, date: t.date, description: t.description, merchant: t.merchant, amount: t.amount, kind: t.kind,
    category: t.category, balance: t.balance ?? null, account: t.account || "", seq: t.seq || 0,
  }));

export const knownMerchants = () => [...new Set(state.transactions.map((t) => t.merchant))];
export const getOverrides = () => ({ ...state.overrides });

/** Save what /api/parse returned. Re-uploading the same statement adds nothing. */
export function addParsed(res) {
  const rename = res.rename || {};
  for (const t of state.transactions) if (rename[t.merchant]) t.merchant = rename[t.merchant];
  state.overrides = { ...res.overrides };
  const have = new Map(state.transactions.map((t) => [t.uid, t]));
  const upload = { id: nextId(state.uploads), created_at: nowISO(), first_date: null, last_date: null, bank: res.bank, account_type: res.account_type, order_found: res.order, layout: res.layout };
  let id = nextId(state.transactions);
  let added = 0, skipped = 0;
  const dates = [];
  for (const t of res.transactions) {
    const old = have.get(t.uid);
    if (old) {
      skipped++;
      if (!old.account && t.account) old.account = t.account; // already saved: it only needs to learn which account it is from
      continue;
    }
    state.transactions.push({ ...t, id: id++, upload_id: upload.id });
    dates.push(t.date);
    added++;
  }
  if (added) {
    upload.first_date = dates.reduce((a, b) => (a < b ? a : b));
    upload.last_date = dates.reduce((a, b) => (a > b ? a : b));
    state.uploads.push(upload);
  }
  changed();
  return { added, duplicates_skipped: skipped };
}

export function listTransactions({ start, end, category, q, account, order = "recent", limit = 500 } = {}) {
  let rows = state.transactions.filter(
    (t) => (!start || t.date >= start) && (!end || t.date <= end) && (!category || t.category === category) &&
      (account == null || account === "" ? true : t.account === (account === "none" ? "" : account)) &&
      (!q || t.description.toLowerCase().includes(q.toLowerCase()) || t.merchant.toLowerCase().includes(q.toLowerCase()))
  );
  rows = order === "file" ? fileOrdered(rows) : rows.sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1));
  return rows.slice(0, limit).map((t) => ({ ...t, reversed: t.category === "Reversed" }));
}

export function setCategory(id, category, applyToMerchant) {
  if (!SPENDING_CATEGORIES.includes(category)) fail("Choose a spending category.");
  const tx = state.transactions.find((t) => t.id === id);
  if (!tx) fail("Transaction not found");
  if (tx.kind !== "debit" || tx.category === "Reversed") fail("Only payments you made can be recategorized.");
  let updated;
  if (applyToMerchant) {
    const key = tx.merchant.toLowerCase();
    state.overrides[key] = category;
    const hit = state.transactions.filter((t) => t.merchant.toLowerCase() === key && t.kind === "debit" && t.category !== "Reversed");
    hit.forEach((t) => (t.category = category));
    updated = hit.length;
  } else {
    tx.category = category;
    updated = 1;
  }
  changed();
  return { updated, merchant: tx.merchant, remembered: !!applyToMerchant };
}

/** Each bank account you have uploaded (plus rows not yet assigned), with its date span and count. */
export function listAccounts() {
  const by = new Map();
  for (const t of state.transactions) {
    const a = by.get(t.account || "") || { account: t.account || "", count: 0, first_date: t.date, last_date: t.date };
    a.count++;
    if (t.date < a.first_date) a.first_date = t.date;
    if (t.date > a.last_date) a.last_date = t.date;
    by.set(a.account, a);
  }
  return [...by.values()].sort((x, y) => (x.account < y.account ? -1 : 1));
}

export function assignAccount(from, to) {
  const f = from === "none" ? "" : from;
  let n = 0;
  for (const t of state.transactions) if ((t.account || "") === f) (t.account = to), n++;
  changed();
  return { updated: n };
}

export function resetAll(includeNotes) {
  const gone = { transactions: state.transactions.length, uploads: state.uploads.length };
  state.transactions = [];
  state.uploads = [];
  state.overrides = {};
  state.budgets = emptyState().budgets;
  if (includeNotes) for (const k of ["notes", "reminders", "ledger", "payments", "splits"]) (gone[k] = state[k].length), (state[k] = []);
  changed();
  return gone;
}

/* ------------------------------------------------------------------ budgets */
export const getBudgets = () => JSON.parse(JSON.stringify(state.budgets));

const amountOrNull = (v, label) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e9) fail(`${label} must be a positive amount.`);
  return n ? round2(n) : null; // zero removes the budget
};

/** Set only what you send. An empty or zero amount removes that budget. */
export function saveBudgets(body) {
  const b = state.budgets;
  if ("overall" in body) b.overall = amountOrNull(body.overall, "The monthly budget");
  if ("savings_goal" in body) b.savings_goal = amountOrNull(body.savings_goal, "The savings goal");
  for (const [cat, v] of Object.entries(body.categories || {})) {
    if (!SPENDING_CATEGORIES.includes(cat)) fail(`'${cat}' cannot have a spending budget.`);
    const n = amountOrNull(v, `The ${cat} budget`);
    if (n === null) delete b.categories[cat];
    else b.categories[cat] = n;
  }
  changed();
  return getBudgets();
}

/* ------------------------------------------------------------------ notes and reminders */
export const listNotes = () => [...state.notes].sort((a, b) => b.id - a.id);
export function addNote(title, body) {
  const id = nextId(state.notes);
  state.notes.push({ id, title: title || "", body, created_at: nowISO() });
  changed();
  return { id };
}
export function editNote(id, title, body) {
  const n = state.notes.find((x) => x.id === id);
  if (!n) fail("Note not found");
  n.title = title || "";
  n.body = body;
  changed();
  return { ok: true };
}
export function deleteNote(id) {
  const i = state.notes.findIndex((x) => x.id === id);
  if (i < 0) fail("Note not found");
  state.notes.splice(i, 1);
  changed();
  return { ok: true };
}

const validDate = (s, what = "date") => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "") || Number.isNaN(Date.parse(s))) fail(`Invalid ${what} '${s}', use YYYY-MM-DD`);
  return s;
};

export const listReminders = () => [...state.reminders].sort((a, b) => a.done - b.done || (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : a.id - b.id));
export function addReminder(title, due_date, amount) {
  validDate(due_date, "date");
  if (!String(title || "").trim()) fail("A reminder needs a title.");
  const id = nextId(state.reminders);
  state.reminders.push({ id, title: title.trim(), due_date, amount: amount || null, done: 0, created_at: nowISO() });
  changed();
  return { id };
}
export function setReminderDone(id, done) {
  const r = state.reminders.find((x) => x.id === id);
  if (!r) fail("Reminder not found");
  r.done = done ? 1 : 0;
  changed();
  return { ok: true };
}
export function deleteReminder(id) {
  const i = state.reminders.findIndex((x) => x.id === id);
  if (i < 0) fail("Reminder not found");
  state.reminders.splice(i, 1);
  changed();
  return { ok: true };
}

/* ------------------------------------------------------------------ owed money and split bills */
export function personKey(name) {
  const n = String(name || "").trim().split(/\s+/).filter(Boolean).join(" ");
  const tidy = n === n.toLowerCase() || n === n.toUpperCase();
  return tidy ? n.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()) : n;
}
const money = (v, what) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) fail(`${what} must be more than zero.`);
  return round2(n);
};

function addLedgerRow({ person, direction, amount, note, date, due_date, tx_id = null, split_id = null }) {
  const id = nextId(state.ledger);
  state.ledger.push({ id, person: personKey(person), direction, amount, note: note || "", date, due_date: due_date || null, tx_id, split_id, created_at: nowISO() });
  return id;
}
function maybeRemind(on, title, due, amount) {
  if (on && due) addReminder(title, due, amount);
}

export function addLedger(body) {
  const person = personKey(body.person);
  if (!person) fail("Who is it with?");
  if (!["they_owe", "i_owe"].includes(body.direction)) fail("Direction must be they_owe or i_owe.");
  const amount = money(body.amount, "The amount");
  const on = body.date ? validDate(body.date) : todayISO();
  const due = body.due_date ? validDate(body.due_date) : null;
  if (due && due < on) fail("The due date is before the date it started.");
  const id = addLedgerRow({ person, direction: body.direction, amount, note: (body.note || "").trim(), date: on, due_date: due });
  maybeRemind(body.remind, body.direction === "they_owe" ? `${person} owes you` : `Pay ${person}`, due, amount);
  changed();
  return { id };
}

/** A shared bill. If you paid, each friend owes you their share; if a friend paid, you owe them yours. */
export function addSplit(body) {
  const title = String(body.title || "").trim();
  if (!title) fail("Give the bill a name, such as Dinner.");
  const total = money(body.total, "The bill total");
  const myShare = round2(body.my_share);
  if (!(myShare >= 0)) fail("Your share cannot be negative.");
  const people = (body.people || []).filter((p) => String(p.name || "").trim()).map((p) => ({ name: personKey(p.name), share: round2(p.share) }));
  if (!people.length) fail("Add at least one person to split with.");
  if (people.some((p) => !(p.share > 0))) fail("Everyone's share must be more than zero.");
  if (new Set(people.map((p) => p.name.toLowerCase())).size !== people.length) fail("The same person is listed twice.");
  let paidBy = String(body.paid_by || "me").trim().toLowerCase() === "me" ? "me" : personKey(body.paid_by);
  if (paidBy !== "me" && !people.some((p) => p.name.toLowerCase() === paidBy.toLowerCase())) fail("The person who paid must be one of the people on the bill.");
  if (Math.abs(myShare + people.reduce((a, p) => a + p.share, 0) - total) > 0.011) fail("The shares do not add up to the bill total.");
  const on = body.date ? validDate(body.date) : todayISO();
  const due = body.due_date ? validDate(body.due_date) : null;
  if (body.tx_id != null && !state.transactions.some((t) => t.id === body.tx_id)) fail("That transaction was not found.");
  if (paidBy !== "me") paidBy = people.find((p) => p.name.toLowerCase() === paidBy.toLowerCase()).name;

  const split_id = nextId(state.splits);
  state.splits.push({ id: split_id, title, date: on, total, my_share: myShare, paid_by: paidBy, tx_id: body.tx_id ?? null, created_at: nowISO() });
  const ids = [];
  if (paidBy === "me") {
    for (const p of people) ids.push(addLedgerRow({ person: p.name, direction: "they_owe", amount: p.share, note: title, date: on, due_date: due, tx_id: body.tx_id ?? null, split_id }));
  } else if (myShare > 0) {
    ids.push(addLedgerRow({ person: paidBy, direction: "i_owe", amount: myShare, note: title, date: on, due_date: due, tx_id: body.tx_id ?? null, split_id }));
  }
  if (body.remind && due) {
    if (paidBy === "me") people.forEach((p) => addReminder(`${p.name} owes you for ${title}`, due, p.share));
    else if (myShare > 0) addReminder(`Pay ${paidBy} for ${title}`, due, myShare);
  }
  changed();
  return { split_id, entries: ids };
}

function ledgerEntries() {
  const pays = new Map();
  for (const p of [...state.payments].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id))) {
    if (!pays.has(p.ledger_id)) pays.set(p.ledger_id, []);
    pays.get(p.ledger_id).push(p);
  }
  return [...state.ledger]
    .sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1))
    .map((e) => {
      const payments = pays.get(e.id) || [];
      const paid = round2(payments.reduce((a, p) => a + p.amount, 0));
      return { ...e, payments, paid, remaining: round2(e.amount - paid) };
    });
}

export function ledgerView() {
  const today = todayISO();
  const entries = ledgerEntries();
  const people = new Map();
  for (const e of entries) {
    e.settled = e.remaining <= 0.004;
    e.overdue = !!e.due_date && !e.settled && e.due_date < today;
    const p = people.get(e.person) || { person: e.person, they_owe: 0, i_owe: 0, open: 0 };
    if (!e.settled) {
      p[e.direction] += e.remaining;
      p.open++;
    }
    people.set(e.person, p);
  }
  const rows = [...people.values()].map((p) => ({ ...p, they_owe: round2(p.they_owe), i_owe: round2(p.i_owe), net: round2(p.they_owe - p.i_owe) }));
  rows.sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || (a.person < b.person ? -1 : 1));
  const they = round2(rows.reduce((a, p) => a + p.they_owe, 0));
  const mine = round2(rows.reduce((a, p) => a + p.i_owe, 0));
  return { entries, people: rows, totals: { they_owe: they, i_owe: mine, net: round2(they - mine) } };
}

export function payLedger(id, amount, date) {
  const e = ledgerEntries().find((x) => x.id === id);
  if (!e) fail("Entry not found");
  const amt = amount == null ? e.remaining : round2(amount);
  if (!(amt > 0)) fail(e.remaining <= 0.004 ? "Nothing is left to settle." : "The amount must be more than zero.");
  if (amt > e.remaining + 0.004) fail(`Only ${e.remaining.toFixed(2)} is left on this entry.`);
  state.payments.push({ id: nextId(state.payments), ledger_id: id, amount: Math.min(amt, e.remaining), date: date ? validDate(date) : todayISO() });
  changed();
  return { ok: true };
}

export function deleteLedger(id) {
  const i = state.ledger.findIndex((x) => x.id === id);
  if (i < 0) fail("Entry not found");
  state.ledger.splice(i, 1);
  state.payments = state.payments.filter((p) => p.ledger_id !== id);
  changed();
  return { ok: true };
}

/* ------------------------------------------------------------------ backup */
export const exportBackup = () => ({ ...JSON.parse(JSON.stringify(state)), exported_at: nowISO() });

/** Replace everything with a backup file's contents (made by Download backup, or tools/export_backup.py). */
export function importBackup(raw) {
  if (!raw || typeof raw !== "object" || raw.app !== "spendwise") fail("That file is not a SpendWise backup.");
  if (raw.version !== 1) fail("That backup is from a newer version of SpendWise.");
  const s = normalize(raw);
  for (const t of s.transactions) {
    if (typeof t.date !== "string" || typeof t.amount !== "number" || !["debit", "credit"].includes(t.kind)) fail("The backup has a damaged transaction, so nothing was changed.");
  }
  state = s;
  changed();
  return { transactions: s.transactions.length, notes: s.notes.length, ledger: s.ledger.length };
}

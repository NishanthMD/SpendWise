// Run: node tests/store.test.mjs   (the browser-side storage: no browser, no server needed)
import assert from "node:assert/strict";
import * as s from "../src/store.js";

const fresh = () => s._setState(s.emptyState());
const throws = (fn, re) => assert.throws(fn, (e) => e instanceof s.StoreError && re.test(e.message), String(re));
const tx = (o) => ({ uid: o.uid, date: o.date || "2026-10-01", description: o.description || "UPI/X", merchant: o.merchant || "Zomato", amount: o.amount || 100, kind: o.kind || "debit", category: o.category || "Food", balance: o.balance ?? null, seq: o.seq || 0, account: o.account ?? "hdfc|savings" });
const parsed = (rows, extra = {}) => ({ transactions: rows, rename: {}, overrides: {}, bank: "hdfc", account_type: "savings", order: "oldest_first", layout: "table", ...extra });

// ---- saving a statement; the same statement twice adds nothing
fresh();
let r = s.addParsed(parsed([tx({ uid: "a", seq: 0 }), tx({ uid: "b", seq: 1, date: "2026-10-02" })]));
assert.deepEqual(r, { added: 2, duplicates_skipped: 0 });
r = s.addParsed(parsed([tx({ uid: "a", seq: 0 }), tx({ uid: "b", seq: 1, date: "2026-10-02" })]));
assert.deepEqual(r, { added: 0, duplicates_skipped: 2 });
assert.equal(s._getState().uploads.length, 1, "an upload that adds nothing leaves no record");
assert.equal(s._getState().uploads[0].first_date, "2026-10-01");

// rows saved with no bank learn it when the same statement is read again with one
fresh();
s.addParsed(parsed([tx({ uid: "a", account: "" })]));
assert.equal(s.listAccounts()[0].account, "");
s.addParsed(parsed([tx({ uid: "a", account: "sbi|current" })]));
assert.equal(s._getState().transactions[0].account, "sbi|current");
fresh();
s.addParsed(parsed([tx({ uid: "a", account: "" })]));
assert.deepEqual(s.assignAccount("none", "axis|current"), { updated: 1 });
assert.equal(s.listAccounts()[0].account, "axis|current");

// ---- statement order survives: second upload starts later, rows keep each statement's own order
fresh();
s.addParsed(parsed([tx({ uid: "n1", date: "2026-09-05", seq: 0 }), tx({ uid: "n2", date: "2026-09-01", seq: 1 })]));
s.addParsed(parsed([tx({ uid: "m1", date: "2026-10-03", seq: 0 })]));
assert.deepEqual(s.fileOrdered().map((t) => t.uid), ["n1", "n2", "m1"], "a statement keeps its own row order, even when dates run backwards");
assert.deepEqual(s.rowsForServer().map((t) => t.seq), [0, 1, 0]);
assert.equal(s.rowsForServer()[0].balance, null);

// ---- recategorizing: one payment, or the whole payee and remembered
fresh();
s.addParsed(parsed([tx({ uid: "1", merchant: "Ramesh Kumar", category: "Person" }), tx({ uid: "2", merchant: "Ramesh Kumar", category: "Person", seq: 1 }), tx({ uid: "3", merchant: "Pay In", kind: "credit", category: "Income", seq: 2 })]));
assert.deepEqual(s.setCategory(1, "Education", true), { updated: 2, merchant: "Ramesh Kumar", remembered: true });
assert.deepEqual(s.getOverrides(), { "ramesh kumar": "Education" });
s.addParsed(parsed([], { overrides: s.getOverrides() }));
throws(() => s.setCategory(1, "Income", true), /spending category/);
throws(() => s.setCategory(3, "Food", true), /payments you made/);
throws(() => s.setCategory(99, "Food", true), /not found/);
assert.equal(s.setCategory(1, "Food", false).updated, 1);
assert.deepEqual(s.knownMerchants().sort(), ["Pay In", "Ramesh Kumar"]);
// a renamed payee takes its remembered category with it (the server sends the renamed overrides)
s.addParsed(parsed([], { rename: { "Ramesh Kumar": "Ramesh Kumar S" }, overrides: { "ramesh kumar s": "Education" } }));
assert.ok(s._getState().transactions.filter((t) => t.kind === "debit").every((t) => t.merchant === "Ramesh Kumar S"));

// ---- listing for the pinned-date panel
fresh();
s.addParsed(parsed([tx({ uid: "1", date: "2026-10-01" }), tx({ uid: "2", date: "2026-10-05", category: "Reversed", seq: 1 }), tx({ uid: "3", date: "2026-10-09", account: "sbi|savings", seq: 2 })]));
assert.equal(s.listTransactions({ start: "2026-10-02", end: "2026-10-09" }).length, 2);
assert.equal(s.listTransactions({ account: "sbi|savings" }).length, 1);
assert.equal(s.listTransactions({ order: "file", limit: 2 }).length, 2);
assert.ok(s.listTransactions({ start: "2026-10-05", end: "2026-10-05" })[0].reversed);

// ---- budgets
fresh();
assert.deepEqual(s.getBudgets(), { overall: null, savings_goal: null, categories: {} });
let b = s.saveBudgets({ overall: 20000, savings_goal: 5000, categories: { Food: 3000, Groceries: 1500 } });
assert.deepEqual(b.categories, { Food: 3000, Groceries: 1500 });
b = s.saveBudgets({ categories: { Food: null } });
assert.deepEqual(b.categories, { Groceries: 1500 });
assert.equal(b.overall, 20000, "a partial update must not clear other budgets");
throws(() => s.saveBudgets({ categories: { Income: 5 } }), /cannot have/);
throws(() => s.saveBudgets({ overall: -1 }), /positive/);
assert.equal(s.saveBudgets({ overall: 0 }).overall, null);

// ---- notes and reminders
fresh();
const n1 = s.addNote("A", "b").id;
s.editNote(n1, "A2", "b2");
assert.equal(s.listNotes()[0].title, "A2");
s.deleteNote(n1);
throws(() => s.deleteNote(n1), /not found/);
const rid = s.addReminder("Rent", "2026-11-01", 5000).id;
throws(() => s.addReminder("x", "bad", null), /Invalid date/);
throws(() => s.addReminder("  ", "2026-11-01", null), /needs a title/);
s.setReminderDone(rid, true);
assert.equal(s.listReminders()[0].done, 1);
s.deleteReminder(rid);
throws(() => s.deleteReminder(rid), /not found/);

// ---- split bills and the owed list
fresh();
const split = s.addSplit({ title: "Dinner", total: 1200, my_share: 300, paid_by: "me", date: "2026-10-01", due_date: "2026-10-10", people: [{ name: "asha", share: 300 }, { name: "Ravi", share: 300 }, { name: "Meena", share: 300 }], remind: true });
assert.equal(split.entries.length, 3);
let led = s.ledgerView();
assert.equal(led.totals.they_owe, 900);
assert.deepEqual(new Set(led.people.map((p) => p.person)), new Set(["Asha", "Ravi", "Meena"]), "a lower-case name is tidied");
assert.ok(s.listReminders().some((x) => x.title.startsWith("Asha owes you")), "remind makes reminders");
assert.ok(led.entries.every((e) => e.overdue), "due 10 Oct 2026 has passed");
const bad = { title: "x", total: 100, my_share: 40, people: [{ name: "A", share: 40 }] };
throws(() => s.addSplit(bad), /add up/);
throws(() => s.addSplit({ ...bad, my_share: 50, people: [{ name: "A", share: 25 }, { name: "a", share: 25 }] }), /twice/);
throws(() => s.addSplit({ ...bad, my_share: 50, paid_by: "Zed", people: [{ name: "A", share: 50 }] }), /paid must be/);
throws(() => s.addSplit({ ...bad, my_share: 50, people: [] }), /at least one/);
throws(() => s.addSplit({ ...bad, title: " ", my_share: 50, people: [{ name: "A", share: 50 }] }), /name/);
throws(() => s.addSplit({ ...bad, my_share: 50, tx_id: 999, people: [{ name: "A", share: 50 }] }), /not found/);
s.addSplit({ title: "Cab", total: 450, my_share: 150, paid_by: "ravi", date: "2026-10-20", people: [{ name: "Ravi", share: 150 }, { name: "Asha", share: 150 }] });
led = s.ledgerView();
const ravi = led.people.find((p) => p.person === "Ravi");
assert.deepEqual([ravi.they_owe, ravi.i_owe, ravi.net], [300, 150, 150]);
assert.deepEqual(led.totals, { they_owe: 900, i_owe: 150, net: 750 });
const asha = led.entries.find((e) => e.person === "Asha" && e.direction === "they_owe");
s.payLedger(asha.id, 100, "2026-10-12");
let e = s.ledgerView().entries.find((x) => x.id === asha.id);
assert.deepEqual([e.paid, e.remaining, e.payments[0].date, e.settled], [100, 200, "2026-10-12", false]);
throws(() => s.payLedger(asha.id, 250), /Only 200.00/);
s.payLedger(asha.id);
e = s.ledgerView().entries.find((x) => x.id === asha.id);
assert.ok(e.settled && e.remaining === 0 && !e.overdue && e.payments.length === 2);
throws(() => s.payLedger(asha.id), /Nothing is left/);
throws(() => s.payLedger(9999), /not found/);
s.addLedger({ person: "Kiran", direction: "i_owe", amount: 80, note: "chai", date: "2026-10-25" });
throws(() => s.addLedger({ person: "Kiran", direction: "sideways", amount: 80 }), /Direction/);
throws(() => s.addLedger({ person: "Kiran", direction: "i_owe", amount: 0 }), /more than zero/);
throws(() => s.addLedger({ person: "  ", direction: "i_owe", amount: 5 }), /Who/);
throws(() => s.addLedger({ person: "K", direction: "i_owe", amount: 5, date: "2026-10-10", due_date: "2026-10-01" }), /before/);
s.deleteLedger(asha.id);
throws(() => s.deleteLedger(asha.id), /not found/);
assert.ok(!s.ledgerView().entries.some((x) => x.id === asha.id));
assert.equal(s._getState().payments.filter((p) => p.ledger_id === asha.id).length, 0);

// ---- clear all leaves notes and the owed list unless asked
const gone = s.resetAll(false);
assert.ok(s.ledgerView().entries.length > 0);
s.resetAll(true);
assert.equal(s.ledgerView().entries.length, 0);
assert.equal(s.listReminders().length, 0);

// ---- backup round trip
fresh();
s.addParsed(parsed([tx({ uid: "1" })]));
s.addNote("n", "b");
s.saveBudgets({ overall: 1000 });
const file = JSON.parse(JSON.stringify(s.exportBackup()));
fresh();
assert.deepEqual(s.importBackup(file), { transactions: 1, notes: 1, ledger: 0 });
assert.equal(s.getBudgets().overall, 1000);
throws(() => s.importBackup({ app: "other" }), /not a SpendWise backup/);
throws(() => s.importBackup({ app: "spendwise", version: 2 }), /newer version/);
throws(() => s.importBackup({ app: "spendwise", version: 1, transactions: [{ date: 5 }] }), /damaged/);
assert.equal(s._getState().transactions.length, 1, "a rejected backup changes nothing");
assert.deepEqual(s.normalize("garbage"), s.emptyState());

// ---- two people's browsers are separate worlds: this module holds one state, replaced wholesale
fresh();
s.addParsed(parsed([tx({ uid: "alice" })]));
const alice = JSON.stringify(s._getState());
fresh();
assert.equal(s._getState().transactions.length, 0);
s._setState(JSON.parse(alice));
assert.equal(s._getState().transactions[0].uid, "alice");
console.log("STORE CHECKS PASSED");

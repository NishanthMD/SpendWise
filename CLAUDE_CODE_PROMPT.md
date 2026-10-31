A working prototype of SpendWise is in this folder (backend/ FastAPI, frontend/ React + Vite). Read README.md, run `python backend/tests/test_core.py` and `python backend/tests/test_passbook.py` (see README), then extend and polish it to the spec below instead of starting over. Keep the framework-free logic in backend/core/ testable.

My real bank statement is at samples/ (Canara Bank ePassbook PDF). It is private: never commit it, never print narrations or names from it in logs, and keep `samples/` in .gitignore. Use it to verify the parser, and report only counts and totals.

# What SpendWise is
A local, single-user web app for a student in India. I upload my bank statement PDF and see where my money went. No bank login, no scraping, no bank API, no credentials, ever. The PDF is the only data source.

# Stack (fixed)
FastAPI + SQLite (stdlib sqlite3) + pdfplumber + reportlab on the backend. React + Vite + Recharts (or hand-written SVG where Recharts cannot do it) on the frontend. AI summary via the `anthropic` package, model name from env var (default `claude-sonnet-5-5`), key only in backend/.env, rule-based fallback when there is no key.

# How to read my statement (Canara ePassbook, verified on the real file)
Columns, left to right: Date | Particulars | Deposits | Withdrawals | Balance. Dates are dd-mm-yyyy, amounts look like 1,000.00.
- Page 1 starts with a bank banner and two boxes of account/branch details. Ignore everything above the column header row; it is personal data and not needed. The column header repeats on every page.
- The first table row is "Opening Balance" (balance only) and the last is "Closing Balance". Stop reading at Closing Balance (the pages after it are a disclaimer).
- Each entry is a tall block. The narration wraps mid-word every ~25 characters, and the date and amounts sit vertically centred on the block, so plain line-by-line text extraction scrambles it. Read words by x-position: dates are the words left of the narration, decimal amounts belong to the nearest of the three right-hand columns, everything else is narration.
- Every entry ends with a "Chq: <number>" line (the number can be blank). That line is the end-of-entry marker.
- Rejoin wrapped narration lines with no separator for UPI strings, so "HEMANT" + "H" + "S/CNRB" becomes HEMANTHS/CNRB.
- Narration types seen: `UPI/DR/<12-digit ref>/<PAYEE, truncated by the bank>/<bank code>/<masked VPA>/<remark>//<txn id>/<dd>/<mm>/<yyyy> <time>`; `UPI/CR/...` (money received); `UPI/REV/<same ref as an earlier DR>/...` (a failed payment coming back, shown as a NEGATIVE withdrawal like -10,000.00); card purchases like `MERCHANT*DESC CITY-dd/mm/yy hh:mm:ss/<last4>` (including foreign merchants); `APY CONTRI FOR(<id>)MM-YYYY` (Atal Pension Yojana, a saving); `ATM / IMPS TRANSACTION CHARGES` (bank charges).
- A reversal and the failed payment it cancels share the UPI ref. Tag both "Reversed" and exclude both from spending and income totals.
- Entries are NOT strictly in date order (some post later than their date). Keep the statement's own order, because the running balance only reconciles in file order. Never sort by date before checking balances.
- Reconciliation is the correctness test: for every row, previous balance + deposit - withdrawal must equal the row's balance, and the last balance must equal the Closing Balance. Show "Balance check passed" or the number of mismatching rows after each upload. My real file has 106 entries including one reversal pair and must reconcile with 0 mismatches.
- Banks truncate payee names (BLINKITC, AMAZONPA, NETFLIXC, KFCK261). Fold known brands back to one clean name.
- Keep the layered fallback for other banks: column-aware reader, then table extraction, then line parsing. Support password-protected PDFs. Re-uploading must never create duplicates.

# Features
1. Upload, parse, categorize: Food, Groceries, Entertainment, Local Shops, Person, Transport, Shopping, Bills & Utilities, Health, Subscriptions, Education, Savings, Bank Charges, Cash, Other, Income, Reversed. "Person" means a UPI payment to a human-looking name. Let me recategorize a payee once and remember it for future uploads.
2. Analytics for all time, a month, or a custom range: totals, income, net, category split, weekly and monthly by category, daily series, top payees, busiest day, largest payment, balance over time.
3. Average daily spending calculator for any two dates.
4. Budgets: an optional monthly budget overall and per category (stored in SQLite, editable in the UI), used by the rings below.
5. Notes keeper (create, edit, delete). Reminders (title, due date, optional amount, done, banner and browser notification when due).
6. Downloadable PDF report (reportlab) with KPIs, category chart and table, monthly chart, top payees, highlights, AI summary, optional notes. Use "Rs." in the PDF.
7. AI summary: send Claude ONLY aggregates (category, payee and monthly totals, averages), never raw narrations or account details.

# Design
Reference: my bank passbook. Make the Transactions tab a Passbook view that reads like it: a ruled header row with Date | Particulars | Deposits | Withdrawals | Balance, tall entries with the date on the left, a clean particulars cell (payee in regular weight, remark small, raw narration in an expandable detail), deposits and withdrawals in their own right-aligned columns, a running balance in the last column, "Opening Balance" and "Closing Balance" rows, and a quiet page-break divider every ~15 entries. Above it, a bordered summary box with the period, opening and closing balance and totals in and out, like the boxes on the passbook's first page. Offer a Compact table toggle. Do not copy the bank's logo or name.
Overall look: cool pale paper background, ink-blue text, ruled rows rather than boxed cards, tabular numerals, Bricolage Grotesque for headings and Instrument Sans for body. Sentence-case plain copy, helpful empty states and errors, visible focus, responsive to mobile, respect prefers-reduced-motion everywhere.

Interactive charts (this is a hard requirement):
- Spending-over-time (daily, weekly, monthly) and balance-over-time must follow the mouse AND touch. A vertical guide line and a highlighted dot snap to the nearest date under the pointer. Dragging a finger scrubs through the dates (use touch-action so the page still scrolls vertically). Arrow keys move the pointer for keyboard users.
- A tooltip near the pointer shows the date, amount, number of payments, the category breakdown for that day, the largest payment, and the balance at the end of the day. On touch, keep it above the finger.
- Tap or click pins the tooltip and opens that day's transactions below the chart.
- The category donut highlights a slice on hover or touch and shows amount, percent and payments.

Circular fitness-style rings (animated, like activity rings, original design):
- Concentric SVG rings on the Overview: month budget used, average daily spend against daily budget, and savings rate (net / income). A ring fills from 0 with an ease-out animation on load and when the period changes, numbers count up in the centre, and a ring that passes 100% starts a darker second lap.
- Smaller single rings for each category budget, a "no-spend day streak" ring, and a savings-goal ring. Use them wherever a value has a target.
- Reduced motion: show the final state with no animation.

Cute animals (2D, hand-drawn look, not realistic):
- Draw an original small cast as inline SVG React components: thick rounded outlines, flat fills from the app palette, slight wobble. Do not use or imitate any existing character, mascot or brand figure.
- Suggested roles: a round piggy bank for savings and upload success (coin drops in, pig jiggles), a sleepy cat that naps while spending is under average and wakes wide-eyed when over budget, a squirrel for the daily-average calculator, an owl for reminders due today, a turtle that walks across while loading, and a bunny that peeks over the edge of empty states.
- Each animal has an idle loop and a reaction to a click or tap (a small speech bubble with one short tip, for example "That is 3 Swiggy orders").
- Show at most one or two animals per screen so the data stays the hero. Provide static poses for prefers-reduced-motion. Never block clicks on charts or tables.

# Privacy and security
Data stays in a local SQLite file. .env, the database and samples/ are git-ignored. Footer note says what is stored locally and what the AI summary receives.

# Verify before you say it works (please actually run these)
- Existing tests, plus a passbook-layout test on fake data, plus my real PDF: 106 entries, 0 balance mismatches, one reversal pair excluded from totals.
- Start the backend and call every endpoint; run `npm run build`; open the app in a browser and walk through: upload, period switching, category change, hovering and touch-scrubbing the charts, rings animating, animals reacting, notes, reminders, calculator, AI summary, PDF download. Check it at phone width.
- Tell me what you could not verify.

# Build order
1. Confirm the parser on the real PDF. 2. Budgets API. 3. Passbook view. 4. Interactive charts. 5. Rings. 6. Animals. 7. Report and AI summary polish. 8. README.

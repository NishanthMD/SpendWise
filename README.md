# SpendWise

A website for seeing where your money went. You upload your bank statement PDF and get categories, charts, budgets, an average-daily-spend calculator, split bills and an owed-money list, notes, reminders and a downloadable PDF report. It works the same on your own computer or as a public website that many people can use at once.

There is no bank login, no scraping, no bank API and no credentials, ever. The PDF is the only data source.

**Nothing is uploaded, and there is no server to run or pay for.** The statement reader is the same Python code as before (`pdfplumber`, `reportlab`), compiled to run inside your browser with Pyodide, so your PDF is read on your own device and never leaves it. Everyone's transactions, budgets, notes, reminders and owed money are saved in their own browser (IndexedDB), so people using the same site can never see, leak or merge each other's data. The site is just static files, so it hosts for free on Cloudflare Pages. See *Privacy* and *Deploying*.

The first time someone uploads a statement, their browser downloads the reader (about 25 MB, then cached) and shows a progress message; reading a statement takes a second or two after that.

## Run it

You need Node 18+ (Python 3.9+ only for the tests and the optional server).

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 and choose **Upload statement**. `npm run dev` and `npm run build` first run `scripts/prepare-runtime.mjs`, which downloads the in-browser Python runtime (pinned and checksum-verified in `runtime.lock.json`) and copies `backend/core/*.py` next to it.

**Optional server.** The same code also runs behind FastAPI (`backend/main.py`), for development or if you would rather host the reader yourself. Start it with `cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && uvicorn main:app --port 8000`, and build the website with `VITE_API_BASE=http://localhost:8000/api` to make it use that server instead of the browser. With the server running, `npm run build` output in `frontend/dist` is also served at http://localhost:8000.

**Moving from the old single-user version:** your old `backend/spendwise.db` is not read by the new version. Turn it into a backup file with `python backend/tools/export_backup.py backend/spendwise.db my-backup.json`, then use **Restore backup** in the footer of the site. The file is plain JSON of your own data: keep it private (the repo already ignores `*backup*.json`).

## What is in it

| Screen | What you get |
| --- | --- |
| Overview | Spend, income, net and category strip; **concentric rings** (month budget used, average day vs daily budget, savings rate) that fill from zero and start a darker second lap past 100%; small rings for each category budget, the no-spend streak and your savings goal; spending over time (daily, weekly, monthly), balance over time, a category donut, top payees, the daily-average calculator and the PDF report |
| Upload bar | Pick the **bank** (or let it be detected from the PDF) and the **account type** (savings, salary, student, current, other) for the next upload. "How this bank's statements are read" shows the columns, dates, narration shapes and row order the reader expects, and how sure we are about them. Several accounts can live side by side: an Account menu appears at the top, and balances are only ever chained within one account |
| Transactions | A **passbook view**: summary box (period, opening and closing balance, totals in and out, balance check), ruled Date, Particulars, Deposits, Withdrawals, Balance columns in the statement's own order, opening and closing rows, a page divider every 15 entries, the raw narration one click away, a Compact table toggle, and recategorize-once-and-remember. **Sort and filter** in one row: a search box, a Sort menu (statement order, date either way, payee A to Z or Z to A, amount highest or lowest first, category) and a Filters button that opens money in or out, category and an amount range; clicking a column heading also sorts |
| Owed money | **Split a bill** (you paid, or a friend did; equal shares or your own amounts, an optional pay-back date and reminder; also from any passbook row with *Split this bill*), **Add money owed** for a plain loan either way, a net total, a chip per person, and every entry with its date, due date and **Overdue** tag. Mark it paid back in full or in part: each payment keeps its date |
| Budgets | An optional monthly budget overall and per category, plus a monthly savings goal (saved in your browser) |
| Notes, Reminders | Notes you can edit, reminders with a due date and optional amount, a banner and (if you allow it) a browser notification when something is due |

The charts are hand-written SVG because they have to do things Recharts cannot: a guide line and dot that snap to the nearest date under a mouse or finger, a tooltip kept above the fingertip, tap or click to pin a date and open its transactions underneath, and arrow keys for keyboard users. The page still scrolls vertically over a chart (`touch-action: pan-y`). The category donut highlights a slice on hover or touch.

**A light touch of glass**: translucent, softly blurred surfaces (tab bar, summary, toolbar, tooltips, buttons) in the spirit of Apple's Liquid Glass, switched off automatically when your device asks for reduced transparency.

**Liquid glass, sliding switches and a pinned dashboard**: surfaces are frosted glass with a bright edge and sheen over slowly drifting colour. The language and Auto / Light / Dark switches have a thumb that slides to your choice, the whole page cross-fades as one picture when the theme changes, so text and background change together, and changing language sweeps a glass panel across the screen while the words change underneath. The section tabs (Overview, Transactions, Owed money and so on) are pinned: they drop down from the top when you scroll down and slide away when you scroll up. The logo and favicon (`frontend/public/favicon.svg`) are a little bear holding a rupee coin. All of it switches off with reduced motion or reduced transparency.

**Light and dark themes**: the Auto / Light / Dark switch at the top follows your device by default, remembers your choice, and covers every screen, chart, ring, table and animal.

**English and Kannada**: the English / ಕನ್ನಡ switch at the top changes the whole interface (tabs, forms, charts, categories, month names). In Kannada mode the site also turns red and yellow like the Karnataka flag, shows a waving flag and a ಕನ್ನಡ ರಾಜ್ಯೋತ್ಸವದ ಶುಭಾಶಯಗಳು (Happy Kannada Rajyotsava) greeting, and the charts switch to red and yellow shades. It works in light and dark. What stays in English: the animals' tips, bank names, the notes you type, and the PDF report. Strings live in `frontend/src/kn.js` (English text is the key, so a missing entry just shows in English).

A small cast of original animals (piggy bank, cat, squirrel, owl, turtle, bunny) appears at most two at a time. Click or tap one for a tip, and it changes feeling each time (happy, in love, surprised, sad, cross, sleepy, winking, then back to itself). With `prefers-reduced-motion` every animation is off and each animal, ring and chart sits in its resting or final state.

## Tests

```bash
cd backend
python tests/make_sample_statement.py samples     # fake table and text-style PDFs
python tests/test_core.py samples                  # parser, categories, analytics, report
python tests/test_passbook.py samples              # fake passbook layout, balance check, reversals
python tests/test_analytics.py                     # balance series, streaks, budgets (no files needed)
python tests/test_axis.py                          # Axis-style NEFT/IMPS/RTGS/MOB narrations, payee folding, one-time re-read
python tests/test_banks.py samples                 # 22 fake statements in SBI, HDFC, ICICI, Kotak, PNB and Axis layouts, oldest and newest first, table and text
python tests/test_export.py                        # old spendwise.db -> backup file, and the old one-time payee re-read
python tests/test_api.py samples                   # every endpoint, through FastAPI's test client, incl. two people staying separate

cd ../frontend
npm test                                           # the browser-side storage: statements, categories, budgets, split bills, owed list, backup
```

The Python tests play the part of the browser with `tests/memstore.py`; the real storage is `frontend/src/store.js`.

`test_api.py` also accepts the path to a real statement as a second argument. It then checks only counts and totals (never narrations or names). `httpx` is needed for it: `pip install -r requirements-dev.txt`.

Keep your real statement in `samples/` at the project root. `samples/`, `*.pdf`, `.env` and the database are git-ignored.

## How it reads a Canara ePassbook

Each entry is a tall block: the narration wraps mid-word every ~25 characters, and the date and amounts sit vertically centred. Plain line-by-line extraction scrambles that, so the reader works by word position:

- It finds the header row (Date, Particulars, Deposits, Withdrawals, Balance) and ignores everything above it. The header repeats on every page.
- Dates are the words left of the narration, amounts go to the nearest of the three right-hand columns, everything else is narration.
- Each entry ends at its `Chq:` line. Wrapped UPI narration is rejoined with no separator. Reading stops at Closing Balance.
- A negative withdrawal (a `UPI/REV` refund) becomes a deposit. A refund and the failed payment it cancels share a UPI reference: both are tagged **Reversed** and left out of spending and income.
- Entries are kept in the statement's own order, because the running balance only reconciles that way. After every upload it checks previous balance + deposit - withdrawal = balance for every row and against the closing balance, and shows "Balance check passed" or the number of mismatching rows.
- Banks truncate payee names (`BLINKITC`, `AMAZONPA`, `NETFLIXC`, `KFCK261`); known brands are folded back to one clean name.

If a PDF is not passbook-style, the parser falls back to table extraction, then to line parsing. Password-protected PDFs ask for the password. Uploading the same statement again adds nothing. Scanned (image-only) PDFs are not supported.

## Banks and statement layouts

There is no national statement format: RBI does not prescribe one, and NPCI has only asked banks to standardise UPI narrations. Layouts differ in column names, one amount column or two, Dr/Cr markers, date style, narration shape and whether the newest row comes first. So the reader never trusts one fixed layout:

- **Columns** are found by name from a long alias list (Txn Date, Tran Date, Transaction Date; Narration, Particulars, Description, Transaction Remarks; Withdrawal Amt., Debit, Dr; Deposit Amt., Credit, Cr; Balance, Closing Balance, Running Balance). Separate debit and credit columns, one amount with Dr/Cr, an amount plus a Type column, and balances marked `(Cr)` or `Dr` are all handled.
- **Row order** is not assumed. The reader checks which direction the running balance reconciles and puts the rows oldest first, so a newest-first statement reads correctly. With no balances it falls back to the dates.
- **Payees** are the first field left after the channel code and reference: `NEFT/MB/<UTR>/<NAME>/...`, `IMPS/P2A/<ref>/<NAME>/...`, `MOB/TPFT/<NAME>/<ref>`, `RTGS/<UTR>/<NAME>/...`, HDFC's `UPI-<NAME>-<vpa>-...`, SBI's `TO TRANSFER-UPI/DR/...` and `NEFT*<IFSC>*<UTR>*<NAME>`, ICICI's `MMT/IMPS/...` and handle-only UPI lines, Kotak's `UPI/<NAME>/<ref>/...`. Names the bank squashed or truncated (`SRIKENCHAMBACERAMIC`) are folded into the fullest spelling.
- **The bank** is recognised from its name or IFSC at the top of the first page, never from narrations (which name other banks). Pick it yourself and your choice wins; if it disagrees with the PDF you are told.

What is known about each bank is in `backend/core/banks.py`, with a confidence level: **real** (Canara, built against a statement that reconciles to the rupee), **layout** (Axis, the layout and narration shapes were checked), or **public** (the rest, taken from publicly shared sample statements and not yet tested on a real file). Where a layout turns out different from the profile, the balance check shows it. If you send a redacted sample, it becomes a test.

## Making categories better

- Change a category in the Transactions tab. By default it applies to every payment to that payee and is remembered for future uploads.
- Add keywords to `RULES` or `LOCAL_SHOP_WORDS` in `backend/core/categorizer.py`.
- "Person" means a UPI payment to something that looks like a human name. Shops that use a personal-looking UPI name land there until you recategorize them once.

## Privacy

- **Your PDF never leaves your device.** It is read by Python running in a background thread of your own browser tab, from memory, and discarded. There is no upload, so there is nothing for anyone to log or leak.
- **Your data lives only in your own browser** (IndexedDB): transactions, notes, reminders, budgets, owed money and the category choices you made. Different people on the same site are separate by construction.
- **No third parties.** Fonts, the Python runtime and the PDF libraries are all served by the site itself, and there are no analytics or trackers. The site's Content-Security-Policy (`frontend/public/_headers`) only allows it to talk to itself.
- **Trade-offs of keeping data in the browser:** it does not follow you to another device and it disappears if you clear the browser's site data. Use **Download backup** and **Restore backup** (site footer) to keep a copy or move to another device. The backup is plain JSON: store it privately.
- **Clear all** (top of the control panel) removes every transaction, the record of each upload, your remembered categories and your budgets from this browser. Tick the box to delete notes, reminders and the owed-money list too.
- If you choose to run the optional server instead, it is stateless (no database, no accounts, access logs off in the Docker image, responses `no-store`), but then statements do pass through it.

## Deploying on Cloudflare Pages (free)

1. **Put the code in a private git repo.** `.gitignore` excludes `samples/`, `*.pdf`, databases, backups, `.env`, `.venv/`, `node_modules/`, `dist/` and the downloaded runtime. Check with `git status` before pushing.
2. In Cloudflare: **Workers & Pages → Create → Pages → Connect to Git**, pick the repo, then set:
   - Root directory: `frontend`
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variable `NODE_VERSION` = `20` (or newer)
3. Deploy. The build downloads the pinned Python runtime from jsDelivr and PyPI, checks every file's SHA-256, and bundles it with the site. `_headers` in `frontend/public` is picked up automatically.
4. Pages limits: every file must be under 25 MB (the largest is 9.6 MB) and a site under 20,000 files (this one has about 60).

To change the runtime (a newer Pyodide, other PDF library versions), edit the pins at the top of `frontend/scripts/prepare-runtime.mjs` and run `node scripts/prepare-runtime.mjs --update` to rewrite `runtime.lock.json`. If you change `backend/core/banks.py` or the categories, run `python backend/tools/export_static.py` (a test fails if the website's copy is stale).

## Where things are

| Part | File |
| --- | --- |
| PDF parsing (passbook reader, table reader, text fallback, passwords) | `backend/core/parser.py` |
| Categories, payee names, person vs shop, remarks | `backend/core/categorizer.py` |
| Totals, series, balance by day, streaks, budget status | `backend/core/analytics.py` |
| PDF report | `backend/core/report.py` |
| The reader and the sums (one set of Python functions, run in the browser or on a server) | `backend/core/api.py`, `backend/core/ingest.py` |
| Running that Python in the browser | `frontend/src/py.worker.js`, `frontend/src/engine.js`, `frontend/scripts/prepare-runtime.mjs` |
| Optional FastAPI wrapper | `backend/main.py` |
| Storage in the browser, backup and restore | `frontend/src/store.js`, `frontend/src/api.js` |
| Old SQLite database exporter | `backend/tools/export_backup.py`, `backend/tools/legacy_db.py` |
| Owed money and splits | `frontend/src/store.js` (the rules), `frontend/src/Ledger.jsx` (the screen) |
| Language and the Kannada theme | `frontend/src/lang.js`, `i18n.jsx`, `kn.js`, `Rajyotsava.jsx`, the end of `styles.css` |
| Interface | `frontend/src/` (`Charts.jsx`, `Rings.jsx`, `Critters.jsx`, `Passbook.jsx`, `Overview.jsx`, `Budgets.jsx`) |

## Next steps

- Recurring payment detection
- Count only your share of a split bill in the spending totals
- A small ML categorizer trained on your own corrections
- Month-end balance forecast

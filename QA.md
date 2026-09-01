# Evergreen QA — end-to-end pass

The standing definition of "is this app fit to put in front of people today".
Run it semi-daily against **mock** (safe to click anything) and read-only against
**live** for the data checks. It is meant to grow: when a bug escapes to
production, the check that would have caught it gets added here in the same
change that fixes it.

**Run it with:** `Skill("evergreen-qa")` or the `evergreen-qa` agent. The agent
follows this file — this file is the authority, not the agent's own memory.

---

## 0. Setup (every run)

| Step | Command / action |
|---|---|
| Typecheck | `node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` |
| Build | `node node_modules/next/dist/bin/next build` |
| Switch to mock | copy `.env.local` to `.env.local.bak`, set `NEXT_PUBLIC_DATA_SOURCE=mock` |
| Start preview | `preview_start` with `{name: "evergreen"}` (port 3180) |
| **Finish** | restore `.env.local` from `.env.local.bak` — production parity is `supabase` |

> Never point the mock preview at live and never click a mutating control while
> `.env.local` says `supabase`. Live data is five real people's real project.

---

## 1. Data integrity — automated

Open `/qa` (Diagnostics, full admin only). It runs `lib/qa/checks.ts`, which
calls the **same** `money.ts` / `contract.ts` functions the screens call — a
check that re-implements the arithmetic only proves two copies agree.

Covers, in one pass:

- **Trades** — every `tradeId` on cost lines, scope cells, materials, schedule,
  packages, agreements, users and contacts resolves; a trade's category exists;
  a budget line's category and name match its trade (the drift that has bitten
  this project twice).
- **Rooms** — every `roomId` on cost lines, scope, packages and materials
  resolves; no two rooms share a name on a floor.
- **Vendors** — a contract's vendor matches the bid it was awarded from; one
  engaged vendor per trade; no vendor account without a trade.
- **Budget items** — draw allocations and packages point at live budget lines;
  change-order exhibits are unique within a line.
- **Budget maths** — per line, contracted + change orders + fee = total; the
  rows sum to the table total; project total = sum of lines; nothing is drawn or
  paid beyond what it is worth; each draw equals its allocations; a contract's
  sum equals contracted + approved change orders.
- **Contracts & draws** — nothing approved for payment against an unsigned
  in-app contract; a paid draw carries a paid date.
- **Access** — for every enabled user × every module, `accessFor()` returns
  exactly what their role (or override) says; nobody is stranded with no module;
  every account has a login identity.

**Pass condition:** zero `Fail`. Warnings are triaged, not ignored — each one
either gets fixed or gets a line in this file saying why it is expected.

Also run against live, read-only: open `/qa` on
<https://evergreen-rust-five.vercel.app> signed in as full admin. Do not click
anything else on live.

---

## 2. Workflow click-through — does it stall?

Walk the whole job in order, as **full admin** on mock. A step "stalls" if the
next action is not obvious, not reachable, or silently does nothing.

1. **Budget Management** — add a budget line (rooms, scope, cost, owner/GC
   managed); expand it; rename it; put it on hold and resurrect it; add a change
   order and choose *Save for later*.
2. **ROM** — commit a line, add a note, lock the ROM. Confirm a line added after
   the lock lands on contract with a ROM of 0.
3. **Bid and Package Management** — bundle two budget lines into a package;
   write scope in the Scope tab and use the floating *Save and proceed*; invite
   vendors; record two bids; compare; award.
4. **Contract** — the award prompts contract creation. Preview the document,
   pick the counterparty, issue it.
5. **Contracts** (under Draw Management) — the new contract appears as its own
   line in the Packages band; expand it; sign both rounds.
6. **Draw Management** — the signed line is now draggable. Build a draw and
   check each line shows what is left to draw against it, and that the draw
   refuses to pretend: allocating past the headroom must say so in red.
   Confirm what the draw finishes is pre-filled from the package, that an item
   already claimed by another draw is named as such, and that the GC can change
   it.
7. **Issue the draw** — issue it to a client, read the document, sign it as
   them. Signing must move the draw to Client approved on its own; then mark it
   paid and confirm it archives and appears in Contracts under Draw requests.
8. **Change order after the fact** — add a change order on a contracted line,
   choose *Push a revised contract* with *also update the draw*; confirm the
   contract gains an amendment, both signatures clear, and the draw returns to
   Saved.
9. **Schedule** — add a timeline item against a budget line; drag a bar; drag
   the empty chart to pan.
10. **Materials** — add a material, set its status through to delivered.
11. **Messages** — start a new chat, set a subject, reply, react, pin, archive.
12. **Help** — every numbered step's *Take me there* lands on a real screen, and
    a step this seat cannot reach says so rather than linking into a refusal.
13. **Feedback** — file with an empty description and with a bug that has no
    expectation; both must refuse in words. Then file a real one and confirm the
    brief carries seat, device, ROM phase and screen.
14. **Field Updates** (builder or admin seat) — build an update of three items:
    one red, one yellow with an owner ask, one ad hoc green. Save each and
    confirm the ack copy ("Saved and flagged red — it will lead the update" /
    "Saved with an ask — the owner will see it called out"). Publish to the
    owner and confirm, in order: the toast names the recipients; a Messages
    thread to the owner carries the 📋 chip; the Schedule grows a pin with red
    and ask badges; the Sent list gains the numbered update. Open the report:
    asks lead in the amber band, red second, progress last with yellow before
    green. Then as the owner: no Field Updates nav item, the chip/pin opens the
    report, the ask section reads "Needs your decision", the footer reads "Sent
    to you". As an awarded vendor with an item in the update: their copy shows
    ONLY their items ("your items only"), in their own thread — never the
    owner's; an update without their items is absent from their list and
    refused on deep link. Refusals to test: publish with no items, publish with
    no recipient ("Pick at least one recipient before it goes out."), save an
    item with the ask toggle on but empty.

Record: the step number, what stalled, and what you expected.

---

## 3. Per-role access — does everyone get their modules?

Diagnostics prints the role × module matrix. Then actually sign in as each
persona on mock and confirm the nav matches, and that a module the role is
denied is denied *by the page too*, not just hidden from the nav (deep-link it).

| Role | Must reach | Must NOT reach |
|---|---|---|
| Full admin | everything, incl. `/qa` | — |
| Owner | Budget Management, Bid & Package (view), Funding, Materials, Schedule, Messages, Contracts, Field Updates reports (via chip/pin — no nav item) | Draw Management, the Field Updates composer |
| Builder / GC | Budget Management, Bid & Package, Draw Management, Contracts, Schedule, Materials, Messages, Field Updates | Funding |
| Trade | their own contract, Schedule, Materials, Messages, field updates carrying their items | Budget Management, Draws, Funding, other trades' contracts, other trades' field-update items |
| Viewer | Schedule, Materials, Messages, Contracts (view), field updates sent to the designer | all money, the Field Updates composer |

---

## 4. Buttons — does every control say it worked?

For each screen, click every control and confirm one of: a visible state change,
a toast, or an obviously updated figure. A control that mutates data and gives
no feedback is a **fail** — the user cannot tell a save from a no-op, and this
app has already shipped one silent save failure.

Specifically confirm:

- A save that fails shows the rust alert toast and does **not** auto-hide.
- Undo appears after a mutation and actually reverts it.
- Read-only roles see disabled controls, not controls that do nothing.
- Destructive actions (delete package, delete draw, remove trade) confirm first,
  and refuse where something depends on them.

---

## 5. Responsive — desktop and phone

Check at **1280×800**, **768×1024** and **375×812**. The reliable way to measure
every route at once is an in-page iframe sized to the width you are testing —
media queries respond to the iframe, and nothing depends on the preview pane's
own size. Reload after switching a real viewport so load-time device gates rerun.

Per route, require:

| Measure | Threshold | Why |
|---|---|---|
| `documentElement.scrollWidth - clientWidth` | **0** | the page body must never scroll sideways |
| Elements past the viewport with no scrollable ancestor | **0** | a wide table inside `overflow-x:auto` is fine; a spilling card is not |
| Smallest dimension of any control, at 375px | **≥ 24px**, target 34 | a 9px caret is not a control on a phone |
| Last content bottom, scrolled to the end | above the tab bar | measure the last child of `.ever-main`, not any element — inner scrollers give false positives |
| Elements with `touch-action: none` in a resting state | **0** | a swipe starting anywhere on a screen with no tool armed must scroll it |
| Table overflow past the viewport at 375px | 0, except the scope matrix | `table.scrollWidth - 375`; panning is a fallback, never the way to read |
| Chat open at ≤860 | fixed, full `100dvh`, tab bar hidden | `data-pane="chat"` takes the screen; no arithmetic against the header or the bar |
| Drag affordances (bar grip, resize handles) | ≥24px **effective hit area** | measure the hit zone, not the painted glyph — a 9px grip with a 34px target passes |
| Signature pad width at 375px | ≥90% of its card | a finger needs the card, not 260px of it |
| Drawer open | tapping the scrim closes it | a box-shadow is paint, not a target |

Measure in **every mode a screen has**, not just its resting one. The timing
grips and row-order buttons sat below the floor for weeks because they only
exist once edit mode is on, and a default-state sweep never saw them.

Notes that keep this honest:

- A grid item defaults to `min-width: auto`, so a one-column grid still refuses
  to shrink below its widest un-wrappable child: any `display:grid` wrapper
  needs `> * { min-width: 0 }`, and any `flex: 1` label needs `min-width: 0`.
- Small controls on **desktop** are deliberate — this is a dense data app and a
  mouse is precise. Only the ≤860px breakpoint enforces the tap-target floor,
  via `.btn` / `.btn-sm` / `.scope-btn` / `.tap` / `.tap-row` in globals.css.
  Give a small control `.tap` rather than inventing a new size.
- Only ONE stylesheet may own `.ever-main` padding-bottom. A `padding` shorthand
  elsewhere silently wins and drops content under the tab bar.
- The floating bars (bundle, scope) must clear the tab bar on a phone.
- **Draw Management is desktop-only by decision.** Below 860px it shows the
  DesktopOnly explanation with links out to Budget Management and Contracts —
  do not file the gate as a bug, and do not let the gated page regress into a
  cramped working version. Signing a DRAW REQUEST stays phone-friendly; it is
  only the building of draws that needs a desk.
- Administrative carries the room × trade matrix — ~1,500 controls on one page.
  It is inside a scroll container and does not spill, but it is a desktop screen
  in practice. Do not file it as a layout defect; do not let it grow.
---

## 6. Cross-user change signals

Two clients, two users. Make a change as one and confirm the other sees it, and
that the nav shows a **green bubble with a count** on the module that changed.

- Messages → unread count on Messages. It clears when the CONVERSATION is
  opened, not when the module is — opening the inbox must never mark every
  thread read.
- A contract issued → count on Contracts for the vendor.
- A draw reopened for approval → count on Draw Management for the builder.
- A report filed in Help → count on Help for the admin.
- Clearing a count writes only to the reader: a notification addressed to a
  ROLE reaches several people, and `readBy` must gain one id, never set the
  shared `read` flag.

Prove the isolation, do not assume it: read `notifications[].readBy` after
opening a module and confirm it holds exactly the one user id.
---

## 5b. Reach — can the user actually get to the action?

A control that exists is not a control the user can use. Check, on a phone:

- **Every flow that mutates from a list is completable with taps only.** Drag
  may exist as an accelerator, never as the only path — HTML5 drag-and-drop does
  not fire on touch browsers at all, and synthetic `DragEvent`s in a test prove
  nothing about a real phone.
- **Any pick-from-list longer than the viewport carries the floating action
  bar**, with a running count, clearing the tab bar and the keyboard.
- **A disabled control shows its reason as text on the screen**, not only in
  `title` — a tooltip explains itself to a mouse and to nobody else.
- **No `window.confirm`.** Destructive confirmation uses the sheet, and says
  what happens rather than asking whether you are sure.
- **Nothing simulates progress.** A spinner with no work behind it teaches
  people to distrust every real one.

---

## 6b. The feedback tracker (daily)

Run `node scripts/pull-feedback.mjs`. It is read-only against live and rewrites
`FEEDBACK.md`, preserving every **Triage:** line already there.

- Work the Open table: blocking bugs, then bugs, then the rest.
- Write a **Triage:** line under each one you act on — the decision and why.
- Close it in the app (Help → the report → Close) once it ships; the next pull
  moves it to Closed with its triage line intact.
- A report's seat is load-bearing. Reproduce it from that seat, not from admin.

---

## 6c. Sign-in (weekly, and after anything touching auth)

Nobody can report a bug they cannot log in to file. These checks are read-only
and need no credentials — **never sign in as anyone, never set a password.**

Health of the five real accounts, one call each:

```bash
curl -s -X POST https://evergreen-rust-five.vercel.app/api/account-status \
  -H "Content-Type: application/json" -d '{"email":"<their address>"}'
```

- `state: "active"` with `confirmed: true` and a `lastSignInAt` → healthy.
- `state: "needs_setup"` → that person cannot use a password. They need the
  6-digit code or a direct link; tell Chris rather than waiting for them to ask.
- `state: "not_invited"` for someone who IS on the roster → the roster lookup is
  failing. That is an outage, not an access decision.
- `degraded: true` → the check could not run. The login screen must still offer
  every way in; it must never claim someone is not on the project.

Delivery path, unsigned probe — 401 proves the hook and both secrets are live;
500 means auth email is dead and every password reset is silently failing:

```bash
curl -s -X POST https://evergreen-rust-five.vercel.app/api/auth-email \
  -H "Content-Type: application/json" -d '{}'
```

On the screen itself:

- The login card is the FIRST thing on a phone, above the pitch.
- Password fields have a working Show/Hide, off by default.
- A wrong password says what to do next, not just "invalid".
- Any dead end names a way out: the code, the reset link, or asking the admin
  for a direct link.

---

## 7. Regression watchlist

Bugs that already escaped once. Each run, prove they are still dead.

- A budget line's **name** and **category** come from its trade, never a second
  copy (fixed 2026-08-20).
- **ROM never reads `lockedCost`** — typing a contract figure must not move the
  ROM (fixed 2026-08-21).
- **Contracted reads `lockedCost`** — typing a contract figure must move the
  Contracted column (fixed 2026-08-21).
- **Opening a chat must not clobber another user's just-sent message**
  (`patchDB`, fixed 2026-08-20). Test with two clients.
- **A change order must not be counted twice** — the revised contract sum is
  contracted + change orders, and `lockedCost` is not rewritten (fixed
  2026-08-21).
- **Draw Management must fit a 375px phone** — its two-column grid collapses to
  one, and the budget-line row's name gives way before the row does (fixed
  2026-08-21, found by this QA's first run).
- **Change-order exhibit letters are unique per line** — lettered from the
  highest letter used, not the count, so deleting one cannot hand out a
  duplicate (fixed 2026-08-21, found by this QA's first run).
- **A draw must never quietly exceed its lines** — the row says what is left,
  and going past it reads in red rather than being clamped or hidden.
- **A signed draw request is the approval** — there is no second control that
  sets the same status from a different fact.
- **Every control on a phone is at least 24px on its smallest side** — carets,
  row titles and icon links carry `.tap` / `.tap-row` (fixed 2026-08-21; 112
  controls across Draw Management, Materials, Help and Artifacts were between
  9px and 19px).
- **A failed account lookup is never reported as "not invited"** — the roster
  and Auth reads must SUCCEED before their silence means anything, or a network
  blip tells a real user they have no access (fixed 2026-08-22).
- **Nothing owns the touch gesture unless a tool is armed** — Gantt bars and the
  drawing frame set `touch-action` from their own armed state, never
  unconditionally (fixed 2026-08-22).
- **An open conversation takes the phone** — fixed, full-height, tab bar hidden.
  The old `calc(100dvh - 250px)` inverted under the keyboard, because
  `min-height: 420` stopped the card shrinking when the viewport did.
- **A draw can be built with taps** — tapping a drawable line adds it (directly
  when one draw is open, arm-and-place when several). Fixed 2026-08-22; drag was
  the only path and touch browsers never fire it.
- **A signed contract does not move** — binding language and Round-2 dates
  freeze on the first signature; changing them goes through the amendment path.
- **A bundled package is one contract sum** — per-trade agreements are the same
  document; summing them double-counts the award.
- **The sign-in code field assumes no length** — Supabase issues 6 to 10 digits
  depending on a project setting, and the field used to truncate at 6, turning a
  valid code into an invalid one and reporting it as expired (fixed 2026-08-24).
  Test by pasting a 10-digit string: all ten must survive.
- **Deploys must hit both domains** — `evergreen-rust-five.vercel.app` and
  `app.evergreenreno.net` alias to the same deployment. The demo project is
  separate and has separate data; a "data loss" report is checked against the
  URL first.
- **A published field update never changes** — there is no edit or delete
  mutator, and the report renders line names from its own snapshot, not the
  live budget (rename a cost line: old reports keep the old name).
- **A vendor's field-update copy is filtered at every door** — the report view,
  the reader list, AND the message thread. A vendor whose items aren't in an
  update can't open it by deep link, and vendors never share the owner's
  thread. (The client side — owner + designer — reads the whole report.)
- **Feature detection never renders server-side** — the Dictate button exists
  only when the browser says so, which the server cannot know; it mounts after
  hydration or it breaks it (fixed 2026-08-27, found building Field Updates).

---

## 8. Deploy hygiene

- `.env.local` is back to `supabase` before committing. `git diff` proves it.
- No `public/__probe.json` or other test artifact is committed.
- The build is clean: no type errors, no new lint warnings.
- After deploying, both aliases are set and the live site loads.

---

## Reporting

Write findings as: **area · severity · what · where · what you expected**.
Failures first. A run with no failures still reports the warnings and the count
of checks that ran, so a green run is provably a run.

### Native back peels layers, never ejects (added 2026-08-29)
- On a phone, the device's back button closes the topmost full-screen layer — an open Messages conversation, a photo lightbox, the compose sheet, the nav drawer — and only leaves the page once no layer is open. Back from an open chat must land on the conversation list, NOT the dashboard.
- Closing a layer with its own ← / ✕ consumes its history entry: the NEXT back press must do real navigation, never a dead press.
- Desktop (>860px) is untouched: no history entry is created for layers there.
- The nav drawer registers NO back-layer, and a layer close must never cancel a navigation: on a phone, ☰ → Messages must LAND on Messages (regression 2026-08-29 — the drawer's consumed history entry yanked the router back off /updates).
- Mechanism: `app/ui/use-back-layer.ts` (`useBackLayer`) — any new full-screen phone takeover must register with it.

### Schedule on a phone: list first, chart behind the toggle (added 2026-08-29)
- On ≤860px the Schedule opens as an agenda — On site now FIRST (ends/not-started pills), Up next, folded Later and Completed bands — with a List | Chart toggle at the top. The Gantt is unchanged behind Chart; desktop is untouched (no toggle, no agenda).
- DECISION (2026-08-29): a task whose end date has passed reads as DONE in the list, whatever its status flag says — no "overdue"/days-over treatment. On this job the plan is maintained by moving bars, not statuses, so a passed window is the completion signal; a slipping task shows by its dates being pushed. Owner seat reads CONFIRMED dates in the list exactly as on the chart.
- Tapping a list row opens the same Drilldown the Gantt uses — trades' confirm-dates buttons, QC sign-off, budget line and 💬 must all work from the list.
- A deep link (?task= or a Messages chip) into a task inside a folded band must unfold that band.
- Edit mode pins the phone to the Chart view; the toggle hides while editing.

### Budget lines on a phone: name + Total + Drawn/Paid, grand total first (added 2026-08-29)
- On ≤700px a budget row is ONLY the caret, the line's name, Total, and Drawn/Paid — no pills, no manager/category sub-line, no 💬, no line counts. All of that (plus ROM and the 💬 button) appears in the expander when the row is opened.
- A "Grand total · N lines" row leads the table on the phone, its two figures lined up over the Total and Drawn/Paid columns. Desktop keeps the stat-card row and the bottom totals row instead — the grand-total row must NOT show on desktop, and the stat cards must NOT show on the phone.
- No horizontal overflow at 375px.

### Budget expander on a phone: clean money read + change-order sheet (added 2026-08-29)
- Opening a budget row on ≤700px leads with a money block — one figure per row (ROM, Contracted, Change orders, Builder fee, Total, Drawn/Paid; zero rows skipped, Total in walnut, Paid in green) — before any controls; the how-it-works boilerplate paragraphs are desktop-only.
- The per-line contract/paid controls on the phone render as a MATRIX — Line | Contract | Paid, every input and figure on the same grid columns (verify: all Contract inputs share one left edge, all Paid inputs another). The ROM toggle is a small text control under the line name, not a chip. Desktop keeps the inline rows.
- Change orders on the phone are a single button ("Change orders (N)") opening a floating sheet; filing, the save-for-later / revise-contract decision, approving and removing all happen in the sheet through the SAME ChangeOrders component the desktop panel uses — the two must never drift. Native back closes the sheet.
- Desktop unchanged: inline change-order panel, no sheet button, no phone money block.

### Refresh never flashes the login screen (added 2026-08-29)
- In Supabase mode, "not signed in YET" and "signed out" are different states: while the session restores after a refresh, the app shows the brand splash ("Signing you back in…"), and the login screen appears ONLY once auth has definitively answered no-session. The prerendered HTML must contain the splash, not the login form.
- The splash must never outstay auth: signed-out browsers reach the login screen within a second (INITIAL_SESSION is local), an 8s safety valve falls back to the login screen if the auth client never answers, and mock mode never shows the splash at all.
- Recovery links land on the reset screen, not the splash; a no-access email lands on the no-access message.

### Materials: mapped to a trade, and that's it (decision 2026-08-29)
- The critical-path machinery is retired from the UI: no Tied-task column, no Excel-style tie cells (Ctrl+C/V), no hard-date vs tie-to-schedule radio, no need-by (start/finish) choice, no identify-by/on-hand two-date stack.
- Each material carries ONE mapping — its trade — editable in the table row, the phone quick-fields, and the detail's Trade block. The Due column is a single derived date from that trade's schedule window; changing the trade moves the date (a trade edit also clears any legacy hidden task tie).
- Adding a material asks Item / Room / Trade / Qty, nothing more.
- Data model untouched: dueMode/needBy/linkedScheduleId still exist on old rows; only the UI for tuning them is gone. Do not re-add the machinery without an explicit ask.

### Artifacts: phone tiles, markup retired (decision 2026-08-29)
- On ≤860px Artifacts renders as a modular TWO-UP tile grid per section — preview + name (+ a permit's issued/pending status) and a ⋯ menu; NO table, NO stat cards, NO Cards/List toggle, NO type/source/version (the section headings carry the kind), and no horizontal scrolling at 375px. Tapping a tile opens the file viewer.
- Markup is REMOVED everywhere (phone and desktop): no pins, no scribble, no markup list, no "Interactive view". The drawing viewer survives as "Scope view" — zoom/pan, trade scope shading, admin room mapping — and Contracts' scope-drawing links (?view=scope&trade=) still open it. A plain ?artifact= deep link opens the file viewer instead.
- Desktop list/cards views unchanged apart from the markup removal.

### Receipts inbox (added 2026-08-29)
- Bills forwarded to the receipts alias hit /api/inbound-receipt (shared-secret auth). SENDER ALLOWLIST: mail from a non-member is answered 200 and filed NOWHERE. Claude parses vendor/date/amount + suggests a budget line; parse failure still files the receipt with empty fields — the pipeline never loses one.
- Suggestions are PENDING and touch no money. Only owner/full_admin see the "Receipts to review" inbox on Budget Management; confirming (role-checked again in the mutator) writes the reviewed values, files the original into Artifacts against the chosen line, and — only for "count as paid" — adds the amount to the line's directPaid with a stamped note. "File as evidence on a draw" moves no money. Dismiss keeps the record.
- Confirm button carries its consequence ("Confirm — adds $X to {line}'s paid"); disabled state names what's missing.

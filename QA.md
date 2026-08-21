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

Record: the step number, what stalled, and what you expected.

---

## 3. Per-role access — does everyone get their modules?

Diagnostics prints the role × module matrix. Then actually sign in as each
persona on mock and confirm the nav matches, and that a module the role is
denied is denied *by the page too*, not just hidden from the nav (deep-link it).

| Role | Must reach | Must NOT reach |
|---|---|---|
| Full admin | everything, incl. `/qa` | — |
| Owner | Budget Management, Bid & Package (view), Funding, Materials, Schedule, Messages, Contracts | Draw Management |
| Builder / GC | Budget Management, Bid & Package, Draw Management, Contracts, Schedule, Materials, Messages | Funding |
| Trade | their own contract, Schedule, Materials, Messages | Budget Management, Draws, Funding, other trades' contracts |
| Viewer | Schedule, Materials, Messages, Contracts (view) | all money |

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

Check at **1280×800**, **768×1024** and **375×812** (`resize_window`), reloading
after each switch so load-time device gates re-run.

- No horizontal scroll on the page body. Wide tables scroll inside their own
  container. Measure it, do not eyeball it — on each page run
  `document.documentElement.scrollWidth - clientWidth` and require `0`.
  A grid item defaults to `min-width: auto`, so a one-column grid still refuses
  to shrink below its widest un-wrappable child: any `display:grid` wrapper
  needs `> * { min-width: 0 }`, and any `flex: 1` label needs `min-width: 0`.
- The floating bars (bundle, scope) clear the bottom nav on a phone.
- Tap targets on the phone are reachable — nothing under the safe-area inset.
- Both colour schemes render (`colorScheme: dark` / `light`).

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

## 6b. The feedback tracker (daily)

Run `node scripts/pull-feedback.mjs`. It is read-only against live and rewrites
`FEEDBACK.md`, preserving every **Triage:** line already there.

- Work the Open table: blocking bugs, then bugs, then the rest.
- Write a **Triage:** line under each one you act on — the decision and why.
- Close it in the app (Help → the report → Close) once it ships; the next pull
  moves it to Closed with its triage line intact.
- A report's seat is load-bearing. Reproduce it from that seat, not from admin.

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
- **Deploys must hit both domains** — `evergreen-rust-five.vercel.app` and
  `app.evergreenreno.net` alias to the same deployment. The demo project is
  separate and has separate data; a "data loss" report is checked against the
  URL first.

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

# Migration plan — the Claude Design re-cut

Reviewed: `README.md`, `github.md`, the UX review, and the prototype
(`Evergreen Prototype.dc.html`, 480KB, six seats, all workflows).

**Verdict: adopt it, in their order, with three changes and one thing done first.**

The review is unusually well grounded — they read the actual tree, and their
model of `money.ts`, the lock semantics and the timing behaviour is accurate.
I verified every file and claim they cite; all check out. Two of their open
questions are settled by live data below.

---

## 1. The idea worth adopting

> A module is either **a package**, or **a cross-package view of packages**.
> There is no third kind of thing.

That single rule fixes the problem I raised in the brief and could not answer:
scope has no home. Scope isn't a step inside bidding — it's the definition of
the package, written once and referenced by materials, timing and change orders
forever after. It has no home because *the package has no page*.

Everything else follows from it. Money, Schedule and Materials stop being places
where work happens and become roll-ups. Work happens on a package.

This also answers the brief's lead question — should the three money modules be
one — with a better argument than tidiness: **no real question a user asks lives
inside one of them.** "Can I pay the mason's invoice?" needs the committed line,
what's been drawn, and whether the owner's money has landed. Three screens and a
mental reconciliation, on the one question where being wrong costs real money.

---

## 2. What the live data says about their open questions

They flagged three assumptions they couldn't check. Two are now settled.

**Owners Funding — settled, harder than they thought.**
`fundingSources` is **empty (0 records)**. It isn't "largely static", it's
unused: a nav item pointing at nothing. Demote it in session 01 rather than
carrying it into the Money merge as an equal third tab. Keep the model — the
cost-of-capital advisory is good work — but it earns a tab only once it holds
data.

**Package → budget line — settled, and their design already handles it.**
No package currently carries a `lineId` (nothing has been awarded yet), and
**5 trades already have more than one cost line** (`rough-carpentry` has 5).
So a package is *not* 1:1 with a line. Their README resolves this correctly —
"the budget line is the schedule unit, not the package" — so one package
clustering three trades gets three bars. The package page must therefore show
*a set of* lines and bars, never assume one. Build it that way from the start.

**Room × trade scope matrix — already resolved by them.** The UX review
recommended absorbing it; `github.md` retracts that after reading the code, and
the README marks it load-bearing. Agreed — keep it.

**One thing they couldn't see: the live data has duplicates.**
10 packages include *Cleaners ×3, Design ×2, Architect ×2* — residue from test
sessions. A package *list* screen is the first thing that makes this visible.
Clean before session 03, not after.

---

## 3. Where I'd change their plan

**a. Do the invariant checks first, as tests — not as a screen.**
The README asks for a Diagnostics screen re-running ~45 checks. That's useful,
but during a migration of this size the same assertions are worth ten times more
as a test suite that fails a build than as a page someone remembers to open.
Port them as tests in session 00; add the admin screen later if it still earns
its place.

**b. ROM phase and the `agreed` flag come last, not woven in.**
Confirmed: there is no `agreed` field today (the only hit is a comment about
"agreed locked cost"). Their recommendation is right — an owner approval should
gate the lock. But it changes the money gate on a live job with signed contracts
and 15 draws already paid. It is the one change that can misstate real money, so
it lands after the IA is stable, with existing locked lines grandfathered as
agreed. Their own session plan wisely omits it; I'm making that explicit.

**c. Session 01's rename is not quite "no schema change".**
The vendor/package/contract language pass is free. Re-rooting the nav per role
touches `app-frame.tsx` and every page's access check — still no data migration,
but it is the change most likely to hide a screen from someone who needs it. It
ships with a role-visibility test (from 00) rather than by eye.

---

## 4. What is already done

Some of the target already exists — worth not rebuilding:

| Target requirement | Status |
| --- | --- |
| Acknowledgement layer (toast on every write) | **Foundation built.** One debounced toast at the store's single `mutate` chokepoint. Needs their per-action sentences ("Draw approved. Saved to the payment schedule.") and the refusal half. |
| Five-fields / derived completeness | **Done** in bidding — the pattern to generalise. |
| Vendor covers many trades | **Done.** `tradeIds` + `vendorCovers`. |
| Owner messaging the whole team | **Done.** |
| Scope screen | **Built**, but at step 02 of the wizard — moves onto the package page. |
| QC dual sign-off, per-trade checklists | **Exists** (`qc.ts`, 18 trades + default). |
| Terms engine, door codes, drawing viewer | **Exist.** |

---

## 5. The plan

Their five sessions, plus a preparation session and a clearly separated phase 2.
Each is shippable alone and worth having if the next never happens.

### 00 — Safety net *(before any UI moves)*
- Snapshot live state to a restorable file.
- Port the invariant checks as tests: money derivation chain, `linePaid ≤ lineCurrent`,
  base + markup = total with black-box contributing 0, draws dual-signed,
  every role's home screen reachable from its own nav, no GC-internal message
  readable from a trade seat.
- Clean the duplicate packages.
- *Ships:* nothing visible. Everything after this is guarded.

### 01 — Language and the role-aware shell
- Rename pass: **vendor / package / contract**. "Trade" survives only as a
  category on a vendor — never a container, never a nav item.
- Nav re-rooted per role, banded (*The job / Reference / Set-up*), badges on
  Today, Approvals, Materials.
- **Trade and bidding-vendor get no nav at all** — one screen each. This is the
  change most likely to fix the adoption problem we've hit repeatedly.
- Demote Owners Funding (empty).
- *Ships:* 10 items → 8. Biggest perceived gain per hour.

### 02 — Money becomes one module, three tabs
- Committed · Paid · (Funded, when it has data).
- **Remaining and covered** on every row — the figure nobody can see in one
  place today.
- Role opens the right tab by default.
- *Ships:* a read-only reshuffle. No numbers move.

### 03 — The package page and the package list
- One package, one page: Scope → Bids → Contract → Budget lines → Draws →
  Schedule & materials.
- Package list replaces the sidebar `<select>`.
- Seven-step flow survives as the path through an *unbid* package.
- Built for **many lines/bars per package** (see §2).
- *Ships:* the seams disappear. This is the session that proves the thesis —
  if the package page doesn't carry its weight here, stop and keep 01–02.

### 04 — The phone, properly
- Trade's single screen; owner's approval queue; materials as a queue
  ("9 items need you this week") instead of 77 × 12.
- No horizontal scroll on a phone, anywhere.
- *Ships:* three views, no new data.

### 05 — Notifications and the invite
- One job per channel, enforced in code: Messenger = humans only; in-app =
  needs action; email = reaches someone not in the app (invite, stale approval,
  money leaving).
- Magic-link invite landing a trade on their one screen.
- Retire notifications that fail the test.

### Phase 2 — after the IA is stable
- ROM phase ↔ `locked` reconciliation, plus the `agreed` gate (highest money risk).
- Materials: four stages, linked trade, due basis (start / last 20% / fixed).
- Acknowledgement layer completed — per-action sentences and refusal reasons.
- Help (per role) and Diagnostics screens; in-app feedback → markdown brief.

---

## 6. Risks

- **Live money, five real users.** Every session ships independently and is
  revertible; no session leaves data half-migrated.
- **Session 03 is the big one.** It's also the natural stop point if the thesis
  doesn't hold. Everything before it is useful on its own.
- **Chris's work network blocks the custom domain** — test on
  `evergreen-rust-five.vercel.app`.
- **Visual styling is medium-fidelity in the prototype.** Their tokens are our
  tokens already (same earth palette); reproduce layout and hierarchy, not hex.

---

## 7. Decisions I need

1. **Start at 00 or 01?** I'd do 00 — but it ships nothing visible, and you may
   prefer to see movement first.
2. **Owners Funding: demote to Admin, or keep a tab and populate it?** It's
   empty today.
3. **Duplicate packages** — delete the test residue (Cleaners ×3 → 1, Design ×2 → 1,
   Architect ×2 → 1)? I'd want your eye before removing anything.
4. **Scope of session 01's rename** — user-facing labels only, or the code
   identifiers too? Labels are safe and fast; identifiers are a wide diff.

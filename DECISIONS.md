# Migration decisions

One decision per entry, in the order they were made. This is the record the
build follows — where it disagrees with `MIGRATION-PLAN.md`, this file wins.

The rule these run under: the design document defines the workflow, the
existing app supplies the data, and a feature the app has that the design does
not cover is a question rather than a default.

---

## 01 — Adopt the ROM, fully. Build it unlocked first.
**Decided 2026-08-20 · Chris**

The design's three-phase money model is adopted as specified: the builder
drafts a rough order of magnitude, the owner commits each line (committing a
range agrees its ceiling), the ROM locks and never moves, and the budget is
then negotiated inside packages — above or below their line — with a signed
package changing only through a change order.

**Sequenced deliberately:** build the ROM over the live 39 cost lines with the
lock *not yet thrown*, so the whole model can be read in real data and backed
out of before it becomes irreversible. Throwing the lock is a separate, later,
explicit decision.

**Why fully rather than the owner gate alone:** the ROM is not a feature in
this design, it is the spine. The approval queue, the package-creation gate and
the entire variance model are views of it. Half-adopting means building those
three things twice.

**What it closes:** today `canLock` is builder-or-admin with no owner approval
anywhere in the path — a price can be fixed and pushed to contract without the
owner ever seeing it. That is the largest money risk in the app, against 39
live cost lines carrying signed work.

**Follows:** package creation gates on a committed line + a locked ROM;
variance is only meaningful against a committed figure, so a draft line carries
none.

---

## 02 — Draws are replaced by the package workstream
**Decided 2026-08-20 · Chris**

Draws stop being assembled on a screen of their own. They become part of the
package: written against **funding phases** on a package's Contract tab, where
a phase is a slice of the committed figure behind a gate, and the gate is
*derived* — the builder signs QC, then the owner counter-signs, and that is
what makes the phase fundable. Release happens on that package's Draws tab.
The standalone `/payments` drag-to-allocate builder goes away.

This is a replacement, not a relocation. Today any locked line can be
allocated into any draw at any time; the design will not let money move until
the work it pays for has been signed off twice.

*Recorded as my stated reading of "draws are replaced in the project
workstream", which Chris moved past without correction. Correctable — say so
and this entry changes.*

**Open, to be answered with live data rather than asked cold:**
- The 15 existing draws must land on packages; today's draws allocate across
  lines, so some will not map cleanly. Show the mapping before writing anything.
- A draw spanning several trades has no home in the design's model. Find those
  in the live data and show what they would become.

---

## 03 — Who sees money, and who moves it
**Decided 2026-08-20 · Chris**

Three separate things, separated deliberately:

**The budget is shared.** Emily, the GC and admin all see Budget Management —
the ROM screen: agreed, committed, paid, remaining, variance. This is the
common ground the job is run from.

**Draws are the GC's to manage.** Building a draw and releasing it sits with
the builder, on the package. The owner does not assemble draws.

**The owner sees the outcome, not the machinery.** What a draw does to a line —
paid, remaining — surfaces in the budget. That is how Chris and Emily read
draw activity: through its effect on the money, not through a draws console.

**Funding stays a tab, and stays owner-only.** Emily and Chris; the GC does not
see it. It holds household financial position — the Kennoway sale, the purchase
loan, the home loan, a retirement repayment, the DJ loan and the HELOC — plus
the advisory naming which source gets tapped next. Showing a contractor exactly
what an owner can afford weakens the owner across every later change-order
conversation. The permission boundary therefore stays on a route, never a
section inside a screen the GC can open.

**This settles an open contradiction in the design** (unspecified item 08): the
package Draws tab gates release on `builder || admin`, while the owner's
approval queue exposes the same write with no role check. The rule is now:
**the GC releases; the owner gates.** Emily's power over money is the draw
approval and the QC counter-signature — the builder signs first, she signs
second, and that second signature is what makes a draw releasable at all.
Nothing is releasable until both have signed.

---

## 04 — Keep the Dashboard. Do not adopt the design's "Today".
**Decided 2026-08-20 · Chris**

The design replaces the dashboard with *Today*: seven action groups that empty,
whose stated goal is a blank screen — *"An empty Today is the goal, not a blank
screen."* Chris prefers what the app already has, so the dashboard stays and
the nav label changes from "Today" to **Dashboard** to match the screen behind
it.

**First case where the app wins over the document** — which is what the
one-at-a-time rule exists to allow.

**Requirement attached: it must reconnect to the new model.** The dashboard
currently reports a world that decisions 01–03 change:
- Stat cards read *Projected Cost / All-in / Markup*. Under the ROM they must
  read against the agreed figure — agreed, committed, paid, variance.
- The *Draws & Payments* panel links to `/payments`, which decision 02 removes.
  It becomes a roll-up of draw outcomes pointing at packages.
- Funding is owner-only (decision 03) and the dashboard is shared with the GC,
  so nothing funding-shaped may appear on it. The materials-stat leak found in
  QA is the precedent: scope the figures, not just the rows.

**Still open:** the design makes the owner's home screen the approval queue, not
a dashboard. Chris chose the dashboard for himself; whether Emily lands on the
dashboard or on her approval queue is a separate question, not settled here.

---

## 05 — Delete the `Test Drywall` package
**Decided 2026-08-20 · Chris · DONE**

Removed from live data. It was empty — no bids, no award, no linked cost line,
no scope items — so the guard that would have refused a package carrying real
money never fired. Snapshot taken immediately before the write to
`evergreen-backups/pre-delete-2026-08-20T12-05-37-233+00-00.json`, and the row
was re-read for concurrent writes before writing.

Verified after: 39 cost lines, 77 materials, 19 messages, 11 funding sources,
6 packages, no Test Drywall.

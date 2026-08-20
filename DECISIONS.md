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

---

## 06 — Design for the persona "owner", never for a named person
**Decided 2026-08-20 · Chris**

Chris and Emily are **both owners**. Chris additionally holds `full_admin`
because he is the developer, which is why he sees everything — that is a
developer privilege, not an owner one. Emily is referred to as *the owner* from
here on.

**The rule:** design and write for the **role**, not the individual. There may
be two owners today and a different set tomorrow; nothing in the product should
assume otherwise.

**Why this needs saying now.** The design document writes its copy in person
names throughout — *"Draft — with Emily"*, *"Send to Emily"*, *"Waiting on
Emily"*, *"Ask Emily"*, *"$X with Emily"*. Building from it verbatim would
import a named individual into UI strings. The app's own copy currently has
none of that (checked: only three code comments, since de-personalised, and a
default session name in data).

**How to build it:** copy is role-shaped, and where a name genuinely reads
better it is **resolved from the user record at render time**, never written
into the string. So the design's "Waiting on Emily" becomes "Waiting on the
owner" — or the actual owner's name, pulled from data. Both owners see the
right thing, and a change of owner does not require a copy change.

---

## 07 — The owner's home is the Dashboard. Approvals are a link, not a panel.
**Decided 2026-08-20 · Chris**

Settles the question left open by decision 04. The design makes the approval
queue the owner's home screen; it is not. **Every role lands on the Dashboard**,
and the current dashboard functionality is kept.

**Approvals stay a real screen, reached from the dashboard by a link** — a count
and a way through ("N items need your approval →"), not the approval cards
themselves rendered inline. The queue is where a decision gets made; the
dashboard only says one is waiting.

**Why it is not simply the design's Today.** Today is an action queue whose goal
is to empty. The dashboard is a standing view of the job. Chris wants the
standing view, with the action queue one click away rather than in place of it.

---

## 08 — Keep both markup models
**Decided 2026-08-20 · Chris**

Per-line markup survives in full: **pass-through + markup** (base × markup%,
disclosed to the owner) and **black-box / in-fee** (the margin sits inside the
number and contributes 0 to the visible markup), plus the global builder-markup
control and the per-line override for owner-carried lines.

The design's ROM carries markup but only one model — its `markupModel` field
exists, its screen shows a single `markup label` per row, and `blackbox` is
handled as "In fee" text rather than as a real second mode. The app's two-model
version is richer and stays.

**Blocks nothing now:** this was the gap holding up the ROM table, since a
ROM row has to show base, markup and all-in separately, and it can only do that
if it knows which model a line uses. Answered — the ROM table carries both.

---

## 09 — Terms become their own admin module, managed by whoever manages the trade
**Decided 2026-08-20 · Chris**

The terms engine is promoted out of the Trade Scope tab into a **module of its
own, alongside the other administrative modules** (Rooms & Scope Matrix, Trade
Scope, Team/Access/Billing).

**The GC manages terms for their own trades.**

*My reading, stated so it can be corrected:* terms follow trade management, the
same way contracts already do in this app — a builder-managed trade signs
builder↔trade, an owner-managed trade signs owner↔trade. So the GC edits terms
for builder-managed trades, the owner for owner-managed ones, and full_admin
for all. Today the gate is a flat admin/owner/builder with no per-trade scoping.

**Against the design:** the design document has no terms engine at all — one
README sentence describing clause sets, per-trade exclusions and additions,
with nothing behind it. The app's working version is kept and given a better
home.

---

## 10 — Keep AI price sourcing on materials
**Decided 2026-08-20 · Chris**

The ✨ sourcing flow stays: `/api/price` runs a live web search and returns real
current US prices — vendor, product, price, direct link, plus rebates and
incentives and a one-line recommendation — which can be written straight to a
material's spec link or added as one of its three comparison options.

Absent from the design document entirely. Kept because nothing in the re-cut
replaces it and it does work no other part of the app does.

---

## 11 — Keep the drawing viewer. Drop markup. Add pan.
**Decided 2026-08-20 · Chris**

**Dropped:** the markup layer — comment / question / photo pins, the pin editor
and its notes, resolve-and-reopen, the pin list, and the freehand scribble
overlay. This is a deliberate removal of something the design *does* specify;
the design's version is thinner than the app's, and neither is wanted.

**Kept:** the viewer itself — opening a drawing full-size and reading it.

**Added:** pan within the viewer, so a large drawing can be moved around rather
than only fitted to the frame. Zoom comes with it; a pan control on a drawing
that cannot be enlarged does not do anything useful.

*Open, and asked rather than assumed:* the viewer also carries **scope view**
(a trade's rooms shaded on the plan, with their scope and materials beside it)
and **map rooms** (dragging a box to tie a room to an area of the drawing).
Neither is annotation, and the design dropped both independently of this
decision. Whether they go with the markup layer or stay is not settled here.

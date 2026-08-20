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

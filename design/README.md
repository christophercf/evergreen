# Handoff: Evergreen — construction management app

## Overview

Evergreen is a construction management app for a single renovation job (31810 Evergreen Rd). It carries one project from a rough order of magnitude budget, through trade packages and bidding, into contracts, draws, scheduling, materials and closeout — with six named roles seeing sharply different slices of the same data.

This bundle documents an interactive prototype that covers the whole flow end to end. It exists to settle the product model — who can do what, when, and what each figure means — before a rebuild in the real repo (`christophercf/evergreen`, Next.js 16 / React 19 / TypeScript / Tailwind 4).

## About the design files

The files here are **design references written in HTML**. They are prototypes that demonstrate intended layout, state and behavior. They are not production code and should not be copied into the app.

The task is to **recreate these designs in the target codebase's environment** — the existing Next.js app, its Tailwind conventions, its `lib/data` store and its `app/ui` primitives. Where the prototype and the repo disagree, the repo's data model wins; this README calls out each place where the prototype deliberately proposes a change.

The prototype is a single-file component with an internal state machine and no backend. Everything is seeded, synchronous and in-memory.

## Fidelity

**High fidelity on interaction and data model; medium fidelity on visual styling.**

- Interaction, permissions, derived state and copy are final. Reproduce them exactly. The copy in the prototype is deliberate — it explains derivations to the user in plain language and should be carried over verbatim where practical.
- Visual styling is an earth-tone system built inline in the prototype, predating the current design-system binding. Layout, hierarchy, density and information architecture should be reproduced; exact colors and type should be re-expressed in the codebase's own design system rather than lifted as hex codes. Tokens are listed below for reference.

## Roles

Six seats, switched from a bar at the top of the prototype (a development affordance — in the real app the seat comes from auth).

| Seat | Internal role | Sees |
| --- | --- | --- |
| Chris (app developer) | `admin` | Everything, plus the seat switcher |
| Aaron (GC) | `builder` | The full job: ROM, packages, money, crews |
| Emily (home owner) | `owner` | Approvals, budget, schedule, materials, messages |
| Luis (vendor) | `trade` | One screen: their own awarded work |
| Tom (bidding vendor) | `tradeBid` | One screen: the bid they were asked for |
| Designer | `viewer` | Read-only reference screens |

Permissions are enforced **in the mutators, not at render**. A hidden button is a convenience; the guard is in the action. Reproduce this — every write path re-checks the role.

## Navigation

The sidebar is banded by frequency of use, not by domain:

- **The job** — Today, Approvals (owner only), Budget Management, Packages, Schedule, Materials, Messages
- **Reference** — Vendors, Artifacts
- **Set-up** — Scope & rooms, Users & access, Help

Band headings only render when a role has more than three items. Trade and bidding-vendor seats have no nav at all — one screen, nothing they cannot act on. Badge counts appear on Today (open items), Approvals (pending), and Materials (late).

Default landing screen is Budget Management, with the ROM locked.

## Screens

### Today
The builder's queue. Items grouped by what they are waiting on, each with a figure and a single action button that jumps to the place the decision is made. An empty Today is the stated goal, with its own reassurance card ("Nothing needs you") rather than a blank state.

### Budget Management
The money spine. A stat-card row (base, markup, total, drawn, remaining, cost of capital), a plotted series showing ROM baseline → locked cost → change orders over time, then the line table.

Each **budget line** carries: price-point history (Estimate, ROM, After Plan Review), an allowance low/high range, a markup model, a locked baseline, change orders, funding phases, direct payments, macro category, and trade.

Derivation chain — reproduce exactly, it is the heart of the app:

```
lineBase     = last price point, else allowance high
lineMarkup   = lineBase × markupPct   (passthrough only; black-box contributes 0)
lineTotal    = lineBase + lineMarkup
lineBaseline = lockedCost if locked, else lineTotal
lineCurrent  = lineBaseline + approved changes − approved savings
linePaid     = paid draws + directPaid, capped at lineCurrent
```

Ranged lines carry `lineLow`/`lineHigh`, both marked up. Locked lines are fixed at both ends. Rollups keep base, markup and total **separate** — the owner must be able to see her true cost and the builder's margin as distinct numbers.

**Markup semantics:** pass-through markup sits on trade lines and is visible; black-box markup sits on fees and is tracked but not itemized to the owner. Both are tracked separately.

**Funding:** each source has name, amount, drawn, rate, liquidity rank and fund type (cash or debt). `marginalRate(f)` is the marginal cost of tapping it; `costOf = amount × rate`. Sources are tapped top-down by an **editable Order column** (the owner's `liquidityRank`). A cheapest-first advisory sorts by marginal rate then rank and states the delta in words: "Your current order costs X to access — cheapest-first would cost Y". It is advisory only — it never moves money. A contingency buffer sits alongside.

**The lock** is the strongest gate in the model. `canLock = !readOnly && (role === "builder" || role === "full_admin")` — owners never lock. "Lock & push to contract" fixes the agreed pre-markup cost; after that, changes go through change orders. `full_admin` alone can unlock. Only locked lines can be drawn against; unlocked draw rows render `cursor: not-allowed` at 0.62 opacity.

### ROM (request for owner markup)
A **phase, not a parallel edit mode**. Three stages:

1. **Drafting** — the builder edits lines; the owner commits them one at a time.
2. **Locked** — no changes. Packages get let against a baseline that cannot move.
3. **Contracted** — change orders only.

This is the prototype's main proposed change to the repo model, and the reason it exists: the real app's `locked` flag gates change-order flow, while the prototype's ROM phase gates package creation. Bring the two together — a `locked` line inside a `Contracted` ROM.

### Packages
A package clusters one or more trades. Tabs per package: **Scope / Bids / Contract / Budget line / Draws / Schedule**.

- **Scope** — room × trade matrix with `in` / `out` / `existing` / `unset` cells, rooms grouped by floor (stock plus custom), and a per-trade scope editor. Load-bearing; do not absorb it into anything else.
- **Bids** — comparison across vendors with normalized fields (total, days, crew size, labor, per-day, basis, rate). Bids missing any of the five comparable fields are excluded from the comparison and shown separately with the reason. **A bid is locked into its submission route once issued** — "we key it in" must name who immediately; a vendor filling the app or uploading their own quote cannot be switched mid-flight.
- **Contract** — vendor, awarded figure, basis, signed date, and funding phases with derived gates (percentage or amount mode).
- **Budget line / Draws** — the money for this package, and draws with allocations across lines. Draws gate on QC.
- **Schedule** — the package's bars.

**Award vs. approve:** the GC awards vendors; the owner approves money. Award buttons live in the builder's flow, draws and ROM lines in the owner's approval queue.

### Schedule
Gantt over 14 weeks (`24 Aug` … `23 Nov`). **The budget line is the schedule unit, not the package** — one package clustering three trades gets three independently draggable bars.

- `canDrag = canEdit && editing` — drag-editing is builder/admin only and sits behind an explicit Edit mode. Owner and builder can both add items; only editors drag.
- Multi-select by ticking rows; dragging any selected bar moves the whole group, with a live preview on every selected bar.
- Drag the bar body to move; drag the right-edge grip to resize (`mode: "move" | "resize"`).
- Row order is changed with tap buttons, not drag.
- Bars carry `confirmedStart`/`confirmedEnd` beside `start`/`end` — confirmed and unconfirmed bars render differently.
- Dependency cascade: moving a task later surfaces its dependents and offers to shift them ("These tasks depend on it. Shift the selected ones too?"). The prototype derives dependencies from three edges written into the seeded package scopes; the repo should use a stored dependency graph.
- Publish flow: "Publish to log the change with a reason, notify trades, and email the client."

Not yet built and worth adding: `ScheduleItem.status` (blocked / done), the pending-change dashed bar treatment, and QC sign-off in the Gantt drill-down.

### Materials
**Four stages, not a boolean:** Need to identify → Identified → Ordered → On prem (internal keys: identified / selected / ordered / onsite). The stage is a single dropdown on every row — movable in either direction, permission-gated to the buyer; there is no separate "mark ordered" action. Blocked items (owner still choosing) show "Ask Emily" instead.

**Every material is linked to a trade on the schedule** via a "Linked trade" dropdown, and its due date derives from that trade's bar by a "Due" basis: when the trade starts, the last 20% of the trade's work, or a fixed date as written. Dates move when the bar moves. Lateness is derived: not ordered, and the lead time no longer fits before the due date. **Materials due within 14 days surface as a "due soon" card on the builder's Today**, distinct from the overdue card.

Each material's details are editable in-row: supplier, lead time, unit cost (money roles only), quantity (feeds line total), specs, and an item URL. The URL renders an "open ↗" link and a small preview image (the prototype uses the site's favicon; the real app should fetch the page's og:image server-side). Costs are visible to admin, builder and owner only.

### Vendors
Roster with ratings, plus a terms engine: a trade's contract terms resolve from a standard clause set, minus per-trade exclusions, plus per-trade additions and custom clauses — grouped in clusters and rendered with a preamble and binding language.

### Artifacts
Files by kind, with per-kind hints. Version history with add-version and watch-for-changes. Permit status with trade gating ("cannot start until issued") and a master general permit banner. Contracts visible to parties only. A stubbed AI summary. An interactive drawing viewer: faux plan with markup pins (change / question / photo), notes, resolve and delete, and a markup list.

App-only, not carried from the repo: zones/room-mapping, freehand scribble, Drive links, real file drops.

### Messages
Audience-filtered. Internal GC alerts never reach vendor screens. Each vendor sees only their own work and the messages they are party to. Messages can be tagged to an item (a package, a line, a material) with photo capture; a tag resolves to a screen, and the deep link only renders if the reader's role has that screen in its nav.

### QC
**Dual sign-off** — owner and builder both sign. Per-trade checklists (22 trades in the repo's `qc.ts`, with a four-item default). Draws gate on both signatures.

### Scope & rooms, Users & access, Help
Room list grouped by floor, the room × trade matrix, a four-step project set-up wizard. Users & access with admin-editable door codes. Help is per-role: a lead paragraph, numbered features each with a jump link, and two tips.

## Core principle

**Every state is derived.** Nothing is marked complete by hand. A bid is comparable because it has five fields. A draw is releasable because QC is signed. A material is late because its lead time exceeds the gap to its derived need-by date. When implementing, resist adding status booleans that a human sets — compute them.

## Acknowledgement layer (new)

No write is silent. Every committed change raises a bottom-center toast naming what was saved ("Draw approved. Saved to the payment schedule."), and every refused click states the reason instead of doing nothing ("That is the owner's counter-signature. Only Emily can add it."). In the prototype this is a watcher over the write-keys plus specific sentences in the mutators — in the rebuild, treat it as a product requirement: acknowledge every write, explain every refusal. System-raised events (like the 48-hour bid check) do NOT toast; they land in Messages with a badge — confirmations are for the user's own actions only.

## In-app feedback capture (new)

Help carries a "File a bug or ask for a feature" form on every seat (compact on vendor phones): kind (Bug / Feature / Wording / Question), area, severity for bugs, what happened, steps, expected. Each report auto-attaches the seat, device, ROM phase, open package and last screen. Reports collect into a markdown brief ("Copy the brief for Claude") intended to be pasted into Claude Code for iterative fixes. Reproduce this loop in the real app — it is how the owner intends to run iteration.

## Diagnostics screen (new)

Admin-only (Chris), under Set-up. Re-runs ~45 invariant checks against live state: committed = awarded + approved COs; paid ≤ committed; all-in = base + markup with black-box contributing 0; session-released draws dual-signed; material stages valid; every role's home screen reachable from its own nav; no GC-internal message readable from a trade seat; rollup sums consistent. Port these as tests in the rebuild.

## State

Prototype state, all in one component: `role`, `device` (desktop/phone), `screen`, `pkgId`, plus per-feature editing state (schedule `editing` + selection + drag mode, ROM phase, dialog open/target, message composer, markup pins). In the repo this maps onto `lib/data/store.ts` (localStorage plus cross-tab sync) with optional Supabase behind `NEXT_PUBLIC_DATA_SOURCE=supabase`.

## Design tokens (prototype)

Reference only — re-express in the codebase's design system.

| Role | Value |
| --- | --- |
| Page ground | `#f5f0e4` |
| Card surface | `#fffdf7` |
| Chrome / sidebar | `#3a2f25` |
| Active nav | `#2c241c` |
| Body text | `#2c241c` |
| Muted text | `#7a6f60` |
| Hairline border | `#ddd2bd` |
| Green (positive, action) | `#6b7f5b`, tint `#e6ebdd`, deep `#56684a` |
| Gold (label, caution) | `#b08a3e`, deep `#8f6f2e` |
| Terracotta (problem) | `#a8553c` |
| Brown (ROM series) | `#8b6f47` |
| Nav band heading | `#8f7f68` |
| Sidebar rule | `#4a3d31` |

Type: Georgia serif for figures, headings and vendor names; system-ui for everything else. Heading 25–26px, card figure 19–23px, table figure 13–16px, body 12.5–13px, meta 10.5–11.5px, uppercase label 9.5–10px at `0.08–0.13em` tracking.

Radius `3px` throughout. Minimum touch target `44px` on phone/trade screens. Cards use `1px solid #ddd2bd` with a `3px` top border in the category accent.

Seven macro categories carry fixed colors (`MACRO_ORDER` / `MACRO_COLOR` in `lib/data/money.ts`) in this same earth palette.

## Assets

None. No images, no icon files — all glyphs are text or inline SVG. The drawing viewer's plan is drawn in HTML/CSS, not a real file.

## Repo mapping

| Screen | Repo files |
| --- | --- |
| Today | `app/page.tsx`, `app/ui/app-frame.tsx` |
| Budget Management | `app/costs/page.tsx`, `app/budget/page.tsx`, `app/payments/page.tsx`, `lib/data/money.ts` |
| Packages — Scope / Bids / Contract | `app/bids/page.tsx`, `scope.tsx`, `screens.tsx`, `kit.tsx`, `request-doc.ts` |
| Packages — Budget line / Draws | `app/costs/page.tsx`, `app/payments/page.tsx` |
| Schedule | `app/timing/page.tsx`, `lib/data/qc.ts` |
| Materials | `app/materials/page.tsx`, `lib/data/materialCatalog.ts` |
| Vendors | `app/vendors/page.tsx`, `app/admin/add-vendor.tsx`, `app/admin/terms-builder.tsx`, `lib/data/terms.ts` |
| Artifacts | `app/artifacts/page.tsx`, `drawing-viewer.tsx`, `file-view.tsx` |
| Messages | `app/ui/messenger.tsx`, `app/updates/page.tsx` |
| Scope & rooms | `app/admin/page.tsx`, `lib/data/types.ts` (`ScopeStatus`) |
| Users & access | `app/admin/page.tsx`, `lib/data/seed.ts` (`doorCode`) |
| Help | no equivalent — new |

## Open items for the rebuild

1. **Markup** — absent from the repo's UI surfaces in places; present in the model. Every figure and every rollup must show it, and keep base/markup/total separate.
2. **ROM vs. `locked`** — reconcile the prototype's ROM phase with the repo's `locked` flag, per the ROM section above.
3. **An `agreed` boolean.** Today no owner approval is a precondition for letting work or fixing a price — every gate around the lock is a builder action. The prototype recommends an `agreed` flag the owner sets, which the lock requires.
4. **QC** — the repo is dual-signed with per-trade checklists; make sure the Gantt drill-down carries it too.
5. The repo README describes timing / materials / vendors / artifacts as "Phase 2 scaffolded". They are not — those modules are substantial. `updates` and `payments` are not in the README at all. Read the tree, not the README.
6. **Materials → schedule link** — the repo's `dueMode`/`needBy` model is close but not identical to the prototype's linked-trade + due-basis (start / last 20% / fixed) dropdowns. Extend `needBy` with a `last20` basis and add a per-material trade override.
7. **Product image from URL** — the prototype shows the link domain's favicon; the real app should fetch the page's `og:image` server-side (an API route already exists for link previews: `link-preview`).

## Files in this bundle

- `Evergreen Prototype.dc.html` — the full prototype, all six roles, all workflows. Open it in a browser.
- `Evergreen Flow Prototypes.dc.html` — earlier flow explorations.
- `Evergreen UX Review.dc.html` — the written UX review that shaped the prototype.
- `Scope of Work Request.dc.html`, `Bid Intake and Comparison.dc.html`, `Vendor Management.dc.html` — the original single-feature deliverables, now subsumed into the prototype. Kept for the detail they carry.
- `github.md` — the source-reading notes: real routes, funding model, lock semantics, timing behavior, differences from the prototype.
- `support.js`, `doc-page.js`, `image-slot.js`, `ios-frame.jsx` — runtime files the prototypes need to open locally.

repo: christophercf/evergreen
branch: master

## Last sync
date: 2026-08-18T23:55:00Z (approximate — within the 23:46–23:55 window of this turn's github reads)
commit: unknown (github_get_tree resolved a6c80eeda25f, which is a tree hash, not a commit — omitting rather than guessing)

### Updated in this project
- Rebuilt Artifacts on the real module (app/artifacts/page.tsx, drawing-viewer.tsx, file-view.tsx): kind sections with hints, version history with add-version, watch-for-changes, permit status with trade gating ("cannot start until issued") and the master general permit banner, contracts visible to parties only, the stubbed AI summary, and the interactive drawing viewer — faux plan, markup pins (change / question / photo) with notes, resolve and delete, and a markup list. Not carried over: zones/room-mapping, freehand scribble, Drive links, real file drops — named as app-only in the rebuild spec.
- Built the scope module on the real model: room x trade matrix with in / out / existing / unset cells, floor-grouped rooms stock + custom, per-trade scope editor, and the four-step project set-up wizard.
- Made QC dual-signed with per-trade checklists and an owner counter-sign card; draws gate on both signatures.
- Added Users & access with admin-editable door codes, contract funding phases with derived gates, messenger item-tagging with photo capture, and the Funded tab's cheapest-first advisory.

## The funding model, from source (app/budget/page.tsx)
- `FundingSource`: name, amount, drawn, `rate`, `liquidityRank`, `fundType` ("cash" | "debt").
- `marginalRate(f)` is the marginal cost of tapping a source; `costOf = amount * rate`.
- Available = untapped (amount − drawn) across sources; `gap = allIn − available`.
- Sources are tapped top-down by an **editable Order column** = the owner's
  `liquidityRank`. The advisory sorts by `marginalRate` then `liquidityRank` and states
  the difference: "Your current order costs X to access — cheapest-first would cost Y".
- A "Cost of Capital" stat card carries the cheapest-first plan's cost.
- A contingency buffer sits alongside.
The prototype reproduces all of this and keeps it advisory: it ranks and reports, never
moves money, and the owner may keep a dear source first when speed matters more than carry.

## The lock, from source (app/costs + app/payments)
- `canLock = !ro && (role === "builder" || role === "full_admin")` — owners never lock.
- "Lock & push to contract" fixes the agreed pre-markup cost; after that "adjust via
  change orders". `full_admin` alone can unlock.
- A cost line can be created already locked via the "Agreed price" mode, and winning
  Bid Management bids "promote in as locked lines".
- Payments: "Only 🔒 locked lines can be drawn"; `canDrag = locked && !ro`, unlocked rows
  render `cursor: not-allowed` at 0.62 opacity.
- Net: the lock is the strongest gate in the money model, and every gate around it is a
  builder action. No owner approval is a precondition for letting work or fixing a price.
  That is the residual gap the prototype's recommended `agreed` boolean closes.

## Adopted from app/timing/page.tsx
Read via github_search_code (not a full read of the 51KB file). What the real timing
UI does that the prototype now does too:
- `canDrag = canEdit && editing` — drag-editing is builder/admin only and sits behind
  an explicit Edit mode. Owner and builder can both add items; only editors drag.
- Multi-select by ticking rows; dragging any selected bar moves the whole group
  (`applyGroupDelta`), with a live preview on every selected bar.
- Drag the bar to move, drag a right-edge grip to change length (`mode: "move" | "resize"`).
- Row-order controls are tap buttons, not drag — "no drag needed (custom order only)".
- Publish flow: "Publish to log the change with a reason, notify trades, and email the client."
- Dependency cascade: moving a task later surfaces its dependents and offers to shift
  them — "These tasks depend on it. Shift the selected ones too?"
Differences the prototype keeps deliberately: it uses mouse events with document
listeners rather than pointer capture, and it derives dependencies from three edges
already written into the seeded package scopes rather than a stored dependency graph.
Not yet adopted: `ScheduleItem.status` ("blocked" / "done"), the pending-change dashed
bar treatment, and dual QC sign-off in the Gantt drill-down.

## Notes
Stack: Next.js 16 / React 19 / TypeScript / Tailwind 4. Mock-first data layer in
`lib/data/store.ts` (localStorage + cross-tab sync), optional Supabase via
`NEXT_PUBLIC_DATA_SOURCE=supabase` and `db/01_schema.sql`.

Personas: Owner / Builder / Trade / Viewer, switcher top-right. "Reset demo data"
bottom-left restores the seed.

Live URLs seen: evergreen-demo.vercel.app (magic-link login) and
evergreen-rust-five.vercel.app. Neither is readable without executing client-side
JS, so all findings come from source.

## Real module set (from the app tree, not the README)
Routes under `app/`: admin, artifacts, bids, budget, costs, materials, payments,
settings, timing, updates, vendors. Shared UI in `app/ui/`: app-frame, bits,
icons, landing, messenger, rating, signature-pad, upload, use-drop. API routes:
account-status, auth-email, inbound-email, invite, link-preview, price,
remove-user, scan-scope, send-update-email, upload.

The README describes timing / materials / vendors / artifacts as "Phase 2
scaffolded". They are not — timing is 51KB, materials 59KB, artifacts 34KB,
vendors 27KB. `updates` and `payments` are not mentioned in the README at all.

## The real money model (lib/data/money.ts)
A `CostLine` carries: `history` (price points — Estimate, ROM, After Plan
Review), `allowanceLow`/`allowanceHigh` (the Working ROM Budget range),
`markupModel` ("passthrough" | black-box) with `markupPct`, `baseline` (locked
original budget), `changeOrders` (kind "change" | "savings"), `locked` +
`lockedCost`, `phases` (LinePhase, mode "pct" | "amount"), `directPaid`, `owner`
("builder" | "owner"), `category` (MacroCategory), `tradeId`.

Derivation chain: `lineBase` (last price point, else allowance high) →
`lineMarkup` (base x markupPct, passthrough only; black-box contributes 0) →
`lineTotal` → `lineBaseline` (locked, else live total) → `lineCurrent`
(baseline + approved changes − approved savings). Ranged lines carry
`lineLow`/`lineHigh` marked up; locked lines are fixed at both ends.
Draws hold `allocations` across lines; `linePaid` = paid draws + `directPaid`,
capped at current. Rollups keep base, markup and total separate.

Seven macro categories with fixed colors (MACRO_ORDER / MACRO_COLOR), in the same
earth palette the prototype already uses.

Materials derive their dates from the schedule: `dueMode` "trade" reads the tied
task, else the trade's whole Gantt window; `needBy` "start" | "finish" picks
between the window start and the last working week. `dueMode` "hard" is a fixed
date. ScheduleItem carries `confirmedStart`/`confirmedEnd` beside `start`/`end`,
which matches the prototype's confirmed/unconfirmed bars.

QC is explicitly dual — "owner + builder sign off" — and `qc.ts` holds real
per-trade checklists for 22 trades, with a four-item default.

`terms.ts` resolves a trade's contract terms from a standard clause set minus
per-trade exclusions plus per-trade additions and custom clauses, grouped in
clusters, rendered with a preamble and binding language.

## Differences from Evergreen Prototype.dc.html
1. Markup is absent from the prototype entirely, so every figure it shows omits
   the builder's margin. CONFIRMED to add, on every line and every rollup.
2. ROM. The real model holds a price-change history plus an allowance range plus
   a `locked` flag; the prototype holds a parent ROM document committed line by
   line. These are closer than they first appeared — `locked` is the prototype's
   `committed`. The real one gates change-order flow; the prototype's gates
   package creation. User wants the two side by side before deciding.
3. Funding: real Budget has cost-of-access per source, a contingency buffer and a
   cheapest-first draw-order advisory; the prototype shows availability only.
4. Room x trade scope matrix is load-bearing. The prototype's UX review
   recommended absorbing it; that recommendation is retracted.
5. Prototype QC signs once; the real model is dual and carries per-trade
   checklists (`qc.ts`, 22 trades). STILL OUTSTANDING.
6. Material dates — RESOLVED. The prototype now derives them from the tied bar,
   with lateness derived from lead time against the on-hand date.
7. Prototype has no terms engine, no door codes, no artifacts, no messenger
   item-tagging. Macro categories and owner-vs-builder ownership are now in.

## Screen map
| Prototype screen | Repo files |
| --- | --- |
| Today | app/page.tsx, app/ui/app-frame.tsx |
| Budget Management | app/costs/page.tsx, app/budget/page.tsx, app/payments/page.tsx, lib/data/money.ts |
| Packages — Scope / Bids / Contract | app/bids/page.tsx, app/bids/scope.tsx, app/bids/screens.tsx, app/bids/kit.tsx, app/bids/request-doc.ts |
| Packages — Budget line / Draws | app/costs/page.tsx, app/payments/page.tsx |
| Packages — Schedule | app/timing/page.tsx, lib/data/qc.ts |
| Schedule | app/timing/page.tsx |
| Materials | app/materials/page.tsx, lib/data/materialCatalog.ts |
| Vendors | app/vendors/page.tsx, app/admin/add-vendor.tsx, app/admin/terms-builder.tsx, lib/data/terms.ts |
| Files | app/artifacts/page.tsx, app/artifacts/drawing-viewer.tsx, app/artifacts/file-view.tsx |
| Messages | app/ui/messenger.tsx, app/updates/page.tsx |
| Scope & rooms | app/admin/page.tsx (matrix, rooms, trade scope), lib/data/types.ts ScopeStatus |
| Users & access | app/admin/page.tsx (Team, Access & Billing), lib/data/seed.ts doorCode |
| Help | no equivalent |
| (not yet built) | app/admin/page.tsx — rooms, room x trade scope matrix, Users & Access, door codes |
| (not yet built) | app/settings/page.tsx |

# Evergreen — 31810 Evergreen Rd Restoration

A renovation-management platform that replaces the two working spreadsheets
(`31810 Evergreen.xlsx` and the Shared budget workbook) with one role-based app.

## Stack
- **Next.js 16 / React 19 / TypeScript / Tailwind 4**
- **Mock-first data layer** — runs with zero setup (state saved in your browser via
  `localStorage` + cross-tab sync). Flip to a real **Supabase** backend by setting
  `NEXT_PUBLIC_DATA_SOURCE=supabase` and the URL/anon key (see `db/01_schema.sql`).

## Run
```bash
npm install
npm run dev      # http://localhost:3000
```
Use the **persona switcher** (top-right) to view as Owner / Builder / Trade / Viewer.
"Reset demo data" (bottom-left) restores the seeded Evergreen project.

## Modules (this build = "core money + scope first")
- **Dashboard** — cost rollups, funding coverage, QC progress, contract phases.
- **Administrative** — rooms (stock + custom), the room×trade **scope matrix**
  (in-scope / out / use-existing), per-trade scope editor with apply-to-all /
  copy-to-rooms, and **Users & Access** (per-module permissions + door codes).
- **Building Costs** — line items with **pass-through markup** or **black-box**
  fee models, room tick-boxes, **price-change history** (Estimate → ROM → After
  Plan Review), macro categories, owner-vs-builder ownership, and **contracts**
  broken into funding **phases with completion gates**.
- **Budget** *(owner-only)* — funding sources with cost-of-access, a contingency
  buffer, and a **cheapest-first draw-order advisory** (spend free cash before
  high-interest debt).

## Phase 2 (scaffolded)
Timing (Gantt + dual QC sign-off), Materials (AI sourcing + rebates), Vendor
Management (contacts, terms, no-lien), Artifacts (drawings, survey, permits).
The QC sign-off model and door codes already exist in the data layer.

## Data
Seeded from the real Evergreen workbooks: trades, rooms, the Oasis contracted
budget (with the agreed 20% markup and after-plan-review deltas), allowances,
contracts/phases, and the owner's financing sources. See `lib/data/seed.ts`.

> AI features (product sourcing, rebate lookup) are **stubbed** with clear
> placeholders in this build, with the buttons wired for a later live model call.

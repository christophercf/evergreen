# Evergreen AI — UX review brief

**Ask:** review the end-to-end experience and workflow, and tell us where it's
working against the people using it. We're after judgement on structure and
flow, not a visual refresh — though say so if the visual language is part of the
problem.

Live: `https://app.evergreenreno.net` (also `https://evergreen-rust-five.vercel.app`).
Stack: Next.js / React, one shared data store, desktop + mobile web. No native app.

---

## 1. What this is

A renovation management app for **one real project**: 31810 Evergreen Rd, an 1822
farmhouse being restored. It is in live use right now, not a prototype. It
replaced two spreadsheets the owner was running.

It is deliberately single-project. Everything is scoped to this one house.

### The people, and what they actually do

| Role | Who | What they're here for |
| --- | --- | --- |
| **Full admin** | Chris — owner *and* the developer | Everything. Builds the app, runs the project. |
| **Owner** | Emily | Is the money and the decisions. Reviews, approves, pays. Mostly phone. |
| **Builder / GC** | Aaron, Rob, John (Oasis) | Runs the work. Bids, schedules, invoices, day-to-day. Desktop + site. |
| **Trade / vendor** | Masons, electricians, window suppliers… | Narrow slice: their own contract, their own materials, their own dates. **Almost entirely phone, often on site.** |
| **Viewer** | Designer, architect | Reads. Designer picks materials; architect sees the whole project but edits nothing. |

Access is per-module and per-role, and it matters: a trade must never see another
trade's costs, and an owner-managed vendor must not see the builder at all.

### The ten modules, in workflow order

1. **Dashboard** — what needs attention
2. **Messenger** — field updates, WhatsApp-style, photos + voice-to-text, email push
3. **Bid Management** — competitive bids *before* anything enters the budget
4. **Project Budget** — the ROM, then locked lines, then change orders
5. **Payment & Draw Mgmt** — invoices and draws against those lines
6. **Owners Funding Mgmt** — where the owner's money comes from
7. **Timing** — Gantt, dependencies, trade confirmation
8. **Materials** — ~63 items: what to buy, who buys it, when it's needed
9. **Vendor Mgmt** — contracts per trade ("Current Contract" to a trade)
10. **Artifacts** — signed documents, drawings, invoices

Plus **Admin** (behind a ⚙): team, the access matrix, rooms, the room × trade
scope matrix, contacts, billing, vendor records. And **My Preferences**.

### The spine

```
Scope a package  →  invite vendors  →  bids come back three ways
      →  compare like-for-like  →  award
      →  price locks into Project Budget  →  draws pay against it
      →  duration becomes a Gantt bar  →  materials hang off the Gantt
```

Bid Management was just rebuilt from a design handoff and is the newest, most
deliberate part. Seven steps: Trades → Scope → Contacts → How they bid → Bids in
→ Compare → Award. Its organising idea is worth understanding because we'd like
to know whether it should spread: **bids arrive three different ways (vendor fills
our form / we key it off a phone call / they send their own quote), and all three
must land on the same five fields — total, materials, labor, working days, crew —
or the comparison is fiction.** Completeness is derived from those five values,
never from a "confirmed" flag, and mismatches are flagged, never silently
corrected.

---

## 2. Where we think it hurts

Honest list. Disagree freely — and tell us what we've missed.

**a. Ten modules for one house.** Six active users, one project, and a left nav
with ten items plus Admin. Money alone is three separate modules (Project Budget
/ Payment & Draw / Owners Funding). Is this the right IA, or has it grown by
accretion? This is the question we most want answered.

**b. "Trade" is doing two jobs.** A *trade* is a line of work with its own
contract, cost line and schedule. A *vendor* is a company, and can cover several
trades. The old model conflated them, so users invented duplicate trades
("Windows — Diverse", "Windows — Builder") to have two vendors in one category.
Fixed in the data, still confusing in the language and the UI.

**c. Bid Management is seven steps deep.** Faithful to the design we were given,
but the package switcher is a `<select>` in a sidebar and there is no longer any
overview of all packages at once. Right trade-off?

**d. Scope has no home.** It's step 02 inside bidding, but scope is arguably a
first-class thing that materials, timing and change orders all reference.

**e. Wide tables everywhere.** Materials is 63 rows × ~12 columns with a sticky
first column. The budget and the Gantt are similar. They work on desktop and are
survivable on mobile, but "survivable" is the word.

**f. Mobile is uneven.** Trades live on their phones. Bid Management has a
purpose-built mobile triage mode (one scannable list, one way forward); most
other modules are the desktop layout, narrower. What should the phone actually
be for, per role?

**g. Onboarding a trade is the weakest link.** Getting a vendor from "exists in
the roster" to "logged in and useful" has historically been where people fall
out. Invite email → set password → find their one relevant screen.

**h. Three notification channels.** In-app notifications, Messenger, and email.
No clear rule for which carries what.

**i. Nothing else has the five-fields discipline.** Bidding refuses to let an
incomplete thing look complete. Materials, budget and timing are much more
forgiving. Should that rigour spread, or is bidding special?

---

## 3. What we'd like back

In rough priority:

1. **Is the module structure right?** If you'd merge, split or bury things, say
   which and why. Concretely: should the three money modules be one?
2. **The role-shaped experience.** A trade on a phone, an owner approving on a
   phone, a builder at a desk — should these be the same app with permissions, or
   genuinely different front doors?
3. **Where the flow breaks between modules.** The seams (award → budget → draw,
   bid duration → Gantt, Gantt → materials) are wired but were bolted on one at
   a time. Do they read as one journey?
4. **The dense tables.** A better pattern for 60+ rows of material on a phone.
5. **First-run and empty states.** Barely designed. A trade's first login is
   currently a list of things they mostly can't touch.
6. **Anything that should be deleted.** We'd rather remove than add.

Not looking for: a rebrand, a component library, or a visual system. The palette
below is deliberate and the owner likes it.

---

## 4. Design language as it stands

An 1822 farmhouse: warm, historic, natural materials. "Patina over polish."

```
--cream    #f5f0e4   aged plaster background
--cream-2  #efe8d6
--paper    #fffdf7   card surface
--walnut   #3a2f25   deep wood — top bar, headings
--sage     #6b7f5b   primary accent
--sage-2   #56684a
--sage-tint #e6ebdd  selected / tinted fill
--brass    #b08a3e   highlight, money
--brass-2  #8f6f2e   micro-labels
--ink      #2c241c   text
--muted    #7a6f60   secondary text
--line     #ddd2bd   hairlines
--rust     #a8553c   over budget / alert
--ok       #5e7d4f   positive
```

Headings and figures are a serif (Georgia); body is the system sans. Cards are
`--paper` on `--cream` with `--line` hairlines and small radii. Uppercase
micro-labels at 10–11px, letter-spacing ~.11em, in `--brass-2`. One filled accent
button per screen; everything else is outlined.

---

## 5. Constraints worth knowing

- **One developer**, working in sessions. Prefer changes that can land
  incrementally over a redesign that has to arrive all at once.
- **Real users, live data.** Signed contracts, real invoices, real money. Nothing
  can be migrated carelessly.
- **The trades are not software people.** Several have already failed to complete
  a login. Simplicity for them beats power for us.
- **Owner reviews on a phone**, usually in the evening, often just to approve one
  thing.
- Mock and live data modes exist, so any flow can be prototyped against realistic
  content.

---

## 6. How to look at it

Ask Chris for a login, or for a screen-share walkthrough — the fastest way to
understand it is 20 minutes watching the award → budget → draw path with real
data in it.

Two flows worth walking end to end:

1. **Bid a trade.** Bid Management → pick a trade → Scope → invite two vendors →
   set how each submits → key both bids → Compare → Award, then look at what
   landed in Project Budget and Timing.
2. **A trade's whole world.** Sign in as a trade and see how little there is, and
   whether what's there is the right little.

// ----------------------------------------------------------------------------
// Help — per seat.
//
// The design's shape: a lead paragraph, numbered steps each with a jump link,
// and a few tips. The CONTENT is this app as it stands today, not the
// prototype — the prototype's Help describes screens that were never built
// (Today, Approve, the six-seat switcher) and a flow the app no longer runs.
// Help that describes a different app is worse than no help at all.
//
// Every `to` here is a live route. If a route moves, this file moves with it.
// ----------------------------------------------------------------------------

import type { Role } from "../data/types";

export type HelpStep = { n: string; t: string; w: string; to: string };
export type HelpTip = { t: string; w: string };
export type HelpSeat = { lead: string; flow: HelpStep[]; tips: HelpTip[] };

export const SEAT_BLURB: Record<Role, string> = {
  full_admin: "Owner and developer. Every screen, every figure, plus Diagnostics — the seat that sees what nobody else does.",
  owner: "Home owner. You agree the money, watch where it goes, and choose what gets built. The draw machinery is the builder's.",
  builder: "General contractor. You run the job: the budget, the packages, the contracts, the draws and the crews.",
  trade: "Your contract, your dates, your materials, and a line to the builder. Nothing else, because nothing else is yours to do.",
  viewer: "Read-only, and no money. You are here for what is being built and when.",
};

export const HELP: Record<Role, HelpSeat> = {
  // -------------------------------------------------------------------------
  builder: {
    lead:
      "You run the job. The order below is the order the app works in — each step needs the one before it to exist. " +
      "Nothing here is marked done by hand: a line opens up because a contract was signed, not because someone ticked a box.",
    flow: [
      { n: "01", t: "Draft the budget", w: "Budget Management. One row per trade, either a figure or a low–high range where you genuinely do not know yet. Put the assumption on the line — Emily reads the assumption, not just the number.", to: "/costs" },
      { n: "02", t: "Get the ROM agreed, then lock it", w: "The owner commits line by line, not all at once, so you can keep editing the rest while they think. When every line is committed you lock the ROM: it stops moving, and everything after that is a deviation from it.", to: "/costs" },
      { n: "03", t: "Bundle a package", w: "Bid and Package Management → New package. Pick the budget lines going out together — work one vendor can price and mobilise for once. The figure that matters is what is left to bid: the agreed ceiling less anything already contracted.", to: "/bids" },
      { n: "04", t: "Write the scope once", w: "The package's Scope tab. It pre-fills from the budget lines' own scope and rooms. Set who supplies materials and how you want it priced, then save and move on. That text is what every bidder prices and what every change order later points back to.", to: "/bids" },
      { n: "05", t: "Invite, and take the bids in", w: "Add New Vendors to Bid. Vendors who cover the trade sort to the top. Three ways in: they fill it in, you key it for them, or they send their own quote and you enter the five fields.", to: "/bids" },
      { n: "06", t: "Compare, then award", w: "Only bids carrying all five fields enter the comparison. Awarding locks the price into the budget line — and prompts you to create the contract.", to: "/bids" },
      { n: "07", t: "Issue the contract", w: "The award writes the bid out in full — sum, scope, rooms, exclusions — plus the terms in force, between the vendor and you (or the homeowner, if they are contracting direct). Issuing freezes it, so the paper cannot drift as the budget line moves.", to: "/vendors" },
      { n: "08", t: "Get it signed", w: "Contracts. Both parties sign Round 1 (scope and cost), then Round 2 (dates and draw schedule). A signed contract is what opens its budget line to be drawn against — money does not move on a promise.", to: "/vendors" },
      { n: "09", t: "Build the draw", w: "Draw Management. Drag signed lines in, set each line's share as a percentage or a flat figure, and say what scope it covers. Then mark it client-approved, and client-paid when the money lands. A paid draw archives.", to: "/payments" },
      { n: "10", t: "Keep it moving", w: "Put the awarded duration on the schedule, keep materials ahead of the trades, and answer in Messages rather than by text so the thread stays with the job.", to: "/timing" },
    ],
    tips: [
      { t: "The package is the unit", w: "Scope, bids, contract, budget line and draws all hang off one package. If you are hunting across modules for one trade's story, you are on the wrong screen." },
      { t: "Bundle before you issue", w: "Bundling after a package is out means re-scoping it. Decide at creation whether one vendor should price two lines together." },
      { t: "A range is not a failure", w: "A ROM range with a stated reason is more use to the owner than a precise figure you invented. Ranges get committed too." },
      { t: "A change order is a decision, not a filing", w: "Saving one asks what it is for: park it as a proposal, or push it onto the live contract as an amendment — which clears both signatures, because the sum they agreed to has changed." },
      { t: "Paid is final", w: "A paid draw does not move backwards and cannot be edited. If a cost grows after it, that is a change order and the difference goes in the next draw." },
    ],
  },

  // -------------------------------------------------------------------------
  owner: {
    lead:
      "You agree the money and watch where it goes. You are not asked to run logistics — the draw machinery is the builder's console, " +
      "and what draws do to the budget shows up on your side of it.",
    flow: [
      { n: "01", t: "Read the ROM, line by line", w: "Budget Management. Every line carries the builder's assumption about what it covers. Commit the ones you are comfortable with and leave the rest — an uncommitted line cannot become a package, so nothing runs ahead of you.", to: "/costs" },
      { n: "02", t: "Say what is in and out", w: "A line you do not want yet goes on hold; one you have dropped is killed and counts towards nothing. Both are reversible, and both stay on the record.", to: "/costs" },
      { n: "03", t: "Watch what gets awarded", w: "Bid and Package Management shows every package, what it was awarded at, and to whom. An unawarded package contributes nothing to the total — a figure only counts once a contract stands behind it.", to: "/bids" },
      { n: "04", t: "Read the contracts", w: "Contracts is one line per contract, in the packages they came from, with the total across all of them. Open one for the full document and the signatures.", to: "/vendors" },
      { n: "05", t: "Follow the money out", w: "Budget Management's Drawn / Paid column is what has actually left, and the change-order column is what moved after the contract was signed.", to: "/costs" },
      { n: "06", t: "Know where it is coming from", w: "Funding is your side alone — the builder never sees it. It is where the money is coming from against what the job now costs.", to: "/budget" },
    ],
    tips: [
      { t: "Contracted is not paid", w: "Contracted is what you are on the hook for. Drawn is what has been allocated to a payment. Paid is what has actually gone. The three are different columns on purpose." },
      { t: "Ask rather than approve", w: "Messages carries the package in context. A question in the thread beats a yes you are not sure about." },
      { t: "The lowest bid is not always comparable", w: "A bid that excludes materials, or is priced time-and-materials with no ceiling, is flagged and kept out of the comparison. Read the flag before the figure." },
      { t: "The ROM is a baseline, not a budget", w: "Once it is locked it stops moving. Anything added afterwards sits against contract with a ROM of zero, so you can always see what is new since you agreed it." },
    ],
  },

  // -------------------------------------------------------------------------
  trade: {
    lead:
      "Your contract, your dates, your materials, and a line to the builder. If nothing is showing as waiting on you, nothing is.",
    flow: [
      { n: "01", t: "Read and sign your contract", w: "Contracts. It is the bid you gave, written out in full, with the terms that apply. Round 1 is scope and cost; Round 2 is dates and the draw schedule. Nothing gets paid against it until it is signed.", to: "/vendors" },
      { n: "02", t: "Confirm your dates", w: "Schedule. Confirm the window you have been given or propose another. The bar is drawn from the duration you quoted.", to: "/timing" },
      { n: "03", t: "Check what you are buying", w: "Materials says who buys each item. Chase the late ones and mark yours ordered when they are placed.", to: "/materials" },
      { n: "04", t: "Talk to the builder", w: "Messages. Photo or voice, straight into the thread the builder reads — not a text that nobody else on the job can see.", to: "/updates" },
    ],
    tips: [
      { t: "Your contract figure is live", w: "It includes approved amendments, so it is what you will actually invoice against — not the original award." },
      { t: "An amendment needs re-signing", w: "If the sum changes, both signatures clear and you sign again. You are never on record as having agreed to a figure you did not read." },
      { t: "You never see other bids", w: "What other vendors quoted is not on any screen you can reach, at any point." },
    ],
  },

  // -------------------------------------------------------------------------
  viewer: {
    lead: "Read-only, and no money at all. You are here for what is being built, where, and when.",
    flow: [
      { n: "01", t: "The schedule", w: "Bars come from the winning bid's duration. Grab the empty chart and drag to move around it.", to: "/timing" },
      { n: "02", t: "What exists", w: "Bid and Package Management shows the work that has been let and how far along it is.", to: "/bids" },
      { n: "03", t: "Drawings and documents", w: "Artifacts holds the drawings, quotes and signed paper, filed against what they belong to.", to: "/artifacts" },
    ],
    tips: [
      { t: "No figures reach this seat", w: "Costs, bids and draws are absent, not hidden — the pages refuse the seat, they do not just leave it out of the nav." },
    ],
  },

  // -------------------------------------------------------------------------
  full_admin: {
    lead:
      "You see every screen and every figure. Use Diagnostics to check the data behind them, and the QA pass in QA.md before anything ships.",
    flow: [
      { n: "01", t: "The money, end to end", w: "Budget Management is the spine: ROM → contracted → change orders → builder fee → total → drawn. Every other money screen reads off these lines rather than keeping its own.", to: "/costs" },
      { n: "02", t: "Packages and contracts", w: "A package is bid, awarded, and becomes a contract. Contracts lists them one line each with the total across all of them.", to: "/bids" },
      { n: "03", t: "Draws", w: "Saved → client approved → client paid, then archived. Only signed contracts can be drawn against.", to: "/payments" },
      { n: "04", t: "Diagnostics", w: "Every check that can be decided from the data: references resolve, the money adds up, and each user reaches exactly the modules their role grants.", to: "/qa" },
      { n: "05", t: "Administrative", w: "Behind the header ⚙: users and access, rooms, trades and categories, vendor management, and the terms that go on every contract.", to: "/admin" },
    ],
    tips: [
      { t: "Every state is derived", w: "Nothing here is marked complete by hand. A line is drawable because a contract is signed; a package is in place because a bid was awarded. Remove the fact and the state goes with it." },
      { t: "One fact, one place", w: "The recurring bug in this app is a second copy that drifts — a name, a category, a contract sum. If you are about to store a figure that can be derived, derive it." },
      { t: "Two sites, two databases", w: "The demo project has its own data and none of the real messages. Check which URL a report came from before treating it as data loss." },
    ],
  },
};

/** App-wide rules, shown to every seat. These are promises about how the app
 *  behaves, not instructions — they are here so nobody has to infer them. */
export const HELP_RULES: HelpTip[] = [
  { t: "Nothing is marked done by hand", w: "Every state is derived from whether the underlying fact exists. A bid is comparable because it carries five fields. A line is drawable because its contract is signed. Remove the fact and the state goes with it." },
  { t: "Mismatches are flagged, never fixed", w: "A bid that excludes materials, or has no ceiling, is shown as bid, with a flag. The app never adjusts someone's number to make it comparable." },
  { t: "One package, one contract, one price", w: "A trade is the category that decided who was invited. The contract and the money hang off the package, not the trade." },
  { t: "The scope is written once", w: "The bid request, the contract, the schedule bar and every change order point back to the same text on the package." },
  { t: "A save either happens or says so", w: "If a write fails you get a red banner that does not disappear on its own. Silence means it saved." },
];

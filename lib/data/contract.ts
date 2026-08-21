// ----------------------------------------------------------------------------
// The contract a bid award creates.
//
// One contract per trade, held on that trade's VendorAgreement. Awarding a bid
// issues it; signing it is what opens the budget line to be drawn against.
// The summary is FROZEN at issue: the budget line keeps moving afterwards and a
// signed document must not move with it.
// ----------------------------------------------------------------------------

import type { BidPackage, CostLine, DB, IssuedContract, VendorBid } from "./types";
import { effectiveClauses } from "./terms";

/** none → nothing awarded yet · issued → awaiting signature · signed → live. */
export type ContractState = "none" | "issued" | "signed";

export const CONTRACT_STATE_LABEL: Record<ContractState, string> = {
  none: "No contract",
  issued: "Contract issued",
  signed: "Contract signed",
};

export function contractOf(db: DB, tradeId: string): IssuedContract | undefined {
  return db.vendorAgreements.find((a) => a.tradeId === tradeId)?.contract;
}

/** Who signs: the vendor, and whoever contracts with them. An owner-managed
 *  trade contracts with the homeowner direct; everything else with the GC. */
export function contractParties(db: DB, tradeId: string): ["builder" | "owner", "trade"] {
  const c = contractOf(db, tradeId);
  if (c) return [c.counterparty, "trade"];
  return [db.trades.find((t) => t.id === tradeId)?.managedBy === "owner" ? "owner" : "builder", "trade"];
}

export function contractState(db: DB, tradeId: string): ContractState {
  const c = contractOf(db, tradeId);
  if (!c) return "none";
  const ag = db.vendorAgreements.find((a) => a.tradeId === tradeId);
  const need = contractParties(db, tradeId);
  return need.every((p) => ag?.round1.some((s) => s.party === p)) ? "signed" : "issued";
}

/** Which of the two parties have not signed yet — shown, not guessed at. */
export function contractMissingSigs(db: DB, tradeId: string): ("builder" | "owner" | "trade")[] {
  const ag = db.vendorAgreements.find((a) => a.tradeId === tradeId);
  return contractParties(db, tradeId).filter((p) => !ag?.round1.some((s) => s.party === p));
}

/** Contract value after every amendment, cost before the builder's fee. */
export function contractAmount(c: IssuedContract): number {
  return (c.revisions ?? []).reduce((a, r) => a + r.delta, c.amount);
}

/** A line can be drawn against once the contract behind it is signed. Money
 *  does not move on a promise — that is the whole point of the signature. */
export function lineDrawable(db: DB, line: CostLine): boolean {
  const ag = db.vendorAgreements.find((a) => a.tradeId === line.tradeId);
  if (ag?.contract) return contractState(db, line.tradeId) === "signed";
  // Several trades on this job were contracted on paper before the app issued
  // contracts. For those the lock IS the record, and refusing to draw against
  // them would be the app disbelieving a contract that exists.
  return !!line.locked;
}

/** What a line's contract is doing, for the budget and draw screens. Lines with
 *  a locked price but no issued contract still read as issued: on this project
 *  several trades were contracted on paper before the app existed. */
export function lineContractState(db: DB, line: CostLine): ContractState {
  const s = contractState(db, line.tradeId);
  if (s !== "none") return s;
  return line.locked ? "issued" : "none";
}

/** The scope text frozen into the contract at issue. */
export function buildContractScope(db: DB, p: BidPackage, tradeId: string): string {
  const parts: string[] = [];
  if (p.overview?.trim()) parts.push(p.overview.trim());
  if (p.scopeDetails?.trim()) parts.push(p.scopeDetails.trim());
  const items = new Set<string>(p.scopeItems ?? []);
  db.scope
    .filter((c) => c.tradeId === tradeId && c.status === "in" && (!p.roomIds.length || p.roomIds.includes(c.roomId)))
    .forEach((c) => c.items.filter((i) => i.included).forEach((i) => items.add(i.label)));
  if (items.size) parts.push([...items].map((i) => `• ${i}`).join("\n"));
  return parts.join("\n\n");
}

/** The whole signable document as plain text — what the parties are agreeing to.
 *  Used for the on-screen preview and the PDF, from one place, so the preview
 *  cannot show something different from what gets signed. */
export function renderContract(db: DB, tradeId: string, c: IssuedContract): string {
  const L: string[] = [];
  const trade = db.trades.find((t) => t.id === tradeId);
  const party = c.counterparty === "owner"
    ? (db.contacts.find((x) => x.party === "owner")?.company ?? "Homeowner")
    : (db.contacts.find((x) => x.party === "builder")?.company ?? "Builder / GC");
  L.push(`${trade?.name ?? tradeId} — Trade Contract`);
  L.push(`${db.project.name}`);
  L.push("");
  L.push(`Between: ${party} ("Contracting party")`);
  L.push(`And:     ${c.vendorName} ("Vendor")`);
  L.push(`Issued:  ${c.issuedAt} by ${c.issuedBy}`);
  L.push("");
  L.push("CONTRACT SUM");
  L.push(`$${c.amount.toLocaleString()}${c.materialsCost != null || c.laborCost != null
    ? ` (materials $${(c.materialsCost ?? 0).toLocaleString()} · labor $${(c.laborCost ?? 0).toLocaleString()})` : ""}`);
  if (c.pricingBasis) L.push(`Pricing basis: ${c.pricingBasis}`);
  if (c.workingDays) L.push(`Duration: ${c.workingDays} working days${c.crewSize ? ` · crew of ${c.crewSize}` : ""}`);
  for (const r of c.revisions ?? []) {
    L.push(`${r.exhibit} — ${r.title}: ${r.delta < 0 ? "−" : "+"}$${Math.abs(r.delta).toLocaleString()} → $${r.newAmount.toLocaleString()} (${r.at})`);
  }
  if ((c.revisions ?? []).length) L.push(`Revised contract sum: $${contractAmount(c).toLocaleString()}`);
  L.push("");
  if (c.rooms.length) { L.push("ROOMS"); L.push(c.rooms.join(", ")); L.push(""); }
  L.push("SCOPE OF WORK");
  L.push(c.scope || "—");
  if (c.exclusions?.trim()) { L.push(""); L.push("EXCLUSIONS"); L.push(c.exclusions.trim()); }
  L.push("");
  L.push("TERMS & CONDITIONS");
  L.push(db.terms.preamble);
  effectiveClauses(db, tradeId).forEach((cl, i) => L.push(`${i + 1}. ${cl.title}. ${cl.body}`));
  L.push("");
  L.push(db.terms.bindingLanguage);
  return L.join("\n");
}

/** Everything an award needs to become a contract, without the store having to
 *  know how a summary is put together. */
export function contractFromAward(db: DB, p: BidPackage, b: VendorBid, tradeId: string, counterparty: "builder" | "owner", by: string): IssuedContract {
  return {
    packageId: p.id,
    lineId: p.lineId,
    vendorName: b.vendorName,
    amount: b.amount ?? 0,
    materialsCost: b.materialsCost,
    laborCost: b.laborCost,
    workingDays: b.workingDays,
    crewSize: b.crewSize,
    pricingBasis: b.pricingBasis ?? p.pricingBasis,
    counterparty,
    scope: buildContractScope(db, p, tradeId),
    rooms: p.roomIds.map((id) => db.rooms.find((r) => r.id === id)?.name ?? id),
    exclusions: p.exclusions,
    issuedAt: new Date().toISOString().slice(0, 10),
    issuedBy: by,
    revisions: [],
  };
}

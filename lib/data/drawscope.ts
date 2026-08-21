// ----------------------------------------------------------------------------
// What a draw finishes, and what is left to draw.
//
// A draw is a claim that some named part of the work is done. The parts are not
// invented here: they come from the package that was bid and the contract that
// was signed, so what the GC ticks off in a draw is the same list the vendor
// priced. The Admin scope matrix is the fallback for work that predates the
// packages — it is a worse list, but a real one.
// ----------------------------------------------------------------------------

import type { BidPackage, CostLine, DB } from "./types";
import { lineCurrent, lineDrawn, allocationAmount } from "./money";
import { contractOf } from "./contract";

/** The package that put this budget line under contract, if there is one. */
export function packageForLine(db: DB, lineId: string): BidPackage | undefined {
  return (db.bidPackages ?? []).find((p) => p.lineId === lineId);
}

export type ScopeSource = "package" | "contract" | "matrix";

export type ScopeOption = {
  label: string;
  /** Where the item came from, so the GC knows how binding it is. */
  from: ScopeSource;
  /** The draw that already claims this item, if another one does. */
  coveredBy?: string;
};

/** Pull the scope of work out of a frozen contract's text: the bullet lines the
 *  package wrote, not the prose around them. */
function bulletsOf(text: string | undefined): string[] {
  if (!text) return [];
  return text.split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("•") || l.startsWith("-"))
    .map((l) => l.replace(/^[•-]\s*/, "").trim())
    .filter(Boolean);
}

/** The named parts of a line's work, best source first. */
export function scopeItemsFor(db: DB, line: CostLine): { items: string[]; from: ScopeSource } {
  const p = packageForLine(db, line.id);
  if (p?.scopeItems?.length) return { items: [...new Set(p.scopeItems)], from: "package" };

  // The contract is the version both parties signed, so it beats anything the
  // package has been edited into since.
  const c = contractOf(db, line.tradeId);
  const fromContract = bulletsOf(c?.scope);
  if (fromContract.length) return { items: [...new Set(fromContract)], from: "contract" };

  const fromPkg = bulletsOf(p?.scopeDetails);
  if (fromPkg.length) return { items: [...new Set(fromPkg)], from: "package" };

  // Nothing was bid — fall back to the room × trade matrix.
  const roomSet = line.roomIds.length ? new Set(line.roomIds) : null;
  const labels = new Set<string>();
  db.scope
    .filter((s) => s.tradeId === line.tradeId && s.status === "in" && (!roomSet || roomSet.has(s.roomId)))
    .forEach((s) => s.items.filter((i) => i.included).forEach((i) => labels.add(i.label)));
  return { items: [...labels], from: "matrix" };
}

/** Every scope item on this line, marked with the OTHER draw that already
 *  claims it. Two draws claiming the same work is how a line gets paid twice. */
export function scopeOptionsFor(db: DB, line: CostLine, thisDrawId: string): ScopeOption[] {
  const { items, from } = scopeItemsFor(db, line);
  const claimed = new Map<string, string>();
  for (const d of db.draws) {
    if (d.id === thisDrawId) continue;
    const a = d.allocations.find((x) => x.lineId === line.id);
    for (const s of a?.includedScope ?? []) if (!claimed.has(s)) claimed.set(s, d.name);
  }
  return items.map((label) => ({ label, from, coveredBy: claimed.get(label) }));
}

/** Scope items nothing else has claimed — what a new allocation should start
 *  with, so the GC adjusts a sensible default instead of building one. */
export function uncoveredScopeFor(db: DB, line: CostLine, thisDrawId: string): string[] {
  return scopeOptionsFor(db, line, thisDrawId).filter((o) => !o.coveredBy).map((o) => o.label);
}

/** What is left to draw on a line. `excludeDrawId` leaves the draw being edited
 *  out, so the GC sees the headroom they are spending rather than the headroom
 *  after they have spent it. */
export function lineHeadroom(db: DB, line: CostLine, excludeDrawId?: string): {
  total: number; drawnElsewhere: number; remaining: number;
} {
  const total = lineCurrent(line);
  const drawnElsewhere = excludeDrawId
    ? db.draws.filter((d) => d.id !== excludeDrawId).reduce((a, d) => {
        const al = d.allocations.find((x) => x.lineId === line.id);
        return a + (al ? allocationAmount(line, al) : 0);
      }, 0)
    : lineDrawn(db, line.id);
  return { total, drawnElsewhere, remaining: Math.max(0, total - drawnElsewhere) };
}

/** The same figure for a whole draw: what its lines still had left to give. */
export function drawHeadroom(db: DB, drawId: string): { budget: number; over: number } {
  const d = db.draws.find((x) => x.id === drawId);
  if (!d) return { budget: 0, over: 0 };
  let budget = 0;
  let over = 0;
  for (const al of d.allocations) {
    const line = db.costLines.find((l) => l.id === al.lineId);
    if (!line) continue;
    const h = lineHeadroom(db, line, drawId);
    budget += h.remaining;
    over += Math.max(0, allocationAmount(line, al) - h.remaining);
  }
  return { budget, over };
}

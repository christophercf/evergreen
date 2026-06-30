// ----------------------------------------------------------------------------
// Money helpers — the single source of truth for how a cost line turns into a
// number, so Building Costs, the Budget, and the dashboard all agree.
// ----------------------------------------------------------------------------

import type { CostLine, DB, Draw, DrawAllocation, LinePhase, MacroCategory } from "./types";

export function fmt(n: number, opts: { cents?: boolean } = {}): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  });
}

export function pct(n: number): string {
  return `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`;
}

/** Current base (pre-markup) cost for a line: last price point, else allowance high. */
export function lineBase(line: CostLine): number {
  if (line.history.length) return line.history[line.history.length - 1].amount;
  return line.allowanceHigh ?? line.allowanceLow ?? 0;
}

/** The first recorded base, for delta-since-start. */
export function lineStart(line: CostLine): number {
  if (line.history.length) return line.history[0].amount;
  return lineBase(line);
}

export function lineMarkup(line: CostLine): number {
  return line.markupModel === "passthrough" ? lineBase(line) * (line.markupPct / 100) : 0;
}

/** All-in cost from the price history + markup (pre-baseline-lock figure). */
export function lineTotal(line: CostLine): number {
  return lineBase(line) + lineMarkup(line);
}

/** Change in base cost from the first to the latest price point. */
export function lineDelta(line: CostLine): number {
  return lineBase(line) - lineStart(line);
}

// ---- Baseline + change orders ----------------------------------------------
/** The locked original budget, or the live computed total before lock. */
export function lineBaseline(line: CostLine): number {
  return line.baseline ?? lineTotal(line);
}
/** Net of approved change orders (+changes, −savings). */
export function approvedNetChange(line: CostLine): number {
  return (line.changeOrders ?? []).filter((c) => c.status === "approved")
    .reduce((a, c) => a + (c.kind === "savings" ? -c.amount : c.amount), 0);
}
export function approvedChanges(line: CostLine): number {
  return (line.changeOrders ?? []).filter((c) => c.status === "approved" && c.kind === "change").reduce((a, c) => a + c.amount, 0);
}
export function approvedSavings(line: CostLine): number {
  return (line.changeOrders ?? []).filter((c) => c.status === "approved" && c.kind === "savings").reduce((a, c) => a + c.amount, 0);
}
/** What the line costs now = baseline + approved change orders − savings. */
export function lineCurrent(line: CostLine): number {
  return lineBaseline(line) + approvedNetChange(line);
}

// ---- Phases + draws --------------------------------------------------------
export function phaseAmount(line: CostLine, phase: LinePhase): number {
  return phase.mode === "pct" ? (lineCurrent(line) * phase.value) / 100 : phase.value;
}
export function phasesTotal(line: CostLine): number {
  return (line.phases ?? []).reduce((a, p) => a + phaseAmount(line, p), 0);
}
export function findPhase(db: DB, lineId: string, phaseId: string): { line: CostLine; phase: LinePhase } | null {
  const line = db.costLines.find((l) => l.id === lineId);
  const phase = line?.phases.find((p) => p.id === phaseId);
  return line && phase ? { line, phase } : null;
}
/** Dollar value of a draw allocation against its line's current total. */
export function allocationAmount(line: CostLine, alloc: DrawAllocation): number {
  return alloc.mode === "pct" ? (lineCurrent(line) * alloc.value) / 100 : alloc.value;
}
export function drawAmount(db: DB, draw: Draw): number {
  return draw.allocations.reduce((a, al) => {
    const line = db.costLines.find((l) => l.id === al.lineId);
    return a + (line ? allocationAmount(line, al) : 0);
  }, 0);
}
/** Total allocated across ALL draws for a given line (its "drawn" amount). */
export function lineDrawn(db: DB, lineId: string): number {
  const line = db.costLines.find((l) => l.id === lineId);
  if (!line) return 0;
  return db.draws.reduce((a, d) => a + d.allocations.filter((al) => al.lineId === lineId).reduce((s, al) => s + allocationAmount(line, al), 0), 0);
}
/** Amount of a line paid through PAID draws only (vs merely allocated). */
export function linePaidByDraws(db: DB, lineId: string): number {
  const line = db.costLines.find((l) => l.id === lineId);
  if (!line) return 0;
  return db.draws.filter((d) => d.status === "paid").reduce((a, d) => a + d.allocations.filter((al) => al.lineId === lineId).reduce((s, al) => s + allocationAmount(line, al), 0), 0);
}
/** Total paid for a line: paid draws + any direct (outside-draw) payment, capped at current. */
export function linePaid(db: DB, line: CostLine): number {
  return Math.min(lineCurrent(line), linePaidByDraws(db, line.id) + (line.directPaid ?? 0));
}
/** Outstanding (not yet paid) on a line. */
export function lineUnpaid(db: DB, line: CostLine): number {
  return Math.max(0, lineCurrent(line) - linePaid(db, line));
}
export type PaidStatus = "paid" | "partial" | "unpaid";
export function linePaidStatus(db: DB, line: CostLine): PaidStatus {
  const paid = linePaid(db, line);
  const cur = lineCurrent(line);
  if (cur > 0 && paid >= cur - 0.5) return "paid";
  return paid > 0.5 ? "partial" : "unpaid";
}

export type Rollup = { key: string; label: string; total: number; base: number; markup: number; count: number };

export function rollupBy(
  lines: CostLine[],
  keyer: (l: CostLine) => { key: string; label: string },
): Rollup[] {
  const map = new Map<string, Rollup>();
  for (const l of lines) {
    const { key, label } = keyer(l);
    const r = map.get(key) ?? { key, label, total: 0, base: 0, markup: 0, count: 0 };
    r.total += lineCurrent(l);
    r.base += lineBase(l);
    r.markup += lineMarkup(l);
    r.count++;
    map.set(key, r);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export function byCategory(lines: CostLine[]): Rollup[] {
  return rollupBy(lines, (l) => ({ key: l.category, label: l.category }));
}

export function tradeName(db: DB, id: string): string {
  return db.trades.find((t) => t.id === id)?.name ?? id;
}

export function byTrade(db: DB, lines: CostLine[]): Rollup[] {
  return rollupBy(lines, (l) => ({ key: l.tradeId, label: tradeName(db, l.tradeId) }));
}

/** All-in cost carried by a single trade (sum of its cost lines). */
export function tradeCost(db: DB, tradeId: string): number {
  return db.costLines.filter((l) => l.tradeId === tradeId).reduce((a, l) => a + lineCurrent(l), 0);
}

export function totals(lines: CostLine[]) {
  const builder = lines.filter((l) => l.owner === "builder");
  const owner = lines.filter((l) => l.owner === "owner");
  const sum = (ls: CostLine[]) => ls.reduce((a, l) => a + lineCurrent(l), 0);
  return {
    builder: sum(builder),
    owner: sum(owner),
    grand: sum(lines),
    markup: lines.reduce((a, l) => a + lineMarkup(l), 0),
    baseline: lines.reduce((a, l) => a + lineBaseline(l), 0),
  };
}

export const MACRO_ORDER: MacroCategory[] = [
  "Soft Costs",
  "Site & Demo",
  "Structure & Envelope",
  "Mechanicals (MEP)",
  "Interior Finishes",
  "Exterior",
  "Owner Items",
];

export const MACRO_COLOR: Record<MacroCategory, string> = {
  "Soft Costs": "#8b6f47",
  "Site & Demo": "#a8743c",
  "Structure & Envelope": "#6b7f5b",
  "Mechanicals (MEP)": "#4a7a8c",
  "Interior Finishes": "#9c6b8e",
  Exterior: "#7d8a4f",
  "Owner Items": "#b08a3e",
};

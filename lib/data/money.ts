// ----------------------------------------------------------------------------
// Money helpers — the single source of truth for how a cost line turns into a
// number, so Building Costs, the Budget, and the dashboard all agree.
// ----------------------------------------------------------------------------

import type { CostLine, DB, MacroCategory } from "./types";

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

/** All-in cost the payer sees. Passthrough adds markup; black-box already includes fees. */
export function lineTotal(line: CostLine): number {
  return lineBase(line) + lineMarkup(line);
}

/** Change in base cost from the first to the latest price point. */
export function lineDelta(line: CostLine): number {
  return lineBase(line) - lineStart(line);
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
    r.total += lineTotal(l);
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
  return db.costLines.filter((l) => l.tradeId === tradeId).reduce((a, l) => a + lineTotal(l), 0);
}

export function totals(lines: CostLine[]) {
  const builder = lines.filter((l) => l.owner === "builder");
  const owner = lines.filter((l) => l.owner === "owner");
  const sum = (ls: CostLine[]) => ls.reduce((a, l) => a + lineTotal(l), 0);
  return {
    builder: sum(builder),
    owner: sum(owner),
    grand: sum(lines),
    markup: lines.reduce((a, l) => a + lineMarkup(l), 0),
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

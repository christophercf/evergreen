// ----------------------------------------------------------------------------
// Money helpers — the single source of truth for how a cost line turns into a
// number, so Building Costs, the Budget, and the dashboard all agree.
// ----------------------------------------------------------------------------

import type { CostLine, CostOwner, DB, Draw, DrawAllocation, LinePhase, MacroCategory, Material, RomLine, ScheduleItem } from "./types";

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
// ---- Allowance ranges (low–high, from the Working ROM Budget) ----------------
export function lineMarkupFactor(line: CostLine): number {
  return line.markupModel === "passthrough" ? 1 + line.markupPct / 100 : 1;
}
/** A line is locked once its cost is agreed; changes then flow through change orders. */
export function isLocked(line: CostLine): boolean {
  return !!line.locked;
}
/** The locked cost (marked up) + approved change orders, or null if not locked. */
export function lineLockedCost(line: CostLine): number | null {
  if (!isLocked(line)) return null;
  const base = line.lockedCost != null ? line.lockedCost * lineMarkupFactor(line) : lineBaseline(line);
  return base + approvedNetChange(line);
}
/** True when the line still carries an unpinned low≠high estimate (and isn't locked). */
export function lineHasRange(line: CostLine): boolean {
  return !isLocked(line) && line.allowanceLow != null && line.allowanceHigh != null && line.allowanceLow !== line.allowanceHigh;
}
/** Marked-up low end. Locked lines are fixed (low === high === locked cost). */
export function lineLow(line: CostLine): number {
  if (isLocked(line)) return lineLockedCost(line)!;
  return lineHasRange(line) ? line.allowanceLow! * lineMarkupFactor(line) + approvedNetChange(line) : lineCurrent(line);
}
/** Marked-up high end. Locked lines are fixed; ranged lines use the high estimate. */
export function lineHigh(line: CostLine): number {
  if (isLocked(line)) return lineLockedCost(line)!;
  return lineHasRange(line) ? line.allowanceHigh! * lineMarkupFactor(line) + approvedNetChange(line) : lineCurrent(line);
}
/** Outstanding on a line = its high-end cost minus what's been paid. */
export function lineRemaining(db: DB, line: CostLine): number {
  return Math.max(0, lineHigh(line) - linePaid(db, line));
}
/** Whole-budget low–high range (marked up); locked lines contribute a fixed figure to both ends. */
export function budgetRange(lines: CostLine[]): { low: number; high: number } {
  return { low: lines.reduce((a, l) => a + lineLow(l), 0), high: lines.reduce((a, l) => a + lineHigh(l), 0) };
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

// ---- Material critical-path dates (derived from the trade's Gantt) ----------

const schStart = (s: ScheduleItem): string => s.confirmedStart ?? s.start;
const schEnd = (s: ScheduleItem): string => s.confirmedEnd ?? s.end;

/** Shift an ISO yyyy-mm-dd date by whole days (UTC, no timezone drift). */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * A trade's overall window on the Gantt: `start` (first bar), `end` (last bar),
 * and `lastWeekStart` (the start of the final week the trade is working). Drives
 * material timing — everything is identified by `start`; on-hand is either at
 * `start` (needed when work begins) or by `lastWeekStart` (needed near the end).
 */
export function tradePhaseDates(db: DB, tradeId: string): { start?: string; end?: string; lastWeekStart?: string } {
  const bars = db.schedule.filter((s) => s.tradeId === tradeId);
  if (!bars.length) return {};
  const start = bars.map(schStart).sort()[0];
  const end = bars.map(schEnd).sort().slice(-1)[0];
  const lw = addDays(end, -6); // start of the last 7-day window
  return { start, end, lastWeekStart: lw < start ? start : lw };
}

/** The two critical-path dates for a material. Schedule-driven ("trade" mode)
 *  dates derive live — from the TIED TASK when one is linked (most specific),
 *  else from the assigned trade's whole Gantt window — so they shift
 *  automatically whenever the tie changes or the builder moves the timing.
 *  identify-by = start; on-hand-by = start, or the last week when the material
 *  isn't needed until finishing. "hard" mode carries a single fixed date. */
export function materialDates(db: DB, m: Material): {
  identifyBy?: string; onHandBy?: string; mode: "hard" | "trade"; needBy: "start" | "finish";
  via: "task" | "trade" | "hard"; sourceLabel?: string;
} {
  const needBy = m.needBy ?? "start";
  if (m.dueMode === "trade") {
    const task = m.linkedScheduleId ? db.schedule.find((s) => s.id === m.linkedScheduleId) : undefined;
    if (task) {
      const start = schStart(task);
      const lw = addDays(schEnd(task), -6);
      const lastWeek = lw < start ? start : lw;
      return { identifyBy: start, onHandBy: needBy === "finish" ? lastWeek : start, mode: "trade", needBy, via: "task", sourceLabel: task.label };
    }
    if (m.tradeId) {
      const p = tradePhaseDates(db, m.tradeId);
      const onHandBy = needBy === "finish" ? (p.lastWeekStart ?? p.end) : p.start;
      return { identifyBy: p.start, onHandBy, mode: "trade", needBy, via: "trade", sourceLabel: tradeName(db, m.tradeId) };
    }
    return { identifyBy: undefined, onHandBy: undefined, mode: "trade", needBy, via: "trade" };
  }
  return { identifyBy: m.dueDate, onHandBy: undefined, mode: "hard", needBy, via: "hard" };
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

// ---------------------------------------------------------------------------
// The ROM — derived, never stored twice.
//
// A ROM row is one trade. Its figures come from that trade's cost lines, so
// the ROM cannot drift from the money it describes: the only thing the RomLine
// itself holds is the owner's agreement and the assumption behind the figure.
// ---------------------------------------------------------------------------

export type RomRow = {
  tradeId: string;
  label: string;
  lines: CostLine[];
  /** Owner agreement — absent until a ROM line exists for this trade. */
  rom?: RomLine;
  committed: boolean;
  /** The agreed envelope. A range agrees its ceiling. */
  low: number;
  high: number;
  ranged: boolean;
  /** Pre-markup cost to the trades, and what the owner ultimately carries. */
  base: number;
  markup: number;
  allIn: number;
  /** True when the trade's lines do not share one markup treatment, so no
   *  single label ("20% on top" / "in fee") tells the truth about the row. */
  mixedMarkup: boolean;
  markupLabel: string;
  owner: CostOwner | "mixed";
  category: MacroCategory;
  /** Under contract: the locked lines, plus approved change orders. */
  underContract: number;
  changeOrders: number;
  paid: number;
  remaining: number;
  lockedCount: number;
  /** Only meaningful once committed — nothing is measured against a figure the
   *  owner has not agreed to. Positive means above the agreed ceiling. */
  variance: number | null;
};

/** One row per trade that has cost lines, richest first. */
export function romRows(db: DB): RomRow[] {
  const byTrade = new Map<string, CostLine[]>();
  for (const l of db.costLines) {
    const k = l.tradeId || "__none";
    if (!byTrade.has(k)) byTrade.set(k, []);
    byTrade.get(k)!.push(l);
  }

  const rows: RomRow[] = [];
  for (const [tradeId, lines] of byTrade) {
    const rom = (db.rom ?? []).find((r) => r.tradeId === tradeId);
    const models = new Set(lines.map((l) => l.markupModel));
    const owners = new Set(lines.map((l) => l.owner));
    const mixedMarkup = models.size > 1;

    const base = lines.reduce((a, l) => a + lineBase(l), 0);
    const allIn = lines.reduce((a, l) => a + lineTotal(l), 0);
    const low = rom?.agreedLow ?? lines.reduce((a, l) => a + lineLow(l), 0);
    const high = rom?.agreedHigh ?? lines.reduce((a, l) => a + lineHigh(l), 0);

    const locked = lines.filter((l) => isLocked(l));
    const changeOrders = lines.reduce((a, l) => a + approvedNetChange(l), 0);
    const underContract = locked.reduce((a, l) => a + lineTotal(l), 0) + changeOrders;
    const paid = lines.reduce((a, l) => a + linePaid(db, l), 0);

    const pct = lines.find((l) => l.markupModel === "passthrough")?.markupPct;
    const markupLabel = mixedMarkup
      ? "mixed"
      : models.has("passthrough") ? `${pct ?? 0}% on top` : "in fee";

    rows.push({
      tradeId, label: tradeName(db, tradeId), lines, rom,
      committed: !!rom?.committed,
      low, high, ranged: low !== high,
      base, markup: allIn - base, allIn,
      mixedMarkup, markupLabel,
      owner: owners.size > 1 ? "mixed" : (lines[0]?.owner ?? "builder"),
      category: lines[0]?.category ?? "Soft Costs",
      underContract, changeOrders, paid,
      remaining: Math.max(0, underContract - paid),
      lockedCount: locked.length,
      // A draft line carries no variance at all: nothing is being measured
      // against a number the owner has not agreed to.
      variance: rom?.committed ? (allIn > high ? allIn - high : allIn < low ? allIn - low : 0) : null,
    });
  }
  return rows.sort((a, b) => b.allIn - a.allIn);
}

export function romTotals(db: DB) {
  const rows = romRows(db);
  const sum = (f: (r: RomRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  const committed = rows.filter((r) => r.committed);
  return {
    rows: rows.length,
    committedRows: committed.length,
    /** The agreed ceiling across committed lines — what the owner has signed up to. */
    agreed: committed.reduce((a, r) => a + r.high, 0),
    allIn: sum((r) => r.allIn),
    base: sum((r) => r.base),
    markup: sum((r) => r.markup),
    underContract: sum((r) => r.underContract),
    changeOrders: sum((r) => r.changeOrders),
    paid: sum((r) => r.paid),
    remaining: sum((r) => r.remaining),
    /** Only across priced, committed trades — the rest is not being measured. */
    variance: committed.reduce((a, r) => a + (r.variance ?? 0), 0),
  };
}

/** Every ROM line committed is the precondition for throwing the lock. */
export function romCanLock(db: DB): boolean {
  const rows = romRows(db);
  return !db.romLocked && rows.length > 0 && rows.every((r) => r.committed);
}

// ----------------------------------------------------------------------------
// Money helpers — the single source of truth for how a cost line turns into a
// number, so Building Costs, the Budget, and the dashboard all agree.
// ----------------------------------------------------------------------------

import type { BudgetLineState, CostLine, CostOwner, DB, Draw, DrawAllocation, LinePhase, MacroCategory, MarkupModel, Material, RomLine, ScheduleItem } from "./types";

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

/** The set every project starts with. Kept as the fallback so a database
 *  saved before categories were editable still reads correctly. */
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
  /** `tradeId::markupModel` — a row is one trade AND one markup treatment. */
  key: string;
  tradeId: string;
  markupModel: MarkupModel;
  label: string;
  tradeLabel: string;
  /** True when this trade is priced both ways, so the label names the model. */
  splitByMarkup: boolean;
  lines: CostLine[];
  rom?: RomLine;
  committed: boolean;
  /** Committed because every line in the row is already under contract, rather
   *  than because the owner pressed the button. */
  autoCommitted: boolean;
  low: number;
  high: number;
  ranged: boolean;
  base: number;
  markup: number;
  allIn: number;
  /** Actual cost now — the agreed envelope plus approved change orders. */
  current: number;
  // ---- the columns, in the order they are read ----------------------------
  /** What the owner agreed. Snapshot at commitment; does not drift. */
  romFigure: number;
  /** What we agreed with the builder for the work itself, before any fee. */
  contracted: number;
  /** The builder's fee on the contracted work. Zero on an owner-managed line. */
  builderFee: number;
  /** contracted + change orders + builder fee. */
  total: number;
  /** Released against this line. Comes from the draw module. */
  draw: number;
  /** Paid in full, so nothing moves until a change order re-opens it. */
  complete: boolean;
  /** No builder fee applies — the owner carries and pays this one directly. */
  ownerManagedDirect: boolean;
  markupLabel: string;
  owner: CostOwner | "mixed";
  category: MacroCategory;
  underContract: number;
  changeOrders: number;
  paid: number;
  remaining: number;
  lockedCount: number;
  /** active / hold / removed. A removed line counts towards nothing. */
  state: BudgetLineState;
  /** Who fills in the contract figure, the change orders and the payments. */
  manager: CostOwner;
};

/** The agreed envelope for one line, with approved change orders excluded.
 *  A locked line is fixed at its locked cost; an unlocked ranged line uses its
 *  allowance ends; anything else is its live total. */
export function romEnvelope(line: CostLine): { low: number; high: number } {
  if (isLocked(line)) {
    const fixed = line.lockedCost != null ? line.lockedCost * lineMarkupFactor(line) : lineBaseline(line);
    return { low: fixed, high: fixed };
  }
  if (lineHasRange(line)) {
    return { low: line.allowanceLow! * lineMarkupFactor(line), high: line.allowanceHigh! * lineMarkupFactor(line) };
  }
  const t = lineTotal(line);
  return { low: t, high: t };
}

/** One row per trade per markup treatment, richest first. */
export function romRows(db: DB): RomRow[] {
  const byKey = new Map<string, CostLine[]>();
  const modelsPerTrade = new Map<string, Set<MarkupModel>>();
  for (const l of db.costLines) {
    const tradeId = l.tradeId || "__none";
    const key = `${tradeId}::${l.markupModel}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(l);
    if (!modelsPerTrade.has(tradeId)) modelsPerTrade.set(tradeId, new Set());
    modelsPerTrade.get(tradeId)!.add(l.markupModel);
  }

  const rows: RomRow[] = [];
  for (const [key, lines] of byKey) {
    const [tradeId, model] = key.split("::") as [string, MarkupModel];
    const rom = (db.rom ?? []).find((r) => r.tradeId === tradeId && r.markupModel === model);
    const owners = new Set(lines.map((l) => l.owner));

    const base = lines.reduce((a, l) => a + lineBase(l), 0);
    const allIn = lines.reduce((a, l) => a + lineTotal(l), 0);
    // The agreed envelope EXCLUDES change orders. This is the point of the ROM:
    // the ceiling the owner agreed does not move because a change order was
    // approved later — the change order is precisely what pushes actual cost
    // past it. lineLow/lineHigh fold approved changes in, so they cannot be
    // reused here without a change order reading as money saved.
    const low = rom?.agreedLow ?? lines.reduce((a, l) => a + romEnvelope(l).low, 0);
    const high = rom?.agreedHigh ?? lines.reduce((a, l) => a + romEnvelope(l).high, 0);
    // What the work actually costs now, change orders included.
    const current = lines.reduce((a, l) => a + lineCurrent(l), 0);

    const locked = lines.filter((l) => isLocked(l));
    const changeOrders = lines.reduce((a, l) => a + approvedNetChange(l), 0);
    const underContract = locked.reduce((a, l) => a + lineTotal(l), 0) + changeOrders;
    const paid = lines.reduce((a, l) => a + linePaid(db, l), 0);

    // Contracted is the work itself, before any fee: what we agreed the builder
    // would do it for. The fee is its own figure beside it, so the owner can see
    // what she is paying for work and what she is paying for management.
    const contracted = locked.reduce((a, l) => a + lineBase(l), 0);
    const builderFee = locked.reduce((a, l) => a + (lineTotal(l) - lineBase(l)), 0);
    const total = contracted + changeOrders + builderFee;
    const draw = lines.reduce((a, l) => a + lineDrawn(db, l.id), 0);
    // Paid in full closes the line. Nothing moves again until a change order
    // re-opens it — which is the only thing that should be able to.
    const complete = total > 0 && paid >= total - 0.5;
    // No fee applies when the owner carries the line and pays the trade direct.
    const ownerManagedDirect = lines.every((l) => l.owner === "owner");
    const state: BudgetLineState = rom?.state ?? "active";
    const manager: CostOwner = ownerManagedDirect ? "owner" : "builder";

    // Work already under contract is work the owner has already agreed to, so a
    // row whose every line is locked starts committed. A part-locked row does
    // not: the unlocked half is still a figure nobody has signed up to.
    const autoCommitted = locked.length === lines.length;
    const committed = rom?.committed ?? autoCommitted;

    const splitByMarkup = (modelsPerTrade.get(tradeId)?.size ?? 1) > 1;
    const pct = lines[0]?.markupPct ?? 0;
    const markupLabel = model === "passthrough" ? `${pct}% on top` : "in fee";
    const name = tradeName(db, tradeId);

    rows.push({
      key, tradeId, markupModel: model,
      label: splitByMarkup ? `${name} — ${markupLabel}` : name,
      /** The trade's own name, without the fee suffix a split row carries. */
      tradeLabel: name,
      splitByMarkup,
      lines, rom, committed, autoCommitted,
      low, high, ranged: low !== high,
      base, markup: allIn - base, allIn,
      markupLabel,
      owner: owners.size > 1 ? "mixed" : (lines[0]?.owner ?? "builder"),
      category: lines[0]?.category ?? "Soft Costs",
      underContract, changeOrders, paid,
      remaining: Math.max(0, total - paid),
      lockedCount: locked.length,
      current,
      romFigure: high,
      contracted, builderFee, total, draw, complete, ownerManagedDirect,
      state, manager,
    });
  }
  return rows.sort((a, b) => b.allIn - a.allIn);
}

export function romTotals(db: DB) {
  const all = romRows(db);
  // A removed line is kept on the record and counted in nothing.
  const rows = all.filter((r) => r.state !== "removed");
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
    contracted: sum((r) => r.contracted),
    builderFee: sum((r) => r.builderFee),
    total: sum((r) => r.total),
    draw: sum((r) => r.draw),
    romFigure: sum((r) => r.romFigure),
    /** Under contract across committed rows only, so it can be read against
     *  `agreed` without comparing two different sets of rows. */
    underContractCommitted: committed.reduce((a, r) => a + r.underContract, 0),
    changeOrders: sum((r) => r.changeOrders),
    paid: sum((r) => r.paid),
    remaining: sum((r) => r.remaining),
    removedRows: all.length - rows.length,
  };
}

/** The project's categories, in order. Falls back to the built-in set. */
export function macroOrder(db: DB): MacroCategory[] {
  const own = db.categories;
  return own && own.length ? own.map((c) => c.name) : MACRO_ORDER;
}

/** A category's colour. An added category that has not been given one falls
 *  back to a neutral rather than rendering as an invisible bar segment. */
export function macroColor(db: DB, name: MacroCategory): string {
  return db.categories?.find((c) => c.name === name)?.color
    ?? MACRO_COLOR[name]
    ?? "var(--muted)";
}

/** Everything filed under a category — a category can only be removed once
 *  this is empty, same rule as a trade. */
export function categoryUsage(db: DB, name: MacroCategory) {
  const counts: Record<string, number> = {
    trades: db.trades.filter((t) => t.category === name).length,
    "budget lines": db.costLines.filter((l) => l.category === name).length,
  };
  const used = Object.entries(counts).filter(([, n]) => n > 0);
  return {
    counts,
    total: used.reduce((a, [, n]) => a + n, 0),
    summary: used.map(([k, n]) => `${n} ${n === 1 ? k.replace(/s$/, "") : k}`).join(", "),
  };
}

/** Everything that points at a trade. A trade can only be removed once this is
 *  empty — nothing here is deleted on its behalf, because a budget line or a
 *  Gantt bar with no trade behind it is worse than an unused trade. */
export function tradeUsage(db: DB, tradeId: string) {
  const counts: Record<string, number> = {
    "budget lines": db.costLines.filter((l) => l.tradeId === tradeId).length,
    "schedule tasks": db.schedule.filter((x) => x.tradeId === tradeId).length,
    materials: db.materials.filter((m) => m.tradeId === tradeId).length,
    "scope cells": (db.scope ?? []).filter((c) => c.tradeId === tradeId && c.status !== "unset").length,
    vendors: db.contacts.filter((c) => c.tradeId === tradeId || c.tradeIds?.includes(tradeId)).length,
    packages: (db.bidPackages ?? []).filter((p) => p.tradeId === tradeId).length,
    contracts: (db.vendorAgreements ?? []).filter((a) => a.tradeId === tradeId).length,
    people: db.users.filter((u) => u.tradeIds?.includes(tradeId)).length,
  };
  const used = Object.entries(counts).filter(([, n]) => n > 0);
  return {
    counts,
    total: used.reduce((a, [, n]) => a + n, 0),
    /** "3 budget lines and 1 package" — what to say when refusing. */
    summary: used.map(([k, n]) => `${n} ${n === 1 ? k.replace(/s$/, "") : k}`).join(", "),
  };
}

/** Every ROM line committed is the precondition for throwing the lock. */
export function romCanLock(db: DB): boolean {
  // A removed line is not waiting on anybody, so it does not hold up the lock.
  const rows = romRows(db).filter((r) => r.state !== "removed");
  return !db.romLocked && rows.length > 0 && rows.every((r) => r.committed);
}

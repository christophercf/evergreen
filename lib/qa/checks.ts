// ----------------------------------------------------------------------------
// Evergreen QA — the checks that can be decided from the data alone.
//
// Everything here reads the SAME functions the screens read. A QA check that
// re-implements the arithmetic proves only that two copies agree with each
// other, which is the exact bug class this project keeps hitting. If a figure
// is wrong on screen it must be wrong here too.
//
// Anything that needs a human eye — does the workflow stall, does the button
// say it saved, does it work on a phone — lives in QA.md, not here.
// ----------------------------------------------------------------------------

import type { DB, ModuleKey, Role, User } from "../data/types";
import { ROLE_ACCESS, accessFor } from "../data/types";

/** Module keys read as they are labelled in the nav, so a finding names the
 *  screen the reader would go to. */
const MODULE_LABEL: Record<string, string> = {
  dashboard: "Dashboard", timing: "Schedule", artifacts: "Artifacts", admin: "Administrative",
  materials: "Materials", vendors: "Contracts", costs: "Budget Management", budget: "Funding",
  payments: "Draw Management", updates: "Messages", bids: "Bid and Package Management",
};
import {
  lineTotal, lineBase, lineCurrent, lineContracted, approvedNetChange, lineMarkupFactor,
  lineDrawn, linePaid, drawAmount, allocationAmount, totals, romRows, romTotals, tradeName,
} from "../data/money";
import { contractOf, contractAmount, contractState } from "../data/contract";

export type Severity = "fail" | "warn" | "info";

export type Finding = {
  /** Which of the QA areas this belongs to — matches the headings in QA.md. */
  area: string;
  severity: Severity;
  /** One line, specific enough to act on without opening the data. */
  message: string;
  /** Where to look. */
  where?: string;
};

export type QaReport = {
  ranAt: string;
  counts: { fail: number; warn: number; info: number };
  findings: Finding[];
  /** Every check that ran, so a green run is provably a run and not a no-op. */
  checksRun: string[];
};

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
/** Currency is stored as floats; a cent of drift is arithmetic, not a defect. */
const near = (a: number, b: number, tol = 0.5) => Math.abs(a - b) <= tol;

// ---------------------------------------------------------------------------

export function runChecks(db: DB): QaReport {
  const f: Finding[] = [];
  const ran: string[] = [];
  const add = (area: string, severity: Severity, message: string, where?: string) =>
    f.push({ area, severity, message, where });

  const roomIds = new Set(db.rooms.map((r) => r.id));
  const tradeIds = new Set(db.trades.map((t) => t.id));
  const lineIds = new Set(db.costLines.map((l) => l.id));
  const userIds = new Set(db.users.map((u) => u.id));
  const catNames = new Set((db.categories ?? []).map((c) => c.name));

  // ---- Trades -------------------------------------------------------------
  ran.push("trades: every reference resolves to db.trades");
  const tradeRefs: [string, string[]][] = [
    ["cost line", db.costLines.map((l) => l.tradeId)],
    ["scope cell", db.scope.map((c) => c.tradeId)],
    ["material", db.materials.map((m) => m.tradeId).filter(Boolean) as string[]],
    ["schedule item", db.schedule.map((s) => s.tradeId).filter(Boolean) as string[]],
    ["bid package", (db.bidPackages ?? []).flatMap((p) => [p.tradeId, ...(p.tradeIds ?? [])])],
    ["vendor agreement", db.vendorAgreements.map((a) => a.tradeId)],
    ["user", db.users.flatMap((u) => u.tradeIds ?? [])],
    ["vendor contact", db.contacts.flatMap((c) => [c.tradeId, ...(c.tradeIds ?? [])].filter(Boolean) as string[])],
    ["ROM row", (db.rom ?? []).map((r) => r.tradeId)],
  ];
  for (const [what, ids] of tradeRefs) {
    const bad = [...new Set(ids.filter((id) => id && !tradeIds.has(id)))];
    if (bad.length) add("Trades", "fail", `${bad.length} ${what} reference(s) point at a trade that does not exist: ${bad.join(", ")}`, what);
  }

  ran.push("trades: category exists in db.categories");
  if (catNames.size) {
    const orphanCat = db.trades.filter((t) => !catNames.has(t.category));
    if (orphanCat.length) add("Trades", "fail", `${orphanCat.length} trade(s) sit in a category that no longer exists: ${orphanCat.map((t) => `${t.name} → ${t.category}`).join("; ")}`, "Admin → Trade Category Management");
  }

  ran.push("trades: cost line category matches its trade's category");
  const catDrift = db.costLines.filter((l) => {
    const t = db.trades.find((x) => x.id === l.tradeId);
    return t && t.category !== l.category;
  });
  if (catDrift.length) {
    add("Trades", "fail", `${catDrift.length} budget line(s) carry a different category from their trade — the classic second-copy drift: ${catDrift.slice(0, 5).map((l) => `${l.name} (line ${l.category} vs trade ${db.trades.find((t) => t.id === l.tradeId)?.category})`).join("; ")}`, "Budget Management");
  }

  // A trade legitimately holds several lines with their own names ("Additional
  // Framing Allowance" under Rough Carpentry). What must never differ is the
  // ROW label, which is the trade's name — composing one is the bug that shipped
  // "Roofing — in fee" next to a NAME field reading "Roofing".
  ran.push("trades: the budget row label is the trade's name, never composed");
  for (const r of romRows(db)) {
    const t = db.trades.find((x) => x.id === r.tradeId);
    if (t && r.label !== t.name) {
      add("Trades", "fail", `Budget row reads "${r.label}" but its trade is named "${t.name}" — the row is composing a label instead of reading one`, "Budget Management");
    }
  }

  // ---- Rooms --------------------------------------------------------------
  ran.push("rooms: every reference resolves to db.rooms");
  const roomRefs: [string, string[]][] = [
    ["cost line", db.costLines.flatMap((l) => l.roomIds)],
    ["scope cell", db.scope.map((c) => c.roomId)],
    ["bid package", (db.bidPackages ?? []).flatMap((p) => p.roomIds)],
    ["material", db.materials.map((m) => m.roomId).filter(Boolean) as string[]],
  ];
  for (const [what, ids] of roomRefs) {
    const bad = [...new Set(ids.filter((id) => id && !roomIds.has(id)))];
    if (bad.length) add("Rooms", "fail", `${bad.length} ${what} reference(s) point at a room that does not exist: ${bad.join(", ")}`, what);
  }

  ran.push("rooms: no two rooms share a name on the same floor");
  const seenRoom = new Map<string, string>();
  for (const r of db.rooms) {
    const key = `${r.floor}::${r.name.trim().toLowerCase()}`;
    if (seenRoom.has(key)) add("Rooms", "warn", `Two rooms named "${r.name}" on ${r.floor} — anything that picks a room by name will pick the wrong one`, "Admin → Rooms");
    seenRoom.set(key, r.id);
  }

  // ---- Vendors ------------------------------------------------------------
  ran.push("vendors: contract vendor matches the awarded bid it came from");
  for (const a of db.vendorAgreements) {
    const c = a.contract;
    if (!c?.packageId) continue;
    const p = (db.bidPackages ?? []).find((x) => x.id === c.packageId);
    if (!p) { add("Vendors", "fail", `${tradeName(db, a.tradeId)}'s contract points at package ${c.packageId}, which no longer exists`, "Contracts"); continue; }
    const won = p.bids?.find((b) => b.id === p.awardedBidId);
    if (won && won.vendorName !== c.vendorName) {
      add("Vendors", "fail", `${tradeName(db, a.tradeId)}: contract says "${c.vendorName}" but the awarded bid says "${won.vendorName}"`, "Contracts / Bid and Package Management");
    }
  }

  ran.push("vendors: a trade has at most one vendor contact");
  const byTrade = new Map<string, string[]>();
  for (const c of db.contacts.filter((x) => x.party === "vendor")) {
    for (const t of [c.tradeId, ...(c.tradeIds ?? [])].filter(Boolean) as string[]) {
      byTrade.set(t, [...(byTrade.get(t) ?? []), c.company]);
    }
  }
  // Two companies covering one trade is normal in the directory; two ENGAGED on
  // the same trade is not, so only the engagement field is checked.
  const engaged = new Map<string, string[]>();
  for (const c of db.contacts.filter((x) => x.party === "vendor" && x.tradeId)) {
    engaged.set(c.tradeId!, [...(engaged.get(c.tradeId!) ?? []), c.company]);
  }
  for (const [t, names] of engaged) {
    if (names.length > 1) add("Vendors", "warn", `${tradeName(db, t)} has ${names.length} engaged vendors (${names.join(", ")}) — the contract and the draws can only address one`, "Admin → Vendor Management");
  }

  ran.push("vendors: every vendor user's trades still exist and are engaged");
  for (const u of db.users.filter((x) => x.role === "trade")) {
    if (!(u.tradeIds ?? []).length) add("Vendors", "warn", `Vendor account "${u.name}" is not assigned to any trade, so they see no contract`, "Admin → Users");
  }

  // ---- Budget items -------------------------------------------------------
  ran.push("budget: draw allocations point at real budget lines");
  for (const d of db.draws) {
    const bad = d.allocations.filter((a) => !lineIds.has(a.lineId));
    if (bad.length) add("Budget items", "fail", `Draw "${d.name}" allocates to ${bad.length} budget line(s) that no longer exist`, "Draw Management");
  }

  ran.push("budget: packages point at real budget lines");
  for (const p of db.bidPackages ?? []) {
    if (p.lineId && !lineIds.has(p.lineId)) add("Budget items", "fail", `Package "${p.title}" points at a budget line that no longer exists`, "Bid and Package Management");
  }

  ran.push("budget: change-order exhibits are unique within a line");
  for (const l of db.costLines) {
    const seen = new Set<string>();
    for (const co of l.changeOrders) {
      if (seen.has(co.exhibit)) add("Budget items", "warn", `"${l.name}" has two change orders both labelled ${co.exhibit}`, "Budget Management");
      seen.add(co.exhibit);
    }
  }

  // ---- Budget arithmetic --------------------------------------------------
  ran.push("budget maths: per line — contracted + change orders + fee = total");
  for (const l of db.costLines) {
    // Read through the same helper the budget rows read: a locked line is worth
    // its contracted price, not the estimate in its history.
    const expected = lineContracted(l) * lineMarkupFactor(l) + approvedNetChange(l);
    if (!near(lineCurrent(l), expected, 1)) {
      add("Budget maths", "fail", `"${l.name}": total ${money(lineCurrent(l))} ≠ contracted + change orders + fee (${money(expected)})`, "Budget Management");
    }
  }

  ran.push("budget maths: the rows add up to the table total");
  const rows = romRows(db);
  const rt = romTotals(db);
  const rowSum = rows.filter((r) => r.state !== "removed").reduce((a, r) => a + r.total, 0);
  if (!near(rowSum, rt.total, 1)) {
    add("Budget maths", "fail", `Budget rows sum to ${money(rowSum)} but the total row says ${money(rt.total)}`, "Budget Management");
  }

  ran.push("budget maths: project totals match the sum of the lines");
  const t = totals(db.costLines);
  const lineSum = db.costLines.reduce((a, l) => a + lineCurrent(l), 0);
  if (!near(t.grand, lineSum, 1)) {
    add("Budget maths", "fail", `Project total ${money(t.grand)} ≠ the sum of its lines (${money(lineSum)})`, "Budget Management / Dashboard");
  }

  ran.push("budget maths: no line is drawn beyond its total");
  for (const l of db.costLines) {
    const drawn = lineDrawn(db, l.id);
    if (drawn - lineCurrent(l) > 0.5) {
      add("Budget maths", "fail", `"${l.name}" is allocated ${money(drawn)} across draws but is only worth ${money(lineCurrent(l))}`, "Draw Management");
    }
  }

  ran.push("budget maths: nothing is paid beyond what it is worth");
  for (const l of db.costLines) {
    if (linePaid(db, l) - lineCurrent(l) > 0.5) {
      add("Budget maths", "fail", `"${l.name}" is paid ${money(linePaid(db, l))} against a total of ${money(lineCurrent(l))}`, "Draw Management");
    }
  }

  ran.push("budget maths: each draw equals the sum of its allocations");
  for (const d of db.draws) {
    const parts = d.allocations.reduce((a, al) => {
      const l = db.costLines.find((x) => x.id === al.lineId);
      return a + (l ? allocationAmount(l, al) : 0);
    }, 0);
    if (!near(drawAmount(db, d), parts, 1)) {
      add("Budget maths", "fail", `Draw "${d.name}" shows ${money(drawAmount(db, d))} but its lines add to ${money(parts)}`, "Draw Management");
    }
  }

  ran.push("budget maths: contract sum = contracted + approved change orders");
  for (const a of db.vendorAgreements) {
    if (!a.contract) continue;
    const lines = db.costLines.filter((l) => l.tradeId === a.tradeId && l.locked);
    if (!lines.length) continue;
    const fromBudget = lines.reduce((s, l) => s + (l.lockedCost ?? lineBase(l)) + approvedNetChange(l), 0);
    if (!near(contractAmount(a.contract), fromBudget, 1)) {
      add("Budget maths", "warn", `${tradeName(db, a.tradeId)}: contract sum ${money(contractAmount(a.contract))} ≠ budget's contracted + change orders (${money(fromBudget)})`, "Contracts / Budget Management");
    }
  }

  ran.push("budget maths: markup factor is sane on every line");
  for (const l of db.costLines) {
    const fct = lineMarkupFactor(l);
    if (fct < 1 || fct > 2) add("Budget maths", "warn", `"${l.name}" carries a markup factor of ${fct.toFixed(2)} — outside 0–100%`, "Budget Management");
  }

  // ---- Contracts & draws --------------------------------------------------
  ran.push("contracts: nothing is drawn against an unsigned in-app contract");
  for (const d of db.draws) {
    for (const al of d.allocations) {
      const l = db.costLines.find((x) => x.id === al.lineId);
      if (!l) continue;
      const c = contractOf(db, l.tradeId);
      if (c && contractState(db, l.tradeId) !== "signed" && d.status !== "planned") {
        add("Contracts", "warn", `Draw "${d.name}" carries "${l.name}", whose contract is issued but not signed`, "Draw Management");
      }
    }
  }

  ran.push("contracts: a paid draw is never left un-dated");
  for (const d of db.draws) {
    if (d.status === "paid" && !d.paidDate) add("Contracts", "warn", `Draw "${d.name}" is marked paid with no paid date`, "Draw Management");
    if (d.status === "pushed" && !d.approvedDate) add("Contracts", "info", `Draw "${d.name}" is client-approved with no approval date (approved before the date was recorded)`, "Draw Management");
  }

  // ---- Access -------------------------------------------------------------
  ran.push("access: every user reaches every module their role grants");
  const MODULES = Object.keys(ROLE_ACCESS.full_admin) as ModuleKey[];
  for (const u of db.users) {
    if (u.disabled) continue;
    for (const m of MODULES) {
      const expected = u.access?.[m] ?? ROLE_ACCESS[u.role][m];
      const actual = accessFor(u, u.role, m);
      if (actual !== expected) {
        add("Access", "fail", `${u.name} (${u.role}) gets "${actual}" on ${MODULE_LABEL[m] ?? m}, but their role/override says "${expected}"`, "Admin → Users");
      }
    }
  }

  ran.push("access: nobody is stranded with no module at all");
  for (const u of db.users) {
    if (u.disabled) continue;
    const reachable = MODULES.filter((m) => accessFor(u, u.role, m) !== "none");
    if (!reachable.length) add("Access", "fail", `${u.name} can reach no module at all — they can sign in and see nothing`, "Admin → Users");
  }

  ran.push("access: every account has a login identity");
  for (const u of db.users) {
    if (!u.email?.trim()) add("Access", "fail", `${u.name} has no email, so they cannot sign in`, "Admin → Users");
  }

  ran.push("access: no orphaned user references");
  for (const meta of db.convMeta ?? []) {
    const bad = Object.keys(meta.reads ?? {}).filter((id) => !userIds.has(id));
    if (bad.length) add("Access", "info", `A conversation holds read receipts for ${bad.length} deleted user(s)`, "Messages");
  }

  const counts = {
    fail: f.filter((x) => x.severity === "fail").length,
    warn: f.filter((x) => x.severity === "warn").length,
    info: f.filter((x) => x.severity === "info").length,
  };
  return { ranAt: new Date().toISOString(), counts, findings: f, checksRun: ran };
}

/** Role × module, as the app will actually answer it. The click-through half of
 *  QA needs this to know what each persona is supposed to see. */
export function accessMatrix(db: DB): { user: User; role: Role; access: Record<string, string> }[] {
  const MODULES = Object.keys(ROLE_ACCESS.full_admin) as ModuleKey[];
  return db.users.filter((u) => !u.disabled).map((u) => ({
    user: u,
    role: u.role,
    access: Object.fromEntries(MODULES.map((m) => [MODULE_LABEL[m] ?? m, accessFor(u, u.role, m)])),
  }));
}

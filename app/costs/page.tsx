"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/data/hooks";
import { PageHeader, NoAccess, Pill, SectionTitle, Money, StatCard, StackBar, NumInput } from "../ui/bits";
import { MoneyTabs } from "../ui/money-tabs";
import { MASTER_TERMS } from "@/lib/data/seed";
import { accessFor, isOwnerManaged, type CostLine, type CostOwner, type LinePhase, type MarkupModel, type MacroCategory, type RoomFloor } from "@/lib/data/types";
import {
  lineBase, lineStart, lineDelta, totals, byCategory, byTrade, drawAmount,
  lineBaseline, lineCurrent, approvedChanges, approvedSavings, approvedNetChange,
  phaseAmount, phasesTotal, tradeName, MACRO_ORDER, MACRO_COLOR, fmt,
  linePaid, linePaidByDraws, lineUnpaid, linePaidStatus,
  lineHasRange, lineLow, lineHigh, budgetRange, isLocked, lineLockedCost, lineRemaining,
} from "@/lib/data/money";
import { fileToDataURL } from "../ui/upload";
import { useFileDrop } from "../ui/use-drop";
import { MsgButton } from "../ui/messenger";

type GroupBy = "category" | "trade" | "owner";

export default function CostsPage() {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const user = store.currentUser;
  const access = accessFor(user, role, "costs");
  const [group, setGroup] = useState<GroupBy>("category");
  const [payFilter, setPayFilter] = useState<"all" | "paid" | "partial" | "unpaid">("all");

  if (access === "none") return <NoAccess module="the Budget" />;
  const ro = access !== "edit";

  const t = totals(db.costLines);
  const buffer = (t.grand * db.project.bufferPct) / 100;
  const netChange = t.grand - t.baseline;
  const paidToDate = db.costLines.reduce((a, l) => a + linePaid(db, l), 0);
  const br = budgetRange(db.costLines);
  const remLow = Math.max(0, br.low - paidToDate);
  const remHigh = Math.max(0, br.high - paidToDate);
  const anyUnlocked = db.costLines.some((l) => !l.locked);
  const shownLines = payFilter === "all" ? db.costLines : db.costLines.filter((l) => linePaidStatus(db, l) === payFilter);
  const groups = groupLines(shownLines, group, db);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const allCollapsed = groups.length > 0 && groups.every((g) => collapsed.has(g.key));
  const toggleGroup = (k: string) => setCollapsed((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(groups.map((g) => g.key)));

  return (
    <>
      <PageHeader
        title="Money"
        subtitle="What we have promised to spend. The builder roughs out the ROM here first; winning package bids promote in as locked lines. The locked baseline is your original budget — every change after that flows through a change order. All figures include builder markup."
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {ro && <Pill color="var(--muted)">View only</Pill>}
            <Link href="/timing" className="btn btn-sm">Schedule →</Link>
          </div>
        }
      />
      <MoneyTabs />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))", gap: 12, marginTop: 16 }}>
        <StatCard label="Current Cost Range" value={br.low === br.high ? <Money value={br.high} /> : <span style={{ fontSize: ".7em", fontWeight: 700 }}>{fmt(br.low)}<span style={{ color: "var(--muted)" }}> – </span>{fmt(br.high)}</span>} accent="var(--brass-2)" sub="low – high" />
        <StatCard label="Paid" value={<Money value={paidToDate} />} accent="var(--ok)" sub={`${Math.round((paidToDate / (br.high || 1)) * 100)}% of high`} />
        <StatCard label="Remaining" value={remLow === remHigh ? <Money value={remHigh} /> : <span style={{ fontSize: ".7em", fontWeight: 700 }}>{fmt(remLow)}<span style={{ color: "var(--muted)" }}> – </span>{fmt(remHigh)}</span>} sub="cost − paid" />
        <StatCard label="Change Orders" value={<Money value={db.costLines.reduce((a, l) => a + approvedChanges(l), 0)} />} accent="var(--rust)" sub="approved adds" />
        <StatCard label="Savings Found" value={<Money value={db.costLines.reduce((a, l) => a + approvedSavings(l), 0)} />} accent="var(--ok)" sub="approved credits" />
        <StatCard label="Baseline" value={<Money value={t.baseline} />} sub={netChange ? `${netChange > 0 ? "▲" : "▼"} ${fmt(Math.abs(netChange))} vs current` : "on budget"} />
      </div>

      {br.low !== br.high && (
        <div className="card" style={{ padding: "9px 14px", marginTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12, color: "var(--muted)", borderLeft: "3px solid var(--sage)" }}>
          🔒 Locked lines are fixed (counted in both ends of the range); unlocked estimates contribute their low–high spread. Lock a line to pin it.
        </div>
      )}

      {/* Cumulative cost-over-time, building to the budget; change orders show their impact */}
      <SectionTitle>Cost Over Time</SectionTitle>
      <CostChart />

      <SectionTitle>Project Mix</SectionTitle>
      <div className="card" style={{ padding: 16 }}>
        <StackBar height={13} segments={MACRO_ORDER.map((c) => ({ value: byCategory(db.costLines).find((x) => x.key === c)?.total ?? 0, color: MACRO_COLOR[c], label: c }))} />
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 12, fontSize: 12 }}>
          {MACRO_ORDER.map((c) => {
            const v = byCategory(db.costLines).find((x) => x.key === c)?.total ?? 0;
            if (!v) return null;
            return <span key={c} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: MACRO_COLOR[c] }} />{c} · <strong><Money value={v} /></strong></span>;
          })}
        </div>
      </div>

      {!ro && <BuilderMarkupControl />}
      {!ro && <AddCostLine />}

      <SectionTitle right={
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {([["all", "All"], ["paid", "✓ Paid"], ["partial", "◐ Part"], ["unpaid", "Unpaid"]] as const).map(([k, lbl]) => (
            <button key={k} className="btn btn-sm" onClick={() => setPayFilter(k)} style={{ background: payFilter === k ? "var(--sage-tint)" : undefined, fontWeight: payFilter === k ? 700 : 400 }}>{lbl}</button>
          ))}
          <span style={{ width: 1, height: 16, background: "var(--line)" }} />
          <button className="btn btn-sm" onClick={toggleAll}>{allCollapsed ? "Expand all" : "Collapse all"}</button>
          {(["category", "trade", "owner"] as GroupBy[]).map((g) => (
            <button key={g} className="btn btn-sm" onClick={() => setGroup(g)} style={{ background: group === g ? "var(--sage-tint)" : undefined, fontWeight: 700 }}>by {g}</button>
          ))}
        </div>
      }>
        Cost Lines{payFilter !== "all" && <span style={{ fontSize: 12, fontWeight: 400, color: "var(--muted)" }}> · {shownLines.length} {payFilter}</span>}
      </SectionTitle>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {groups.map((grp) => {
          const isCollapsed = collapsed.has(grp.key);
          return (
            <div key={grp.key}>
              <div onClick={() => toggleGroup(grp.key)} style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 2px 7px", cursor: "pointer" }}>
                <span style={{ fontSize: 11, color: "var(--muted)", width: 12 }}>{isCollapsed ? "▸" : "▾"}</span>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: grp.color }} />
                <h3 className="serif" style={{ fontSize: 15, fontWeight: 700, color: "var(--walnut)" }}>{grp.label}</h3>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{grp.lines.length} line{grp.lines.length === 1 ? "" : "s"}</span>
                <span style={{ marginLeft: "auto", fontWeight: 700 }}><Money value={grp.lines.reduce((a, l) => a + lineCurrent(l), 0)} /></span>
              </div>
              {!isCollapsed && (
                <div className="card" style={{ overflow: "hidden" }}>
                  {grp.lines.map((l, i) => (<CostRow key={l.id} line={l} ro={ro} first={i === 0} />))}
                </div>
              )}
            </div>
          );
        })}
      </div>

    </>
  );
}

// ---------------------------------------------------------------------------
// Add a room here — shared with the Admin tab, no duplicates.
function AddRoomCard() {
  const store = useStore();
  const [name, setName] = useState("");
  const [floor, setFloor] = useState<RoomFloor>("First Floor");
  const [warn, setWarn] = useState(false);
  const FLOORS: RoomFloor[] = ["Whole House", "First Floor", "Second Floor", "Basement", "Exterior"];
  return (
    <div className="card" style={{ padding: 12, marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <strong style={{ fontSize: 13 }}>Add a room</strong>
      <span style={{ fontSize: 12, color: "var(--muted)" }}>shared with the Admin tab</span>
      <input placeholder="Room name…" value={name} onChange={(e) => { setName(e.target.value); setWarn(false); }} style={{ flex: 1, minWidth: 160 }} />
      <select value={floor} onChange={(e) => setFloor(e.target.value as RoomFloor)}>{FLOORS.map((f) => <option key={f}>{f}</option>)}</select>
      <button className="btn btn-primary" onClick={() => { const ok = store.addRoom(name, floor); if (ok) setName(""); else setWarn(true); }}>+ Add room</button>
      {warn && <span style={{ fontSize: 12, color: "var(--rust)" }}>That room already exists.</span>}
    </div>
  );
}

// Add a cost line item (builder or owner). "Agreed price" = single contracted price;
// "Range" = a low/high allowance not yet pinned (per the budget convention).
function AddCostLine() {
  const store = useStore();
  const db = store.db;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [tradeId, setTradeId] = useState<string>(db.trades[0]?.id ?? "");
  const [owner, setOwner] = useState<CostOwner>("builder");
  const [markupModel, setMarkupModel] = useState<MarkupModel>("passthrough");
  const [markupPct, setMarkupPct] = useState(db.project.builderMarkupPct ?? 20);
  const [mode, setMode] = useState<"agreed" | "range">("agreed");
  const [price, setPrice] = useState("");
  const [low, setLow] = useState("");
  const [high, setHigh] = useState("");

  const trade = db.trades.find((t) => t.id === tradeId);
  // default markup/owner from the trade
  const pickTrade = (id: string) => {
    setTradeId(id);
    const t = db.trades.find((x) => x.id === id);
    if (t) { const o = t.defaultOwner; setOwner(o); setMarkupModel(o === "owner" ? "blackbox" : "passthrough"); setMarkupPct(o === "owner" ? 0 : (db.project.builderMarkupPct ?? 20)); }
  };
  const valid = name.trim() && trade && (mode === "agreed" ? Number(price) > 0 : Number(low) > 0 && Number(high) >= Number(low));

  const factor = markupModel === "passthrough" ? 1 + markupPct / 100 : 1;
  const submit = () => {
    if (!valid || !trade) return;
    const today = new Date().toISOString().slice(0, 10);
    store.addCostLine(mode === "agreed" ? {
      // Agreed with the vendor → created already locked (changes via change order).
      name: name.trim(), tradeId, category: trade.category, owner, roomIds: [],
      markupModel, markupPct, status: "contracted",
      locked: true, lockedCost: Number(price), baseline: Number(price) * factor, lockedAt: today, lockedBy: store.session.displayName,
      history: [{ label: "Agreed (locked)", date: today, amount: Number(price) }],
    } : {
      // Estimate range → unlocked allowance; lock it once a price is agreed.
      name: name.trim(), tradeId, category: trade.category, owner, roomIds: [],
      markupModel, markupPct, status: "allowance",
      allowanceLow: Number(low), allowanceHigh: Number(high),
      history: [{ label: "Working budget", date: today, amount: Number(high) }],
    });
    setName(""); setPrice(""); setLow(""); setHigh(""); setOpen(false);
  };

  if (!open) return <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => setOpen(true)}>＋ Add cost line item</button>;

  return (
    <div className="card" style={{ padding: 14, marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 14, color: "var(--walnut)" }}>Add a cost line item</strong>
        <div style={{ display: "inline-flex", gap: 4, background: "var(--cream-2)", padding: 3, borderRadius: 8 }}>
          {([["agreed", "🔒 Locked (agreed)"], ["range", "Estimate (low/high)"]] as const).map(([v, lbl]) => (
            <button key={v} onClick={() => setMode(v)} className="btn btn-sm" style={mode === v ? { background: "var(--walnut)", color: "#fff" } : { background: "transparent", border: "none" }}>{lbl}</button>
          ))}
        </div>
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{mode === "agreed" ? "Price agreed with the vendor — created locked (draw-ready)." : "A low/high range we haven't pinned yet — lock it once agreed."}</span>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input placeholder="Line item name…" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
        <select value={tradeId} onChange={(e) => pickTrade(e.target.value)} style={{ fontSize: 12.5 }}>
          {MACRO_ORDER.map((c) => <optgroup key={c} label={c}>{db.trades.filter((t) => t.category === c).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>)}
        </select>
        <select value={owner} onChange={(e) => setOwner(e.target.value as CostOwner)} style={{ fontSize: 12.5 }}>
          <option value="builder">Builder-carried</option>
          <option value="owner">Owner-carried</option>
        </select>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {mode === "agreed" ? (
          <label style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>Price $<input type="number" value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: 120 }} /></label>
        ) : (
          <>
            <label style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>Low $<input type="number" value={low} onChange={(e) => setLow(e.target.value)} style={{ width: 110 }} /></label>
            <label style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>High $<input type="number" value={high} onChange={(e) => setHigh(e.target.value)} style={{ width: 110 }} /></label>
          </>
        )}
        <span style={{ width: 1, height: 18, background: "var(--line)" }} />
        <select value={markupModel} onChange={(e) => setMarkupModel(e.target.value as MarkupModel)} style={{ fontSize: 12 }}>
          <option value="passthrough">+ markup</option>
          <option value="blackbox">fee included</option>
        </select>
        {markupModel === "passthrough" && <label style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}><input type="number" value={markupPct} onChange={(e) => setMarkupPct(Number(e.target.value))} style={{ width: 56 }} />%</label>}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-primary" disabled={!valid} onClick={submit}>Add line item</button>
        <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cumulative cost over the project timeline, stacked by category, building to
// the budget. Approved change orders accrue at their date so their impact shows.
function CostChart() {
  const store = useStore();
  const db = store.db;
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const monthIdx = (d: string) => { const dt = new Date(`${d}T00:00:00`); return dt.getFullYear() * 12 + dt.getMonth(); };
  const fmtMonth = (idx: number) => new Date(Math.floor(idx / 12), idx % 12, 1).toLocaleString("en-US", { month: "short", year: "2-digit" });

  // When each line "lands" = latest scheduled end for its trade (else project start).
  const endIdxOf = (l: CostLine) => {
    const ends = db.schedule.filter((s) => s.tradeId === l.tradeId).map((s) => monthIdx(s.end));
    return ends.length ? Math.max(...ends) : null;
  };
  // Actual money out the door: paid draws (by paid date) + direct payments.
  const paidEvents: { idx: number; amt: number }[] = [];
  for (const d of db.draws) if (d.status === "paid" && d.paidDate) paidEvents.push({ idx: monthIdx(d.paidDate), amt: drawAmount(db, d) });
  for (const l of db.costLines) if (l.directPaid && l.directPaidDate) paidEvents.push({ idx: monthIdx(l.directPaidDate), amt: l.directPaid });
  const paidTotal = paidEvents.reduce((a, e) => a + e.amt, 0);
  const cumPaid = (uptoIdx: number) => paidEvents.filter((e) => e.idx <= uptoIdx).reduce((a, e) => a + e.amt, 0);

  const now = new Date();
  const todayIdx = now.getFullYear() * 12 + now.getMonth();
  const sIdx = db.schedule.map((s) => monthIdx(s.start));
  const coIdx = db.costLines.flatMap((l) => l.changeOrders.filter((c) => c.status === "approved").map((c) => monthIdx(c.date)));
  const pIdx = paidEvents.map((e) => e.idx);
  const first = Math.min(...sIdx, ...coIdx, ...(pIdx.length ? pIdx : [Infinity]));
  const last = Math.max(...db.schedule.map((s) => monthIdx(s.end)), ...coIdx, ...(pIdx.length ? pIdx : [-Infinity]));
  const months: number[] = [];
  for (let i = first; i <= last; i++) months.push(i);

  const baseTotal = totals(db.costLines).baseline;
  const grand = totals(db.costLines).grand;
  const maxV = Math.max(baseTotal, grand, paidTotal) || 1;

  // cumulative value by category at each month
  const cum = (uptoIdx: number, cat: MacroCategory) =>
    db.costLines.filter((l) => l.category === cat).reduce((a, l) => {
      const end = endIdxOf(l);
      const landed = end === null ? first : end;
      const base = landed <= uptoIdx ? lineBaseline(l) : 0;
      const co = l.changeOrders.filter((c) => c.status === "approved" && monthIdx(c.date) <= uptoIdx)
        .reduce((s, c) => s + (c.kind === "savings" ? -c.amount : c.amount), 0);
      return a + base + (landed <= uptoIdx ? co : 0);
    }, 0);

  const W = 720, H = 240, padL = 56, padB = 28, padT = 12;
  const plotW = W - padL - 10, plotH = H - padB - padT;
  const y = (v: number) => padT + plotH - (v / maxV) * plotH;
  const xAt = (i: number) => padL + (months.length <= 1 ? plotW : (i / (months.length - 1)) * plotW);
  const budgetY = y(baseTotal);
  const cats = MACRO_ORDER.filter((c) => db.costLines.some((l) => l.category === c));

  // Build cumulative stacked series: bottom[i] accumulates as we stack categories.
  const bottom = months.map(() => 0);
  const bands = cats.map((c) => {
    const pts = months.map((m, i) => {
      const v = cum(m, c);
      const b = bottom[i];
      const t = b + v;
      bottom[i] = t;
      return { x: xAt(i), top: y(t), bot: y(b) };
    });
    // polygon: tops L→R, then bottoms R→L
    const poly = [...pts.map((p) => `${p.x.toFixed(1)},${p.top.toFixed(1)}`), ...[...pts].reverse().map((p) => `${p.x.toFixed(1)},${p.bot.toFixed(1)}`)].join(" ");
    return { c, poly };
  });
  const totalLine = months.map((m, i) => `${xAt(i).toFixed(1)},${y(bottom[i]).toFixed(1)}`).join(" ");

  // Actual-paid overlay: cumulative payments up to today, plus a Today marker.
  // (Rendered after mount so server/client HTML match.)
  const lastActualIdx = Math.min(todayIdx, last);
  const actualMonths = months.filter((m) => m <= lastActualIdx);
  const actualPts = actualMonths.map((m) => ({ x: xAt(months.indexOf(m)), yv: y(cumPaid(m)) }));
  const dayFrac = Math.min(1, (now.getDate() - 1) / 28);
  const todayX = todayIdx >= first && todayIdx <= last ? xAt(months.indexOf(todayIdx) + Math.min(dayFrac, months.length - 1 - months.indexOf(todayIdx))) : null;
  if (todayX !== null && actualPts.length) actualPts.push({ x: todayX, yv: y(cumPaid(todayIdx)) });
  const actualLine = actualPts.map((p) => `${p.x.toFixed(1)},${p.yv.toFixed(1)}`).join(" ");
  const actualEnd = actualPts[actualPts.length - 1];

  return (
    <div className="card" style={{ padding: 16, overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 520, display: "block" }}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={padL} x2={W - 10} y1={padT + plotH * (1 - f)} y2={padT + plotH * (1 - f)} stroke="var(--line)" strokeWidth={1} />
            <text x={padL - 6} y={padT + plotH * (1 - f) + 3} textAnchor="end" fontSize={9} fill="var(--muted)">{fmt(maxV * f)}</text>
          </g>
        ))}
        {/* stacked areas */}
        {bands.map((b) => <polygon key={b.c} points={b.poly} fill={MACRO_COLOR[b.c]} opacity={0.82} stroke={MACRO_COLOR[b.c]} strokeWidth={0.5} />)}
        {/* total boundary line + points */}
        <polyline points={totalLine} fill="none" stroke="var(--walnut)" strokeWidth={1.5} />
        {months.map((m, i) => <circle key={i} cx={xAt(i)} cy={y(bottom[i])} r={2.4} fill="var(--walnut)" />)}
        {/* budget reference line */}
        <line x1={padL} x2={W - 10} y1={budgetY} y2={budgetY} stroke="var(--brass)" strokeWidth={1.5} strokeDasharray="5 4" />
        <text x={W - 12} y={budgetY - 4} textAnchor="end" fontSize={9.5} fill="var(--brass-2)" fontWeight={700}>Baseline budget {fmt(baseTotal)}</text>
        {/* actual paid-to-date overlay + today marker (client-only) */}
        {mounted && actualPts.length > 0 && (
          <g>
            <polyline points={actualLine} fill="none" stroke="var(--ok)" strokeWidth={2.5} strokeLinejoin="round" />
            {actualEnd && <circle cx={actualEnd.x} cy={actualEnd.yv} r={3.5} fill="var(--ok)" stroke="#fff" strokeWidth={1.2} />}
            {actualEnd && (
              <text x={Math.min(actualEnd.x + 6, W - 12)} y={Math.max(actualEnd.yv - 7, 10)} textAnchor={actualEnd.x > W - 130 ? "end" : "start"} fontSize={9.5} fill="var(--ok)" fontWeight={700}>
                Paid to date {fmt(paidTotal)}
              </text>
            )}
          </g>
        )}
        {mounted && todayX !== null && (
          <g>
            <line x1={todayX} x2={todayX} y1={padT} y2={padT + plotH} stroke="var(--rust)" strokeWidth={1.5} strokeDasharray="3 3" />
            <text x={todayX + 4} y={padT + 10} fontSize={9.5} fill="var(--rust)" fontWeight={700}>Today</text>
          </g>
        )}
        {/* month labels */}
        {months.map((m, i) => <text key={i} x={xAt(i)} y={H - padB + 16} textAnchor="middle" fontSize={9} fill="var(--muted)">{fmtMonth(m)}</text>)}
      </svg>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 6, fontSize: 11 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 700, color: "var(--ok)" }}><span style={{ width: 14, height: 3, background: "var(--ok)", borderRadius: 2 }} />Actual paid</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 700, color: "var(--walnut)" }}><span style={{ width: 14, height: 2, background: "var(--walnut)", borderRadius: 2 }} />Projected</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 700, color: "var(--rust)" }}><span style={{ width: 14, height: 0, borderTop: "2px dashed var(--rust)" }} />Today</span>
        {cats.map((c) => <span key={c} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: MACRO_COLOR[c] }} />{c}</span>)}
      </div>
      <p style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>The stacked area is the <strong>projected</strong> cumulative cost (each trade lands per the schedule), building toward the baseline budget (dashed brass). The solid green line is <strong>actual money paid</strong> (draws + direct payments) up to the Today marker — the gap between green and the area is work committed but not yet paid.</p>
    </div>
  );
}

function groupLines(lines: CostLine[], group: GroupBy, db: ReturnType<typeof useStore>["db"]) {
  if (group === "owner") {
    return [
      { key: "builder", label: "Builder-carried", color: "var(--sage)", lines: lines.filter((l) => l.owner === "builder") },
      { key: "owner", label: "Owner-carried", color: "var(--brass)", lines: lines.filter((l) => l.owner === "owner") },
    ].filter((g) => g.lines.length);
  }
  if (group === "trade") {
    return byTrade(db, lines).map((r) => ({ key: r.key, label: r.label, color: "var(--sage)", lines: lines.filter((l) => l.tradeId === r.key) }));
  }
  return MACRO_ORDER.map((c) => ({ key: c, label: c, color: MACRO_COLOR[c], lines: lines.filter((l) => l.category === c) })).filter((g) => g.lines.length);
}

// ---------------------------------------------------------------------------
function CostRow({ line, ro, first }: { line: CostLine; ro: boolean; first: boolean }) {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const [open, setOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  // Deep link from Messenger context chips: /costs?line=<id> opens this row.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("line") === line.id) {
      setOpen(true);
      setTimeout(() => rowRef.current?.scrollIntoView({ block: "center" }), 60);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const net = approvedNetChange(line);
  const locked = isLocked(line);
  const paid = linePaid(db, line);
  const remaining = lineRemaining(db, line);
  const canLock = !ro && (role === "builder" || role === "full_admin");
  const sched = db.schedule.filter((s) => s.tradeId === line.tradeId && s.kind !== "milestone");
  const schedWindow = sched.length ? (() => {
    const f = (d: string) => new Date(`${d}T00:00:00`).toLocaleString("en-US", { month: "short", day: "numeric" });
    return `${f(sched.map((s) => s.start).sort()[0])} – ${f(sched.map((s) => s.end).sort().slice(-1)[0])}`;
  })() : null;

  return (
    <div ref={rowRef} style={{ borderTop: first ? undefined : "1px solid var(--line)" }}>
      <div title={open ? "Collapse" : "Expand"} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", cursor: "pointer", background: open ? "var(--sage-tint)" : undefined, borderLeft: open ? "4px solid var(--sage)" : "4px solid transparent" }} onClick={() => setOpen((v) => !v)}>
        <span style={{ fontSize: 13, color: open ? "var(--sage-2)" : "var(--muted)", width: 12, flexShrink: 0 }}>{open ? "▾" : "▸"}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: open ? "var(--walnut)" : undefined }}>{line.name}</span>
            {isOwnerManaged(db.trades.find((t) => t.id === line.tradeId)) && <Pill color="#fff" bg="var(--brass)">⌂ Owner Managed</Pill>}
            <Pill color="#fff" bg={line.owner === "owner" ? "var(--brass)" : "var(--sage)"}>{line.owner}</Pill>
            <PaidPill line={line} />
            {isLocked(line) ? <Pill color="#fff" bg="var(--ok)">🔒 Locked</Pill> : lineHasRange(line) ? <Pill color="var(--brass-2)" bg="#f0e6cd">Estimate</Pill> : <StatusPill status={line.status} />}
            {line.changeOrders.length > 0 && <Pill color="var(--brass-2)" bg="#f0e6cd">{line.changeOrders.length} exhibit{line.changeOrders.length === 1 ? "" : "s"}</Pill>}
            <MsgButton kind="cost" refId={line.id} label={line.name} href={`/costs?line=${line.id}`} small />
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
            {tradeName(db, line.tradeId)} · {line.roomIds.length === 0 ? "whole project" : `${line.roomIds.length} room${line.roomIds.length === 1 ? "" : "s"}`}
            {line.markupModel === "passthrough" ? ` · +${line.markupPct}% markup` : " · fee included"}
            {schedWindow && <> · <span style={{ color: "var(--sage-2)" }}>🗓 {schedWindow}</span></>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Mini label="Low" value={locked ? "—" : fmt(lineLow(line))} dim={locked} />
          <Mini label="High" value={locked ? "—" : fmt(lineHigh(line))} dim={locked} />
          {locked ? (
            <Mini label="Locked" value={fmt(lineCurrent(line))} accent="var(--ok)" prefix="🔒" />
          ) : canLock ? (
            <div style={{ minWidth: 64, textAlign: "right" }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--muted)" }}>Locked</div>
              <button className="btn btn-sm" style={{ padding: "1px 7px", marginTop: 1 }} onClick={(e) => { e.stopPropagation(); setOpen(true); }}>🔒 Lock</button>
            </div>
          ) : (
            <Mini label="Locked" value="—" dim />
          )}
          <span style={{ width: 1, height: 30, background: "var(--line)" }} />
          <Mini label="Paid" value={fmt(paid)} accent={paid > 0 ? "var(--ok)" : undefined} dim={paid === 0} />
          <Mini label="Remaining" value={fmt(remaining)} accent={remaining > 0 ? "var(--brass-2)" : "var(--ok)"} />
        </div>
      </div>

      {open && (
        <div style={{ padding: "12px 16px 18px", background: "var(--paper)", borderTop: "2px solid var(--sage)", boxShadow: "inset 0 6px 12px -8px rgba(44,36,28,.25)" }}>
          {/* Cost lifecycle: Estimate → Lock → Paid / Remaining */}
          <CostPanel line={line} ro={ro} />

          {/* Contract document */}
          <ContractDoc line={line} ro={ro} />

          {/* Change orders / exhibits */}
          <ChangeOrders line={line} ro={ro} />

          {/* Phases */}
          <Phases line={line} ro={ro} />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 14 }} className="ever-two">
            <div>
              <Label>Price history (pre-baseline)</Label>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                {line.history.map((p, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, gap: 8 }}>
                    <span style={{ color: "var(--muted)" }}>{p.label} <span style={{ opacity: .6 }}>· {p.date}</span></span>
                    <span style={{ fontWeight: 600 }}><Money value={p.amount} /></span>
                  </div>
                ))}
                {!line.history.length && <span style={{ fontSize: 12, color: "var(--muted)" }}>Allowance {fmt(line.allowanceLow ?? 0)}–{fmt(line.allowanceHigh ?? 0)}</span>}
              </div>
              {lineHasRange(line) && (
                <div style={{ fontSize: 12, marginTop: 8, padding: "6px 8px", background: "var(--paper)", borderRadius: 6, color: "var(--ink)" }}>
                  Working ROM allowance <span style={{ color: "var(--muted)" }}>(Oasis cost)</span>: <strong>{fmt(line.allowanceLow!)}–{fmt(line.allowanceHigh!)}</strong>
                  {line.markupModel === "passthrough" && <> · +{line.markupPct}% → <strong>{fmt(lineLow(line))}–{fmt(lineHigh(line))}</strong></>}
                </div>
              )}
              {lineDelta(line) !== 0 && <div style={{ fontSize: 12, marginTop: 6, color: "var(--muted)" }}>Pre-lock movement: {fmt(lineStart(line))} → {fmt(lineBase(line))}</div>}
            </div>
            <div>
              <Label>Cost owner &amp; markup</Label>
              <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
                <select value={line.owner} disabled={ro} onChange={(e) => store.updateCostLine(line.id, { owner: e.target.value as CostOwner })}>
                  <option value="builder">Builder-carried</option>
                  <option value="owner">Owner-carried</option>
                </select>
                <select value={line.markupModel} disabled={ro || line.locked} onChange={(e) => store.updateCostLine(line.id, { markupModel: e.target.value as MarkupModel })}>
                  <option value="passthrough">Pass-through + markup</option>
                  <option value="blackbox">Black-box (fee included)</option>
                </select>
                {line.markupModel === "passthrough" && (
                  line.owner === "builder"
                    ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5 }}><strong>{line.markupPct}%</strong> <span style={{ color: "var(--muted)", fontSize: 11.5 }}>· builder markup, managed globally above</span></span>
                    : <NumInput value={line.markupPct} disabled={ro || line.locked} onCommit={(v) => store.updateCostLine(line.id, { markupPct: v })} width={56} suffix="%" align="left" />
                )}
              </div>
              {line.locked && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>Locked — adjust via change orders above.</div>}
            </div>
          </div>

          <Label style={{ marginTop: 14 }}>Rooms included</Label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            {db.rooms.map((r) => {
              const on = line.roomIds.includes(r.id);
              return <button key={r.id} disabled={ro} onClick={() => store.toggleRoomOnLine(line.id, r.id)} className="btn btn-sm" style={{ background: on ? "var(--sage)" : "var(--paper)", color: on ? "#fff" : "var(--muted)", borderColor: on ? "var(--sage)" : "var(--line)" }}>{on ? "✓ " : ""}{r.name}</button>;
            })}
          </div>

          <LinePhotos line={line} ro={ro} />
        </div>
      )}
    </div>
  );
}

// Capture photos while defining scope — each becomes a project photo artifact
// tagged to this line (and optionally to an architectural drawing).
function LinePhotos({ line, ro }: { line: CostLine; ro: boolean }) {
  const store = useStore();
  const db = store.db;
  const by = store.session.displayName;
  const fileRef = useRef<HTMLInputElement>(null);
  const [room, setRoom] = useState<string>(line.roomIds[0] ?? "");
  const [draw, setDraw] = useState<string>("");
  const photos = db.artifacts.filter((a) => a.kind === "photo" && a.lineId === line.id);
  const drawings = db.artifacts.filter((a) => a.kind === "drawing");

  const upload = async (f: File) => {
    const url = await fileToDataURL(f);
    store.addLinePhoto({ lineId: line.id, roomId: room || undefined, dataUrl: url, name: `${line.name} — ${new Date().toLocaleDateString()}`, linkedDrawingId: draw || undefined, by });
  };
  const { over, dropProps } = useFileDrop((files) => files.forEach((f) => void upload(f)), { accept: (f) => f.type.startsWith("image/"), disabled: ro });

  return (
    <div style={{ marginTop: 14 }}>
      <Label>Scope photos</Label>
      <div {...dropProps} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6, padding: ro ? 0 : 8, borderRadius: 8, border: ro ? "none" : `1.5px dashed ${over ? "var(--sage)" : "var(--line)"}`, background: over ? "var(--sage-tint)" : "transparent", minHeight: ro ? 0 : 40, alignItems: "center" }}>
        {!ro && !over && photos.length === 0 && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Drag &amp; drop photos here, or use the button below.</span>}
        {photos.map((p) => {
          const src = p.versions?.[0]?.fileUrl;
          return src ? <img key={p.id} src={src} alt={p.name} title={p.name} style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)" }} /> : null;
        })}
        {ro && !photos.length && <span style={{ fontSize: 12, color: "var(--muted)" }}>No photos yet.</span>}
      </div>
      {!ro && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
          <button className="btn btn-sm btn-primary" onClick={() => fileRef.current?.click()}>📷 Take / upload photo</button>
          <select value={room} onChange={(e) => setRoom(e.target.value)} style={{ fontSize: 12 }}>
            <option value="">no room</option>
            {(line.roomIds.length ? db.rooms.filter((r) => line.roomIds.includes(r.id)) : db.rooms).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          {drawings.length > 0 && (
            <select value={draw} onChange={(e) => setDraw(e.target.value)} title="Tag this photo to a drawing" style={{ fontSize: 12 }}>
              <option value="">no drawing tag</option>
              {drawings.map((d) => <option key={d.id} value={d.id}>tag → {d.name}</option>)}
            </select>
          )}
          <Link href="/artifacts" className="btn btn-sm">View in Artifacts →</Link>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function ContractDoc({ line, ro }: { line: CostLine; ro: boolean }) {
  const store = useStore();
  const db = store.db;
  const [openDoc, setOpenDoc] = useState(false);
  const terms = db.contracts.find((c) => c.id === line.contractId)?.terms ?? MASTER_TERMS;
  return (
    <div className="card" style={{ padding: 12, marginTop: 10, background: "var(--paper)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Label>Scope Details</Label>
        <select value={line.contractMode ?? "appendix"} disabled={ro} onChange={(e) => store.setLineContract(line.id, { contractMode: e.target.value as "direct" | "appendix" })} style={{ fontSize: 12 }}>
          <option value="direct">Direct contract with trade</option>
          <option value="appendix">Appendix to builder&apos;s paper</option>
        </select>
        <label style={{ fontSize: 12, color: "var(--muted)", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <input type="checkbox" checked={line.termsAppended ?? true} disabled={ro} onChange={(e) => store.setLineContract(line.id, { termsAppended: e.target.checked })} /> append T&amp;Cs
        </label>
        <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => setOpenDoc((v) => !v)}>{openDoc ? "Hide" : "Preview"} document</button>
      </div>
      <textarea value={line.contractSummary ?? ""} disabled={ro} placeholder="Scope of work summary for this line's contract…"
        onChange={(e) => store.setLineContract(line.id, { contractSummary: e.target.value })}
        style={{ width: "100%", marginTop: 8, minHeight: 56, fontSize: 12.5, resize: "vertical" }} />
      {openDoc && (
        <div style={{ marginTop: 10, padding: 12, border: "1px solid var(--line)", borderRadius: 8, background: "var(--cream)", fontSize: 12.5 }}>
          <div style={{ fontWeight: 700, fontFamily: "var(--font-serif)", fontSize: 14 }}>{line.contractMode === "direct" ? "Trade Contract" : "Contract Appendix"} — {line.name}</div>
          <div style={{ color: "var(--muted)", margin: "2px 0 8px" }}>{db.project.address} · {db.contracts.find((c) => c.id === line.contractId)?.name ?? "Vendor TBD"}</div>
          <div style={{ fontWeight: 600 }}>Scope of work</div>
          <p style={{ whiteSpace: "pre-wrap", margin: "2px 0 8px" }}>{line.contractSummary || "—"}</p>
          <div style={{ fontWeight: 600 }}>Contract value</div>
          <p style={{ margin: "2px 0 8px" }}>{fmt(lineCurrent(line))} {line.markupModel === "passthrough" ? `(incl. ${line.markupPct}% builder markup)` : "(fee included)"}</p>
          {(line.termsAppended ?? true) && (<><div style={{ fontWeight: 600 }}>Terms &amp; conditions</div><p style={{ whiteSpace: "pre-wrap", margin: "2px 0 8px", color: "var(--muted)" }}>{terms}</p></>)}
          {line.changeOrders.length > 0 && (<><div style={{ fontWeight: 600 }}>Exhibits</div><ul style={{ margin: "2px 0 0", paddingLeft: 18, color: "var(--muted)" }}>{line.changeOrders.map((c) => <li key={c.id}>{c.exhibit}: {c.title} — {c.kind === "savings" ? "−" : "+"}{fmt(c.amount)} ({c.status})</li>)}</ul></>)}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function ChangeOrders({ line, ro }: { line: CostLine; ro: boolean }) {
  const store = useStore();
  const [adding, setAdding] = useState<null | "change" | "savings">(null);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const submit = () => {
    if (!title.trim() || !amount) return;
    store.addChangeOrder(line.id, { kind: adding!, title: title.trim(), desc: desc.trim(), amount: Number(amount), date: new Date().toISOString().slice(0, 10), status: "proposed" });
    setTitle(""); setAmount(""); setDesc(""); setAdding(null);
  };
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Label>Change orders &amp; savings (contract exhibits)</Label>
        {!ro && <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button className="btn btn-sm" onClick={() => setAdding(adding === "change" ? null : "change")}>+ Change order</button>
          <button className="btn btn-sm" onClick={() => setAdding(adding === "savings" ? null : "savings")} style={{ color: "var(--ok)" }}>+ Saving</button>
        </div>}
      </div>
      {line.changeOrders.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
          {line.changeOrders.map((co) => (
            <div key={co.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12.5, background: "var(--paper)" }}>
              <Pill color="var(--brass-2)" bg="#f0e6cd">{co.exhibit}</Pill>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{co.title}</div>
                {co.desc && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{co.desc}</div>}
              </div>
              <span style={{ fontWeight: 700, color: co.kind === "savings" ? "var(--ok)" : "var(--rust)" }}>{co.kind === "savings" ? "−" : "+"}{fmt(co.amount)}</span>
              {co.status === "approved" ? <Pill color="#fff" bg="var(--ok)">approved</Pill>
                : !ro ? <button className="btn btn-sm" onClick={() => store.updateChangeOrder(line.id, co.id, { status: "approved" })}>Approve</button>
                : <Pill color="var(--muted)">proposed</Pill>}
              {!ro && <button className="btn btn-sm" style={{ color: "var(--rust)" }} onClick={() => store.removeChangeOrder(line.id, co.id)}>✕</button>}
            </div>
          ))}
        </div>
      )}
      {adding && !ro && (
        <div className="card" style={{ padding: 10, marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", background: "var(--paper)" }}>
          <strong style={{ fontSize: 12.5, color: adding === "savings" ? "var(--ok)" : "var(--rust)" }}>{adding === "savings" ? "New saving" : "New change order"}</strong>
          <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
          <input placeholder="$ amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 110 }} />
          <input placeholder="Detail (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
          <button className="btn btn-primary" onClick={submit}>Add</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function Phases({ line, ro }: { line: CostLine; ro: boolean }) {
  const store = useStore();
  const total = phasesTotal(line);
  const current = lineCurrent(line);
  const over = total > current + 0.5;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Label>Payment phases</Label>
        <span style={{ fontSize: 11.5, color: over ? "var(--rust)" : "var(--muted)" }}>{fmt(total)} of {fmt(current)} allocated{over ? " — over budget!" : ""}</span>
        {!ro && <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => store.addLinePhase(line.id, { name: `Phase ${line.phases.length + 1}`, mode: "pct", value: 0 })}>+ Phase</button>}
      </div>
      <div style={{ marginTop: 6 }}><StackBar height={8} segments={[{ value: Math.min(total, current), color: over ? "var(--rust)" : "var(--sage)" }, { value: Math.max(0, current - total), color: "var(--cream-2)" }]} /></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
        {line.phases.map((p) => {
          const locked = false;
          return (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
              <input value={p.name} disabled={ro || locked} onChange={(e) => store.updateLinePhase(line.id, p.id, { name: e.target.value })} style={{ flex: 1, minWidth: 0 }} />
              <select value={p.mode} disabled={ro || locked} onChange={(e) => store.updateLinePhase(line.id, p.id, { mode: e.target.value as LinePhase["mode"] })} style={{ fontSize: 12 }}>
                <option value="pct">%</option>
                <option value="amount">$</option>
              </select>
              <NumInput value={p.value} disabled={ro || locked} onCommit={(v) => store.updateLinePhase(line.id, p.id, { value: v })} width={72} />
              <span style={{ width: 90, textAlign: "right", fontWeight: 700 }}>{fmt(phaseAmount(line, p))}</span>
              {locked ? <Pill color="#fff" bg="var(--ok)">paid</Pill> : !ro && <button className="btn btn-sm" style={{ color: "var(--rust)" }} onClick={() => store.removeLinePhase(line.id, p.id)}>✕</button>}
            </div>
          );
        })}
        {!line.phases.length && <span style={{ fontSize: 12, color: "var(--muted)" }}>No phases yet — split this line into payment phases to group into draws.</span>}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: CostLine["status"] }) {
  const map: Record<CostLine["status"], { c: string; b: string }> = {
    estimate: { c: "var(--muted)", b: "var(--cream-2)" },
    allowance: { c: "var(--brass-2)", b: "#f0e6cd" },
    contracted: { c: "#fff", b: "var(--sage-2)" },
    complete: { c: "#fff", b: "var(--walnut)" },
  };
  return <Pill color={map[status].c} bg={map[status].b}>{status}</Pill>;
}

function PaidPill({ line }: { line: CostLine }) {
  const db = useStore().db;
  const st = linePaidStatus(db, line);
  if (st === "paid") return <Pill color="#fff" bg="var(--ok)">✓ Paid</Pill>;
  if (st === "partial") return <Pill color="var(--brass-2)" bg="#f0e6cd">◐ Part-paid</Pill>;
  return null;
}

// Compact labeled field used in the structured cost row.
function Mini({ label, value, accent, dim, prefix }: { label: string; value: string; accent?: string; dim?: boolean; prefix?: string }) {
  return (
    <div style={{ minWidth: 60, textAlign: "right" }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: dim ? "var(--sc-unset)" : (accent ?? "var(--ink)"), whiteSpace: "nowrap" }}>{prefix ? `${prefix} ` : ""}{value}</div>
    </div>
  );
}

function Cell({ label, children, accent }: { label: string; children: React.ReactNode; accent?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 110, border: "1px solid var(--line)", borderRadius: 8, padding: "7px 10px", background: "#fff" }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: accent ?? "var(--ink)", marginTop: 2 }}>{children}</div>
    </div>
  );
}

// Cost lifecycle for a line: Estimate (Low/High) → Lock → Paid / Remaining.
// Builder/full-admin can lock the cost (pushes to the vendor contract); after that,
// changes flow through change orders only.
function CostPanel({ line, ro }: { line: CostLine; ro: boolean }) {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const canLock = !ro && (role === "builder" || role === "full_admin");
  const locked = isLocked(line);
  const ranged = lineHasRange(line);
  const paid = linePaid(db, line);
  const remaining = lineRemaining(db, line);
  const viaDraws = linePaidByDraws(db, line.id);
  const direct = line.directPaid ?? 0;
  const st = linePaidStatus(db, line);
  const factor = line.markupModel === "passthrough" ? 1 + line.markupPct / 100 : 1;
  const remainingAfterDraws = Math.max(0, lineHigh(line) - viaDraws);

  const [lockOpen, setLockOpen] = useState(false);
  const [lockAmt, setLockAmt] = useState<string>("");

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, margin: "12px 0", background: "var(--paper)", display: "flex", flexDirection: "column", gap: 10 }}>
      {/* cost figures */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {locked ? (
          <Cell label="Locked Cost" accent="var(--ok)">🔒 {fmt(lineCurrent(line))}</Cell>
        ) : ranged ? (
          <>
            <Cell label="Estimated Low">{fmt(lineLow(line))}</Cell>
            <Cell label="Estimated High">{fmt(lineHigh(line))}</Cell>
          </>
        ) : (
          <Cell label="Cost">{fmt(lineCurrent(line))}</Cell>
        )}
        <Cell label="Paid" accent="var(--ok)">{fmt(paid)}</Cell>
        <Cell label="Remaining" accent={remaining > 0 ? "var(--brass-2)" : "var(--ok)"}>{fmt(remaining)}</Cell>
      </div>

      {/* change-order impact (after lock) */}
      {(approvedChanges(line) > 0 || approvedSavings(line) > 0) && (
        <div style={{ fontSize: 12, color: "var(--muted)" }}>Baseline {fmt(lineBaseline(line))}{approvedChanges(line) > 0 && <span style={{ color: "var(--rust)" }}> + COs {fmt(approvedChanges(line))}</span>}{approvedSavings(line) > 0 && <span style={{ color: "var(--ok)" }}> − savings {fmt(approvedSavings(line))}</span>} = current <strong>{fmt(lineCurrent(line))}</strong></div>
      )}

      {/* lock / locked state */}
      {locked ? (
        <div style={{ fontSize: 12, color: "var(--ok)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          🔒 Locked{line.lockedAt ? ` ${line.lockedAt}` : ""}{line.lockedBy ? ` by ${line.lockedBy}` : ""} — in the vendor contract. To change, add a change order below.
          {role === "full_admin" && !ro && <button className="btn btn-sm" style={{ color: "var(--rust)" }} onClick={() => store.unlockLineCost(line.id)}>Unlock</button>}
        </div>
      ) : canLock ? (
        lockOpen ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", background: "var(--cream)", padding: 8, borderRadius: 8 }}>
            <span style={{ fontSize: 12 }}>Lock at (Oasis cost, pre-markup) $</span>
            <input type="number" autoFocus value={lockAmt} onChange={(e) => setLockAmt(e.target.value)} placeholder={String(line.allowanceHigh ?? Math.round(lineBase(line)))} style={{ width: 120 }} />
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{line.markupModel === "passthrough" ? `→ ${fmt((Number(lockAmt || line.allowanceHigh || lineBase(line))) * factor)} incl. ${line.markupPct}% markup` : "fee included"}</span>
            <button className="btn btn-sm btn-primary" onClick={() => { const amt = Number(lockAmt || line.allowanceHigh || lineBase(line)); store.lockLineCost(line.id, amt); setLockOpen(false); setLockAmt(""); }}>🔒 Lock &amp; push to contract</button>
            <button className="btn btn-sm" onClick={() => setLockOpen(false)}>Cancel</button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn btn-sm btn-primary" onClick={() => { setLockAmt(String(line.allowanceHigh ?? Math.round(lineBase(line)))); setLockOpen(true); }}>🔒 Lock cost</button>
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Locks the agreed price &amp; pushes it to the vendor contract. Changes after that need a change order.</span>
          </div>
        )
      ) : (
        <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{ranged ? "Estimate not yet locked — a builder/admin locks the agreed cost." : "Only a builder or full admin can lock this cost."}</div>
      )}

      {/* payment */}
      <div style={{ borderTop: "1px dashed var(--line)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", gap: 12, fontSize: 12, flexWrap: "wrap", alignItems: "center" }}>
          {st === "paid" ? <Pill color="#fff" bg="var(--ok)">✓ Paid in full</Pill> : st === "partial" ? <Pill color="var(--brass-2)" bg="#f0e6cd">◐ Partially paid</Pill> : <Pill color="var(--muted)">Unpaid</Pill>}
          <span>Via draws <strong>{fmt(viaDraws)}</strong> <Link href="/payments" style={{ color: "var(--sage-2)" }}>↗</Link></span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>Paid directly <NumInput value={direct || 0} disabled={ro} money onCommit={(v) => store.setLineDirectPaid(line.id, v, line.directPaidNote)} width={96} style={{ fontSize: 12 }} />{line.directPaidDate && <span style={{ color: "var(--muted)" }}>· {line.directPaidDate}</span>}</span>
        </div>
        {!ro && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {st !== "paid" && <button className="btn btn-sm" onClick={() => store.setLineDirectPaid(line.id, remainingAfterDraws, line.directPaidNote)}>💵 Mark paid directly</button>}
            {direct > 0 && <button className="btn btn-sm" onClick={() => store.setLineDirectPaid(line.id, 0)}>Clear direct</button>}
            <input disabled={ro} value={line.directPaidNote ?? ""} placeholder="Payment note (paid by owner, check #…)" onChange={(e) => store.setLineDirectPaid(line.id, direct, e.target.value)} style={{ flex: 1, minWidth: 160, fontSize: 12 }} />
          </div>
        )}
      </div>
    </div>
  );
}

function Label({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)", ...style }}>{children}</div>;
}

// Builder markup — one rate across all builder-managed pass-through lines.
function BuilderMarkupControl() {
  const store = useStore();
  const db = store.db;
  const pct = db.project.builderMarkupPct ?? 20;
  const count = db.costLines.filter((l) => l.owner === "builder" && l.markupModel === "passthrough").length;
  return (
    <div className="card" style={{ padding: 12, marginTop: 14, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", borderLeft: "3px solid var(--sage)" }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <strong style={{ fontSize: 13.5 }}>Builder markup</strong>
        <div style={{ fontSize: 12.5, color: "var(--muted)" }}>One markup applied across all {count} builder-managed pass-through lines. Set it once — it’s the same for every vendor you manage.</div>
      </div>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <NumInput value={pct} onCommit={(v) => store.setBuilderMarkup(v)} width={70} style={{ fontSize: 18, fontWeight: 700, color: "var(--brass-2)" }} />
        <span style={{ fontWeight: 700, color: "var(--brass-2)", fontSize: 16 }}>%</span>
      </span>
    </div>
  );
}

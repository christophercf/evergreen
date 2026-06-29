"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/data/hooks";
import { PageHeader, NoAccess, Pill, SectionTitle, Money, StatCard, StackBar } from "../ui/bits";
import { MASTER_TERMS } from "@/lib/data/seed";
import { accessFor, type CostLine, type CostOwner, type LinePhase, type MarkupModel, type MacroCategory, type RoomFloor } from "@/lib/data/types";
import {
  lineBase, lineStart, lineDelta, totals, byCategory, byTrade,
  lineBaseline, lineCurrent, approvedChanges, approvedSavings, approvedNetChange,
  phaseAmount, phasesTotal, tradeName, MACRO_ORDER, MACRO_COLOR, fmt,
} from "@/lib/data/money";
import { fileToDataURL } from "../ui/upload";

type GroupBy = "category" | "trade" | "owner";

export default function CostsPage() {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const user = store.currentUser;
  const access = accessFor(user, role, "costs");
  const [group, setGroup] = useState<GroupBy>("category");
  const [aiFor, setAiFor] = useState<string | null>(null);

  if (access === "none") return <NoAccess module="Building Costs" />;
  const ro = access !== "edit";

  const t = totals(db.costLines);
  const buffer = (t.grand * db.project.bufferPct) / 100;
  const netChange = t.grand - t.baseline;
  const anyUnlocked = db.costLines.some((l) => !l.locked);
  const groups = groupLines(db.costLines, group, db);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const allCollapsed = groups.length > 0 && groups.every((g) => collapsed.has(g.key));
  const toggleGroup = (k: string) => setCollapsed((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(groups.map((g) => g.key)));

  return (
    <>
      <PageHeader
        title="Building Costs"
        subtitle="The locked baseline is your original budget. Every change flows through a change order (a numbered exhibit on that line's contract), so the owner can always see budget → current and where savings were found."
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {ro && <Pill color="var(--muted)">View only</Pill>}
            <Link href="/timing" className="btn btn-sm">Timing →</Link>
            <Link href="/payments" className="btn btn-sm">Payments →</Link>
          </div>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))", gap: 12, marginTop: 16 }}>
        <StatCard label="Baseline Budget" value={<Money value={t.baseline} />} sub="locked original" />
        <StatCard label="Current Total" value={<Money value={t.grand} />} accent="var(--brass-2)" sub={netChange ? `${netChange > 0 ? "▲" : "▼"} ${fmt(Math.abs(netChange))} vs baseline` : "on budget"} />
        <StatCard label="Change Orders" value={<Money value={db.costLines.reduce((a, l) => a + approvedChanges(l), 0)} />} accent="var(--rust)" sub="approved adds" />
        <StatCard label="Savings Found" value={<Money value={db.costLines.reduce((a, l) => a + approvedSavings(l), 0)} />} accent="var(--ok)" sub="approved credits" />
        <StatCard label={`+${db.project.bufferPct}% Buffer`} value={<Money value={t.grand + buffer} />} sub={`buffer ${fmt(buffer)}`} />
      </div>

      {anyUnlocked && !ro && (
        <div className="card" style={{ padding: 14, marginTop: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", borderLeft: "3px solid var(--brass)" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <strong style={{ fontSize: 13.5 }}>Lock the baseline</strong>
            <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Freeze today's totals as the original budget. After locking, costs only move through change orders.</div>
          </div>
          <button className="btn btn-primary" onClick={() => store.lockBaseline()}>🔒 Lock current costs as baseline</button>
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

      {!ro && <AddRoomCard />}

      <SectionTitle right={
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button className="btn btn-sm" onClick={toggleAll}>{allCollapsed ? "Expand all" : "Collapse all"}</button>
          {(["category", "trade", "owner"] as GroupBy[]).map((g) => (
            <button key={g} className="btn btn-sm" onClick={() => setGroup(g)} style={{ background: group === g ? "var(--sage-tint)" : undefined, fontWeight: 700 }}>by {g}</button>
          ))}
        </div>
      }>
        Cost Lines
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
                  {grp.lines.map((l, i) => (<CostRow key={l.id} line={l} ro={ro} first={i === 0} onAi={() => setAiFor(l.id)} />))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {aiFor && <AiModal line={db.costLines.find((l) => l.id === aiFor)!} onClose={() => setAiFor(null)} />}
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

// ---------------------------------------------------------------------------
// Cumulative cost over the project timeline, stacked by category, building to
// the budget. Approved change orders accrue at their date so their impact shows.
function CostChart() {
  const store = useStore();
  const db = store.db;
  const monthIdx = (d: string) => { const dt = new Date(`${d}T00:00:00`); return dt.getFullYear() * 12 + dt.getMonth(); };
  const fmtMonth = (idx: number) => new Date(Math.floor(idx / 12), idx % 12, 1).toLocaleString("en-US", { month: "short", year: "2-digit" });

  // When each line "lands" = latest scheduled end for its trade (else project start).
  const endIdxOf = (l: CostLine) => {
    const ends = db.schedule.filter((s) => s.tradeId === l.tradeId).map((s) => monthIdx(s.end));
    return ends.length ? Math.max(...ends) : null;
  };
  const sIdx = db.schedule.map((s) => monthIdx(s.start));
  const coIdx = db.costLines.flatMap((l) => l.changeOrders.filter((c) => c.status === "approved").map((c) => monthIdx(c.date)));
  const first = Math.min(...sIdx, ...coIdx);
  const last = Math.max(...db.schedule.map((s) => monthIdx(s.end)), ...coIdx);
  const months: number[] = [];
  for (let i = first; i <= last; i++) months.push(i);

  const baseTotal = totals(db.costLines).baseline;
  const grand = totals(db.costLines).grand;
  const maxV = Math.max(baseTotal, grand) || 1;

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
        {/* month labels */}
        {months.map((m, i) => <text key={i} x={xAt(i)} y={H - padB + 16} textAnchor="middle" fontSize={9} fill="var(--muted)">{fmtMonth(m)}</text>)}
      </svg>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 6, fontSize: 11 }}>
        {cats.map((c) => <span key={c} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: MACRO_COLOR[c] }} />{c}</span>)}
      </div>
      <p style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>Cumulative cost over time as a stacked area by category, building toward the baseline budget (dashed). Approved change orders lift the curve above the line.</p>
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
function CostRow({ line, ro, first, onAi }: { line: CostLine; ro: boolean; first: boolean; onAi: () => void }) {
  const store = useStore();
  const db = store.db;
  const [open, setOpen] = useState(false);
  const net = approvedNetChange(line);
  const sched = db.schedule.filter((s) => s.tradeId === line.tradeId && s.kind !== "milestone");
  const schedWindow = sched.length ? (() => {
    const f = (d: string) => new Date(`${d}T00:00:00`).toLocaleString("en-US", { month: "short", day: "numeric" });
    return `${f(sched.map((s) => s.start).sort()[0])} – ${f(sched.map((s) => s.end).sort().slice(-1)[0])}`;
  })() : null;

  return (
    <div style={{ borderTop: first ? undefined : "1px solid var(--line)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", cursor: "pointer" }} onClick={() => setOpen((v) => !v)}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{line.name}</span>
            <Pill color="#fff" bg={line.owner === "owner" ? "var(--brass)" : "var(--sage)"}>{line.owner}</Pill>
            {line.locked ? <Pill color="var(--walnut)" bg="var(--cream-2)">🔒 baseline</Pill> : <StatusPill status={line.status} />}
            {line.changeOrders.length > 0 && <Pill color="var(--brass-2)" bg="#f0e6cd">{line.changeOrders.length} exhibit{line.changeOrders.length === 1 ? "" : "s"}</Pill>}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
            {tradeName(db, line.tradeId)} · {line.roomIds.length === 0 ? "whole project" : `${line.roomIds.length} room${line.roomIds.length === 1 ? "" : "s"}`}
            {line.markupModel === "passthrough" ? ` · +${line.markupPct}% markup` : " · fee included"}
            {schedWindow && <> · <span style={{ color: "var(--sage-2)" }}>🗓 {schedWindow}</span></>}
          </div>
        </div>
        {net !== 0 && <span style={{ fontSize: 11.5, fontWeight: 700, color: net > 0 ? "var(--rust)" : "var(--ok)" }}>{net > 0 ? "▲" : "▼"} {fmt(Math.abs(net))}</span>}
        <div style={{ textAlign: "right", minWidth: 96 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5 }}><Money value={lineCurrent(line)} /></div>
          {net !== 0 && <div style={{ fontSize: 11, color: "var(--muted)" }}>base {fmt(lineBaseline(line))}</div>}
        </div>
      </div>

      {open && (
        <div style={{ padding: "4px 14px 16px", background: "var(--cream)", borderTop: "1px dashed var(--line)" }}>
          {/* Budget tracking */}
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", margin: "12px 0", fontSize: 13 }}>
            <span>Baseline <strong>{fmt(lineBaseline(line))}</strong></span>
            {approvedChanges(line) > 0 && <span style={{ color: "var(--rust)" }}>+ changes {fmt(approvedChanges(line))}</span>}
            {approvedSavings(line) > 0 && <span style={{ color: "var(--ok)" }}>− savings {fmt(approvedSavings(line))}</span>}
            <span>= current <strong style={{ color: "var(--brass-2)" }}>{fmt(lineCurrent(line))}</strong></span>
          </div>

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
                {line.markupModel === "passthrough" && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><input type="number" value={line.markupPct} disabled={ro || line.locked} onChange={(e) => store.updateCostLine(line.id, { markupPct: Number(e.target.value) })} style={{ width: 56 }} />%</span>}
              </div>
              {line.locked && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>Baseline locked — adjust via change orders above.</div>}
              <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={onAi}>✨ AI: find this cheapest</button>
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

  return (
    <div style={{ marginTop: 14 }}>
      <Label>Scope photos</Label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
        {photos.map((p) => {
          const src = p.versions?.[0]?.fileUrl;
          return src ? <img key={p.id} src={src} alt={p.name} title={p.name} style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)" }} /> : null;
        })}
        {!photos.length && <span style={{ fontSize: 12, color: "var(--muted)" }}>No photos yet.</span>}
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
        <Label>Line contract</Label>
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
              <input type="number" value={p.value} disabled={ro || locked} onChange={(e) => store.updateLinePhase(line.id, p.id, { value: Number(e.target.value) })} style={{ width: 72, textAlign: "right" }} />
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

function Label({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)", ...style }}>{children}</div>;
}

// ---------------------------------------------------------------------------
function AiModal({ line, onClose }: { line: CostLine; onClose: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(44,36,28,.45)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div className="card" style={{ maxWidth: 520, width: "100%", padding: 22 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--brass)" }}>✨</span>
          <h3 className="serif" style={{ fontSize: 18, fontWeight: 700, color: "var(--walnut)" }}>AI sourcing — {line.name}</h3>
        </div>
        <div style={{ marginTop: 8, padding: "8px 10px", background: "#f0e6cd", borderRadius: 8, fontSize: 12, color: "var(--brass-2)" }}>Placeholder result — wired but not yet connected to a live model.</div>
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
          {[{ v: "Build.com", p: "$1,180", note: "free ship, in stock" }, { v: "Ferguson", p: "$1,240", note: "matches spec link" }, { v: "Wayfair", p: "$1,295", note: "−10% w/ code" }].map((r) => (
            <div key={r.v} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 }}>
              <span><strong>{r.v}</strong> <span style={{ color: "var(--muted)" }}>· {r.note}</span></span><strong>{r.p}</strong>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 12 }}>Will also surface local &amp; federal rebates / tax incentives for qualifying products.</div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}><button className="btn btn-primary" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

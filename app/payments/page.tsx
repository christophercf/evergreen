"use client";

import { useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/data/hooks";
import { PageHeader, NoAccess, Pill, SectionTitle, Money, StatCard, StackBar } from "../ui/bits";
import { accessFor, type Draw } from "@/lib/data/types";
import { totals, drawAmount, lineCurrent, lineDrawn, allocationAmount, tradeName, fmt } from "@/lib/data/money";

const STATUS_BG: Record<Draw["status"], string> = { planned: "var(--sc-unset)", pushed: "var(--brass)", paid: "var(--ok)" };

export default function PaymentsPage() {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const user = store.currentUser;
  const access = accessFor(user, role, "payments");
  const [dragLine, setDragLine] = useState<string | null>(null);
  if (access === "none") return <NoAccess module="the Payment Tracker" />;
  const ro = access !== "edit";

  const t = totals(db.costLines);
  const allocated = db.draws.reduce((a, d) => a + drawAmount(db, d), 0);
  const paid = db.draws.filter((d) => d.status === "paid").reduce((a, d) => a + drawAmount(db, d), 0);
  const unallocated = Math.max(0, t.grand - allocated);

  const lines = [...db.costLines].filter((l) => lineCurrent(l) > 0).sort((a, b) => a.category.localeCompare(b.category) || lineCurrent(b) - lineCurrent(a));

  return (
    <>
      <PageHeader
        title="Payment Tracker"
        subtitle="Drag budget lines into draws, set each line's share (% or flat $), then push a draw to issue the first round of trade contracts. The budget on the left tracks total → drawn → remaining live."
        right={<div style={{ display: "flex", gap: 8 }}>{ro && <Pill color="var(--muted)">View only</Pill>}<Link href="/costs" className="btn btn-sm">Building Costs →</Link></div>}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px,1fr))", gap: 12, marginTop: 16 }}>
        <StatCard label="Contract Value" value={<Money value={t.grand} />} sub="current, all lines" />
        <StatCard label="Allocated to Draws" value={<Money value={allocated} />} accent="var(--brass-2)" sub={`${Math.round((allocated / (t.grand || 1)) * 100)}% of budget`} />
        <StatCard label="Paid" value={<Money value={paid} />} accent="var(--ok)" sub={`${db.draws.filter((d) => d.status === "paid").length} draw(s)`} />
        <StatCard label="Unallocated" value={<Money value={unallocated} />} sub="not yet in a draw" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 360px) 1fr", gap: 16, marginTop: 18, alignItems: "start" }} className="ever-pay">
        {/* LEFT: budget modules */}
        <div>
          <SectionTitle>Budget</SectionTitle>
          <div className="card" style={{ padding: 10, maxHeight: "70vh", overflow: "auto" }}>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 8 }}>{ro ? "Lines and their draw status." : "Drag a line into a draw →"}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {lines.map((l) => {
                const total = lineCurrent(l);
                const drawn = lineDrawn(db, l.id);
                const rem = total - drawn;
                return (
                  <div key={l.id}
                    draggable={!ro}
                    onDragStart={(e) => { e.dataTransfer.setData("text/plain", l.id); setDragLine(l.id); }}
                    onDragEnd={() => setDragLine(null)}
                    className="card"
                    style={{ padding: "8px 10px", cursor: ro ? "default" : "grab", opacity: dragLine === l.id ? 0.5 : 1, background: "var(--paper)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {!ro && <span style={{ color: "var(--muted)", fontSize: 13 }}>⋮⋮</span>}
                      <span style={{ fontWeight: 600, fontSize: 12.5, flex: 1 }}>{l.name}</span>
                    </div>
                    <div style={{ display: "flex", gap: 8, fontSize: 11, color: "var(--muted)", marginTop: 3, paddingLeft: ro ? 0 : 19 }}>
                      <span>Total <strong style={{ color: "var(--ink)" }}>{fmt(total)}</strong></span>
                      <span>Drawn <strong style={{ color: "var(--brass-2)" }}>{fmt(drawn)}</strong></span>
                      <span>Left <strong style={{ color: rem > 0 ? "var(--ink)" : "var(--ok)" }}>{fmt(rem)}</strong></span>
                    </div>
                    <div style={{ marginTop: 4, paddingLeft: ro ? 0 : 19 }}><StackBar height={5} segments={[{ value: drawn, color: "var(--brass)" }, { value: Math.max(0, rem), color: "var(--cream-2)" }]} /></div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* RIGHT: draws */}
        <div>
          <SectionTitle right={!ro ? <button className="btn btn-primary btn-sm" onClick={() => store.addDraw(`Draw ${db.draws.length + 1}`)}>+ Add draw</button> : undefined}>Draws</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
            {db.draws.map((d) => <DrawCard key={d.id} draw={d} ro={ro} />)}
          </div>
        </div>
      </div>

      <style>{`@media (max-width: 820px){ .ever-pay{ grid-template-columns: 1fr !important; } }`}</style>
    </>
  );
}

function DrawCard({ draw, ro }: { draw: Draw; ro: boolean }) {
  const store = useStore();
  const db = store.db;
  const [over, setOver] = useState(false);
  const total = drawAmount(db, draw);
  const locked = draw.status === "paid";

  return (
    <div
      onDragOver={(e) => { if (!ro && !locked) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const id = e.dataTransfer.getData("text/plain"); if (id) store.addAllocation(draw.id, id); }}
      className="card"
      style={{ padding: 14, borderLeft: `3px solid ${STATUS_BG[draw.status]}`, outline: over ? "2px dashed var(--sage)" : "none", background: over ? "var(--sage-tint)" : undefined }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <input value={draw.name} disabled={ro || locked} onChange={(e) => store.renameDraw(draw.id, e.target.value)} style={{ border: "none", background: "transparent", fontWeight: 700, fontSize: 15, fontFamily: "var(--font-serif)", color: "var(--walnut)", minWidth: 120, flex: 1 }} />
        <Pill color="#fff" bg={STATUS_BG[draw.status]}>{draw.status}{draw.paidDate ? ` · ${draw.paidDate}` : draw.pushedDate ? ` · ${draw.pushedDate}` : ""}</Pill>
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "var(--font-serif)", margin: "4px 0 8px" }}><Money value={total} /></div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {draw.allocations.map((a) => {
          const l = db.costLines.find((x) => x.id === a.lineId);
          if (!l) return null;
          return (
            <div key={a.lineId} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, borderBottom: "1px solid var(--line)", paddingBottom: 5 }}>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
              {!ro && !locked ? (
                <>
                  <select value={a.mode} onChange={(e) => store.setAllocation(draw.id, a.lineId, { mode: e.target.value as "pct" | "flat" })} style={{ fontSize: 11, padding: "1px 3px" }}>
                    <option value="pct">%</option><option value="flat">$</option>
                  </select>
                  <input type="number" value={a.value} onChange={(e) => store.setAllocation(draw.id, a.lineId, { value: Number(e.target.value) })} style={{ width: 56, fontSize: 11, textAlign: "right" }} />
                </>
              ) : <span style={{ color: "var(--muted)" }}>{a.mode === "pct" ? `${a.value}%` : "$"}</span>}
              <span style={{ width: 72, textAlign: "right", fontWeight: 700 }}>{fmt(allocationAmount(l, a))}</span>
              {!ro && !locked && <button className="btn btn-sm" style={{ color: "var(--rust)", padding: "1px 6px" }} onClick={() => store.removeAllocation(draw.id, a.lineId)}>✕</button>}
            </div>
          );
        })}
        {!draw.allocations.length && <div style={{ fontSize: 12, color: "var(--muted)", padding: "10px 0", textAlign: "center", border: "1px dashed var(--line)", borderRadius: 8 }}>{ro ? "No lines." : "Drag budget lines here"}</div>}
      </div>

      {!ro && (
        <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
          {draw.status === "planned" && <PushButton draw={draw} />}
          {draw.status === "pushed" && <button className="btn btn-sm btn-primary" onClick={() => store.setDrawStatus(draw.id, "paid")}>Mark paid 🔒</button>}
          {!locked && <button className="btn btn-sm" style={{ color: "var(--rust)", marginLeft: "auto" }} onClick={() => store.removeDraw(draw.id)}>Delete</button>}
        </div>
      )}
      {locked && <div style={{ fontSize: 11.5, color: "var(--ok)", marginTop: 8 }}>🔒 Paid {draw.paidDate} — locked. Cost growth needs a new draw.</div>}
      {draw.status === "pushed" && <div style={{ fontSize: 11.5, color: "var(--brass-2)", marginTop: 8 }}>📄 Contracts issued — see Vendor Management for signatures.</div>}
    </div>
  );
}

function PushButton({ draw }: { draw: Draw }) {
  const store = useStore();
  const name = store.session.displayName;
  const [done, setDone] = useState(false);
  return (
    <button className="btn btn-sm btn-primary" disabled={!draw.allocations.length} onClick={() => { const r = store.pushDraw(draw.id, name); setDone(true); void r; }}>
      {done ? "✓ Pushed" : "Push → issue contracts"}
    </button>
  );
}

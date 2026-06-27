"use client";

import { useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/data/hooks";
import { PageHeader, NoAccess, Pill, SectionTitle, Money, StatCard, StackBar } from "../ui/bits";
import { accessFor, type Draw } from "@/lib/data/types";
import { totals, drawAmount, phaseAmount, lineCurrent, tradeName, fmt } from "@/lib/data/money";

const STATUS_BG: Record<Draw["status"], string> = { planned: "var(--sc-unset)", invoiced: "var(--brass)", paid: "var(--ok)" };
const NEXT: Record<Draw["status"], Draw["status"]> = { planned: "invoiced", invoiced: "paid", paid: "paid" };

export default function PaymentsPage() {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const user = store.currentUser;
  const access = accessFor(user, role, "payments");
  if (access === "none") return <NoAccess module="the Payment Tracker" />;
  const ro = access !== "edit";

  const t = totals(db.costLines);
  const paid = db.draws.filter((d) => d.status === "paid").reduce((a, d) => a + drawAmount(db, d), 0);
  const invoiced = db.draws.filter((d) => d.status === "invoiced").reduce((a, d) => a + drawAmount(db, d), 0);
  const planned = db.draws.filter((d) => d.status === "planned").reduce((a, d) => a + drawAmount(db, d), 0);
  const remaining = Math.max(0, t.grand - paid);

  // phases already attached to any draw
  const assigned = new Set(db.draws.flatMap((d) => d.phaseRefs.map((r) => `${r.lineId}:${r.phaseId}`)));

  return (
    <>
      <PageHeader
        title="Payment Tracker"
        subtitle="Bundle line phases into draws — the client payments that fund the work. Once a draw is paid, those amounts lock in (lines can still grow through change orders, funded by later draws)."
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {ro && <Pill color="var(--muted)">View only</Pill>}
            <Link href="/costs" className="btn btn-sm">Building Costs →</Link>
          </div>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px,1fr))", gap: 12, marginTop: 16 }}>
        <StatCard label="Contract Value" value={<Money value={t.grand} />} sub="current, all lines" />
        <StatCard label="Paid to Date" value={<Money value={paid} />} accent="var(--ok)" sub={`${db.draws.filter((d) => d.status === "paid").length} draw(s)`} />
        <StatCard label="In Pipeline" value={<Money value={invoiced + planned} />} sub={`${fmt(invoiced)} invoiced · ${fmt(planned)} planned`} />
        <StatCard label="Remaining" value={<Money value={remaining} />} accent="var(--brass-2)" sub="not yet paid" />
      </div>

      <div className="card" style={{ padding: 16, marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 8 }}>
          <span style={{ color: "var(--muted)" }}>Paid vs remaining</span>
          <span style={{ fontWeight: 700 }}>{Math.round((paid / (t.grand || 1)) * 100)}% funded</span>
        </div>
        <StackBar height={16} segments={[{ value: paid, color: "var(--ok)" }, { value: invoiced, color: "var(--brass)" }, { value: Math.max(0, remaining - invoiced), color: "var(--cream-2)" }]} />
        <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 11.5, color: "var(--muted)" }}>
          <span>▮ paid</span><span style={{ color: "var(--brass-2)" }}>▮ invoiced</span><span>▮ remaining</span>
        </div>
      </div>

      <SectionTitle right={!ro ? <button className="btn btn-primary btn-sm" onClick={() => store.addDraw(`Draw ${db.draws.length + 1}`)}>+ New draw</button> : undefined}>Draws</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {db.draws.map((d) => <DrawCard key={d.id} draw={d} ro={ro} assigned={assigned} />)}
        {!db.draws.length && <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>No draws yet.</div>}
      </div>

      <SectionTitle>Remaining by Line</SectionTitle>
      <div className="card" style={{ overflow: "auto", maxHeight: "50vh" }}>
        <table style={{ fontSize: 12.5 }}>
          <thead><tr>
            <th style={th}>Line</th><th style={thR}>Current</th><th style={thR}>In draws</th><th style={thR}>Paid</th><th style={thR}>Remaining</th>
          </tr></thead>
          <tbody>
            {db.costLines.filter((l) => lineCurrent(l) > 0).map((l) => {
              const inDraws = db.draws.flatMap((d) => d.phaseRefs.filter((r) => r.lineId === l.id).map((r) => ({ d, r })))
                .reduce((a, { r }) => { const p = l.phases.find((x) => x.id === r.phaseId); return a + (p ? phaseAmount(l, p) : 0); }, 0);
              const paidL = db.draws.filter((d) => d.status === "paid").flatMap((d) => d.phaseRefs.filter((r) => r.lineId === l.id))
                .reduce((a, r) => { const p = l.phases.find((x) => x.id === r.phaseId); return a + (p ? phaseAmount(l, p) : 0); }, 0);
              const rem = lineCurrent(l) - paidL;
              return (
                <tr key={l.id}>
                  <td style={td}>{l.name}<div style={{ fontSize: 11, color: "var(--muted)" }}>{tradeName(db, l.tradeId)}</div></td>
                  <td style={tdR}>{fmt(lineCurrent(l))}</td>
                  <td style={tdR}>{fmt(inDraws)}</td>
                  <td style={{ ...tdR, color: "var(--ok)" }}>{fmt(paidL)}</td>
                  <td style={{ ...tdR, fontWeight: 700 }}>{fmt(rem)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function DrawCard({ draw, ro, assigned }: { draw: Draw; ro: boolean; assigned: Set<string> }) {
  const store = useStore();
  const db = store.db;
  const [adding, setAdding] = useState(false);
  const amount = drawAmount(db, draw);
  const paidLock = draw.status === "paid";

  // Candidate phases to add: any line phase not already in a draw.
  const candidates = db.costLines.flatMap((l) => l.phases.map((p) => ({ l, p }))).filter(({ l, p }) => !assigned.has(`${l.id}:${p.id}`));

  return (
    <div className="card" style={{ padding: 16, borderLeft: `3px solid ${STATUS_BG[draw.status]}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <input value={draw.name} disabled={ro || paidLock} onChange={(e) => store.renameDraw(draw.id, e.target.value)} style={{ border: "none", background: "transparent", fontWeight: 700, fontSize: 16, fontFamily: "var(--font-serif)", color: "var(--walnut)", minWidth: 160 }} />
        <Pill color="#fff" bg={STATUS_BG[draw.status]}>{draw.status}{draw.paidDate ? ` · ${draw.paidDate}` : ""}</Pill>
        <span style={{ marginLeft: "auto", fontWeight: 700, fontSize: 16 }}><Money value={amount} /></span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 10 }}>
        {draw.phaseRefs.map((r) => {
          const l = db.costLines.find((x) => x.id === r.lineId);
          const p = l?.phases.find((x) => x.id === r.phaseId);
          if (!l || !p) return null;
          return (
            <div key={`${r.lineId}:${r.phaseId}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "5px 0", borderBottom: "1px solid var(--line)" }}>
              <span style={{ flex: 1 }}><strong>{l.name}</strong> <span style={{ color: "var(--muted)" }}>· {p.name}</span></span>
              <span style={{ fontWeight: 700 }}>{fmt(phaseAmount(l, p))}</span>
              {!ro && !paidLock && <button className="btn btn-sm" style={{ color: "var(--rust)" }} onClick={() => store.togglePhaseInDraw(draw.id, r.lineId, r.phaseId)}>✕</button>}
            </div>
          );
        })}
        {!draw.phaseRefs.length && <span style={{ fontSize: 12, color: "var(--muted)" }}>No phases in this draw yet.</span>}
      </div>

      {!ro && !paidLock && (
        <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {adding ? (
            <select autoFocus defaultValue="" onChange={(e) => { if (e.target.value) { const [lineId, phaseId] = e.target.value.split("|"); store.togglePhaseInDraw(draw.id, lineId, phaseId); setAdding(false); } }} style={{ minWidth: 240 }}>
              <option value="" disabled>Add a line phase…</option>
              {candidates.map(({ l, p }) => <option key={`${l.id}:${p.id}`} value={`${l.id}|${p.id}`}>{l.name} — {p.name} ({fmt(phaseAmount(l, p))})</option>)}
            </select>
          ) : (
            <button className="btn btn-sm" onClick={() => setAdding(true)}>+ Add phase</button>
          )}
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            {draw.status !== "paid" && <button className="btn btn-sm" onClick={() => store.setDrawStatus(draw.id, NEXT[draw.status])}>Mark {NEXT[draw.status]}{NEXT[draw.status] === "paid" ? " 🔒" : ""}</button>}
            <button className="btn btn-sm" style={{ color: "var(--rust)" }} onClick={() => store.removeDraw(draw.id)}>Delete</button>
          </div>
        </div>
      )}
      {paidLock && <div style={{ fontSize: 11.5, color: "var(--ok)", marginTop: 8 }}>🔒 Paid {draw.paidDate} — these amounts are locked. Cost increases must be funded by a new draw.</div>}
    </div>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: "8px 10px", borderBottom: "2px solid var(--line)", position: "sticky", top: 0, background: "var(--paper)", fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" };
const thR: React.CSSProperties = { ...th, textAlign: "right" };
const td: React.CSSProperties = { padding: "7px 10px", borderBottom: "1px solid var(--line)" };
const tdR: React.CSSProperties = { ...td, textAlign: "right" };

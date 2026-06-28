"use client";

import { useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/data/hooks";
import { PageHeader, NoAccess, Pill, SectionTitle, Money } from "../ui/bits";
import { MASTER_TERMS } from "@/lib/data/seed";
import { accessFor, type VendorAgreement } from "@/lib/data/types";
import { tradeCost, tradeName, allocationAmount, fmt } from "@/lib/data/money";

export default function VendorsPage() {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const user = store.currentUser;
  const access = accessFor(user, role, "vendors");
  if (access === "none") return <NoAccess module="Vendor Management" />;

  const myTrades = role === "trade" ? new Set(user?.tradeIds ?? []) : null;
  const activeTradeIds = Array.from(new Set(db.costLines.map((l) => l.tradeId)))
    .filter((id) => !myTrades || myTrades.has(id))
    .sort((a, b) => tradeCost(db, b) - tradeCost(db, a));

  return (
    <>
      <PageHeader
        title="Vendor Management"
        subtitle="Each trade's roll-up: scope pulled from the Admin matrix, terms applied, the vendor's requested draw parameters, and two rounds of digitally-signed contract — first on scope & cost, then on draw schedule & timeline."
        right={<Link href="/costs" className="btn btn-sm">Building Costs →</Link>}
      />
      <SectionTitle>Vendors &amp; Contracts</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {activeTradeIds.map((tid) => <VendorCard key={tid} tradeId={tid} />)}
      </div>
    </>
  );
}

function VendorCard({ tradeId }: { tradeId: string }) {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const me = store.currentUser;
  const name = store.session.displayName;
  const access = accessFor(me, role, "vendors");
  const ro = access !== "edit";

  const agreement: VendorAgreement = db.vendorAgreements.find((a) => a.tradeId === tradeId) ?? { tradeId, round1: [], round2: [] };
  const vendorUser = db.users.find((u) => u.tradeIds?.includes(tradeId));
  const isAssignedTrade = role === "trade" && !!vendorUser && vendorUser.id === me?.id;
  const canBuilderSign = role === "builder" || role === "full_admin";
  const canTradeSign = isAssignedTrade || role === "full_admin";
  const canEditRequest = !ro || isAssignedTrade;

  const cost = tradeCost(db, tradeId);
  const cells = db.scope.filter((c) => c.tradeId === tradeId && c.status === "in");
  const rooms = cells.map((c) => db.rooms.find((r) => r.id === c.roomId)?.name ?? c.roomId);
  const items = Array.from(new Set(cells.flatMap((c) => c.items.filter((i) => i.included).map((i) => i.label))));
  const terms = db.contracts.find((c) => c.tradeIds.includes(tradeId))?.terms ?? MASTER_TERMS;

  const r1Done = agreement.round1.some((s) => s.party === "builder") && agreement.round1.some((s) => s.party === "trade");
  const r2Done = agreement.round2.some((s) => s.party === "builder") && agreement.round2.some((s) => s.party === "trade");

  // This trade's draw allocations (for round 2 schedule).
  const myLineIds = new Set(db.costLines.filter((l) => l.tradeId === tradeId).map((l) => l.id));
  const drawRows = db.draws.flatMap((d) => d.allocations.filter((a) => myLineIds.has(a.lineId)).map((a) => {
    const l = db.costLines.find((x) => x.id === a.lineId)!;
    return { d, l, amt: allocationAmount(l, a) };
  }));

  const [start, setStart] = useState(agreement.startDate ?? "");
  const [finish, setFinish] = useState(agreement.finishDate ?? "");

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h3 className="serif" style={{ fontSize: 17, fontWeight: 700, color: "var(--walnut)" }}>{tradeName(db, tradeId)}</h3>
        {vendorUser && <Pill bg="var(--cream-2)">{vendorUser.name}</Pill>}
        <Pill color="#fff" bg={r1Done ? "var(--ok)" : "var(--sc-unset)"}>R1 {r1Done ? "executed" : "draft"}</Pill>
        <Pill color="#fff" bg={r2Done ? "var(--ok)" : "var(--sc-unset)"}>R2 {r2Done ? "executed" : "draft"}</Pill>
        <span style={{ marginLeft: "auto", fontWeight: 700, fontSize: 16 }}><Money value={cost} /></span>
      </div>

      {/* Scope from admin */}
      <div style={{ marginTop: 10 }}>
        <Lbl>Scope (from Admin matrix)</Lbl>
        <div style={{ fontSize: 12.5, marginTop: 4 }}>
          {rooms.length ? <><strong>Rooms:</strong> {rooms.join(", ")}</> : <span style={{ color: "var(--muted)" }}>No rooms marked in-scope yet.</span>}
        </div>
        {items.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>{items.map((it) => <Pill key={it} bg="var(--sage-tint)">{it}</Pill>)}</div>}
      </div>

      {/* Draw parameter request */}
      <div style={{ marginTop: 12 }}>
        <Lbl>Vendor draw-parameter request</Lbl>
        <textarea value={agreement.drawRequest ?? ""} disabled={!canEditRequest} placeholder="Vendor: request your preferred draw terms (deposit %, milestones, net terms)…"
          onChange={(e) => store.setVendorDrawRequest(tradeId, e.target.value)} style={{ width: "100%", marginTop: 4, minHeight: 44, fontSize: 12.5, resize: "vertical" }} />
        <div style={{ fontSize: 11.5, color: "var(--muted)" }}>Advises the builder’s <Link href="/payments" style={{ color: "var(--sage-2)", fontWeight: 600 }}>draw schedule</Link>.</div>
      </div>

      {/* Round 1 — scope & cost */}
      <div className="card" style={{ padding: 12, marginTop: 12, background: "var(--paper)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <strong style={{ fontSize: 13 }}>Round 1 — Scope &amp; Total Cost</strong>
          {r1Done && <Pill color="#fff" bg="var(--ok)">executed</Pill>}
        </div>
        <p style={{ fontSize: 12.5, margin: "6px 0", color: "var(--muted)" }}>
          Vendor agrees to the scope above for a total of <strong style={{ color: "var(--ink)" }}>{fmt(cost)}</strong>. Terms &amp; conditions apply.
        </p>
        <details style={{ fontSize: 12, color: "var(--muted)" }}><summary style={{ cursor: "pointer" }}>Terms &amp; conditions</summary><p style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{terms}</p></details>
        <SignRow round={1} agreement={agreement} canBuilder={canBuilderSign && !ro} canTrade={canTradeSign} onSign={(party) => store.signVendorRound(tradeId, 1, party, name)} />
      </div>

      {/* Round 2 — draw schedule & timeline */}
      <div className="card" style={{ padding: 12, marginTop: 10, background: "var(--paper)", opacity: r1Done ? 1 : 0.6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <strong style={{ fontSize: 13 }}>Round 2 — Draw Schedule &amp; Timeline</strong>
          {r2Done && <Pill color="#fff" bg="var(--ok)">executed</Pill>}
          {!r1Done && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>locked until Round 1 is executed</span>}
        </div>
        {r1Done && <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", margin: "8px 0" }}>
            <label style={{ fontSize: 11.5, color: "var(--muted)" }}>Start<br /><input type="date" value={start} disabled={!canBuilderSign || ro} onChange={(e) => setStart(e.target.value)} /></label>
            <label style={{ fontSize: 11.5, color: "var(--muted)" }}>Finish<br /><input type="date" value={finish} disabled={!canBuilderSign || ro} onChange={(e) => setFinish(e.target.value)} /></label>
            {(canBuilderSign && !ro) && <button className="btn btn-sm" disabled={!start || !finish} onClick={() => store.setVendorDates(tradeId, start, finish)}>Save dates</button>}
            {agreement.startDate && <span style={{ fontSize: 12, color: "var(--muted)" }}>Saved: {agreement.startDate} → {agreement.finishDate}</span>}
          </div>
          <Lbl>Draw schedule (from Payments)</Lbl>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, margin: "4px 0 8px" }}>
            {drawRows.length ? drawRows.map(({ d, l, amt }, i) => (
              <div key={i} style={{ display: "flex", gap: 8, fontSize: 12.5 }}>
                <span style={{ flex: 1 }}>{d.name} · {l.name}</span>
                <span style={{ fontWeight: 600 }}>{fmt(amt)}</span>
                <span style={{ minWidth: 92, textAlign: "right", color: d.status === "paid" ? "var(--ok)" : d.status === "pushed" ? "var(--brass-2)" : "var(--muted)" }}>{d.status}</span>
              </div>
            )) : <span style={{ fontSize: 12, color: "var(--muted)" }}>Not allocated to any draw yet (set in Payment Tracker).</span>}
          </div>
          <SignRow round={2} agreement={agreement} canBuilder={canBuilderSign && !ro} canTrade={canTradeSign} onSign={(party) => store.signVendorRound(tradeId, 2, party, name)} />
        </>}
      </div>
    </div>
  );
}

function SignRow({ round, agreement, canBuilder, canTrade, onSign }: { round: 1 | 2; agreement: VendorAgreement; canBuilder: boolean; canTrade: boolean; onSign: (party: "builder" | "trade") => void }) {
  const sigs = round === 1 ? agreement.round1 : agreement.round2;
  const sig = (party: "builder" | "trade") => sigs.find((s) => s.party === party);
  const fmtTs = (s?: string) => (s ? new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
      {(["builder", "trade"] as const).map((party) => {
        const s = sig(party);
        const can = party === "builder" ? canBuilder : canTrade;
        return (
          <div key={party} style={{ flex: 1, minWidth: 180, border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700 }}>{party === "builder" ? "Builder / GC" : "Trade / Vendor"}</div>
            {s ? (
              <div style={{ marginTop: 4 }}>
                <div style={{ fontFamily: "var(--font-serif)", fontSize: 16, color: "var(--walnut)", fontStyle: "italic" }}>✒ {s.name}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>signed {fmtTs(s.at)}</div>
                {can && <button className="btn btn-sm" style={{ marginTop: 4, color: "var(--rust)" }} onClick={() => onSign(party)}>Revoke</button>}
              </div>
            ) : (
              <button className="btn btn-sm btn-primary" style={{ marginTop: 6 }} disabled={!can} onClick={() => onSign(party)}>
                {can ? "✒ Sign here" : "Awaiting signature"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Lbl({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)" }}>{children}</div>;
}

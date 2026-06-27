"use client";

import { useState } from "react";
import { useStore } from "@/lib/data/hooks";
import { PageHeader, NoAccess, Pill, SectionTitle, Money, StatCard, StackBar } from "../ui/bits";
import { accessFor, type FundingSource } from "@/lib/data/types";
import { totals, fmt } from "@/lib/data/money";

// Marginal cost of fully tapping a source (as a rate) — used to rank cheapest-first.
function marginalCost(f: FundingSource): number {
  if (f.costToAccess && f.amount) return f.costToAccess;
  return f.amount * f.rate;
}
function marginalRate(f: FundingSource): number {
  if (!f.amount) return f.rate;
  return marginalCost(f) / f.amount;
}

export default function BudgetPage() {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const user = store.currentUser;
  const access = accessFor(user, role, "budget");

  if (access === "none") return <NoAccess module="the Budget" />;
  const ro = access !== "edit";

  const t = totals(db.costLines);
  const buffer = (t.grand * db.project.bufferPct) / 100;
  const allIn = t.grand + buffer;

  const available = db.funding.reduce((a, f) => a + f.amount, 0);
  const drawn = db.funding.reduce((a, f) => a + f.drawn, 0);
  const gap = allIn - available;

  // Advisory: draw cheapest-first to cover the all-in need.
  const ranked = [...db.funding].sort((a, b) => marginalRate(a) - marginalRate(b) || a.liquidityRank - b.liquidityRank);
  let need = allIn;
  const plan = ranked.map((f) => {
    const use = Math.max(0, Math.min(f.amount, need));
    need -= use;
    const cost = f.amount ? (use / f.amount) * marginalCost(f) : 0;
    return { f, use, cost, rate: marginalRate(f) };
  });
  const planCost = plan.reduce((a, p) => a + p.cost, 0);

  // Worst-case: same need but most-expensive-first, for contrast.
  const rankedWorst = [...db.funding].sort((a, b) => marginalRate(b) - marginalRate(a));
  let need2 = allIn;
  const worstCost = rankedWorst.reduce((a, f) => {
    const use = Math.max(0, Math.min(f.amount, need2));
    need2 -= use;
    return a + (f.amount ? (use / f.amount) * marginalCost(f) : 0);
  }, 0);
  const savings = worstCost - planCost;

  return (
    <>
      <PageHeader
        title="Budget & Financing"
        subtitle="Owner-only. Pulls the all-in cost from Building Costs, then helps you fund it for the least carrying cost — spend free cash before high-interest debt."
        right={<Pill color="#fff" bg="var(--brass)">Owner only</Pill>}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(165px,1fr))", gap: 12, marginTop: 16 }}>
        <StatCard label="All-in Need" value={<Money value={allIn} />} sub={`costs ${fmt(t.grand)} + ${db.project.bufferPct}% buffer`} accent="var(--brass-2)" />
        <StatCard label="Funding Available" value={<Money value={available} />} sub={`${fmt(drawn)} drawn so far`} />
        <StatCard label={gap > 0 ? "Funding Gap" : "Surplus"} value={<Money value={Math.abs(gap)} />} accent={gap > 0 ? "var(--rust)" : "var(--ok)"} sub={gap > 0 ? "need more sources" : "covered"} />
        <StatCard label="Cost of Capital" value={<Money value={planCost} />} sub="on the recommended plan" />
      </div>

      {/* Buffer control */}
      <div className="card" style={{ padding: 16, marginTop: 14, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Contingency buffer</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Applied over building costs for overages & surprises.</div>
        </div>
        <input type="range" min={0} max={25} value={db.project.bufferPct} disabled={ro} onChange={(e) => store.setBuffer(Number(e.target.value))} style={{ flex: 1, minWidth: 180 }} />
        <div className="serif" style={{ fontSize: 22, fontWeight: 700, color: "var(--brass-2)", minWidth: 64, textAlign: "right" }}>{db.project.bufferPct}%</div>
        <div style={{ minWidth: 110, textAlign: "right" }}><Money value={buffer} /></div>
      </div>

      {/* Coverage bar */}
      <div className="card" style={{ padding: 16, marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 8 }}>
          <span style={{ color: "var(--muted)" }}>Funding available vs all-in need</span>
          <span style={{ fontWeight: 700, color: gap > 0 ? "var(--rust)" : "var(--ok)" }}>{Math.round((available / (allIn || 1)) * 100)}% covered</span>
        </div>
        <StackBar height={16} segments={[{ value: Math.min(available, allIn), color: "var(--sage)" }, { value: Math.max(0, gap), color: "#f3ddd6" }, { value: Math.max(0, -gap), color: "var(--brass)" }]} />
      </div>

      {/* Advisory */}
      <SectionTitle>Recommended Draw Order</SectionTitle>
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <span style={{ color: "var(--brass)" }}>✨</span>
          <span style={{ fontSize: 13.5 }}>
            Tapping cheapest-first costs <strong><Money value={planCost} /></strong> to access funds.
            {savings > 100 && <> That’s <strong style={{ color: "var(--ok)" }}><Money value={savings} /></strong> less than funding worst-first.</>}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {plan.filter((p) => p.use > 0).map((p, i) => (
            <div key={p.f.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 11px", borderRadius: 8, background: i % 2 ? "var(--cream)" : "transparent" }}>
              <span style={{ width: 22, height: 22, borderRadius: 99, background: "var(--sage)", color: "#fff", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{p.f.name}</div>
                <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                  {p.rate === 0 ? "free to access" : `${(p.rate * 100).toFixed(1)}% cost to access`}{p.f.timeframe ? ` · available ${p.f.timeframe}` : ""}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 700 }}>{fmt(p.use)}</div>
                {p.cost > 0 && <div style={{ fontSize: 11, color: "var(--rust)" }}>+{fmt(p.cost)} cost</div>}
              </div>
            </div>
          ))}
        </div>
        {gap > 0 && <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--rust)" }}>⚠ Sources fall <Money value={gap} /> short of the all-in need. Add a source below or trim scope.</div>}
      </div>

      {/* Funding sources editor */}
      <SectionTitle>Funding Sources</SectionTitle>
      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ fontSize: 12.5 }}>
          <thead>
            <tr>
              <th style={th}>Source</th>
              <th style={thR}>Available</th>
              <th style={thR}>Drawn</th>
              <th style={thR}>Rate</th>
              <th style={thR}>Cost to access</th>
              <th style={thR}>When</th>
              <th style={thR}>Order</th>
              {!ro && <th style={th}></th>}
            </tr>
          </thead>
          <tbody>
            {[...db.funding].sort((a, b) => a.liquidityRank - b.liquidityRank).map((f) => (
              <tr key={f.id}>
                <td style={td}>
                  <input value={f.name} disabled={ro} onChange={(e) => store.updateFunding(f.id, { name: e.target.value })} style={cellInput(160)} />
                  {f.note && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{f.note}</div>}
                </td>
                <td style={tdR}><NumCell value={f.amount} ro={ro} onChange={(v) => store.updateFunding(f.id, { amount: v })} money /></td>
                <td style={tdR}><NumCell value={f.drawn} ro={ro} onChange={(v) => store.updateFunding(f.id, { drawn: v })} money /></td>
                <td style={tdR}><NumCell value={f.rate * 100} ro={ro} onChange={(v) => store.updateFunding(f.id, { rate: v / 100 })} suffix="%" width={56} /></td>
                <td style={tdR}><NumCell value={f.costToAccess ?? 0} ro={ro} onChange={(v) => store.updateFunding(f.id, { costToAccess: v })} money /></td>
                <td style={tdR}><input value={f.timeframe ?? ""} disabled={ro} onChange={(e) => store.updateFunding(f.id, { timeframe: e.target.value })} style={cellInput(60)} /></td>
                <td style={tdR}><NumCell value={f.liquidityRank} ro={ro} onChange={(v) => store.updateFunding(f.id, { liquidityRank: v })} width={42} /></td>
                {!ro && <td style={td}><button className="btn btn-sm" style={{ color: "var(--rust)" }} onClick={() => store.removeFunding(f.id)}>✕</button></td>}
              </tr>
            ))}
            <tr style={{ background: "var(--cream)" }}>
              <td style={{ ...td, fontWeight: 700 }}>Total</td>
              <td style={{ ...tdR, fontWeight: 700 }}>{fmt(available)}</td>
              <td style={{ ...tdR, fontWeight: 700 }}>{fmt(drawn)}</td>
              <td colSpan={4 + (ro ? 0 : 1)}></td>
            </tr>
          </tbody>
        </table>
      </div>
      {!ro && <AddSource />}
    </>
  );
}

function NumCell({ value, onChange, ro, money, suffix, width = 90 }: { value: number; onChange: (v: number) => void; ro: boolean; money?: boolean; suffix?: string; width?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2, justifyContent: "flex-end" }}>
      {money && <span style={{ color: "var(--muted)" }}>$</span>}
      <input type="number" value={Math.round(value)} disabled={ro} onChange={(e) => onChange(Number(e.target.value))}
        style={{ width, textAlign: "right", fontVariantNumeric: "tabular-nums" }} />
      {suffix && <span style={{ color: "var(--muted)" }}>{suffix}</span>}
    </span>
  );
}

function AddSource() {
  const store = useStore();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");
  return (
    <div className="card" style={{ padding: 12, marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <input placeholder="Source name" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
      <input placeholder="Amount $" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 120 }} />
      <input placeholder="Rate %" type="number" value={rate} onChange={(e) => setRate(e.target.value)} style={{ width: 90 }} />
      <button className="btn btn-primary" onClick={() => {
        if (!name.trim()) return;
        store.addFunding({ name: name.trim(), amount: Number(amount) || 0, drawn: 0, rate: (Number(rate) || 0) / 100, liquidityRank: 99 });
        setName(""); setAmount(""); setRate("");
      }}>+ Add source</button>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: "9px 10px", borderBottom: "2px solid var(--line)", fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" };
const thR: React.CSSProperties = { ...th, textAlign: "right" };
const td: React.CSSProperties = { padding: "6px 10px", borderBottom: "1px solid var(--line)" };
const tdR: React.CSSProperties = { ...td, textAlign: "right" };
const cellInput = (w: number): React.CSSProperties => ({ width: w, border: "none", background: "transparent", padding: "2px 0", fontWeight: 600 });

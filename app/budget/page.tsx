"use client";

import { useState } from "react";
import { useStore } from "@/lib/data/hooks";
import { PageHeader, NoAccess, Pill, SectionTitle, Money, StatCard, StackBar, NumInput, TextInput } from "../ui/bits";
import { MoneyTabs } from "../ui/money-tabs";
import { accessFor, type FundingSource } from "@/lib/data/types";
import { totals, fmt, budgetRange } from "@/lib/data/money";

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

  if (access === "none") return <NoAccess module="Budget Management" />;
  const ro = access !== "edit";

  const t = totals(db.costLines);
  const buffer = (t.grand * db.project.bufferPct) / 100;
  // All-in need is a RANGE, pulling the low–high cost range from Budget Management + buffer.
  const costRange = budgetRange(db.costLines);
  const bf = 1 + db.project.bufferPct / 100;
  const allInLow = costRange.low * bf;
  const allInHigh = costRange.high * bf;
  const allIn = allInHigh; // conservative (high end) for coverage / draw-plan math
  const hasRange = Math.round(allInLow) !== Math.round(allInHigh);

  // Remaining (untapped) capacity of a source. Money already DRAWN from a line is
  // gone — it's no longer available to fund the project — so the roll-up excludes it.
  const remainOf = (f: FundingSource) => Math.max(0, f.amount - f.drawn);
  const cashSources = db.funding.filter((f) => f.fundType !== "debt");
  const debtItems = db.funding.filter((f) => f.fundType === "debt");
  const drawn = db.funding.reduce((a, f) => a + f.drawn, 0);
  // Funding = non-debt sources, counting only what's still UNTAPPED (Available − Drawn).
  const funding = cashSources.reduce((a, f) => a + remainOf(f), 0);
  const tappedCash = cashSources.reduce((a, f) => a + Math.min(f.amount, f.drawn), 0);
  // Cash vs debt: debt must be repaid, so it's always a negative against the surplus.
  const totalDebt = debtItems.reduce((a, f) => a + f.amount, 0);
  const totalCash = funding;
  // Total still-drawable (cash remaining + debt remaining) — drives the shortfall check.
  const available = funding + debtItems.reduce((a, f) => a + remainOf(f), 0);
  const gap = allIn - available;
  // Surplus = Funding − Debt − All-in Need (a range: worst case uses the high cost, best case the low).
  const surplusLow = funding - totalDebt - allInHigh;
  const surplusHigh = funding - totalDebt - allInLow;
  const surplusIsRange = Math.round(surplusLow) !== Math.round(surplusHigh);
  // Debt obligations: what's been drawn (borrowed) vs repaid.
  const debtDrawn = debtItems.reduce((a, f) => a + f.drawn, 0);
  const debtRepaid = debtItems.reduce((a, f) => a + (f.repaid ?? 0), 0);
  const debtOutstanding = debtDrawn - debtRepaid;

  // Advisory: draw cheapest-first to cover the all-in need.
  const ranked = [...db.funding].sort((a, b) => marginalRate(a) - marginalRate(b) || a.liquidityRank - b.liquidityRank);
  let need = allIn;
  const plan = ranked.map((f) => {
    const use = Math.max(0, Math.min(remainOf(f), need));
    need -= use;
    const cost = f.amount ? (use / f.amount) * marginalCost(f) : 0;
    return { f, use, cost, rate: marginalRate(f) };
  });
  const recommendedCost = plan.reduce((a, p) => a + p.cost, 0);
  void plan;

  // The plan in the OWNER'S current draw order (by liquidityRank) — drives the grid.
  const orderedManual = [...db.funding].sort((a, b) => a.liquidityRank - b.liquidityRank);
  let needM = allIn;
  const manualTapped = new Map<string, number>();
  let manualCost = 0;
  for (const f of orderedManual) {
    const use = Math.max(0, Math.min(remainOf(f), needM));
    needM -= use;
    manualTapped.set(f.id, use);
    manualCost += f.amount ? (use / f.amount) * marginalCost(f) : 0;
  }
  const orderSavings = manualCost - recommendedCost;
  const recommendedIds = [...db.funding].sort((a, b) => marginalRate(a) - marginalRate(b) || a.liquidityRank - b.liquidityRank).map((f) => f.id);

  return (
    <>
      <PageHeader
        title="Budget Management"
        subtitle="Where the money comes from. Pulls the all-in cost from the committed budget, then helps you fund it for the least carrying cost — spend free cash before high-interest debt."
        right={<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {!ro && <button className="btn btn-sm" disabled={!store.canUndo} onClick={() => store.undo()} title="Undo the last budget change">↶ Undo</button>}
          <Pill color="#fff" bg="var(--brass)">Owner only</Pill>
        </div>}
      />
      <MoneyTabs />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(165px,1fr))", gap: 12, marginTop: 16 }}>
        <StatCard label="All-in Need" value={hasRange ? <span style={{ fontSize: ".7em", fontWeight: 700 }}>{fmt(allInLow)}<span style={{ color: "var(--muted)" }}> – </span>{fmt(allInHigh)}</span> : <Money value={allInHigh} />} sub={`cost range + ${db.project.bufferPct}% buffer`} accent="var(--brass-2)" />
        <StatCard label="Funding" value={<Money value={funding} />} accent="var(--ok)" sub={tappedCash > 0 ? `untapped cash (${fmt(tappedCash)} already drawn)` : "non-debt sources"} />
        <StatCard label="Debt" value={<span style={{ color: "var(--rust)" }}>−<Money value={totalDebt} /></span>} accent="var(--rust)" sub={`${fmt(debtOutstanding)} drawn & owed`} />
        <StatCard label="Surplus" value={surplusIsRange ? <span style={{ fontSize: ".7em", fontWeight: 700 }}>{fmt(surplusLow)}<span style={{ color: "var(--muted)" }}> – </span>{fmt(surplusHigh)}</span> : <Money value={surplusHigh} />} accent={surplusLow >= 0 ? "var(--ok)" : surplusHigh >= 0 ? "var(--brass-2)" : "var(--rust)"} sub="funding − debt − all-in need" />
        <StatCard label="Cost of Capital" value={<Money value={recommendedCost} />} sub="cheapest-first plan" />
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

      {/* Coverage bar — funding (non-debt) vs all-in need */}
      {(() => { const fundGap = allInHigh - funding; const covHigh = Math.round((funding / (allInHigh || 1)) * 100); const covLow = Math.round((funding / (allInLow || 1)) * 100); return (
        <div className="card" style={{ padding: 16, marginTop: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 8 }}>
            <span style={{ color: "var(--muted)" }}>Funding vs all-in need {hasRange ? `(${fmt(allInLow)} – ${fmt(allInHigh)})` : ""}</span>
            <span style={{ fontWeight: 700, color: fundGap > 0 ? "var(--rust)" : "var(--ok)" }}>funding covers {hasRange ? `${covHigh}–${covLow}%` : `${covHigh}%`}</span>
          </div>
          <StackBar height={16} segments={[{ value: Math.min(funding, allInHigh), color: "var(--sage)" }, { value: Math.max(0, fundGap), color: "#f3ddd6" }, { value: Math.max(0, -fundGap), color: "var(--sage-2)" }]} />
        </div>
      ); })()}

      {/* Merged: Funding sources + draw order, one editable grid */}
      <SectionTitle right={!ro && orderSavings > 100 ? <button className="btn btn-sm btn-primary" onClick={() => store.setFundingRanks(recommendedIds)}>✨ Apply recommended order (save {fmt(orderSavings)})</button> : undefined}>
        Funding &amp; Draw Order
      </SectionTitle>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: -6, marginBottom: 8 }}>
        Sources are tapped top-down by the editable <strong>Order</strong> column. Your current order costs <strong style={{ color: "var(--ink)" }}>{fmt(manualCost)}</strong> to access{orderSavings > 100 ? <> — cheapest-first would cost <strong style={{ color: "var(--ok)" }}>{fmt(recommendedCost)}</strong>.</> : <> (cheapest-first, optimal).</>}
      </div>
      {/* Bounded height keeps the horizontal scrollbar on-screen at all times. */}
      <div className="card" style={{ overflow: "auto", maxHeight: "62vh" }}>
        <table style={{ fontSize: 12.5 }}>
          <thead>
            <tr>
              <th style={thC} className="m-hide">#</th>
              <th style={th}>Source</th>
              <th style={thC}>Type</th>
              <th style={thR}>Available</th>
              <th style={thR} className="m-hide">Drawn</th>
              <th style={thR} className="m-hide">Rate</th>
              <th style={thR} className="m-hide">Cost to access</th>
              <th style={thR} className="m-hide">When</th>
              <th style={thC}>Order</th>
              <th style={thR} className="m-hide">Tapped</th>
              <th style={thR} className="m-hide">Access cost</th>
              {!ro && <th style={th} className="m-hide"></th>}
            </tr>
          </thead>
          <tbody>
            {orderedManual.map((f, i) => {
              const use = manualTapped.get(f.id) ?? 0;
              const cost = f.amount ? (use / f.amount) * marginalCost(f) : 0;
              return (
                <tr key={f.id}>
                  <td style={tdC} className="m-hide"><span style={{ width: 20, height: 20, borderRadius: 99, background: use > 0 ? "var(--sage)" : "var(--cream-2)", color: use > 0 ? "#fff" : "var(--muted)", fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span></td>
                  <td style={td}>
                    <TextInput value={f.name} disabled={ro} onCommit={(v) => store.updateFunding(f.id, { name: v })} style={cellInput(150)} />
                    <TextInput value={f.note ?? ""} disabled={ro} placeholder="note…" onCommit={(v) => store.updateFunding(f.id, { note: v })} style={{ ...cellInput(180), fontSize: 11, fontWeight: 400, color: "var(--muted)", display: "block" }} />
                  </td>
                  <td style={tdC}>
                    {ro ? <Pill bg={f.fundType === "debt" ? "#f3d9cf" : "var(--sage-tint)"} color={f.fundType === "debt" ? "var(--rust)" : "var(--sage-2)"}>{f.fundType === "debt" ? "Debt" : "Cash"}</Pill>
                      : <select value={f.fundType ?? "cash"} onChange={(e) => store.updateFunding(f.id, { fundType: e.target.value as "cash" | "debt" })} style={{ fontSize: 11.5, color: f.fundType === "debt" ? "var(--rust)" : "var(--sage-2)", fontWeight: 700 }}><option value="cash">Cash</option><option value="debt">Debt</option></select>}
                  </td>
                  <td style={tdR}><NumCell value={f.amount} ro={ro} onChange={(v) => store.updateFunding(f.id, { amount: v })} money /></td>
                  <td style={tdR} className="m-hide"><NumCell value={f.drawn} ro={ro} onChange={(v) => store.updateFunding(f.id, { drawn: v })} money /></td>
                  <td style={tdR} className="m-hide"><NumCell value={f.rate * 100} ro={ro} onChange={(v) => store.updateFunding(f.id, { rate: v / 100 })} suffix="%" width={50} /></td>
                  <td style={tdR} className="m-hide"><NumCell value={f.costToAccess ?? 0} ro={ro} onChange={(v) => store.updateFunding(f.id, { costToAccess: v })} money /></td>
                  <td style={tdR} className="m-hide"><TextInput value={f.timeframe ?? ""} disabled={ro} onCommit={(v) => store.updateFunding(f.id, { timeframe: v })} style={cellInput(56)} /></td>
                  <td style={tdC}><NumCell value={f.liquidityRank} ro={ro} onChange={(v) => store.updateFunding(f.id, { liquidityRank: v })} width={40} /></td>
                  <td style={tdR} className="m-hide"><strong style={{ color: use > 0 ? "var(--ink)" : "var(--muted)" }}>{use > 0 ? fmt(use) : "—"}</strong></td>
                  <td style={tdR} className="m-hide">{cost > 0 ? <span style={{ color: "var(--rust)" }}>+{fmt(cost)}</span> : <span style={{ color: "var(--muted)" }}>free</span>}</td>
                  {!ro && <td style={td} className="m-hide"><button className="btn btn-sm" style={{ color: "var(--rust)" }} onClick={() => store.removeFunding(f.id)}>✕</button></td>}
                </tr>
              );
            })}
            <tr style={{ background: "var(--cream)" }}>
              <td style={tdC} className="m-hide"></td>
              <td style={{ ...td, fontWeight: 700 }}>Total</td>
              <td style={{ ...tdC, fontSize: 10.5, color: "var(--muted)", lineHeight: 1.4 }}><div style={{ color: "var(--sage-2)" }}>{fmt(totalCash)} cash</div><div style={{ color: "var(--rust)" }}>−{fmt(totalDebt)} debt</div></td>
              <td style={{ ...tdR, fontWeight: 700, fontSize: 11, lineHeight: 1.55 }}>
                <div style={{ color: "var(--sage-2)" }}>{fmt(funding)} cash{tappedCash > 0 ? <span style={{ color: "var(--muted)", fontWeight: 400 }} title={`${fmt(tappedCash)} already drawn is excluded`}> *</span> : null}</div>
                <div style={{ color: "var(--rust)" }}>−{fmt(totalDebt)} debt</div>
                <div style={{ borderTop: "1px solid var(--line)", marginTop: 2, paddingTop: 1 }}>{fmt(funding - totalDebt)} net</div>
                <div style={{ color: "var(--brass-2)" }}>−{hasRange ? `(${fmt(allInLow)} – ${fmt(allInHigh)})` : fmt(allInHigh)} all-in</div>
                <div style={{ borderTop: "1px solid var(--line)", marginTop: 2, paddingTop: 2, color: surplusLow >= 0 ? "var(--ok)" : surplusHigh >= 0 ? "var(--brass-2)" : "var(--rust)" }}>{surplusIsRange ? `${fmt(surplusLow)} – ${fmt(surplusHigh)}` : fmt(surplusHigh)} surplus</div>
              </td>
              <td style={{ ...tdR, fontWeight: 700 }} className="m-hide">{fmt(drawn)}</td>
              <td colSpan={4}></td>
              <td style={{ ...tdR, fontWeight: 700 }} className="m-hide">{fmt(allIn - Math.max(0, gap))}</td>
              <td style={{ ...tdR, fontWeight: 700 }} className="m-hide">{fmt(manualCost)}</td>
              {!ro && <td className="m-hide"></td>}
            </tr>
          </tbody>
        </table>
      </div>
      {tappedCash > 0 && <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--muted)" }}>* Funding counts only <strong>untapped</strong> cash — {fmt(tappedCash)} already drawn (e.g. from Joint WROS) is excluded from the roll-up.</div>}
      {gap > 0 && <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--rust)" }}>⚠ Sources fall <Money value={gap} /> short of the all-in need. Add a source below or trim scope.</div>}
      {!ro && <AddSource />}

      {/* Debt to repay — drawn vs repaid, outstanding balance */}
      <SectionTitle right={<span style={{ fontSize: 13, fontWeight: 700, color: debtOutstanding > 0 ? "var(--rust)" : "var(--ok)" }}>Outstanding: <Money value={debtOutstanding} /></span>}>
        Debt to Repay
      </SectionTitle>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: -6, marginBottom: 8 }}>
        Borrowed money already drawn that must be paid back. Mark any source <strong>Debt</strong> in the grid above and it appears here; log repayments to track the balance owed.
      </div>
      {debtItems.length === 0 ? (
        <div className="card" style={{ padding: 16, fontSize: 13, color: "var(--muted)" }}>No debt sources yet — set a funding source’s Type to <strong>Debt</strong> above to track it here.</div>
      ) : (
        <div className="card" style={{ overflow: "auto", maxHeight: "62vh" }}>
          <table style={{ fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={th}>Debt source</th>
                <th style={thR} className="m-hide">Drawn (owed)</th>
                <th style={thR}>Repaid</th>
                <th style={thR}>Balance owed</th>
                <th style={thR} className="m-hide">Rate</th>
                <th style={thR} className="m-hide">By</th>
                {!ro && <th style={th}></th>}
              </tr>
            </thead>
            <tbody>
              {debtItems.map((f) => {
                const repaid = f.repaid ?? 0;
                const owed = Math.max(0, f.drawn - repaid);
                const pctRepaid = f.drawn > 0 ? Math.round((repaid / f.drawn) * 100) : 0;
                return (
                  <tr key={f.id}>
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>{f.name}</div>
                      <div style={{ marginTop: 3 }}><StackBar height={5} segments={[{ value: repaid, color: "var(--ok)" }, { value: owed, color: "var(--rust)" }]} /></div>
                    </td>
                    <td style={tdR} className="m-hide"><NumCell value={f.drawn} ro={ro} onChange={(v) => store.updateFunding(f.id, { drawn: v })} money /></td>
                    <td style={tdR}><NumCell value={repaid} ro={ro} onChange={(v) => store.updateFunding(f.id, { repaid: v })} money /></td>
                    <td style={tdR}><strong style={{ color: owed > 0 ? "var(--rust)" : "var(--ok)" }}>{fmt(owed)}</strong>{owed === 0 ? " ✓" : <span style={{ color: "var(--muted)", fontSize: 11 }}> · {pctRepaid}% paid</span>}</td>
                    <td style={tdR} className="m-hide">{f.rate ? `${(f.rate * 100).toFixed(1)}%` : "—"}</td>
                    <td style={tdR} className="m-hide">{f.timeframe ?? "—"}</td>
                    {!ro && <td style={td}>{repaid < f.drawn && <button className="btn btn-sm" title="Mark fully repaid" onClick={() => store.updateFunding(f.id, { repaid: f.drawn })}>Paid off</button>}</td>}
                  </tr>
                );
              })}
              <tr style={{ background: "var(--cream)" }}>
                <td style={{ ...td, fontWeight: 700 }}>Total debt</td>
                <td style={{ ...tdR, fontWeight: 700 }} className="m-hide">{fmt(debtDrawn)}</td>
                <td style={{ ...tdR, fontWeight: 700, color: "var(--ok)" }}>{fmt(debtRepaid)}</td>
                <td style={{ ...tdR, fontWeight: 700, color: debtOutstanding > 0 ? "var(--rust)" : "var(--ok)" }}>{fmt(debtOutstanding)}</td>
                <td colSpan={ro ? 2 : 3}></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// Thin wrapper over the shared commit-on-blur NumInput (keeps existing call sites).
function NumCell({ value, onChange, ro, money, suffix, width = 90 }: { value: number; onChange: (v: number) => void; ro: boolean; money?: boolean; suffix?: string; width?: number }) {
  return <NumInput value={value} onCommit={onChange} disabled={ro} money={money} suffix={suffix} width={width} />;
}

function AddSource() {
  const store = useStore();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");
  const [fundType, setFundType] = useState<"cash" | "debt">("cash");
  return (
    <div className="card" style={{ padding: 12, marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <input placeholder="Source name" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
      <select value={fundType} onChange={(e) => setFundType(e.target.value as "cash" | "debt")}><option value="cash">Cash</option><option value="debt">Debt</option></select>
      <input placeholder="Amount $" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 120 }} />
      <input placeholder="Rate %" type="number" value={rate} onChange={(e) => setRate(e.target.value)} style={{ width: 90 }} />
      <button className="btn btn-primary" onClick={() => {
        if (!name.trim()) return;
        store.addFunding({ name: name.trim(), amount: Number(amount) || 0, drawn: 0, rate: (Number(rate) || 0) / 100, liquidityRank: 99, fundType });
        setName(""); setAmount(""); setRate(""); setFundType("cash");
      }}>+ Add source</button>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: "9px 10px", borderBottom: "2px solid var(--line)", fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" };
const thR: React.CSSProperties = { ...th, textAlign: "right" };
const thC: React.CSSProperties = { ...th, textAlign: "center" };
const td: React.CSSProperties = { padding: "6px 10px", borderBottom: "1px solid var(--line)" };
const tdR: React.CSSProperties = { ...td, textAlign: "right" };
const tdC: React.CSSProperties = { ...td, textAlign: "center" };
const cellInput = (w: number): React.CSSProperties => ({ width: w, border: "none", background: "transparent", padding: "2px 0", fontWeight: 600 });

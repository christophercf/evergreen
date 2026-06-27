"use client";

import Link from "next/link";
import { useStore } from "@/lib/data/hooks";
import { Money, StatCard, SectionTitle, PageHeader, StackBar, Pill } from "./ui/bits";
import { byCategory, totals, drawAmount, MACRO_ORDER, MACRO_COLOR, fmt } from "@/lib/data/money";
import { accessFor } from "@/lib/data/types";

export default function Dashboard() {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const user = store.currentUser;
  const canBudget = accessFor(user, role, "budget") !== "none";

  const t = totals(db.costLines);
  const cats = byCategory(db.costLines);
  const buffer = (t.grand * db.project.bufferPct) / 100;
  const allIn = t.grand + buffer;

  // Funding coverage
  const available = db.funding.reduce((a, f) => a + f.amount, 0);
  const coverage = Math.min(1, available / (allIn || 1));

  // Scope progress
  const inScope = db.scope.filter((c) => c.status === "in");
  const items = inScope.flatMap((c) => c.items.filter((i) => i.included));
  const signed = items.filter((i) => i.done).length;

  // Draws / payments
  const paidDraws = db.draws.filter((d) => d.status === "paid");
  const paidTotal = paidDraws.reduce((a, d) => a + drawAmount(db, d), 0);
  const remaining = Math.max(0, t.grand - paidTotal);

  return (
    <>
      <PageHeader
        title="Project Dashboard"
        subtitle={`${db.project.name} · ${db.project.built}. One place for scope, costs, and financing — the single source of truth your spreadsheets used to hold.`}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 18 }}>
        <StatCard label="Projected Cost" value={<Money value={t.grand} />} sub={<>Builder <Money value={t.builder} /> · Owner <Money value={t.owner} /></>} />
        <StatCard label={`All-in (+${db.project.bufferPct}% buffer)`} value={<Money value={allIn} />} accent="var(--brass-2)" sub={<>Buffer <Money value={buffer} /></>} />
        <StatCard label="Builder Markup" value={<Money value={t.markup} />} sub="Pass-through @ 20%" />
        {canBudget && <StatCard label="Funding Available" value={<Money value={available} />} accent={coverage >= 1 ? "var(--ok)" : "var(--rust)"} sub={`${Math.round(coverage * 100)}% of all-in covered`} />}
        <StatCard label="QC Sign-offs" value={`${signed}/${items.length}`} sub="Owner + builder dual sign-off" />
      </div>

      <SectionTitle right={<Link href="/costs" className="btn btn-sm">Open Building Costs →</Link>}>Cost by Category</SectionTitle>
      <div className="card" style={{ padding: 16 }}>
        <StackBar height={14} segments={MACRO_ORDER.map((c) => ({ value: cats.find((x) => x.key === c)?.total ?? 0, color: MACRO_COLOR[c], label: c }))} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px,1fr))", gap: "8px 18px", marginTop: 14 }}>
          {MACRO_ORDER.map((c) => {
            const r = cats.find((x) => x.key === c);
            if (!r || r.total === 0) return null;
            return (
              <div key={c} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ width: 11, height: 11, borderRadius: 3, background: MACRO_COLOR[c], flexShrink: 0 }} />
                <span style={{ fontSize: 13, flex: 1 }}>{c}</span>
                <span style={{ fontSize: 13, fontWeight: 700 }}><Money value={r.total} /></span>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 8 }} className="ever-two">
        <div>
          <SectionTitle right={<Link href="/admin" className="btn btn-sm">Scope matrix →</Link>}>Scope &amp; QC</SectionTitle>
          <div className="card" style={{ padding: 16 }}>
            <Row label="Rooms in project" value={`${db.rooms.length}`} />
            <Row label="Trades configured" value={`${db.trades.length}`} />
            <Row label="In-scope room×trade cells" value={`${inScope.length}`} />
            <Row label="Scope items signed off (owner + builder)" value={`${signed} / ${items.length}`} />
            <div style={{ marginTop: 10 }}>
              <StackBar segments={[{ value: signed, color: "var(--ok)" }, { value: Math.max(0, items.length - signed), color: "var(--cream-2)" }]} />
            </div>
          </div>
        </div>
        <div>
          <SectionTitle right={<Link href="/payments" className="btn btn-sm">Payments →</Link>}>Draws &amp; Payments</SectionTitle>
          <div className="card" style={{ padding: 16 }}>
            <Row label="Paid to date" value={fmt(paidTotal)} />
            <Row label="Remaining to fund" value={fmt(remaining)} />
            <div style={{ marginTop: 10 }}>
              <StackBar segments={[{ value: paidTotal, color: "var(--ok)" }, { value: remaining, color: "var(--cream-2)" }]} />
            </div>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 7 }}>
              {db.draws.map((d) => (
                <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                  <Pill color="#fff" bg={d.status === "paid" ? "var(--ok)" : d.status === "invoiced" ? "var(--brass)" : "var(--sc-unset)"}>{d.status}</Pill>
                  <span style={{ flex: 1, color: "var(--muted)" }}>{d.name}</span>
                  <span style={{ fontWeight: 700 }}>{fmt(drawAmount(db, d))}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <style>{`@media (max-width: 760px){ .ever-two{ grid-template-columns: 1fr !important; } }`}</style>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", borderBottom: "1px solid var(--line)", fontSize: 13.5 }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <span style={{ fontWeight: 700 }}>{value}</span>
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/data/hooks";
import { Money, StatCard, SectionTitle, PageHeader, StackBar, Pill } from "./ui/bits";
import { byCategory, totals, drawAmount, MACRO_ORDER, MACRO_COLOR, fmt, materialDates, tradeName } from "@/lib/data/money";
import { accessFor } from "@/lib/data/types";

export default function Dashboard() {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const user = store.currentUser;
  // Cost visibility keys off the costs-module permission, not the role name —
  // the Designer is a "viewer" (not a trade) but still must never see money.
  const canSeeCosts = accessFor(user, role, "costs") !== "none";
  // Today summarises other modules, so it has to respect their permissions —
  // otherwise a role that can't open Materials still reads the whole queue here.
  const canSeeMaterials = accessFor(user, role, "materials") !== "none";
  const [qPage, setQPage] = useState(0);

  const t = totals(db.costLines);
  const cats = byCategory(db.costLines);
  const buffer = (t.grand * db.project.bufferPct) / 100;
  const allIn = t.grand + buffer;

  // Scope progress
  const inScope = db.scope.filter((c) => c.status === "in");
  const items = inScope.flatMap((c) => c.items.filter((i) => i.included));
  const signed = items.filter((i) => i.done).length;

  // Draws / payments
  const paidDraws = db.draws.filter((d) => d.status === "paid");
  const paidTotal = paidDraws.reduce((a, d) => a + drawAmount(db, d), 0);
  const remaining = Math.max(0, t.grand - paidTotal);

  // Purchase queue: materials still to buy (needed/identified), ordered by when
  // they must be on-hand — dates derive from each material's assigned trade.
  const today = Date.now();
  const queue = db.materials
    .filter((m) => m.status === "needed" || m.status === "identified")
    .map((m) => {
      const d = materialDates(db, m);
      const due = d.onHandBy ?? d.identifyBy;
      return { m, due, lastWk: d.needBy === "finish", days: due ? Math.round((new Date(`${due}T00:00:00`).getTime() - today) / 86400000) : Infinity };
    })
    .filter((x) => x.due)
    .sort((a, b) => a.days - b.days);

  // Trades get a focused dashboard — only their own work, no project financials.
  if (role === "trade") return <TradeDashboard />;

  return (
    <>
      <PageHeader
        title="Project Dashboard"
        subtitle={`${db.project.name} · ${db.project.built}. One place for scope, costs, and financing — the single source of truth your spreadsheets used to hold.`}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 18 }}>
        {canSeeCosts && <>
          <StatCard label="Projected Cost" value={<Money value={t.grand} />} sub={<>Builder <Money value={t.builder} /> · Owner <Money value={t.owner} /><div style={{ marginTop: 2 }}>incl. <Money value={t.markup} /> builder markup</div></>} />
          <StatCard label={`All-in (+${db.project.bufferPct}% buffer)`} value={<Money value={allIn} />} accent="var(--brass-2)" sub={<>Buffer <Money value={buffer} /></>} />
          <StatCard label="Builder Markup" value={<Money value={t.markup} />} sub="Pass-through @ 20%" />
        </>}
        <StatCard label="QC Sign-offs" value={`${signed}/${items.length}`} sub="Owner + builder dual sign-off" />
      </div>

      {canSeeMaterials && queue.length > 0 && (() => {
        const PAGE = 8;
        const pages = Math.ceil(queue.length / PAGE);
        const page = Math.min(qPage, pages - 1);
        return (
        <div className="card" style={{ padding: 14, marginTop: 14, borderLeft: "3px solid var(--brass)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <strong style={{ fontSize: 14, color: "var(--walnut)" }}>🛒 Next materials to purchase</strong>
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>ordered by when each must be on-hand (from its trade’s schedule)</span>
            <Link href="/materials" className="btn btn-sm" style={{ marginLeft: "auto" }}>Materials →</Link>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {queue.slice(page * PAGE, page * PAGE + PAGE).map(({ m, days, due, lastWk }) => (
              <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, flexWrap: "wrap" }}>
                <Pill color="#fff" bg={days < 0 ? "var(--rust)" : days <= 7 ? "var(--rust)" : days <= 21 ? "var(--brass)" : "var(--sage)"}>{days < 0 ? `${-days}d overdue` : `${days}d`}</Pill>
                <span style={{ flex: 1, minWidth: 140 }}>
                  <strong>{m.item}</strong>{(m.qty ?? 1) > 1 ? <span style={{ color: "var(--muted)" }}> ×{m.qty}</span> : null}
                  <span style={{ color: "var(--muted)" }}> · {m.roomLabel ?? "—"}{m.tradeId ? ` · ${tradeName(db, m.tradeId)}` : ""}</span>
                </span>
                <span style={{ color: "var(--muted)", fontSize: 11.5 }}>{m.ownerApproved ? "✓ approved" : "needs approval"}</span>
                <span style={{ color: "var(--sage-2)", fontSize: 11.5, fontVariantNumeric: "tabular-nums" }}>📦 {due}{lastWk && <span style={{ color: "var(--brass-2)", fontWeight: 700 }}> · last wk</span>}</span>
              </div>
            ))}
          </div>
          {pages > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, justifyContent: "center" }}>
              <button className="btn btn-sm" disabled={page === 0} onClick={() => setQPage(page - 1)}>‹ Prev</button>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Page {page + 1} of {pages} · {queue.length} items</span>
              <button className="btn btn-sm" disabled={page >= pages - 1} onClick={() => setQPage(page + 1)}>Next ›</button>
            </div>
          )}
        </div>
        );
      })()}

      {canSeeCosts && <>
        <SectionTitle right={<Link href="/costs" className="btn btn-sm">Open Project Budget →</Link>}>Cost by Category</SectionTitle>
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
      </>}

      <div style={{ display: "grid", gridTemplateColumns: canSeeCosts ? "1fr 1fr" : "1fr", gap: 16, marginTop: 8 }} className="ever-two">
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
        {canSeeCosts && <div>
          <SectionTitle right={<Link href="/payments" className="btn btn-sm">Draws →</Link>}>Draws &amp; Payments</SectionTitle>
          <div className="card" style={{ padding: 16 }}>
            <Row label="Paid to date" value={fmt(paidTotal)} />
            <Row label="Remaining to fund" value={fmt(remaining)} />
            <div style={{ marginTop: 10 }}>
              <StackBar segments={[{ value: paidTotal, color: "var(--ok)" }, { value: remaining, color: "var(--cream-2)" }]} />
            </div>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 7 }}>
              {db.draws.map((d) => (
                <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                  <Pill color="#fff" bg={d.status === "paid" ? "var(--ok)" : d.status === "pushed" ? "var(--brass)" : "var(--sc-unset)"}>{d.status}</Pill>
                  <span style={{ flex: 1, color: "var(--muted)" }}>{d.name}</span>
                  <span style={{ fontWeight: 700 }}>{fmt(drawAmount(db, d))}</span>
                </div>
              ))}
            </div>
          </div>
        </div>}
      </div>

      <style>{`@media (max-width: 760px){ .ever-two{ grid-template-columns: 1fr !important; } }`}</style>
    </>
  );
}

// Trade-only dashboard: their tasks, their materials, their QC — nothing else.
function TradeDashboard() {
  const store = useStore();
  const db = store.db;
  const user = store.currentUser;
  const canSeeMaterials = accessFor(user, store.session.role, "materials") !== "none";
  const mine = new Set(user?.tradeIds ?? []);
  const tradeNames = [...mine].map((t) => db.trades.find((x) => x.id === t)?.name ?? t).join(", ");
  const tasks = db.schedule.filter((s) => s.tradeId && mine.has(s.tradeId));
  const inProg = tasks.filter((s) => s.status === "in_progress").length;
  const pendingConfirm = tasks.filter((s) => s.confirm === "pending" && s.assignedUserId === user?.id);
  const mats = db.materials.filter((m) => m.tradeId && mine.has(m.tradeId));
  const matsDue = mats.filter((m) => m.dueDate && m.status !== "purchased" && m.status !== "delivered")
    .map((m) => ({ m, days: Math.round((new Date(`${m.dueDate}T00:00:00`).getTime() - Date.now()) / 86400000) }))
    .sort((a, b) => a.days - b.days);
  let qcSigned = 0, qcTotal = 0;
  db.scope.filter((c) => c.status === "in" && mine.has(c.tradeId)).forEach((c) => c.items.forEach((it) => { if (it.included) { qcTotal++; if (it.done) qcSigned++; } }));
  const fmtD = (d?: string) => (d ? new Date(`${d}T00:00:00`).toLocaleString("en-US", { month: "short", day: "numeric" }) : "");

  return (
    <>
      <PageHeader title={`Welcome, ${user?.name?.split(" — ")[0] ?? "Trade"}`} subtitle={`Your work on ${db.project.name}${tradeNames ? ` · ${tradeNames}` : ""}. You only see tasks, materials, and sign-offs for your trade.`} />

      {pendingConfirm.length > 0 && (
        <div className="card" style={{ padding: 14, marginTop: 14, borderLeft: "3px solid var(--brass)" }}>
          <strong style={{ fontSize: 13.5 }}>🔔 {pendingConfirm.length} date change{pendingConfirm.length === 1 ? "" : "s"} need your confirmation</strong>
          <div style={{ marginTop: 6 }}><Link href="/timing" className="btn btn-sm">Review in Timing →</Link></div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12, marginTop: 16 }}>
        <StatCard label="My Tasks" value={`${tasks.length}`} sub={`${tasks.filter((s) => s.status === "done").length} done`} />
        <StatCard label="In Progress" value={`${inProg}`} accent="var(--sage)" />
        <StatCard label="My Materials Due" value={`${matsDue.length}`} accent={matsDue.length ? "var(--rust)" : "var(--ok)"} sub="not yet purchased" />
        <StatCard label="My QC Sign-offs" value={`${qcSigned}/${qcTotal}`} sub="owner + builder" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 8 }} className="ever-two">
        <div>
          <SectionTitle right={<Link href="/timing" className="btn btn-sm">Schedule →</Link>}>My Schedule</SectionTitle>
          <div className="card" style={{ padding: 12 }}>
            {tasks.length ? tasks.slice(0, 8).map((s) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--line)", fontSize: 12.5 }}>
                <span style={{ flex: 1 }}>{s.label}</span>
                <span style={{ color: "var(--muted)" }}>{fmtD(s.start)}–{fmtD(s.end)}</span>
                <Pill color="#fff" bg={s.status === "done" ? "var(--ok)" : s.status === "in_progress" ? "var(--sage)" : s.status === "blocked" ? "var(--rust)" : "var(--sc-unset)"}>{s.status.replace("_", " ")}</Pill>
              </div>
            )) : <div style={{ fontSize: 13, color: "var(--muted)", padding: 8 }}>No tasks assigned to your trade yet.</div>}
          </div>
        </div>
        {canSeeMaterials && <div>
          <SectionTitle right={<Link href="/materials" className="btn btn-sm">Materials →</Link>}>My Materials Due</SectionTitle>
          <div className="card" style={{ padding: 12 }}>
            {matsDue.length ? matsDue.slice(0, 8).map(({ m, days }) => (
              <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--line)", fontSize: 12.5 }}>
                <Pill color="#fff" bg={days <= 7 ? "var(--rust)" : "var(--brass)"}>{days < 0 ? `${-days}d late` : `${days}d`}</Pill>
                <span style={{ flex: 1 }}>{m.item}</span>
                <span style={{ color: "var(--muted)" }}>due {fmtD(m.dueDate)}</span>
              </div>
            )) : <div style={{ fontSize: 13, color: "var(--muted)", padding: 8 }}>Nothing due — you’re clear.</div>}
          </div>
        </div>}
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

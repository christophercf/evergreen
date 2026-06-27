"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/data/hooks";
import { PageHeader, NoAccess, Pill, SectionTitle, Money, StatCard } from "../ui/bits";
import {
  accessFor, SCHEDULE_LABEL, type ScheduleItem, type ScheduleStatus, type MacroCategory,
} from "@/lib/data/types";
import { tradeCost, tradeName, MACRO_COLOR, fmt } from "@/lib/data/money";

const DAY = 86400000;
const MONTH_W = 58; // px per month column
const ROW_H = 34;
const LABEL_W = 270;

const parse = (d: string) => new Date(`${d}T00:00:00`).getTime();
function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
const STATUS_COLOR: Record<ScheduleStatus, string> = {
  not_started: "var(--sc-unset)", in_progress: "var(--sage)", blocked: "var(--rust)", done: "var(--ok)",
};

export default function TimingPage() {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const user = store.currentUser;
  const access = accessFor(user, role, "timing");
  const [openId, setOpenId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const catOf = (tradeId?: string): MacroCategory | undefined => db.trades.find((t) => t.id === tradeId)?.category;
  const colorOf = (s: ScheduleItem) => (s.kind === "milestone" ? "var(--walnut)" : MACRO_COLOR[catOf(s.tradeId) ?? "Soft Costs"]);

  // QC progress for a trade (signed items / in-scope included items).
  const qc = useMemo(() => {
    const m = new Map<string, { signed: number; total: number }>();
    for (const c of db.scope) {
      if (c.status !== "in") continue;
      const cur = m.get(c.tradeId) ?? { signed: 0, total: 0 };
      for (const it of c.items) {
        if (!it.included) continue;
        cur.total++;
        if (it.done) cur.signed++;
      }
      m.set(c.tradeId, cur);
    }
    return m;
  }, [db.scope]);

  // Timeline bounds (snap to month edges).
  const { rangeStart, rangeEnd, months, totalW } = useMemo(() => {
    const starts = db.schedule.map((s) => parse(s.start));
    const ends = db.schedule.map((s) => parse(s.end));
    const min = new Date(Math.min(...starts));
    const max = new Date(Math.max(...ends));
    const rs = new Date(min.getFullYear(), min.getMonth(), 1).getTime();
    const reEnd = new Date(max.getFullYear(), max.getMonth() + 1, 0).getTime();
    const ms: { label: string; t: number }[] = [];
    const d = new Date(rs);
    while (d.getTime() <= reEnd) {
      ms.push({ label: d.toLocaleString("en-US", { month: "short", year: "2-digit" }), t: d.getTime() });
      d.setMonth(d.getMonth() + 1);
    }
    return { rangeStart: rs, rangeEnd: reEnd, months: ms, totalW: ms.length * MONTH_W };
  }, [db.schedule]);

  const x = (ms: number) => ((ms - rangeStart) / (rangeEnd - rangeStart)) * totalW;
  const todayMs = mounted ? Date.now() : 0;
  const todayX = mounted && todayMs >= rangeStart && todayMs <= rangeEnd ? x(todayMs) : null;

  if (access === "none") return <NoAccess module="Timing" />;
  const ro = access !== "edit";

  // Summary
  const distinctTrades = [...new Set(db.schedule.map((s) => s.tradeId).filter(Boolean) as string[])];
  const scheduledCost = distinctTrades.reduce((a, id) => a + tradeCost(db, id), 0);
  const done = db.schedule.filter((s) => s.status === "done").length;
  const inProg = db.schedule.filter((s) => s.status === "in_progress").length;
  const span = `${new Date(rangeStart).toLocaleString("en-US", { month: "short", day: "numeric" })} – ${new Date(Math.max(...db.schedule.map((s) => parse(s.end)))).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  return (
    <>
      <PageHeader
        title="Timing"
        subtitle="The live construction schedule. Each bar is paired to Building Costs — its cost is pulled from the cost lines, and drilling in lets the owner and builder sign off scope for quality control."
        right={<Link href="/costs" className="btn btn-sm">Paired with Building Costs →</Link>}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12, marginTop: 16 }}>
        <StatCard label="Schedule Window" value={<span style={{ fontSize: 18 }}>{span}</span>} sub={`${db.schedule.length} tasks`} />
        <StatCard label="Scheduled Trades Cost" value={<Money value={scheduledCost} />} sub="pulled from Building Costs" accent="var(--brass-2)" />
        <StatCard label="In Progress" value={`${inProg}`} sub={`${done} done`} accent="var(--sage)" />
        <StatCard label="QC Sign-offs" value={`${[...qc.values()].reduce((a, v) => a + v.signed, 0)}/${[...qc.values()].reduce((a, v) => a + v.total, 0)}`} sub="owner + builder" />
      </div>

      <SectionTitle right={
        <div style={{ display: "flex", gap: 12, fontSize: 11.5, color: "var(--muted)", flexWrap: "wrap" }}>
          {(["not_started", "in_progress", "done", "blocked"] as ScheduleStatus[]).map((s) => (
            <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 11, height: 11, borderRadius: 3, background: STATUS_COLOR[s] }} />{SCHEDULE_LABEL[s]}
            </span>
          ))}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ color: "var(--rust)" }}>▎</span>today</span>
        </div>
      }>
        Gantt Chart
      </SectionTitle>

      <div className="card" style={{ overflowX: "auto", padding: 0 }}>
        <div style={{ position: "relative", width: LABEL_W + totalW, minWidth: "100%" }}>
          {/* Month header */}
          <div style={{ display: "flex", borderBottom: "1px solid var(--line)", position: "sticky", top: 0, background: "var(--paper)", zIndex: 3 }}>
            <div style={{ width: LABEL_W, flexShrink: 0, position: "sticky", left: 0, background: "var(--paper)", zIndex: 4, padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em", borderRight: "1px solid var(--line)" }}>Task</div>
            <div style={{ position: "relative", width: totalW, height: 30 }}>
              {months.map((m, i) => (
                <div key={i} style={{ position: "absolute", left: i * MONTH_W, top: 0, width: MONTH_W, height: 30, borderRight: "1px solid var(--line)", fontSize: 10.5, color: "var(--muted)", padding: "8px 0 0 6px", fontWeight: 600 }}>{m.label}</div>
              ))}
            </div>
          </div>

          {/* Rows */}
          {db.schedule.map((s) => {
            const left = x(parse(s.start));
            const w = Math.max(s.kind === "milestone" ? 0 : 6, x(parse(s.end)) - left);
            const cat = colorOf(s);
            const prog = s.tradeId ? qc.get(s.tradeId) : undefined;
            const frac = prog && prog.total ? prog.signed / prog.total : s.status === "done" ? 1 : s.status === "in_progress" ? 0.4 : 0;
            const cost = s.tradeId ? tradeCost(db, s.tradeId) : 0;
            const isOpen = openId === s.id;
            return (
              <div key={s.id}>
                <div style={{ display: "flex", alignItems: "stretch", borderBottom: "1px solid var(--line)", background: isOpen ? "var(--sage-tint)" : undefined }}>
                  {/* Label */}
                  <button
                    onClick={() => setOpenId(isOpen ? null : s.id)}
                    style={{ width: LABEL_W, flexShrink: 0, position: "sticky", left: 0, zIndex: 2, background: isOpen ? "var(--sage-tint)" : "var(--paper)", borderRight: "1px solid var(--line)", border: "none", borderBottom: "none", textAlign: "left", padding: "5px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 7 }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: 99, background: STATUS_COLOR[s.status], flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</span>
                      <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
                        {s.kind === "milestone" ? "Milestone" : s.kind === "procurement" ? "Procurement" : tradeName(db, s.tradeId!)}
                        {cost > 0 && <> · {fmt(cost)}</>}
                      </span>
                    </span>
                  </button>
                  {/* Timeline */}
                  <div style={{ position: "relative", width: totalW, height: ROW_H }}>
                    {months.map((_, i) => (
                      <div key={i} style={{ position: "absolute", left: i * MONTH_W, top: 0, bottom: 0, width: 1, background: "var(--line)", opacity: .5 }} />
                    ))}
                    {s.kind === "milestone" ? (
                      <div title={SCHEDULE_LABEL[s.status]} style={{ position: "absolute", left: left - 7, top: ROW_H / 2 - 7, width: 14, height: 14, background: "var(--walnut)", transform: "rotate(45deg)", borderRadius: 2 }} />
                    ) : (
                      <div title={`${s.label} · ${s.durationLabel ?? ""}`} style={{ position: "absolute", left, top: 6, width: w, height: ROW_H - 12, borderRadius: 5, background: hexA(typeof cat === "string" && cat.startsWith("#") ? cat : "#6b7f5b", 0.28), border: `1px solid ${s.status === "blocked" ? "var(--rust)" : s.status === "done" ? "var(--ok)" : hexA(typeof cat === "string" && cat.startsWith("#") ? cat : "#6b7f5b", 0.9)}`, overflow: "hidden", display: "flex", alignItems: "center" }}>
                        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${frac * 100}%`, background: typeof cat === "string" && cat.startsWith("#") ? cat : "var(--sage)", opacity: .85 }} />
                        {w > 42 && <span style={{ position: "relative", fontSize: 9.5, fontWeight: 700, color: frac > 0.5 ? "#fff" : "var(--ink)", padding: "0 5px", whiteSpace: "nowrap" }}>{s.durationLabel}</span>}
                      </div>
                    )}
                  </div>
                </div>
                {isOpen && <Drilldown item={s} ro={ro} onJump={() => setOpenId(null)} />}
              </div>
            );
          })}

          {/* Today line */}
          {todayX !== null && (
            <div style={{ position: "absolute", left: LABEL_W + todayX, top: 0, bottom: 0, width: 2, background: "var(--rust)", zIndex: 1, pointerEvents: "none" }} />
          )}
        </div>
      </div>

      <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>
        Imported from the live Google Sheet schedule. Bars fill with QC sign-off progress. Click a task to check off scope and sign off — the cost shown is live from <Link href="/costs" style={{ color: "var(--sage-2)", fontWeight: 600 }}>Building Costs</Link>.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
function Drilldown({ item, ro, onJump }: { item: ScheduleItem; ro: boolean; onJump: () => void }) {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const name = store.session.displayName;

  if (!item.tradeId) {
    return (
      <div style={{ padding: "12px 16px 16px", background: "var(--cream)", borderBottom: "1px solid var(--line)" }}>
        <p style={{ fontSize: 13, color: "var(--muted)" }}>
          {item.kind === "milestone" ? "Milestone — no trade scope to sign off." : "Procurement task."} {item.durationLabel} · {item.start} → {item.end}
        </p>
        {!ro && <StatusRow item={item} />}
      </div>
    );
  }

  const lineTotalAll = tradeCost(db, item.tradeId);
  const cells = db.scope.filter((c) => c.tradeId === item.tradeId && c.status === "in");

  const ownerCanSign = role === "owner";
  const builderCanSign = role === "builder";

  return (
    <div style={{ padding: "12px 16px 18px", background: "var(--cream)", borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <strong style={{ fontSize: 13.5 }}>{tradeName(db, item.tradeId)}</strong>
        <Pill bg="var(--sage-tint)">{item.durationLabel} · {item.start} → {item.end}</Pill>
        <span style={{ marginLeft: "auto", fontSize: 13 }}>Cost from Building Costs: <strong><Money value={lineTotalAll} /></strong></span>
        <Link href="/costs" className="btn btn-sm" onClick={onJump}>Open in Building Costs →</Link>
      </div>
      {!ro && <StatusRow item={item} />}

      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)", margin: "12px 0 6px" }}>
        Quality-control sign-off — both owner &amp; builder
      </div>
      {!cells.length && <p style={{ fontSize: 12.5, color: "var(--muted)" }}>No in-scope rooms for this trade yet. Set scope in Administrative → Trade Scope.</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {cells.map((c) => {
          const room = db.rooms.find((r) => r.id === c.roomId);
          const items = c.items.filter((i) => i.included);
          if (!items.length) return null;
          return (
            <div key={c.roomId} className="card" style={{ padding: "8px 12px" }}>
              <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 6 }}>{room?.name}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {items.map((it) => (
                  <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                    <span style={{ flex: 1, color: it.done ? "var(--ok)" : "var(--ink)", fontWeight: it.done ? 600 : 400 }}>
                      {it.done ? "✓ " : ""}{it.label}
                    </span>
                    <SignBtn label="Owner" signed={!!it.ownerSignedBy} who={it.ownerSignedBy} disabled={!ownerCanSign}
                      onClick={() => store.signoffScopeItem(c.roomId, item.tradeId!, it.id, "owner", name)} />
                    <SignBtn label="Builder" signed={!!it.builderSignedBy} who={it.builderSignedBy} disabled={!builderCanSign}
                      onClick={() => store.signoffScopeItem(c.roomId, item.tradeId!, it.id, "builder", name)} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>
        You’re signing as <strong>{name}</strong> ({role}). {role === "owner" ? "Builder sign-off is locked to a builder account." : role === "builder" ? "Owner sign-off is locked to an owner account." : "Switch to the owner or builder persona to sign."}
      </p>
    </div>
  );
}

function StatusRow({ item }: { item: ScheduleItem }) {
  const store = useStore();
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {(["not_started", "in_progress", "blocked", "done"] as ScheduleStatus[]).map((s) => (
        <button key={s} className="btn btn-sm" onClick={() => store.setScheduleStatus(item.id, s)}
          style={{ background: item.status === s ? STATUS_COLOR[s] : "var(--paper)", color: item.status === s ? "#fff" : "var(--ink)", borderColor: item.status === s ? STATUS_COLOR[s] : "var(--line)" }}>
          {SCHEDULE_LABEL[s]}
        </button>
      ))}
    </div>
  );
}

function SignBtn({ label, signed, who, disabled, onClick }: { label: string; signed: boolean; who?: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled && !signed} title={who ? `Signed by ${who}` : `${label} sign-off`}
      className="btn btn-sm"
      style={{ minWidth: 74, background: signed ? "var(--ok)" : "var(--paper)", color: signed ? "#fff" : disabled ? "var(--muted)" : "var(--ink)", borderColor: signed ? "var(--ok)" : "var(--line)", opacity: disabled && !signed ? 0.6 : 1 }}>
      {signed ? `✓ ${label}` : label}
    </button>
  );
}

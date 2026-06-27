"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/data/hooks";
import { PageHeader, NoAccess, Pill, SectionTitle, Money, StatCard } from "../ui/bits";
import {
  accessFor, SCHEDULE_LABEL, type ScheduleItem, type ScheduleStatus, type MacroCategory,
} from "@/lib/data/types";
import { tradeCost, tradeName, MACRO_COLOR, fmt } from "@/lib/data/money";
import { qcRecommendations } from "@/lib/data/qc";

const DAY = 86400000;
const MONTH_W = 58;
const ROW_H = 34;
const LABEL_W = 270;

const parse = (d: string) => new Date(`${d}T00:00:00`).getTime();
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const fmtD = (d: string) => new Date(`${d}T00:00:00`).toLocaleString("en-US", { month: "short", day: "numeric" });
const fmtTs = (s?: string) => (s ? new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
const STATUS_COLOR: Record<ScheduleStatus, string> = {
  not_started: "var(--sc-unset)", in_progress: "var(--sage)", blocked: "var(--rust)", done: "var(--ok)",
};

type Cascade = { sourceId: string; deltaDays: number; deps: ScheduleItem[] } | null;

export default function TimingPage() {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const user = store.currentUser;
  const access = accessFor(user, role, "timing");
  const [openId, setOpenId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [cascade, setCascade] = useState<Cascade>(null);
  useEffect(() => setMounted(true), []);

  const canEdit = role === "builder" && access === "edit"; // only the builder adjusts timing
  const ownerView = role === "owner"; // owner sees confirmed dates only

  const catOf = (tradeId?: string): MacroCategory | undefined => db.trades.find((t) => t.id === tradeId)?.category;
  const colorOf = (s: ScheduleItem) => (s.kind === "milestone" ? "var(--walnut)" : MACRO_COLOR[catOf(s.tradeId) ?? "Soft Costs"]);

  // Bar dates depend on role: owner sees the trade-confirmed dates only.
  const datesOf = (s: ScheduleItem): [number, number] =>
    ownerView ? [parse(s.confirmedStart ?? s.start), parse(s.confirmedEnd ?? s.end)] : [parse(s.start), parse(s.end)];

  const qc = useMemo(() => {
    const m = new Map<string, { signed: number; total: number }>();
    for (const c of db.scope) {
      if (c.status !== "in") continue;
      const cur = m.get(c.tradeId) ?? { signed: 0, total: 0 };
      for (const it of c.items) { if (!it.included) continue; cur.total++; if (it.done) cur.signed++; }
      m.set(c.tradeId, cur);
    }
    return m;
  }, [db.scope]);

  const { rangeStart, rangeEnd, months, totalW, pxPerDay } = useMemo(() => {
    const all = db.schedule.flatMap((s) => [parse(s.start), parse(s.end), parse(s.confirmedStart ?? s.start), parse(s.confirmedEnd ?? s.end)]);
    const min = new Date(Math.min(...all));
    const max = new Date(Math.max(...all));
    const rs = new Date(min.getFullYear(), min.getMonth(), 1).getTime();
    const reEnd = new Date(max.getFullYear(), max.getMonth() + 1, 0).getTime();
    const ms: { label: string; t: number }[] = [];
    const d = new Date(rs);
    while (d.getTime() <= reEnd) { ms.push({ label: d.toLocaleString("en-US", { month: "short", year: "2-digit" }), t: d.getTime() }); d.setMonth(d.getMonth() + 1); }
    const tw = ms.length * MONTH_W;
    return { rangeStart: rs, rangeEnd: reEnd, months: ms, totalW: tw, pxPerDay: tw / ((reEnd - rs) / DAY) };
  }, [db.schedule]);

  const x = (ms: number) => ((ms - rangeStart) / (rangeEnd - rangeStart)) * totalW;
  const todayX = mounted && Date.now() >= rangeStart && Date.now() <= rangeEnd ? x(Date.now()) : null;

  // ---- drag state ----
  const [drag, setDrag] = useState<{ id: string; startX: number; days: number } | null>(null);
  const dragRef = useRef<{ id: string; startX: number; days: number } | null>(null);

  function commitMove(s: ScheduleItem, deltaDays: number) {
    if (!deltaDays) return;
    const [ns, ne] = datesOf(s);
    const newStart = iso(ns + deltaDays * DAY);
    const newEnd = iso(ne + deltaDays * DAY);
    store.pushSchedule(s.id, newStart, newEnd);
    // Pushed back + has dependents → prompt to cascade.
    const deps = store.dependentsOf(s.id);
    if (deltaDays > 0 && deps.length) setCascade({ sourceId: s.id, deltaDays, deps });
  }

  function applyDate(s: ScheduleItem, start: string, end: string) {
    const prevEnd = parse(s.confirmedEnd ?? s.end);
    store.pushSchedule(s.id, start, end);
    const deltaDays = Math.round((parse(end) - prevEnd) / DAY);
    const deps = store.dependentsOf(s.id);
    if (deltaDays > 0 && deps.length) setCascade({ sourceId: s.id, deltaDays, deps });
  }

  if (access === "none") return <NoAccess module="Timing" />;

  const distinctTrades = [...new Set(db.schedule.map((s) => s.tradeId).filter(Boolean) as string[])];
  const scheduledCost = distinctTrades.reduce((a, id) => a + tradeCost(db, id), 0);
  const pending = db.schedule.filter((s) => s.confirm === "pending");
  const notifs = store.notificationsFor(user, role).filter((n) => !n.read);

  return (
    <>
      <PageHeader
        title="Timing"
        subtitle={
          canEdit ? "Drag a bar or use the date boxes to reschedule. Pushing a task back prompts you to shift its dependents and asks the assigned trade to confirm."
          : ownerView ? "The approved construction schedule. You see dates once the trade has confirmed them with the builder."
          : "Your assigned tasks. Confirm the dates the builder proposes so they’re locked into the owner’s view."
        }
        right={<Link href="/costs" className="btn btn-sm">Paired with Building Costs →</Link>}
      />

      {(role === "builder" || role === "trade") && notifs.length > 0 && (
        <div className="card" style={{ padding: 12, marginTop: 14, borderLeft: "3px solid var(--brass)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <strong style={{ fontSize: 13 }}>🔔 {notifs.length} update{notifs.length === 1 ? "" : "s"}</strong>
            <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => store.clearNotifications(user, role)}>Mark all read</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {notifs.slice(0, 6).map((n) => (
              <div key={n.id} style={{ fontSize: 12.5, color: "var(--ink)", display: "flex", gap: 8 }}>
                <span style={{ color: "var(--muted)", flexShrink: 0 }}>{fmtTs(n.createdAt)}</span>
                <span>{n.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12, marginTop: 16 }}>
        <StatCard label="Scheduled Trades Cost" value={<Money value={scheduledCost} />} sub="live from Building Costs" accent="var(--brass-2)" />
        <StatCard label="Tasks" value={`${db.schedule.length}`} sub={`${db.schedule.filter((s) => s.status === "done").length} done`} />
        <StatCard label="Awaiting Trade Confirm" value={`${pending.length}`} accent={pending.length ? "var(--rust)" : "var(--ok)"} sub="date changes pending" />
        <StatCard label="QC Sign-offs" value={`${[...qc.values()].reduce((a, v) => a + v.signed, 0)}/${[...qc.values()].reduce((a, v) => a + v.total, 0)}`} sub="owner + builder" />
      </div>

      <SectionTitle right={
        <div style={{ display: "flex", gap: 12, fontSize: 11.5, color: "var(--muted)", flexWrap: "wrap" }}>
          {(["not_started", "in_progress", "done", "blocked"] as ScheduleStatus[]).map((s) => (
            <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 11, height: 11, borderRadius: 3, background: STATUS_COLOR[s] }} />{SCHEDULE_LABEL[s]}</span>
          ))}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ color: "var(--rust)" }}>▎</span>today</span>
        </div>
      }>
        Gantt Chart {canEdit && <span style={{ fontSize: 12, fontWeight: 400, color: "var(--muted)" }}>— drag bars to reschedule</span>}
      </SectionTitle>

      {/* maxHeight + sticky header → the column header stays put while you scroll the grid */}
      <div className="card" style={{ padding: 0, overflow: "auto", maxHeight: "68vh" }}>
        <div style={{ position: "relative", width: LABEL_W + totalW, minWidth: "100%" }}>
          <div style={{ display: "flex", position: "sticky", top: 0, background: "var(--paper)", zIndex: 5, borderBottom: "1px solid var(--line)" }}>
            <div style={{ width: LABEL_W, flexShrink: 0, position: "sticky", left: 0, background: "var(--paper)", zIndex: 6, padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em", borderRight: "1px solid var(--line)" }}>Task</div>
            <div style={{ position: "relative", width: totalW, height: 30 }}>
              {months.map((m, i) => (
                <div key={i} style={{ position: "absolute", left: i * MONTH_W, top: 0, width: MONTH_W, height: 30, borderRight: "1px solid var(--line)", fontSize: 10.5, color: "var(--muted)", padding: "8px 0 0 6px", fontWeight: 600 }}>{m.label}</div>
              ))}
            </div>
          </div>

          {db.schedule.map((s) => {
            const [ds, de] = datesOf(s);
            const dDays = drag?.id === s.id ? drag.days : 0;
            const left = x(ds + dDays * DAY);
            const w = Math.max(s.kind === "milestone" ? 0 : 6, x(de + dDays * DAY) - left);
            const cat = colorOf(s);
            const barColor = typeof cat === "string" && cat.startsWith("#") ? cat : "#6b7f5b";
            const prog = s.tradeId ? qc.get(s.tradeId) : undefined;
            const frac = prog && prog.total ? prog.signed / prog.total : s.status === "done" ? 1 : s.status === "in_progress" ? 0.4 : 0;
            const cost = s.tradeId ? tradeCost(db, s.tradeId) : 0;
            const isOpen = openId === s.id;
            const isPending = s.confirm === "pending" && !ownerView;
            return (
              <div key={s.id}>
                <div style={{ display: "flex", alignItems: "stretch", borderBottom: "1px solid var(--line)", background: isOpen ? "var(--sage-tint)" : undefined }}>
                  <button onClick={() => setOpenId(isOpen ? null : s.id)}
                    style={{ width: LABEL_W, flexShrink: 0, position: "sticky", left: 0, zIndex: 2, background: isOpen ? "var(--sage-tint)" : "var(--paper)", borderRight: "1px solid var(--line)", border: "none", textAlign: "left", padding: "5px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 99, background: STATUS_COLOR[s.status], flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</span>
                      <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
                        {s.kind === "milestone" ? "Milestone" : s.kind === "procurement" ? "Procurement" : tradeName(db, s.tradeId!)}
                        {cost > 0 && <> · {fmt(cost)}</>}
                        {isPending && <> · <span style={{ color: "var(--rust)" }}>pending confirm</span></>}
                        {(s.deps?.length ?? 0) > 0 && <> · ⛓ {s.deps!.length}</>}
                      </span>
                    </span>
                  </button>
                  <div style={{ position: "relative", width: totalW, height: ROW_H }}>
                    {months.map((_, i) => (<div key={i} style={{ position: "absolute", left: i * MONTH_W, top: 0, bottom: 0, width: 1, background: "var(--line)", opacity: .5 }} />))}
                    {s.kind === "milestone" ? (
                      <div title={SCHEDULE_LABEL[s.status]} style={{ position: "absolute", left: left - 7, top: ROW_H / 2 - 7, width: 14, height: 14, background: "var(--walnut)", transform: "rotate(45deg)", borderRadius: 2 }} />
                    ) : (
                      <div
                        title={`${s.label} · ${s.durationLabel ?? ""}${canEdit ? " · drag to move" : ""}`}
                        onPointerDown={(e) => {
                          if (!canEdit) return;
                          e.currentTarget.setPointerCapture(e.pointerId);
                          dragRef.current = { id: s.id, startX: e.clientX, days: 0 };
                          setDrag({ id: s.id, startX: e.clientX, days: 0 });
                        }}
                        onPointerMove={(e) => {
                          if (!dragRef.current || dragRef.current.id !== s.id) return;
                          const days = Math.round((e.clientX - dragRef.current.startX) / pxPerDay);
                          if (days !== dragRef.current.days) { dragRef.current.days = days; setDrag({ id: s.id, startX: dragRef.current.startX, days }); }
                        }}
                        onPointerUp={() => {
                          if (!dragRef.current || dragRef.current.id !== s.id) return;
                          const days = dragRef.current.days;
                          dragRef.current = null; setDrag(null);
                          if (days) commitMove(s, days);
                        }}
                        style={{
                          position: "absolute", left, top: 6, width: w, height: ROW_H - 12, borderRadius: 5,
                          background: hexA(barColor, 0.28),
                          border: isPending ? "1.5px dashed var(--rust)" : `1px solid ${s.status === "blocked" ? "var(--rust)" : s.status === "done" ? "var(--ok)" : hexA(barColor, 0.9)}`,
                          overflow: "hidden", display: "flex", alignItems: "center", cursor: canEdit ? "grab" : "pointer", touchAction: "none",
                        }}>
                        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${frac * 100}%`, background: barColor, opacity: .85 }} />
                        {w > 42 && <span style={{ position: "relative", fontSize: 9.5, fontWeight: 700, color: frac > 0.5 ? "#fff" : "var(--ink)", padding: "0 5px", whiteSpace: "nowrap" }}>{s.durationLabel}</span>}
                      </div>
                    )}
                  </div>
                </div>
                {isOpen && <Drilldown item={s} canEdit={canEdit} onApplyDate={applyDate} onJump={() => setOpenId(null)} />}
              </div>
            );
          })}

          {todayX !== null && <div style={{ position: "absolute", left: LABEL_W + todayX, top: 0, bottom: 0, width: 2, background: "var(--rust)", zIndex: 1, pointerEvents: "none" }} />}
        </div>
      </div>

      <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>
        Imported from the live schedule. Bars fill with QC sign-off progress; cost is live from <Link href="/costs" style={{ color: "var(--sage-2)", fontWeight: 600 }}>Building Costs</Link>.
        {!canEdit && role !== "owner" && " Only the builder can change dates."}
      </p>

      {cascade && <CascadeModal cascade={cascade} onClose={() => setCascade(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
function CascadeModal({ cascade, onClose }: { cascade: NonNullable<Cascade>; onClose: () => void }) {
  const store = useStore();
  const db = store.db;
  const [sel, setSel] = useState<Set<string>>(new Set(cascade.deps.map((d) => d.id)));
  const src = db.schedule.find((s) => s.id === cascade.sourceId);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(44,36,28,.45)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div className="card" style={{ maxWidth: 520, width: "100%", padding: 22 }} onClick={(e) => e.stopPropagation()}>
        <h3 className="serif" style={{ fontSize: 18, fontWeight: 700, color: "var(--walnut)" }}>Shift dependent tasks?</h3>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "8px 0 12px" }}>
          “{src?.label}” moved back <strong>{cascade.deltaDays} day{cascade.deltaDays === 1 ? "" : "s"}</strong>. These tasks list it as a critical-path dependency. Shift the selected ones by the same amount?
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 240, overflow: "auto" }}>
          {cascade.deps.map((d) => (
            <label key={d.id} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7 }}>
              <input type="checkbox" checked={sel.has(d.id)} onChange={() => setSel((p) => { const n = new Set(p); n.has(d.id) ? n.delete(d.id) : n.add(d.id); return n; })} />
              <span style={{ flex: 1 }}>{d.label}</span>
              <span style={{ color: "var(--muted)" }}>{fmtD(d.start)} → {fmtD(d.end)}</span>
            </label>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button className="btn" onClick={onClose}>No, leave them</button>
          <button className="btn btn-primary" onClick={() => {
            cascade.deps.filter((d) => sel.has(d.id)).forEach((d) => {
              store.pushSchedule(d.id, iso(parse(d.start) + cascade.deltaDays * DAY), iso(parse(d.end) + cascade.deltaDays * DAY));
            });
            onClose();
          }}>Shift {sel.size} task{sel.size === 1 ? "" : "s"}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Drilldown({ item, canEdit, onApplyDate, onJump }: { item: ScheduleItem; canEdit: boolean; onApplyDate: (s: ScheduleItem, start: string, end: string) => void; onJump: () => void }) {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const name = store.session.displayName;
  const user = store.currentUser;

  const [start, setStart] = useState(item.start);
  const [end, setEnd] = useState(item.end);
  useEffect(() => { setStart(item.start); setEnd(item.end); }, [item.start, item.end]);

  const isAssignedTrade = role === "trade" && item.assignedUserId === user?.id;
  const cells = item.tradeId ? db.scope.filter((c) => c.tradeId === item.tradeId && c.status === "in") : [];
  const recs = qcRecommendations(item.tradeId);
  const ownerCanSign = role === "owner";
  const builderCanSign = role === "builder";

  return (
    <div style={{ padding: "12px 16px 18px", background: "var(--cream)", borderBottom: "1px solid var(--line)" }}>
      {/* Dates / scheduling */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13.5 }}>{item.tradeId ? tradeName(db, item.tradeId) : item.kind}</strong>
        {item.tradeId && <span style={{ fontSize: 13 }}>Cost: <strong><Money value={tradeCost(db, item.tradeId)} /></strong></span>}
        <ConfirmBadge item={item} />
        {item.tradeId && <Link href="/costs" className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={onJump}>Open in Building Costs →</Link>}
      </div>

      {canEdit ? (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginTop: 12 }}>
          <label style={{ fontSize: 11.5, color: "var(--muted)" }}>Start<br /><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label style={{ fontSize: 11.5, color: "var(--muted)" }}>End<br /><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
          <button className="btn btn-primary" disabled={start === item.start && end === item.end} onClick={() => onApplyDate(item, start, end)}>Apply dates</button>
          <div style={{ display: "flex", gap: 4, marginLeft: 8 }}>
            {(["not_started", "in_progress", "blocked", "done"] as ScheduleStatus[]).map((st) => (
              <button key={st} className="btn btn-sm" onClick={() => store.setScheduleStatus(item.id, st)}
                style={{ background: item.status === st ? STATUS_COLOR[st] : "var(--paper)", color: item.status === st ? "#fff" : "var(--ink)", borderColor: item.status === st ? STATUS_COLOR[st] : "var(--line)" }}>{SCHEDULE_LABEL[st]}</button>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>
          {role === "owner"
            ? <>Confirmed: <strong>{fmtD(item.confirmedStart ?? item.start)} → {fmtD(item.confirmedEnd ?? item.end)}</strong></>
            : <>Proposed: <strong>{fmtD(item.start)} → {fmtD(item.end)}</strong>{item.durationLabel ? ` · ${item.durationLabel}` : ""}</>}
        </div>
      )}

      {/* Dependencies editor (builder) */}
      {canEdit && <DepsEditor item={item} />}

      {/* Trade confirmation */}
      {isAssignedTrade && item.confirm === "pending" && (
        <div className="card" style={{ padding: 12, marginTop: 12, borderLeft: "3px solid var(--brass)" }}>
          <div style={{ fontSize: 13, marginBottom: 8 }}>The builder proposed <strong>{fmtD(item.start)} → {fmtD(item.end)}</strong> for your work. Confirm so it locks into the owner’s view.</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" onClick={() => store.respondSchedule(item.id, true, name)}>✓ Confirm dates</button>
            <button className="btn" onClick={() => store.respondSchedule(item.id, false, name)}>Decline</button>
          </div>
        </div>
      )}
      {item.confirm === "confirmed" && item.confirmedBy && (
        <div style={{ fontSize: 11.5, color: "var(--ok)", marginTop: 8 }}>✓ Confirmed by {item.confirmedBy} · {fmtTs(item.confirmedAt)}</div>
      )}

      {/* QC */}
      {item.tradeId && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)", margin: "14px 0 6px" }}>
            Recommended QC checks — {tradeName(db, item.tradeId)}
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "var(--ink)", display: "flex", flexDirection: "column", gap: 3 }}>
            {recs.map((r, i) => <li key={i}>{r}</li>)}
          </ul>

          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)", margin: "14px 0 6px" }}>
            Sign-off by room — both owner &amp; builder
          </div>
          {!cells.length && <p style={{ fontSize: 12.5, color: "var(--muted)" }}>No in-scope rooms yet (set in Administrative → Trade Scope).</p>}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {cells.map((c) => {
              const room = db.rooms.find((r) => r.id === c.roomId);
              const items = c.items.filter((i) => i.included);
              if (!items.length) return null;
              const otherTrades = db.scope.filter((o) => o.roomId === c.roomId && o.status === "in" && o.tradeId !== item.tradeId).map((o) => tradeName(db, o.tradeId));
              return (
                <div key={c.roomId} className="card" style={{ padding: "8px 12px" }}>
                  <div style={{ fontWeight: 600, fontSize: 12.5 }}>{room?.name}</div>
                  {otherTrades.length > 0 && <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Also in this room: {otherTrades.join(", ")} — coordinate sequencing before sign-off.</div>}
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 4 }}>
                    {items.map((it) => (
                      <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                        <span style={{ flex: 1, color: it.done ? "var(--ok)" : "var(--ink)", fontWeight: it.done ? 600 : 400 }}>{it.done ? "✓ " : ""}{it.label}</span>
                        <SignBtn label="Owner" signed={!!it.ownerSignedBy} who={it.ownerSignedBy} at={it.ownerSignedAt} disabled={!ownerCanSign} onClick={() => store.signoffScopeItem(c.roomId, item.tradeId!, it.id, "owner", name)} />
                        <SignBtn label="Builder" signed={!!it.builderSignedBy} who={it.builderSignedBy} at={it.builderSignedAt} disabled={!builderCanSign} onClick={() => store.signoffScopeItem(c.roomId, item.tradeId!, it.id, "builder", name)} />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function ConfirmBadge({ item }: { item: ScheduleItem }) {
  if (!item.assignedUserId) return null;
  if (item.confirm === "pending") return <Pill color="#fff" bg="var(--rust)">awaiting trade confirm</Pill>;
  if (item.confirm === "declined") return <Pill color="#fff" bg="var(--rust)">trade declined</Pill>;
  return <Pill color="#fff" bg="var(--ok)">trade-confirmed</Pill>;
}

function DepsEditor({ item }: { item: ScheduleItem }) {
  const store = useStore();
  const db = store.db;
  const [adding, setAdding] = useState(false);
  const deps = item.deps ?? [];
  const candidates = db.schedule.filter((s) => s.id !== item.id && !deps.includes(s.id));
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 6 }}>Critical-path dependencies</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        {deps.map((d) => {
          const dep = db.schedule.find((s) => s.id === d);
          return (
            <span key={d} className="pill" style={{ background: "var(--sage-tint)", color: "var(--ink)" }}>
              ⛓ {dep?.label ?? d}
              <button onClick={() => store.setScheduleDeps(item.id, deps.filter((x) => x !== d))} style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--rust)", marginLeft: 2 }}>✕</button>
            </span>
          );
        })}
        {!deps.length && <span style={{ fontSize: 12, color: "var(--muted)" }}>None — depends on no other task.</span>}
        {adding ? (
          <select autoFocus onChange={(e) => { if (e.target.value) { store.setScheduleDeps(item.id, [...deps, e.target.value]); setAdding(false); } }} defaultValue="">
            <option value="" disabled>Pick a predecessor…</option>
            {candidates.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        ) : (
          <button className="btn btn-sm" onClick={() => setAdding(true)}>+ Add dependency</button>
        )}
      </div>
    </div>
  );
}

function SignBtn({ label, signed, who, at, disabled, onClick }: { label: string; signed: boolean; who?: string; at?: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled && !signed} title={who ? `Signed by ${who}${at ? " · " + fmtTs(at) : ""}` : `${label} sign-off`}
      className="btn btn-sm"
      style={{ minWidth: 78, background: signed ? "var(--ok)" : "var(--paper)", color: signed ? "#fff" : disabled ? "var(--muted)" : "var(--ink)", borderColor: signed ? "var(--ok)" : "var(--line)", opacity: disabled && !signed ? 0.6 : 1 }}>
      {signed ? `✓ ${label}` : label}
    </button>
  );
}

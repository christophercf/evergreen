"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useStore } from "@/lib/data/hooks";
import { PageHeader, NoAccess, Pill, SectionTitle, StatCard } from "../ui/bits";
import {
  accessFor, awardedTradeIdSet, canReadFieldUpdate, fieldItemsFor, isArchitectUser, SCHEDULE_LABEL, type ScheduleItem, type ScheduleStatus, type MacroCategory,
} from "@/lib/data/types";
import { useNarrowViewport } from "../ui/desktop-only";
import { tradeName, romRows, fmt, macroOrder, macroColor } from "@/lib/data/money";
import { qcRecommendations } from "@/lib/data/qc";
import { conversationKeyOf, conversationUrl, emailsFor, MsgButton, pushEmail } from "../ui/messenger";

const DAY = 86400000;
const BASE_MONTH_W = 58;
const ROW_H = 34;
const LABEL_W = 250;

const parse = (d: string) => new Date(`${d}T00:00:00`).getTime();
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const fmtD = (d: string) => new Date(`${d}T00:00:00`).toLocaleString("en-US", { month: "short", day: "numeric" });
const fmtTs = (s?: string) => (s ? new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
// Human duration from a start/end (inclusive days → weeks/days).
function durLabel(start: string, end: string) {
  const days = Math.round((parse(end) - parse(start)) / DAY) + 1;
  if (days >= 7 && days % 7 === 0) return `${days / 7} wk`;
  if (days >= 12) return `${(days / 7).toFixed(1)} wk`;
  return `${days} d`;
}
function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
const STATUS_COLOR: Record<ScheduleStatus, string> = {
  not_started: "var(--sc-unset)", in_progress: "var(--sage)", blocked: "var(--rust)", done: "var(--ok)",
};

type Cascade = { sourceId: string; deltaDays: number; deps: ScheduleItem[] } | null;
type DragState = { id: string; startX: number; days: number; mode: "move" | "resize" } | null;

export default function TimingPage() {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const user = store.currentUser;
  const access = accessFor(user, role, "timing");
  const [openId, setOpenId] = useState<string | null>(null);
  // Phone: the schedule opens as a list (what needs attention), with the
  // fit-all chart one toggle away. Desktop keeps the Gantt untouched.
  const phone = useNarrowViewport();
  const [phoneView, setPhoneView] = useState<"list" | "chart">("list");
  const [mounted, setMounted] = useState(false);
  const [cascade, setCascade] = useState<Cascade>(null);
  const [zoom, setZoom] = useState(2);
  const [editing, setEditing] = useState(false);
  const [showOrig, setShowOrig] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const editSnapshot = useRef<Map<string, { start: string; end: string }>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoRef = useRef(false);
  const MONTH_W = Math.round(BASE_MONTH_W * zoom);
  useEffect(() => setMounted(true), []);
  // Visible width of the Gantt scroll pane — the drilldown pins itself to this
  // so it stays on-screen no matter how far the chart is scrolled (phones!).
  const [paneW, setPaneW] = useState<number | null>(null);
  useEffect(() => {
    const measure = () => setPaneW(scrollRef.current?.clientWidth ?? null);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  // Deep link from Messenger context chips: /timing?task=<id> opens that drilldown.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("task");
    if (id && store.db.schedule.some((s) => s.id === id)) setOpenId(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canEdit = (role === "builder" || role === "full_admin") && access === "edit";
  // Owner AND builder can add brand-new timeline items (drag-editing stays builder/admin).
  const canAdd = (role === "owner" || role === "builder" || role === "full_admin") && access === "edit";
  const ownerView = role === "owner";
  const canDrag = canEdit && editing;

  // Trades only see their own tasks (+ milestones for inspection context).
  // Trades see only their own bars — except the architect, who needs the whole schedule.
  const myTradeIds = role === "trade" && !isArchitectUser(user) ? new Set(user?.tradeIds ?? []) : null;
  const baseVisible = myTradeIds ? db.schedule.filter((s) => (s.tradeId && myTradeIds.has(s.tradeId)) || s.kind === "milestone") : db.schedule;
  // Display order: the hand-arranged custom order (▲▼), or by start date.
  const [rowSort, setRowSort] = useState<"custom" | "latest" | "earliest">("custom");
  const visible = rowSort === "custom" ? baseVisible
    : [...baseVisible].sort((a, b) => (rowSort === "latest" ? b.start.localeCompare(a.start) : a.start.localeCompare(b.start)));

  const catOf = (tradeId?: string): MacroCategory | undefined => db.trades.find((t) => t.id === tradeId)?.category;
  const colorOf = (s: ScheduleItem) => (s.kind === "milestone" ? "var(--walnut)" : macroColor(db, catOf(s.tradeId) ?? "Soft Costs"));
  // Owner sees confirmed dates; builder/editor see working dates.
  const datesOf = (s: ScheduleItem): [number, number] =>
    ownerView && !editing ? [parse(s.confirmedStart ?? s.start), parse(s.confirmedEnd ?? s.end)] : [parse(s.start), parse(s.end)];

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

  const { rangeStart, rangeEnd, months, totalW } = useMemo(() => {
    const all = db.schedule.flatMap((s) => [parse(s.start), parse(s.end), parse(s.origStart ?? s.start), parse(s.origEnd ?? s.end)]);
    const min = new Date(Math.min(...all));
    const max = new Date(Math.max(...all));
    const rs = new Date(min.getFullYear(), min.getMonth(), 1).getTime();
    const reEnd = new Date(max.getFullYear(), max.getMonth() + 1, 0).getTime();
    const ms: { label: string; t: number }[] = [];
    const d = new Date(rs);
    while (d.getTime() <= reEnd) { ms.push({ label: d.toLocaleString("en-US", { month: "short", year: "2-digit" }), t: d.getTime() }); d.setMonth(d.getMonth() + 1); }
    return { rangeStart: rs, rangeEnd: reEnd, months: ms, totalW: ms.length * MONTH_W };
  }, [db.schedule, MONTH_W]);

  const x = (ms: number) => ((ms - rangeStart) / (rangeEnd - rangeStart)) * totalW;
  const pxPerDay = totalW / ((rangeEnd - rangeStart) / DAY);
  const todayX = mounted && Date.now() >= rangeStart && Date.now() <= rangeEnd ? x(Date.now()) : null;

  // Auto-zoom to ~5 weeks and scroll to today, once.
  useEffect(() => {
    if (autoRef.current || !mounted) return;
    const el = scrollRef.current;
    if (!el) return;
    const avail = el.clientWidth - LABEL_W;
    if (avail <= 40) return;
    const wantPxPerDay = avail / 35;
    const z = Math.max(1, Math.min(6, (wantPxPerDay * 30.4) / BASE_MONTH_W));
    autoRef.current = true;
    setZoom(+z.toFixed(2));
  }, [mounted]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !autoRef.current) return;
    const nowX = Math.max(rangeStart, Math.min(Date.now(), rangeEnd));
    el.scrollLeft = Math.max(0, ((nowX - rangeStart) / (rangeEnd - rangeStart)) * totalW - 24);
  }, [totalW, rangeStart, rangeEnd]);

  const [drag, setDrag] = useState<DragState>(null);
  const dragRef = useRef<DragState>(null);
  // Grab the empty chart and drag it around. Anything interactive — a bar, its
  // resize handle, a button, a link — keeps its own gesture; panning only picks
  // up what nothing else claimed.
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [panning, setPanning] = useState(false);
  // Two fingers zoom the chart; one pans it. Zoom is the same state the
  // −/+ buttons drive, so the gesture and the buttons cannot disagree.
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());

  const startPan = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.current.size === 2) {
      const [a, b] = [...touches.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
      panRef.current = null;
      setPanning(false);
      return;
    }
    if ((e.target as HTMLElement).closest("button, a, input, textarea, select, [data-bar]")) return;
    const el = scrollRef.current;
    if (!el) return;
    panRef.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    setPanning(true);
    el.setPointerCapture(e.pointerId);
  };
  const movePan = (e: React.PointerEvent<HTMLDivElement>) => {
    if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pz = pinch.current;
    if (pz && touches.current.size === 2) {
      const [a, b] = [...touches.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pz.dist > 0) setZoom(+Math.max(1, Math.min(6, pz.zoom * (dist / pz.dist))).toFixed(2));
      return;
    }
    const p = panRef.current, el = scrollRef.current;
    if (!p || !el) return;
    el.scrollLeft = p.left - (e.clientX - p.x);
    el.scrollTop = p.top - (e.clientY - p.y);
  };
  const endPan = (e: React.PointerEvent<HTMLDivElement>) => {
    touches.current.delete(e.pointerId);
    if (touches.current.size < 2) pinch.current = null;
    if (!panRef.current) return;
    panRef.current = null;
    setPanning(false);
    scrollRef.current?.releasePointerCapture?.(e.pointerId);
  };
  // Multi-select (edit mode): checked bars move together when any of them is dragged.
  const [selIds, setSelIds] = useState<Set<string>>(new Set());
  const toggleSel = (id: string) => setSelIds((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  function applyDelta(s: ScheduleItem, mode: "move" | "resize", days: number) {
    if (!days) return;
    const [ns, ne] = datesOf(s);
    if (mode === "move") {
      store.editSchedule(s.id, iso(ns + days * DAY), iso(ne + days * DAY));
      const deps = store.dependentsOf(s.id);
      if (days > 0 && deps.length) setCascade({ sourceId: s.id, deltaDays: days, deps });
    } else {
      const newEnd = Math.max(ns + DAY, ne + days * DAY); // keep ≥ 1 day
      store.editSchedule(s.id, iso(ns), iso(newEnd));
    }
  }

  /** Shift every selected bar by the same number of days (group move). */
  function applyGroupDelta(days: number) {
    if (!days) return;
    selIds.forEach((id) => {
      const it = db.schedule.find((x) => x.id === id);
      if (!it) return;
      const [ns, ne] = datesOf(it);
      store.editSchedule(id, iso(ns + days * DAY), iso(ne + days * DAY));
    });
  }

  // edit-mode lifecycle
  function beginEdit() {
    const snap = new Map<string, { start: string; end: string }>();
    db.schedule.forEach((s) => snap.set(s.id, { start: s.start, end: s.end }));
    editSnapshot.current = snap;
    setSelIds(new Set());
    setEditing(true);
  }
  function cancelEdit() {
    editSnapshot.current.forEach((v, id) => {
      const s = db.schedule.find((x) => x.id === id);
      if (s && (s.start !== v.start || s.end !== v.end)) store.editSchedule(id, v.start, v.end);
    });
    setEditing(false);
    setSelIds(new Set());
    editSnapshot.current = new Map();
  }
  const pendingChanges = db.schedule
    .map((s) => { const o = editSnapshot.current.get(s.id); return o && (o.start !== s.start || o.end !== s.end) ? { itemId: s.id, label: s.label, fromStart: o.start, fromEnd: o.end, toStart: s.start, toEnd: s.end } : null; })
    .filter(Boolean) as { itemId: string; label: string; fromStart: string; fromEnd: string; toStart: string; toEnd: string }[];

  if (access === "none") return <NoAccess module="the Schedule" />;

  const pending = visible.filter((s) => s.confirm === "pending");
  const notifs = store.notificationsFor(user, role).filter((n) => !n.read);

  return (
    <>
      <PageHeader
        title="Schedule"
        subtitle={
          canEdit ? "Enter Edit mode to drag bars (move) or their right edge (length). Tick several rows to move them together. Publish to log the change with a reason, notify trades, and email the client."
          : ownerView ? "The approved construction schedule. You see dates once the trade has confirmed them."
          : "Your assigned tasks. Confirm the dates the builder proposes."
        }
      />

      {(role === "builder" || role === "trade" || role === "full_admin") && notifs.length > 0 && (
        <div className="card" style={{ padding: 12, marginTop: 14, borderLeft: "3px solid var(--brass)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <strong style={{ fontSize: 13 }}>🔔 {notifs.length} update{notifs.length === 1 ? "" : "s"}</strong>
            <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => store.clearNotifications(user, role)}>Mark all read</button>
          </div>
          {notifs.slice(0, 6).map((n) => (
            <div key={n.id} style={{ fontSize: 12.5, display: "flex", gap: 8 }}><span style={{ color: "var(--muted)", flexShrink: 0 }}>{fmtTs(n.createdAt)}</span><span>{n.message}</span></div>
          ))}
        </div>
      )}

      {/* Field-update pins: one chip per published report THIS reader can
          open, with badges counted through their own lens — a pin must never
          leak the existence or contents of a report its viewer was not sent.
          Vendors read their copy from their own Messages chip instead. */}
      {(() => {
        if (!["builder", "full_admin", "owner", "viewer"].includes(role)) return null;
        const readable = (db.fieldUpdates ?? []).filter((u) => canReadFieldUpdate(u, role, user, awardedTradeIdSet(db.vendorAgreements)));
        if (!readable.length) return null;
        return (
          <div className="card" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", padding: "9px 13px", marginTop: 14 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".11em", textTransform: "uppercase", color: "var(--brass-2)" }}>Field updates</span>
            {readable.map((u) => {
              const items = fieldItemsFor(u, role, user);
              const redN = items.filter((i) => i.rag === "red").length;
              const askN = items.filter((i) => i.ask).length;
              return (
                <Link key={u.id} href={`/field-updates?view=${u.id}`} className="tap-row"
                  style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "6px 11px", borderRadius: 6, border: "1px solid var(--line)", fontSize: 12, fontWeight: 600, color: "var(--walnut)", textDecoration: "none" }}>
                  <span>No {String(u.no).padStart(2, "0")} · {new Date(`${u.dateIso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                  {redN > 0 && <span style={{ fontSize: 10, background: "#f0e2d8", color: "#8a4029", borderRadius: 3, padding: "1px 6px" }}>{redN} red</span>}
                  {askN > 0 && <span style={{ fontSize: 10, background: "#f5ecd7", color: "#7a5d1f", borderRadius: 3, padding: "1px 6px" }}>{askN} {askN === 1 ? "ask" : "asks"}</span>}
                </Link>
              );
            })}
          </div>
        );
      })()}

      {/* Phone: List | Chart toggle. Editing is a chart activity, so an
          active edit session pins the view to the chart. */}
      {phone && !editing && (
        <div style={{ display: "flex", background: "var(--cream-2)", border: "1px solid var(--line)", borderRadius: 9, padding: 2, marginTop: 14, fontSize: 12.5, fontWeight: 700 }}>
          {(["list", "chart"] as const).map((v) => (
            <button key={v} onClick={() => setPhoneView(v)} className="tap"
              style={{ flex: 1, textAlign: "center", padding: "7px 0", borderRadius: 7, border: "none", cursor: "pointer", font: "inherit",
                background: phoneView === v ? "var(--paper)" : "transparent",
                color: phoneView === v ? "var(--walnut)" : "var(--muted)",
                boxShadow: phoneView === v ? "0 1px 2px rgba(58,47,37,.12)" : undefined }}>
              {v === "list" ? "List" : "Chart"}
            </button>
          ))}
        </div>
      )}

      {phone && phoneView === "list" && !editing ? (
        <PhoneAgenda visible={visible} ownerView={ownerView} openId={openId} setOpenId={setOpenId} canEdit={canEdit} onCascade={setCascade} />
      ) : (
      <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12, marginTop: 16 }}>
        <StatCard label="Tasks" value={`${visible.length}`} sub={`${visible.filter((s) => s.status === "done").length} done`} />
        <StatCard label="Awaiting Trade Confirm" value={`${pending.length}`} accent={pending.length ? "var(--rust)" : "var(--ok)"} sub="date changes pending" />
        <StatCard label="Revisions" value={`${db.scheduleRevisions.length}`} sub="published timing changes" />
      </div>

      <SectionTitle right={
        <div style={{ display: "flex", gap: 10, fontSize: 11.5, color: "var(--muted)", flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
            <input type="checkbox" checked={showOrig} onChange={(e) => setShowOrig(e.target.checked)} /> overlay original
          </label>
          <select value={rowSort} onChange={(e) => setRowSort(e.target.value as "custom" | "latest" | "earliest")} title="Row order" style={{ fontSize: 11.5 }}>
            <option value="custom">Custom order</option>
            <option value="latest">Most recent first</option>
            <option value="earliest">Earliest first</option>
          </select>
          <button className="btn btn-sm" onClick={() => setShowHistory((v) => !v)}>History ({db.scheduleRevisions.length})</button>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <button className="btn btn-sm" onClick={() => setZoom((z) => Math.max(1, +(z - 0.5).toFixed(2)))} title="Zoom out">－</button>
            <span style={{ minWidth: 34, textAlign: "center", fontWeight: 700 }}>{Math.round(zoom * 50)}%</span>
            <button className="btn btn-sm" onClick={() => setZoom((z) => Math.min(6, +(z + 0.5).toFixed(2)))} title="Zoom in">＋</button>
          </div>
        </div>
      }>
        Gantt Chart
      </SectionTitle>

      {/* Edit-mode toolbar */}
      {canEdit && (
        <div className="card" style={{ padding: 10, marginBottom: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderLeft: editing ? "3px solid var(--brass)" : undefined }}>
          {!editing ? (
            <>
              <button className="btn btn-primary btn-sm" onClick={beginEdit}>✎ Edit timing</button>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Enter edit mode to drag/resize bars. Changes are logged & published with a reason.</span>
            </>
          ) : (
            <>
              <Pill color="#fff" bg="var(--brass)">EDIT MODE</Pill>
              <span style={{ fontSize: 12.5 }}>{pendingChanges.length} change{pendingChanges.length === 1 ? "" : "s"} staged</span>
              <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                drag bar = move · drag right edge = length · {selIds.size > 1 ? <strong style={{ color: "var(--brass-2)" }}>{selIds.size} selected — drag any one to move them together</strong> : "tick rows to move several together"}
              </span>
              {selIds.size > 0 && <button className="btn btn-sm" onClick={() => setSelIds(new Set())}>Clear selection</button>}
              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                <button className="btn btn-sm" onClick={cancelEdit}>Cancel</button>
                <button className="btn btn-primary btn-sm" disabled={!pendingChanges.length} onClick={() => setPublishOpen(true)}>Publish {pendingChanges.length || ""} change{pendingChanges.length === 1 ? "" : "s"}</button>
              </div>
            </>
          )}
        </div>
      )}

      {showHistory && <HistoryPanel />}

      {canAdd && <AddTimelineItem />}

      {/* Gantt: maxHeight + sticky header */}
      <div ref={scrollRef} className="card"
        onPointerDown={startPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan}
        style={{ padding: 0, overflow: "auto", maxHeight: "62vh", cursor: panning ? "grabbing" : "grab", touchAction: "pan-x pan-y", userSelect: panning ? "none" : undefined }}>
        <div style={{ position: "relative", width: LABEL_W + totalW, minWidth: "100%" }}>
          <div style={{ display: "flex", position: "sticky", top: 0, background: "var(--paper)", zIndex: 5, borderBottom: "1px solid var(--line)" }}>
            <div style={{ width: LABEL_W, flexShrink: 0, position: "sticky", left: 0, background: "var(--paper)", zIndex: 6, padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em", borderRight: "1px solid var(--line)" }}>Task</div>
            <div style={{ position: "relative", width: totalW, height: 28 }}>
              {months.map((m, i) => (<div key={i} style={{ position: "absolute", left: i * MONTH_W, top: 0, width: MONTH_W, height: 28, borderRight: "1px solid var(--line)", fontSize: 10.5, color: "var(--muted)", padding: "7px 0 0 6px", fontWeight: 600 }}>{m.label}</div>))}
            </div>
          </div>

          {visible.map((s) => {
            const [ds, de] = datesOf(s);
            const isDrag = drag?.id === s.id;
            // group drag: dragging any SELECTED bar previews the shift on all selected bars
            const inGroup = !!drag && !isDrag && drag.mode === "move" && selIds.has(drag.id) && selIds.has(s.id);
            const moveDays = (isDrag && drag!.mode === "move") || inGroup ? drag!.days : 0;
            const endDays = isDrag || inGroup ? drag!.days : 0;
            const isSel = canDrag && selIds.has(s.id);
            const left = x(ds + moveDays * DAY);
            const right = x(de + endDays * DAY);
            const w = Math.max(s.kind === "milestone" ? 0 : 6, right - left);
            const cat = colorOf(s);
            const barColor = typeof cat === "string" && cat.startsWith("#") ? cat : "#6b7f5b";
            const prog = s.tradeId ? qc.get(s.tradeId) : undefined;
            const frac = prog && prog.total ? prog.signed / prog.total : s.status === "done" ? 1 : s.status === "in_progress" ? 0.4 : 0;
            const isOpen = openId === s.id;
            const isPending = s.confirm === "pending" && !ownerView;
            const dl = durLabel(iso(ds + moveDays * DAY), iso(de + endDays * DAY));
            const origMoved = (s.origStart && s.origStart !== s.start) || (s.origEnd && s.origEnd !== s.end);
            return (
              <div key={s.id}>
                <div style={{ display: "flex", alignItems: "stretch", borderBottom: "1px solid var(--line)", background: isOpen ? "var(--sage-tint)" : undefined }}>
                  <div role="button" onClick={() => setOpenId(isOpen ? null : s.id)} style={{ width: LABEL_W, flexShrink: 0, position: "sticky", left: 0, zIndex: 2, background: isOpen ? "var(--sage-tint)" : "var(--paper)", borderRight: "1px solid var(--line)", textAlign: "left", padding: "5px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 7 }}>
                    {canDrag && (
                      <>
                        {/* Row-order controls — tap-friendly, no drag needed (custom order only) */}
                        {rowSort === "custom" && <span style={{ display: "flex", flexDirection: "column", gap: 1, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                          <button title="Move row up" onClick={() => store.moveScheduleItem(s.id, -1)}
                            className="tap" style={{ width: 20, height: 15, lineHeight: 1, fontSize: 9, padding: 0, border: "1px solid var(--line)", borderRadius: 4, background: "var(--paper)", cursor: "pointer", color: "var(--muted)" }}>▲</button>
                          <button title="Move row down" onClick={() => store.moveScheduleItem(s.id, 1)}
                            className="tap" style={{ width: 20, height: 15, lineHeight: 1, fontSize: 9, padding: 0, border: "1px solid var(--line)", borderRadius: 4, background: "var(--paper)", cursor: "pointer", color: "var(--muted)" }}>▼</button>
                        </span>}
                        <input type="checkbox" checked={selIds.has(s.id)} title="Select to move together with other checked bars"
                          onClick={(e) => e.stopPropagation()} onChange={() => toggleSel(s.id)} style={{ flexShrink: 0 }} />
                      </>
                    )}
                    <span style={{ width: 8, height: 8, borderRadius: 99, background: STATUS_COLOR[s.status], flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</span>
                      <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
                        {s.kind === "milestone" ? "Milestone" : s.kind === "procurement" ? "Procurement" : tradeName(db, s.tradeId!)}
                        {isPending && <> · <span style={{ color: "var(--rust)" }}>pending</span></>}
                      </span>
                    </span>
                  </div>
                  <div style={{ position: "relative", width: totalW, height: ROW_H }}>
                    {months.map((_, i) => (<div key={i} style={{ position: "absolute", left: i * MONTH_W, top: 0, bottom: 0, width: 1, background: "var(--line)", opacity: .5 }} />))}
                    {/* original-plan ghost */}
                    {showOrig && origMoved && s.kind !== "milestone" && (
                      <div title={`Original: ${fmtD(s.origStart!)} → ${fmtD(s.origEnd!)}`} style={{ position: "absolute", left: x(parse(s.origStart!)), top: 4, width: Math.max(6, x(parse(s.origEnd!)) - x(parse(s.origStart!))), height: ROW_H - 8, borderRadius: 5, border: "1.5px dashed var(--muted)", background: "transparent", pointerEvents: "none" }} />
                    )}
                    {s.kind === "milestone" ? (
                      <div title={SCHEDULE_LABEL[s.status]} style={{ position: "absolute", left: left - 7, top: ROW_H / 2 - 7, width: 14, height: 14, background: "var(--walnut)", transform: "rotate(45deg)", borderRadius: 2 }} />
                    ) : (
                      <div
                        data-bar={canDrag ? "" : undefined}
                        title={`${s.label} · ${dl}${canDrag ? " · drag to move, edge to resize" : ""}`}
                        onPointerDown={(e) => { if (!canDrag) return; e.currentTarget.setPointerCapture(e.pointerId); const st = { id: s.id, startX: e.clientX, days: 0, mode: "move" as const }; dragRef.current = st; setDrag(st); }}
                        onPointerMove={(e) => { const d = dragRef.current; if (!d || d.id !== s.id) return; const days = Math.round((e.clientX - d.startX) / pxPerDay); if (days !== d.days) { dragRef.current = { ...d, days }; setDrag({ ...d, days }); } }}
                        onPointerUp={() => { const d = dragRef.current; if (!d || d.id !== s.id) return; const days = d.days; const mode = d.mode; dragRef.current = null; setDrag(null); if (days) { if (mode === "move" && selIds.size > 1 && selIds.has(s.id)) applyGroupDelta(days); else applyDelta(s, mode, days); } }}
                        style={{ position: "absolute", left, top: 6, width: w, height: ROW_H - 12, borderRadius: 5, background: hexA(barColor, 0.28), border: isPending ? "1.5px dashed var(--rust)" : `1px solid ${s.status === "blocked" ? "var(--rust)" : s.status === "done" ? "var(--ok)" : hexA(barColor, 0.9)}`, boxShadow: isSel ? "0 0 0 2px var(--brass)" : undefined, overflow: "hidden", display: "flex", alignItems: "center", cursor: canDrag ? "grab" : "pointer", touchAction: canDrag ? "none" : "manipulation" }}>
                        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${frac * 100}%`, background: barColor, opacity: .85 }} />
                        {w > 40 && <span style={{ position: "relative", fontSize: 9.5, fontWeight: 700, color: frac > 0.5 ? "#fff" : "var(--ink)", padding: "0 5px", whiteSpace: "nowrap" }}>{dl}</span>}
                        {canDrag && (
                          <span
                            onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget.parentElement as HTMLElement).setPointerCapture?.(e.pointerId); const st = { id: s.id, startX: e.clientX, days: 0, mode: "resize" as const }; dragRef.current = st; setDrag(st); }}
                            onPointerMove={(e) => { const d = dragRef.current; if (!d || d.id !== s.id || d.mode !== "resize") return; const days = Math.round((e.clientX - d.startX) / pxPerDay); if (days !== d.days) { dragRef.current = { ...d, days }; setDrag({ ...d, days }); } }}
                            onPointerUp={(e) => { e.stopPropagation(); const d = dragRef.current; if (!d || d.id !== s.id) return; const days = d.days; dragRef.current = null; setDrag(null); if (days) applyDelta(s, "resize", days); }}
                            className="ever-grip" title="Drag to change length"
                            style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 9, cursor: "ew-resize", background: "rgba(0,0,0,.12)", touchAction: "none" }} />
                        )}
                      </div>
                    )}
                  </div>
                </div>
                {/* The Gantt canvas is wide + horizontally scrolled; pin the
                    drilldown to the VISIBLE pane so it never opens off-screen. */}
                {isOpen && (
                  <div style={{ position: "sticky", left: 0, width: paneW ?? "100%", maxWidth: "100%" }}>
                    <Drilldown item={s} editing={editing} canEdit={canEdit} onJump={() => setOpenId(null)} onCascade={setCascade} />
                  </div>
                )}
              </div>
            );
          })}

          {todayX !== null && <div style={{ position: "absolute", left: LABEL_W + todayX, top: 0, bottom: 0, width: 2, background: "var(--rust)", zIndex: 1, pointerEvents: "none" }} />}
        </div>
      </div>

      <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>
        Auto-zoomed to ~5 weeks from today (red line). Bars fill with QC sign-off. Toggle <em>overlay original</em> to compare the first plan (dashed) with current.
      </p>
      </>
      )}

      {cascade && <CascadeModal cascade={cascade} editing={editing} onClose={() => setCascade(null)} />}
      {publishOpen && <PublishModal changes={pendingChanges} onClose={() => setPublishOpen(false)} onDone={() => { setPublishOpen(false); setEditing(false); setSelIds(new Set()); editSnapshot.current = new Map(); }} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Owner/builder add a brand-new bar: task, procurement window, or milestone.
// Items with an assigned trade go out as "pending" for the trade to confirm.
function AddTimelineItem() {
  const store = useStore();
  const db = store.db;
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<ScheduleItem["kind"]>("work");
  const [tradeId, setTradeId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [deps, setDeps] = useState<string[]>([]);
  const [matDeps, setMatDeps] = useState<string[]>([]);
  const [budgetKey, setBudgetKey] = useState("");
  const [budgetNote, setBudgetNote] = useState("");
  const milestone = kind === "milestone";
  // Work is spend against a line somebody agreed, so a work task has to say
  // which one. A milestone is a date, not spend, so it does not.
  const budgetLines = romRows(db);
  const needsBudget = kind === "work";
  const ready = !!label.trim() && !!start && (milestone || (!!end && end >= start)) && (!needsBudget || !!budgetKey);

  const add = () => {
    if (!ready) return;
    store.addScheduleItem({ label, kind, tradeId: tradeId || undefined, start, end: milestone ? start : end, deps, materialDeps: matDeps, budgetKey: budgetKey || undefined, budgetNote });
    setLabel(""); setStart(""); setEnd(""); setDeps([]); setMatDeps([]); setBudgetKey(""); setBudgetNote(""); setOpen(false);
  };
  const cell = (l: string, node: React.ReactNode) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)" }}>{l}</span>
      {node}
    </label>
  );

  if (!open) return (
    <button className="btn btn-sm" style={{ marginBottom: 10 }} onClick={() => setOpen(true)}>＋ Add timeline item</button>
  );
  return (
    <div className="card" style={{ padding: 12, marginBottom: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", borderLeft: "3px solid var(--sage)" }}>
      <strong style={{ fontSize: 13, alignSelf: "center" }}>New timeline item</strong>
      {cell("Task", <input autoFocus placeholder="e.g. Install radiant floor" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} style={{ minWidth: 190 }} />)}
      {cell("Type", (
        <select value={kind} onChange={(e) => setKind(e.target.value as ScheduleItem["kind"])}>
          <option value="work">Trade work</option>
          <option value="procurement">Procurement</option>
          <option value="milestone">Milestone</option>
        </select>
      ))}
      {!milestone && cell("Trade", (
        <select value={tradeId} onChange={(e) => setTradeId(e.target.value)}>
          <option value="">— none —</option>
          {macroOrder(db).map((c) => <optgroup key={c} label={c}>{db.trades.filter((t) => t.category === c).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>)}
        </select>
      ))}
      {needsBudget && cell("Budget line", (
        <select value={budgetKey}
          onChange={(e) => {
            setBudgetKey(e.target.value);
            // Picking the line names the trade too — they cannot disagree.
            const row = budgetLines.find((b) => b.key === e.target.value);
            if (row) setTradeId(row.tradeId);
          }}
          style={{ minWidth: 200, borderColor: budgetKey ? undefined : "var(--brass)" }}>
          <option value="">Choose the line this spends…</option>
          {budgetLines.map((b) => (
            <option key={b.key} value={b.key}>{b.label} — {fmt(b.total || b.romFigure)}</option>
          ))}
        </select>
      ))}
      {needsBudget && cell("On that line, this is", (
        <input placeholder="e.g. Finish electric" value={budgetNote}
          onChange={(e) => setBudgetNote(e.target.value)} style={{ minWidth: 170 }} />
      ))}
      {cell(milestone ? "Date" : "Start", <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />)}
      {!milestone && cell("Finish", <input type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />)}
      <button className="btn btn-primary btn-sm" disabled={!ready} onClick={add}>
        {needsBudget && !budgetKey && label.trim() ? "Pick a budget line" : "Add to timeline"}
      </button>
      <button className="btn btn-sm" onClick={() => setOpen(false)}>Cancel</button>

      {/* Dependencies: other timeline items and/or materials this waits on. */}
      <div style={{ width: "100%", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", borderTop: "1px dashed var(--line)", paddingTop: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)" }}>Depends on</span>
        {deps.map((d) => <Pill key={d} bg="var(--sage-tint)">⛓ {db.schedule.find((s) => s.id === d)?.label ?? d} <button onClick={() => setDeps((p) => p.filter((x) => x !== d))} style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--rust)" }}>✕</button></Pill>)}
        {matDeps.map((m) => <Pill key={m} bg="#f0e6cd">📦 {db.materials.find((x) => x.id === m)?.item ?? m} <button onClick={() => setMatDeps((p) => p.filter((x) => x !== m))} style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--rust)" }}>✕</button></Pill>)}
        <select value="" onChange={(e) => { if (e.target.value) setDeps((p) => [...p, e.target.value]); }} style={{ fontSize: 11.5, maxWidth: 190 }}>
          <option value="">+ timeline item…</option>
          {db.schedule.filter((s) => !deps.includes(s.id)).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select value="" onChange={(e) => { if (e.target.value) setMatDeps((p) => [...p, e.target.value]); }} style={{ fontSize: 11.5, maxWidth: 190 }}>
          <option value="">+ material…</option>
          {db.materials.filter((m) => !matDeps.includes(m.id)).map((m) => <option key={m.id} value={m.id}>{m.item}{m.roomLabel ? ` · ${m.roomLabel}` : ""}</option>)}
        </select>
      </div>
      {tradeId && !milestone && <span style={{ fontSize: 11, color: "var(--muted)", width: "100%" }}>The assigned trade will be notified and asked to confirm the dates.</span>}
    </div>
  );
}

function HistoryPanel() {
  const store = useStore();
  const db = store.db;
  if (!db.scheduleRevisions.length) return <div className="card" style={{ padding: 14, marginBottom: 10, fontSize: 12.5, color: "var(--muted)" }}>No published timing changes yet.</div>;
  return (
    <div className="card" style={{ padding: 14, marginBottom: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Timing change history</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {db.scheduleRevisions.map((r) => (
          <div key={r.id} style={{ borderLeft: "2px solid var(--line)", paddingLeft: 10 }}>
            <div style={{ fontSize: 12.5 }}><strong>{fmtTs(r.at)}</strong> · {r.by} · {r.changes.length} task(s) {r.emailedClient && <Pill color="#fff" bg="var(--ok)">client emailed</Pill>}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Reason: {r.reason}</div>
            {r.changes.map((c) => <div key={c.itemId} style={{ fontSize: 11.5, color: "var(--muted)" }}>• {c.label}: {fmtD(c.fromStart)}–{fmtD(c.fromEnd)} → {fmtD(c.toStart)}–{fmtD(c.toEnd)}</div>)}
          </div>
        ))}
      </div>
    </div>
  );
}

function PublishModal({ changes, onClose, onDone }: { changes: { itemId: string; label: string; fromStart: string; fromEnd: string; toStart: string; toEnd: string }[]; onClose: () => void; onDone: () => void }) {
  const store = useStore();
  const db = store.db;
  const meId = store.session.userId;
  const [reason, setReason] = useState("");
  const [step, setStep] = useState<"reason" | "message">("reason");
  const [msg, setMsg] = useState("");
  const [to, setTo] = useState<Set<string>>(new Set());
  const trades = new Set(changes.map((c) => db.schedule.find((s) => s.id === c.itemId)?.assignedUserId).filter(Boolean));
  const summary = changes.map((c) => `• ${c.label}: ${fmtD(c.fromStart)}–${fmtD(c.fromEnd)} → ${fmtD(c.toStart)}–${fmtD(c.toEnd)}`).join("\n");

  const publish = () => {
    store.publishScheduleEdits(changes, reason.trim(), store.session.displayName);
    // Step 2: offer a Messenger message to everyone affected.
    const impacted = db.users.filter((u) =>
      u.id !== meId && u.status === "active" &&
      (u.role === "owner" || u.role === "builder" ||
        (u.role === "trade" && changes.some((c) => { const s = db.schedule.find((x) => x.id === c.itemId); return s?.tradeId && u.tradeIds?.includes(s.tradeId); }))));
    setTo(new Set(impacted.map((u) => u.id)));
    setMsg(`Schedule update:\n${summary}\n\nReason: ${reason.trim()}`);
    setStep("message");
  };

  const sendMsg = () => {
    const toIds = [...to];
    store.postUpdate({ title: `Schedule change — ${changes.length} task${changes.length === 1 ? "" : "s"}`, body: msg, toUserIds: toIds });
    pushEmail(emailsFor(db.users, toIds), `📅 ${db.project.name} — schedule change`, msg,
      { replyUrl: conversationUrl([meId, ...toIds]), convKey: conversationKeyOf([meId, ...toIds]), senderName: store.session.displayName });
    onDone();
  };

  return (
    <div className="ever-sheet-overlay" style={{ position: "fixed", inset: 0, background: "rgba(44,36,28,.45)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={step === "reason" && !reason.trim() ? onClose : undefined}>
      <div className="card ever-sheet" style={{ maxWidth: 540, width: "100%", padding: 22, maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        {step === "reason" ? (
          <>
            <h3 className="serif" style={{ fontSize: 18, fontWeight: 700, color: "var(--walnut)" }}>Publish timing changes</h3>
            <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "6px 0 10px" }}>{changes.length} task(s) changed. {trades.size} trade(s) will be notified to confirm.</p>
            <div style={{ maxHeight: 160, overflow: "auto", border: "1px solid var(--line)", borderRadius: 8, padding: 8, fontSize: 12 }}>
              {changes.map((c) => <div key={c.itemId} style={{ padding: "2px 0" }}>• <strong>{c.label}</strong>: {fmtD(c.fromStart)}–{fmtD(c.fromEnd)} → {fmtD(c.toStart)}–{fmtD(c.toEnd)}</div>)}
            </div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", display: "block", marginTop: 12 }}>Reason for the change (required — logged on each task)
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Inspection delayed; materials backordered…" style={{ width: "100%", marginTop: 4, minHeight: 60 }} />
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" disabled={!reason.trim()} onClick={publish}>Publish &amp; notify</button>
            </div>
          </>
        ) : (
          <>
            <h3 className="serif" style={{ fontSize: 18, fontWeight: 700, color: "var(--walnut)" }}>✓ Published — send a message?</h3>
            <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "6px 0 10px" }}>Let the builders, impacted trades and the owner know via Messenger (+ email). Edit before sending.</p>
            <textarea value={msg} onChange={(e) => setMsg(e.target.value)} style={{ width: "100%", minHeight: 110, fontSize: 12.5 }} />
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)", margin: "10px 0 4px" }}>Send to</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {db.users.filter((u) => u.id !== meId && u.status === "active").map((u) => {
                const on = to.has(u.id);
                return (
                  <button key={u.id} className="btn btn-sm" onClick={() => setTo((s) => { const n = new Set(s); on ? n.delete(u.id) : n.add(u.id); return n; })}
                    style={{ background: on ? "var(--sage)" : undefined, color: on ? "#fff" : undefined, borderColor: on ? "var(--sage)" : undefined }}>
                    {on ? "✓ " : ""}{u.name}
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button className="btn" onClick={onDone}>Skip</button>
              <button className="btn btn-primary" disabled={!to.size || !msg.trim()} onClick={sendMsg}>💬 Send message</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CascadeModal({ cascade, editing, onClose }: { cascade: NonNullable<Cascade>; editing: boolean; onClose: () => void }) {
  const store = useStore();
  const db = store.db;
  const [sel, setSel] = useState<Set<string>>(new Set(cascade.deps.map((d) => d.id)));
  const src = db.schedule.find((s) => s.id === cascade.sourceId);
  return (
    <div className="ever-sheet-overlay" style={{ position: "fixed", inset: 0, background: "rgba(44,36,28,.45)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div className="card ever-sheet" style={{ maxWidth: 520, width: "100%", padding: 22 }} onClick={(e) => e.stopPropagation()}>
        <h3 className="serif" style={{ fontSize: 18, fontWeight: 700, color: "var(--walnut)" }}>Shift dependent tasks?</h3>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "8px 0 12px" }}>“{src?.label}” moved back <strong>{cascade.deltaDays} day{cascade.deltaDays === 1 ? "" : "s"}</strong>. These tasks depend on it. Shift the selected ones too?</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 240, overflow: "auto" }}>
          {cascade.deps.map((d) => (
            <label key={d.id} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 7 }}>
              <input type="checkbox" checked={sel.has(d.id)} onChange={() => setSel((p) => { const n = new Set(p); n.has(d.id) ? n.delete(d.id) : n.add(d.id); return n; })} />
              <span style={{ flex: 1 }}>{d.label}</span><span style={{ color: "var(--muted)" }}>{fmtD(d.start)} → {fmtD(d.end)}</span>
            </label>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button className="btn" onClick={onClose}>No, leave them</button>
          <button className="btn btn-primary" onClick={() => {
            cascade.deps.filter((d) => sel.has(d.id)).forEach((d) => {
              const ns = iso(parse(d.start) + cascade.deltaDays * DAY); const ne = iso(parse(d.end) + cascade.deltaDays * DAY);
              if (editing) store.editSchedule(d.id, ns, ne); else store.pushSchedule(d.id, ns, ne);
            });
            onClose();
          }}>Shift {sel.size} task{sel.size === 1 ? "" : "s"}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// The phone's schedule: an agenda, not a chart. Answers the question a phone
// user actually has — what needs attention this week — with the late work
// leading. Tapping a row opens the same drilldown the Gantt uses, so trades
// confirm dates and QC gets signed from here too. The chart stays one toggle
// away; drag-editing stays a desktop activity.
// ---------------------------------------------------------------------------
function PhoneAgenda({ visible, ownerView, openId, setOpenId, canEdit, onCascade }: {
  visible: ScheduleItem[];
  ownerView: boolean;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  canEdit: boolean;
  onCascade: (c: { sourceId: string; deltaDays: number; deps: ScheduleItem[] }) => void;
}) {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const [showLater, setShowLater] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const t0 = today.getTime();
  const dayDiff = (a: number, b: number) => Math.round((a - b) / DAY);
  // The owner reads confirmed dates, like everywhere else on this page.
  const startOf = (s: ScheduleItem) => parse(ownerView ? (s.confirmedStart ?? s.start) : s.start);
  const endOf = (s: ScheduleItem) => parse(ownerView ? (s.confirmedEnd ?? s.end) : s.end);
  const rangeLabel = (s: ScheduleItem) => `${fmtD(iso(startOf(s)))} – ${fmtD(iso(endOf(s)))}`;
  const subOf = (s: ScheduleItem) =>
    `${s.kind === "milestone" ? "Milestone" : s.kind === "procurement" ? "Procurement" : tradeName(db, s.tradeId!)} · ${rangeLabel(s)}`;
  const catColor = (s: ScheduleItem) =>
    s.kind === "milestone" ? "var(--walnut)" : macroColor(db, db.trades.find((t) => t.id === s.tradeId)?.category ?? "Soft Costs");

  const open = visible.filter((s) => s.status !== "done");
  const done = visible.filter((s) => s.status === "done");
  const active = open.filter((s) => startOf(s) <= t0);
  const late = active.filter((s) => endOf(s) < t0).sort((a, b) => endOf(a) - endOf(b));
  const now = active.filter((s) => endOf(s) >= t0).sort((a, b) => endOf(a) - endOf(b));
  const upNext = open.filter((s) => startOf(s) > t0 && dayDiff(startOf(s), t0) <= 14).sort((a, b) => startOf(a) - startOf(b));
  const later = open.filter((s) => startOf(s) > t0 && dayDiff(startOf(s), t0) > 14).sort((a, b) => startOf(a) - startOf(b));
  const nextMilestone = open.filter((s) => s.kind === "milestone" && startOf(s) >= t0).sort((a, b) => startOf(a) - startOf(b))[0];
  // A deep link (?task= or a chip) may point into the folded band — unfold it.
  const laterOpen = showLater || (!!openId && later.some((s) => s.id === openId));
  const doneOpen = showDone || (!!openId && done.some((s) => s.id === openId));

  const sect = (label: string, color: string) => (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".11em", textTransform: "uppercase", color, margin: "16px 2px 7px" }}>{label}</div>
  );

  const row = (s: ScheduleItem, right: ReactNode) => {
    const isOpen = openId === s.id;
    const pendingMe = s.confirm === "pending" && !ownerView;
    return (
      <div key={s.id}>
        <div role="button" onClick={() => setOpenId(isOpen ? null : s.id)} className="tap-row"
          style={{ background: isOpen ? "var(--sage-tint)" : "var(--paper)", border: "1px solid var(--line)", borderLeft: `3px solid ${catColor(s)}`, borderRadius: isOpen ? "12px 12px 0 0" : 12, padding: "9px 12px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", boxShadow: "0 1px 2px rgba(58,47,37,.05)" }}>
          {s.kind === "milestone" && <span aria-hidden style={{ width: 9, height: 9, background: "var(--walnut)", transform: "rotate(45deg)", borderRadius: 2, flexShrink: 0 }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {subOf(s)}{pendingMe && <> · <span style={{ color: "var(--rust)", fontWeight: 700 }}>pending</span></>}
            </div>
          </div>
          {pendingMe && role === "trade" ? <span className="pill" style={{ color: "var(--brass-2)", background: "#f0e6cd", flexShrink: 0 }}>confirm dates</span> : right}
        </div>
        {isOpen && (
          <div style={{ border: "1px solid var(--line)", borderTop: "none", borderRadius: "0 0 12px 12px", overflow: "hidden" }}>
            <Drilldown item={s} editing={false} canEdit={canEdit} onJump={() => setOpenId(null)} onCascade={onCascade} />
          </div>
        )}
      </div>
    );
  };
  const list = (items: ScheduleItem[], right: (s: ScheduleItem) => ReactNode) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>{items.map((s) => row(s, right(s)))}</div>
  );

  const foldBand = (label: string, sub: string, opened: boolean, toggle: () => void) => (
    <div role="button" onClick={toggle} className="tap-row"
      style={{ margin: "12px 0 0", background: "var(--cream-2)", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 12px", fontSize: 12, color: "var(--muted)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, cursor: "pointer" }}>
      <span style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}><strong style={{ color: "var(--walnut)" }}>{label}</strong>{sub ? <> · {sub}</> : null}</span>
      <span style={{ flexShrink: 0, color: "var(--sage-2)", fontWeight: 700 }}>{opened ? "▴" : "▾"}</span>
    </div>
  );

  return (
    <div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "12px 2px 0", lineHeight: 1.5 }}>
        {late.length > 0 && <><strong style={{ color: "var(--rust)" }}>{late.length} running late</strong> · </>}
        {now.length} on site now
        {nextMilestone && <> · next milestone <strong style={{ color: "var(--walnut)" }}>{nextMilestone.label.replace(/ \(Milestone\)$/i, "")}, {fmtD(iso(startOf(nextMilestone)))}</strong></>}
      </div>

      {late.length > 0 && (
        <>
          {sect("Running late", "var(--rust)")}
          {list(late, (s) => (
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div className="serif" style={{ fontSize: 15, fontWeight: 700, color: "var(--rust)" }}>{dayDiff(t0, endOf(s))}d</div>
              <div style={{ fontSize: 9.5, color: "var(--rust)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em" }}>over</div>
            </div>
          ))}
        </>
      )}

      {sect("On site now", "var(--brass-2)")}
      {now.length ? list(now, (s) => (
        s.status === "in_progress"
          ? <span className="pill" style={{ color: "var(--sage-2)", background: "var(--sage-tint)", flexShrink: 0 }}>ends {fmtD(iso(endOf(s)))}</span>
          : <span className="pill" style={{ color: "var(--brass-2)", background: "#f0e6cd", flexShrink: 0 }}>not started</span>
      )) : <div className="card" style={{ padding: "12px 14px", fontSize: 12.5, color: "var(--muted)" }}>Nothing on site this week.</div>}

      {upNext.length > 0 && (
        <>
          {sect("Up next", "var(--brass-2)")}
          {list(upNext, (s) => (
            <span className="pill" style={{ color: "var(--muted)", background: "var(--cream-2)", flexShrink: 0 }}>in {dayDiff(startOf(s), t0)}d</span>
          ))}
        </>
      )}

      {later.length > 0 && (
        <>
          {foldBand(`Later — ${later.length} task${later.length === 1 ? "" : "s"}`, laterOpen ? "" : later.slice(0, 3).map((s) => s.label.replace(/ \(.*\)$/, "")).join(", ") + "…", laterOpen, () => setShowLater((v) => !v))}
          {laterOpen && <div style={{ marginTop: 7 }}>{list(later, (s) => (
            <span className="pill" style={{ color: "var(--muted)", background: "var(--cream-2)", flexShrink: 0 }}>{fmtD(iso(startOf(s)))}</span>
          ))}</div>}
        </>
      )}

      {done.length > 0 && (
        <>
          {foldBand(`Completed — ${done.length} task${done.length === 1 ? "" : "s"}`, "", doneOpen, () => setShowDone((v) => !v))}
          {doneOpen && <div style={{ marginTop: 7 }}>{list(done, (s) => (
            <span className="pill" style={{ color: "var(--ok)", background: "var(--sage-tint)", flexShrink: 0 }}>✓ done</span>
          ))}</div>}
        </>
      )}
    </div>
  );
}

function Drilldown({ item, editing, canEdit, onJump, onCascade }: { item: ScheduleItem; editing: boolean; canEdit: boolean; onJump: () => void; onCascade: (c: { sourceId: string; deltaDays: number; deps: ScheduleItem[] }) => void }) {
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
  const ownerCanSign = role === "owner" || role === "full_admin";
  const builderCanSign = role === "builder" || role === "full_admin";

  return (
    <div style={{ padding: "12px 16px 18px", background: "var(--cream)", borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13.5 }}>{item.tradeId ? tradeName(db, item.tradeId) : item.kind}</strong>
        {item.assignedUserId && <ConfirmBadge item={item} />}
        <MsgButton kind="timing" refId={item.id} label={item.label} href={`/timing?task=${item.id}`} small />
      </div>

      {/* Which money this task spends, and what it is within that line. */}
      {item.budgetKey ? (() => {
        const row = romRows(db).find((b) => b.key === item.budgetKey);
        if (!row) return null;
        return (
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginTop: 6, fontSize: 12 }}>
            <span style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)" }}>Budget line</span>
            <Link href="/costs" style={{ color: "var(--sage-2)", fontWeight: 600 }}>{row.label}</Link>
            {item.budgetNote ? <span style={{ color: "var(--muted)" }}>· {item.budgetNote}</span> : null}
            <span style={{ color: "var(--muted)" }}>· {fmt(row.total || row.romFigure)} total, {fmt(row.paid)} paid</span>
          </div>
        );
      })() : null}

      {canEdit && editing ? (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginTop: 12 }}>
          <label style={{ fontSize: 11.5, color: "var(--muted)" }}>Start<br /><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label style={{ fontSize: 11.5, color: "var(--muted)" }}>End<br /><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
          <button className="btn btn-primary" disabled={start === item.start && end === item.end} onClick={() => {
            const deltaDays = Math.round((parse(start) - parse(item.start)) / DAY);
            store.editSchedule(item.id, start, end);
            // Pushing this task later drags its dependents — surface them.
            const deps = store.dependentsOf(item.id);
            if (deltaDays > 0 && deps.length) onCascade({ sourceId: item.id, deltaDays, deps });
          }}>Apply</button>
          <div style={{ display: "flex", gap: 4, marginLeft: 8 }}>
            {(["not_started", "in_progress", "blocked", "done"] as ScheduleStatus[]).map((st) => (
              <button key={st} className="btn btn-sm" onClick={() => store.setScheduleStatus(item.id, st)} style={{ background: item.status === st ? STATUS_COLOR[st] : "var(--paper)", color: item.status === st ? "#fff" : "var(--ink)", borderColor: item.status === st ? STATUS_COLOR[st] : "var(--line)" }}>{SCHEDULE_LABEL[st]}</button>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>
          {role === "owner"
            ? <>Confirmed: <strong>{fmtD(item.confirmedStart ?? item.start)} → {fmtD(item.confirmedEnd ?? item.end)}</strong></>
            : <>Dates: <strong>{fmtD(item.start)} → {fmtD(item.end)}</strong> · {durLabel(item.start, item.end)}{canEdit ? " · enter Edit mode to change" : ""}</>}
        </div>
      )}

      {canEdit && editing && <DepsEditor item={item} />}

      {isAssignedTrade && item.confirm === "pending" && (
        <div className="card" style={{ padding: 12, marginTop: 12, borderLeft: "3px solid var(--brass)" }}>
          <div style={{ fontSize: 13, marginBottom: 8 }}>The builder proposed <strong>{fmtD(item.start)} → {fmtD(item.end)}</strong>. Confirm to lock it into the owner’s view.</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" onClick={() => store.respondSchedule(item.id, true, name)}>✓ Confirm dates</button>
            <button className="btn" onClick={() => store.respondSchedule(item.id, false, name)}>Decline</button>
          </div>
        </div>
      )}
      {item.confirm === "confirmed" && item.confirmedBy && <div style={{ fontSize: 11.5, color: "var(--ok)", marginTop: 8 }}>✓ Confirmed by {item.confirmedBy} · {fmtTs(item.confirmedAt)}</div>}

      <ItemChangeLog item={item} />

      {item.tradeId && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)", margin: "14px 0 6px" }}>Recommended QC checks — {tradeName(db, item.tradeId)}</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, display: "flex", flexDirection: "column", gap: 3 }}>{recs.map((r, i) => <li key={i}>{r}</li>)}</ul>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)", margin: "14px 0 6px" }}>Sign-off by room — owner &amp; builder</div>
          {!cells.length && <p style={{ fontSize: 12.5, color: "var(--muted)" }}>No in-scope rooms yet.</p>}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {cells.map((c) => {
              const room = db.rooms.find((r) => r.id === c.roomId);
              const items = c.items.filter((i) => i.included);
              if (!items.length) return null;
              const other = db.scope.filter((o) => o.roomId === c.roomId && o.status === "in" && o.tradeId !== item.tradeId).map((o) => tradeName(db, o.tradeId));
              return (
                <div key={c.roomId} className="card" style={{ padding: "8px 12px" }}>
                  <div style={{ fontWeight: 600, fontSize: 12.5 }}>{room?.name}</div>
                  {other.length > 0 && <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Also here: {other.join(", ")} — coordinate before sign-off.</div>}
                  {items.map((it) => (
                    <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginTop: 4 }}>
                      <span style={{ flex: 1, color: it.done ? "var(--ok)" : "var(--ink)", fontWeight: it.done ? 600 : 400 }}>{it.done ? "✓ " : ""}{it.label}</span>
                      <SignBtn label="Owner" signed={!!it.ownerSignedBy} who={it.ownerSignedBy} at={it.ownerSignedAt} disabled={!ownerCanSign} onClick={() => store.signoffScopeItem(c.roomId, item.tradeId!, it.id, "owner", name)} />
                      <SignBtn label="Builder" signed={!!it.builderSignedBy} who={it.builderSignedBy} at={it.builderSignedAt} disabled={!builderCanSign} onClick={() => store.signoffScopeItem(c.roomId, item.tradeId!, it.id, "builder", name)} />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// Per-item change history: every published revision that touched this task,
// with who / when / the required reason.
function ItemChangeLog({ item }: { item: ScheduleItem }) {
  const db = useStore().db;
  const entries = db.scheduleRevisions
    .map((r) => ({ r, c: r.changes.find((c) => c.itemId === item.id) }))
    .filter((x) => x.c);
  if (!entries.length) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 5 }}>Change log</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {entries.map(({ r, c }) => (
          <div key={r.id} style={{ fontSize: 12, borderLeft: "2px solid var(--brass)", paddingLeft: 9 }}>
            <span style={{ fontWeight: 600 }}>{fmtD(c!.fromStart)}–{fmtD(c!.fromEnd)} → {fmtD(c!.toStart)}–{fmtD(c!.toEnd)}</span>
            <span style={{ color: "var(--muted)" }}> · {r.by} · {fmtTs(r.at)}</span>
            <div style={{ color: "var(--muted)", fontSize: 11.5 }}>Reason: {r.reason}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConfirmBadge({ item }: { item: ScheduleItem }) {
  if (item.confirm === "pending") return <Pill color="#fff" bg="var(--rust)">awaiting trade confirm</Pill>;
  if (item.confirm === "declined") return <Pill color="#fff" bg="var(--rust)">trade declined</Pill>;
  return <Pill color="#fff" bg="var(--ok)">trade-confirmed</Pill>;
}

function DepsEditor({ item }: { item: ScheduleItem }) {
  const store = useStore();
  const db = store.db;
  const deps = item.deps ?? [];
  const matDeps = item.materialDeps ?? [];
  const candidates = db.schedule.filter((s) => s.id !== item.id && !deps.includes(s.id));
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 6 }}>Dependencies (tasks &amp; materials)</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        {deps.map((d) => { const dep = db.schedule.find((s) => s.id === d); return (
          <span key={d} className="pill" style={{ background: "var(--sage-tint)", color: "var(--ink)" }}>⛓ {dep?.label ?? d}<button onClick={() => store.setScheduleDeps(item.id, deps.filter((x) => x !== d))} style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--rust)", marginLeft: 2 }}>✕</button></span>
        ); })}
        {matDeps.map((m) => { const mat = db.materials.find((x) => x.id === m); const onHand = mat?.status === "delivered"; return (
          <span key={m} className="pill" style={{ background: "#f0e6cd", color: "var(--ink)" }} title={mat ? `Status: ${mat.status}` : undefined}>📦 {mat?.item ?? m}{mat && !onHand && <span style={{ color: "var(--rust)", fontWeight: 700 }}> · {mat.status}</span>}<button onClick={() => store.setScheduleMaterialDeps(item.id, matDeps.filter((x) => x !== m))} style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--rust)", marginLeft: 2 }}>✕</button></span>
        ); })}
        {!deps.length && !matDeps.length && <span style={{ fontSize: 12, color: "var(--muted)" }}>None.</span>}
        <select value="" onChange={(e) => { if (e.target.value) store.setScheduleDeps(item.id, [...deps, e.target.value]); }} style={{ fontSize: 11.5, maxWidth: 180 }}>
          <option value="">+ task…</option>
          {candidates.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select value="" onChange={(e) => { if (e.target.value) store.setScheduleMaterialDeps(item.id, [...matDeps, e.target.value]); }} style={{ fontSize: 11.5, maxWidth: 180 }}>
          <option value="">+ material…</option>
          {db.materials.filter((m) => !matDeps.includes(m.id)).map((m) => <option key={m.id} value={m.id}>{m.item}{m.roomLabel ? ` · ${m.roomLabel}` : ""}</option>)}
        </select>
      </div>
    </div>
  );
}

function SignBtn({ label, signed, who, at, disabled, onClick }: { label: string; signed: boolean; who?: string; at?: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled && !signed} title={who ? `Signed by ${who}${at ? " · " + fmtTs(at) : ""}` : `${label} sign-off`} className="btn btn-sm"
      style={{ minWidth: 78, background: signed ? "var(--ok)" : "var(--paper)", color: signed ? "#fff" : disabled ? "var(--muted)" : "var(--ink)", borderColor: signed ? "var(--ok)" : "var(--line)", opacity: disabled && !signed ? 0.6 : 1 }}>
      {signed ? `✓ ${label}` : label}
    </button>
  );
}

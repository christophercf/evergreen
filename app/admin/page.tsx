"use client";

import { Fragment, useState, useEffect, useRef } from "react";
import { useStore } from "@/lib/data/hooks";
import { PageHeader, NoAccess, Pill, SectionTitle } from "../ui/bits";
import {
  accessFor, canRemoveUser, canSeeContacts, isArchitectUser, isOwnerManaged, SCOPE_LABEL, ROLE_LABEL,
  type ContactSheet, type MacroCategory, type ModuleKey, type Role, type ScopeStatus, type AccessLevel, type RoomFloor, type User,
} from "@/lib/data/types";
import { MACRO_ORDER, tradeName } from "@/lib/data/money";
import { sendInviteEmail, removeAuthUser } from "@/lib/data/auth";
import TermsBuilder from "./terms-builder";

const SCOPE_CYCLE: ScopeStatus[] = ["unset", "in", "existing", "out"];
const SCOPE_COLOR: Record<ScopeStatus, string> = { in: "var(--sc-in)", out: "var(--sc-out)", existing: "var(--sc-existing)", unset: "transparent" };
const cellText = (s: ScopeStatus) => (s === "unset" ? "·" : s === "in" ? "IN" : s === "existing" ? "EX" : "OUT");
const FLOORS: RoomFloor[] = ["Whole House", "First Floor", "Second Floor", "Basement", "Exterior"];

type Tab = "matrix" | "trade" | "team";

export default function AdminPage() {
  const store = useStore();
  const role = store.session.role;
  const user = store.currentUser;
  const access = accessFor(user, role, "admin");
  const [tab, setTab] = useState<Tab>("matrix");

  if (access === "none") return <NoAccess module="the Administrative module" />;
  const ro = access !== "edit";

  return (
    <>
      <PageHeader
        title="Administrative"
        subtitle="Define the project: which rooms are included, what each trade does in each room (In / EX / Out), and who can see and edit each part of the app."
        right={ro ? <Pill color="var(--muted)">View only</Pill> : undefined}
      />
      <div style={{ display: "flex", gap: 6, marginTop: 16, borderBottom: "1px solid var(--line)" }}>
        {([["matrix", "Rooms & Scope Matrix"], ["trade", "Trade Scope"], ["team", "Team, Access & Billing"]] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className="btn btn-sm"
            style={{ border: "none", borderBottom: tab === k ? "2px solid var(--sage)" : "2px solid transparent", background: "transparent", borderRadius: 0, color: tab === k ? "var(--walnut)" : "var(--muted)", fontWeight: 700 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === "matrix" && <MatrixTab ro={ro} />}
      {tab === "trade" && <TradeScopeTab ro={ro} />}
      {tab === "team" && <TeamTab ro={ro} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Scope matrix — all trades, sticky room column, cluster filter buttons,
// Whole-House cascade, undo, copy/paste + drag-and-drop.
// ---------------------------------------------------------------------------
function MatrixTab({ ro }: { ro: boolean }) {
  const store = useStore();
  const db = store.db;
  const [cat, setCat] = useState<MacroCategory | "All">("All");
  const [pasteMode, setPasteMode] = useState(false);
  const [armCopy, setArmCopy] = useState(false);
  const [newRoom, setNewRoom] = useState("");
  const [newFloor, setNewFloor] = useState<RoomFloor>("First Floor");
  const [dupWarn, setDupWarn] = useState(false);

  const trades = cat === "All" ? db.trades : db.trades.filter((t) => t.category === cat);
  const cellOf = (roomId: string, tradeId: string): ScopeStatus =>
    db.scope.find((c) => c.roomId === roomId && c.tradeId === tradeId)?.status ?? "unset";

  const onCell = (roomId: string, tradeId: string) => {
    if (ro) return;
    if (armCopy) { store.copyScopeCell(roomId, tradeId); setArmCopy(false); setPasteMode(true); return; }
    if (pasteMode) { store.pasteScopeCell(roomId, tradeId); return; }
    const s = cellOf(roomId, tradeId);
    store.setScopeStatus(roomId, tradeId, SCOPE_CYCLE[(SCOPE_CYCLE.indexOf(s) + 1) % SCOPE_CYCLE.length]);
  };

  return (
    <>
      {/* cluster toggle buttons */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 16 }}>
        {(["All", ...MACRO_ORDER] as (MacroCategory | "All")[]).map((c) => (
          <button key={c} onClick={() => setCat(c)} className="btn btn-sm" style={{ background: cat === c ? "var(--sage)" : "var(--paper)", color: cat === c ? "#fff" : "var(--ink)", borderColor: cat === c ? "var(--sage)" : "var(--line)", fontWeight: 700 }}>{c}</button>
        ))}
      </div>

      {/* toolbar */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", margin: "12px 0" }}>
        {!ro && <>
          <button className="btn btn-sm" disabled={!store.canUndo} onClick={() => store.undo()}>↶ Undo</button>
          <button className="btn btn-sm" onClick={() => { setArmCopy(true); setPasteMode(false); }} style={{ background: armCopy ? "var(--brass)" : undefined, color: armCopy ? "#fff" : undefined }}>⧉ Copy a cell</button>
          <button className="btn btn-sm" disabled={!store.scopeClipboard} onClick={() => setPasteMode((v) => !v)} style={{ background: pasteMode ? "var(--sage)" : undefined, color: pasteMode ? "#fff" : undefined }}>Paste mode {pasteMode ? "ON" : "off"}</button>
          {store.scopeClipboard && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>clipboard: <strong>{SCOPE_LABEL[store.scopeClipboard.status]}</strong></span>}
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>·  drag a cell onto another to copy</span>
        </>}
        <div style={{ display: "flex", gap: 12, marginLeft: "auto", fontSize: 11.5, color: "var(--muted)" }}>
          {(["in", "existing", "out", "unset"] as ScopeStatus[]).map((s) => (
            <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 13, height: 13, borderRadius: 3, border: "1px solid var(--line)", background: SCOPE_COLOR[s] }} />{cellText(s)}</span>
          ))}
        </div>
      </div>
      {armCopy && <div style={{ fontSize: 12, color: "var(--brass-2)", marginBottom: 8 }}>Click a cell to copy its scope…</div>}

      {/* matrix — sticky header (top) + sticky room column (left) + persistent bottom scrollbar */}
      <PersistentScroll maxHeight="70vh" dep={`${trades.length}:${db.rooms.length}:${cat}`}>
        <table style={{ fontSize: 12.5, borderCollapse: "separate", borderSpacing: 0 }}>
          <thead>
            <tr>
              <th style={{ ...thLeft, zIndex: 6 }}>Room</th>
              {trades.map((t) => <th key={t.id} style={{ ...thCell, minWidth: 92 }}>{t.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {db.rooms.map((room) => (
              <tr key={room.id}>
                <td style={tdLeft}>
                  <span style={{ fontWeight: 600 }}>{room.name}</span>
                  {room.id === "whole-house" && <div style={{ fontSize: 10, color: "var(--brass-2)" }}>sets all rooms</div>}
                  {room.addition && <div style={{ fontSize: 10 }}><Pill color="#fff" bg="var(--brass)">addition</Pill></div>}
                  {room.id !== "whole-house" && <div style={{ fontSize: 10.5, color: "var(--muted)" }}>{room.floor}</div>}
                </td>
                {trades.map((t) => {
                  const s = cellOf(room.id, t.id);
                  return (
                    <td key={t.id} style={{ padding: 3, textAlign: "center" }}>
                      <button
                        disabled={ro}
                        draggable={!ro}
                        onDragStart={(e) => e.dataTransfer.setData("text/plain", s)}
                        onDragOver={(e) => { if (!ro) e.preventDefault(); }}
                        onDrop={(e) => { e.preventDefault(); if (ro) return; const st = e.dataTransfer.getData("text/plain") as ScopeStatus; if (st) store.setScopeStatus(room.id, t.id, st); }}
                        onClick={() => onCell(room.id, t.id)}
                        title={`${room.name} · ${t.name}: ${SCOPE_LABEL[s]}`}
                        className="scope-btn"
                        style={{ background: s === "unset" ? "var(--paper)" : SCOPE_COLOR[s], color: s === "unset" ? "var(--muted)" : "#fff", cursor: ro ? "default" : pasteMode ? "copy" : "pointer" }}>
                        {cellText(s)}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </PersistentScroll>

      {/* rooms management */}
      <SectionTitle>Rooms ({db.rooms.length})</SectionTitle>
      {!ro && (
        <div className="card" style={{ padding: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <input placeholder="New room name…" value={newRoom} onChange={(e) => { setNewRoom(e.target.value); setDupWarn(false); }} style={{ flex: 1, minWidth: 180 }} />
          <select value={newFloor} onChange={(e) => setNewFloor(e.target.value as RoomFloor)}>{FLOORS.map((f) => <option key={f}>{f}</option>)}</select>
          <button className="btn btn-primary" onClick={() => { const ok = store.addRoom(newRoom, newFloor); if (ok) setNewRoom(""); else setDupWarn(true); }}>+ Add room</button>
          {dupWarn && <span style={{ fontSize: 12, color: "var(--rust)" }}>That room already exists.</span>}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
        {db.rooms.map((room) => (
          <div key={room.id} className="card" style={{ padding: "9px 11px", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <input defaultValue={room.name} disabled={ro} onBlur={(e) => e.target.value.trim() && store.renameRoom(room.id, e.target.value.trim())} style={{ border: "none", background: "transparent", padding: 0, fontWeight: 600, fontSize: 13.5, width: "100%" }} />
              <div style={{ fontSize: 11, color: "var(--muted)" }}>{room.floor}{room.custom ? " · custom" : ""}</div>
            </div>
            {!ro && room.id !== "whole-house" && <button className="btn btn-sm" onClick={() => store.removeRoom(room.id)} style={{ color: "var(--rust)" }}>✕</button>}
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Trade scope — only in-scope rooms, grouped into clusters with identical scope.
// ---------------------------------------------------------------------------
function TradeScopeTab({ ro }: { ro: boolean }) {
  const store = useStore();
  const db = store.db;
  const [tradeId, setTradeId] = useState(db.trades.find((t) => t.id === "electrical")?.id ?? db.trades[0].id);
  const trade = db.trades.find((t) => t.id === tradeId)!;

  const inCells = db.scope.filter((c) => c.tradeId === tradeId && c.status === "in");
  // Cluster rooms whose included-item set is identical.
  const sig = (c: typeof inCells[number]) => c.items.filter((i) => i.included).map((i) => i.label).sort().join("|");
  const clusters = new Map<string, { items: string[]; roomIds: string[] }>();
  inCells.forEach((c) => {
    const key = sig(c);
    const entry = clusters.get(key) ?? { items: c.items.filter((i) => i.included).map((i) => i.label), roomIds: [] };
    entry.roomIds.push(c.roomId);
    clusters.set(key, entry);
  });
  const roomName = (id: string) => db.rooms.find((r) => r.id === id)?.name ?? id;
  const allItems = (db.scopeTemplates.find((t) => t.tradeId === tradeId)?.items ?? []);

  return (
    <>
      <SectionTitle right={
        <select value={tradeId} onChange={(e) => setTradeId(e.target.value)}>
          {MACRO_ORDER.map((c) => (
            <optgroup key={c} label={c}>{db.trades.filter((t) => t.category === c).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>
          ))}
        </select>
      }>
        {trade.name} — scope (in-scope rooms only)
      </SectionTitle>

      {inCells.length === 0 && <div className="card" style={{ padding: 20, color: "var(--muted)", fontSize: 13 }}>{trade.name} isn’t in scope for any room yet. Mark rooms “IN” in the Scope Matrix, or expand below.</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {[...clusters.values()].map((cl, idx) => {
          const itemSet = new Set(cl.items);
          const itemUniverse = Array.from(new Set([...allItems, ...cl.items]));
          return (
            <div key={idx} className="card" style={{ padding: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <Pill color="#fff" bg="var(--sage)">{cl.roomIds.length} room{cl.roomIds.length === 1 ? "" : "s"}</Pill>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{cl.roomIds.map(roomName).join(", ")}</span>
                {cl.roomIds.length > 1 && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>· identical scope shown once</span>}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>
                {itemUniverse.map((label) => (
                  <label key={label} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: itemSet.has(label) ? "var(--ink)" : "var(--muted)" }}>
                    <input type="checkbox" checked={itemSet.has(label)} disabled={ro} onChange={(e) => store.setScopeItemForRooms(cl.roomIds, tradeId, label, e.target.checked)} />
                    {label}
                  </label>
                ))}
              </div>
              {!ro && <AddClusterItem roomIds={cl.roomIds} tradeId={tradeId} />}
            </div>
          );
        })}
      </div>

      {!ro && <ExpandScope tradeId={tradeId} inRoomIds={inCells.map((c) => c.roomId)} />}

      <TermsBuilder tradeId={tradeId} ro={ro} />
    </>
  );
}

function AddClusterItem({ roomIds, tradeId }: { roomIds: string[]; tradeId: string }) {
  const store = useStore();
  const [v, setV] = useState("");
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
      <input placeholder="Add scope item to these rooms…" value={v} onChange={(e) => setV(e.target.value)} style={{ flex: 1, fontSize: 12.5 }} />
      <button className="btn btn-sm" onClick={() => { if (v.trim()) { store.addScopeItemForRooms(roomIds, tradeId, v.trim()); setV(""); } }}>+ Add</button>
    </div>
  );
}

function ExpandScope({ tradeId, inRoomIds }: { tradeId: string; inRoomIds: string[] }) {
  const store = useStore();
  const db = store.db;
  const [mode, setMode] = useState<null | "all" | "select">(null);
  const [sel, setSel] = useState<string[]>([]);
  const source = inRoomIds[0];
  const targets = db.rooms.filter((r) => !inRoomIds.includes(r.id));

  return (
    <div className="card" style={{ padding: 14, marginTop: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Expand this trade’s scope</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn" disabled={!source} onClick={() => { if (source) store.copyScopeToRooms(source, tradeId, db.rooms.filter((r) => r.id !== source).map((r) => r.id)); }}>⊞ Expand scope to ALL rooms</button>
        <button className="btn" disabled={!source} onClick={() => setMode(mode === "select" ? null : "select")} style={{ background: mode === "select" ? "var(--sage-tint)" : undefined }}>☑ Expand scope to select rooms</button>
      </div>
      {mode === "select" && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px" }}>
            {targets.map((r) => (
              <label key={r.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
                <input type="checkbox" checked={sel.includes(r.id)} onChange={() => setSel((p) => p.includes(r.id) ? p.filter((x) => x !== r.id) : [...p, r.id])} />
                {r.name}
              </label>
            ))}
          </div>
          <button className="btn btn-primary btn-sm" style={{ marginTop: 10 }} disabled={!sel.length || !source} onClick={() => { if (source) { store.copyScopeToRooms(source, tradeId, sel); setSel([]); setMode(null); } }}>Expand to {sel.length || "…"} room{sel.length === 1 ? "" : "s"}</button>
        </div>
      )}
      {!source && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>Set scope on at least one room first, then expand it from there.</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Users & access — contacts (gated), removal, permissions, Full Admin.
// ---------------------------------------------------------------------------
const MODULES: { key: ModuleKey; label: string }[] = [
  { key: "dashboard", label: "Dashboard" }, { key: "admin", label: "Admin" }, { key: "costs", label: "Costs" },
  { key: "payments", label: "Payments" }, { key: "budget", label: "Budget" }, { key: "timing", label: "Timing" },
  { key: "materials", label: "Materials" }, { key: "vendors", label: "Vendors" }, { key: "artifacts", label: "Artifacts" },
  { key: "updates", label: "Updates" },
];
const LEVELS: AccessLevel[] = ["none", "view", "edit"];
const ROLES: Role[] = ["full_admin", "owner", "builder", "trade", "viewer"];

// One merged tab: companies (Builder/GC, Owner, each Vendor) with their contact &
// billing on top and the people + their access nested inside — Users & Access and
// Contacts & Billing unified so there's a single source for each person/company.
function TeamTab({ ro }: { ro: boolean }) {
  const store = useStore();
  const db = store.db;
  const viewerRole = store.session.role;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [nrole, setNrole] = useState<Role>("trade");
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; name: string; email: string } | null>(null);
  const canManageAccess = viewerRole === "full_admin";

  return (
    <>
      {confirmRemove && <RemoveDialog target={confirmRemove} onClose={() => setConfirmRemove(null)} />}
      <SectionTitle>Access Matrix</SectionTitle>
      <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: -6, marginBottom: 10 }}>
        Everyone on the project in one grid — their role and exactly what each person can see or edit in every module.
        {canManageAccess
          ? " Change a role or any cell to grant access."
          : <> Roles &amp; permissions are read-only — only a <strong>Full Admin</strong> can change them.</>}
        {" "}Expand a row (▸) for contacts, door code &amp; invite controls.
      </p>
      <AccessMatrix ro={ro} onRemove={setConfirmRemove} />

      <div style={{ marginTop: 22 }}>
        <SectionTitle right={!ro && (viewerRole === "full_admin" || viewerRole === "builder" || viewerRole === "owner") ? <AddVendorTrade /> : undefined}>Companies &amp; Billing</SectionTitle>
        <CompaniesBilling ro={ro} />
      </div>

      {!ro && <div style={{ marginTop: 16 }}><InvitePanel viewerRole={viewerRole} name={name} setName={setName} email={email} setEmail={setEmail} nrole={nrole} setNrole={setNrole} /></div>}
    </>
  );
}

const firstTrade = (u: User) => (u.tradeIds ?? [])[0];
// Cluster order for the access matrix: Owners → Architect → Builders → Trades → Designers/Viewers.
const GROUP_LABELS = ["Owners", "Architect", "Builders / GC", "Trades", "Designers & Viewers"];
const groupOf = (u: User): number =>
  u.role === "full_admin" || u.role === "owner" ? 0
    : isArchitectUser(u) ? 1
      : u.role === "builder" ? 2
        : u.role === "trade" ? 3
          : 4;
const lvlColor = (l: AccessLevel) => (l === "edit" ? "var(--sage-2)" : l === "view" ? "var(--ink)" : "var(--muted)");

// One clean grid: a row per person, a column per module. Sticky person column +
// sticky header + persistent bottom scrollbar so it pans cleanly when wide.
function AccessMatrix({ ro, onRemove }: { ro: boolean; onRemove: (t: { id: string; name: string; email: string }) => void }) {
  const store = useStore();
  const db = store.db;
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const users = [...db.users].sort((a, b) =>
    (groupOf(a) - groupOf(b)) ||
    (tradeName(db, firstTrade(a) ?? "").localeCompare(tradeName(db, firstTrade(b) ?? ""))) ||
    a.name.localeCompare(b.name));

  const company = (u: User) =>
    u.role === "trade" ? (firstTrade(u) ? tradeName(db, firstTrade(u)) : "Unassigned")
      : u.role === "owner" ? "Owner"
        : u.role === "viewer" ? "Designer / Viewer"
          : "Builder / GC";

  return (
    <PersistentScroll maxHeight="72vh" dep={`${users.length}:${open.size}`}>
      <table style={{ fontSize: 12.5, borderCollapse: "separate", borderSpacing: 0, width: "100%" }}>
        <thead>
          <tr>
            <th style={{ ...thLeft, zIndex: 6, minWidth: 230 }}>Person</th>
            <th style={{ ...thCell, textAlign: "left", minWidth: 110 }}>Role</th>
            <th style={{ ...thCell, textAlign: "left", minWidth: 130 }}>Company / Trade</th>
            {MODULES.map((m) => <th key={m.key} style={{ ...thCell, minWidth: 64 }}>{m.label}</th>)}
            <th style={{ ...thCell, minWidth: 40 }} />
          </tr>
        </thead>
        <tbody>
          {users.map((u, i) => {
            const g = groupOf(u);
            const newGroup = i === 0 || groupOf(users[i - 1]) !== g;
            return (
              <Fragment key={u.id}>
                {newGroup && (
                  <tr>
                    <td colSpan={MODULES.length + 4} style={{ padding: "8px 12px 4px", fontSize: 10.5, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--brass-2)", background: "var(--cream)", borderBottom: "1px solid var(--line)", position: "sticky", left: 0 }}>
                      {GROUP_LABELS[g]}
                    </td>
                  </tr>
                )}
                <AccessRow u={u} ro={ro} expanded={open.has(u.id)} onToggle={() => toggle(u.id)} company={company(u)} onRemove={onRemove} />
              </Fragment>
            );
          })}
          {!users.length && <tr><td style={{ padding: 16, color: "var(--muted)", fontSize: 13 }} colSpan={MODULES.length + 4}>No people yet — invite someone below.</td></tr>}
        </tbody>
      </table>
    </PersistentScroll>
  );
}

function AccessRow({ u, ro, expanded, onToggle, company, onRemove }: { u: User; ro: boolean; expanded: boolean; onToggle: () => void; company: string; onRemove: (t: { id: string; name: string; email: string }) => void }) {
  const store = useStore();
  const viewerRole = store.session.role;
  const viewer = store.currentUser;
  const canManageAccess = viewerRole === "full_admin";
  const seeContacts = canSeeContacts(viewerRole, u);
  const canRemove = !ro && canRemoveUser(viewerRole, viewer, u);
  const pending = u.status && u.status !== "active";
  const rowBg = expanded ? "var(--sage-tint)" : "var(--paper)";

  return (
    <>
      <tr>
        <td style={{ ...tdLeft, minWidth: 230, background: rowBg, verticalAlign: "top" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
            <button className="btn btn-sm" onClick={onToggle} title={expanded ? "Hide details" : "Show contacts & invite"} style={{ padding: "1px 6px", lineHeight: 1.2 }}>{expanded ? "▾" : "▸"}</button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <input defaultValue={u.name} disabled={ro} onBlur={(e) => e.target.value.trim() && store.updateUser(u.id, { name: e.target.value.trim() })} style={{ border: "none", background: "transparent", fontWeight: 700, fontSize: 14, fontFamily: "var(--font-serif)", color: "var(--walnut)", width: "100%", padding: 0 }} />
              <div style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{seeContacts ? u.email : "🔒 contact hidden"}</div>
              {pending === true && (
                <div style={{ marginTop: 3 }}>
                  <Pill color="#fff" bg={u.status === "invited" ? "var(--brass)" : "var(--rust)"}>{u.status === "invited" ? "invited" : "pending"}</Pill>
                </div>
              )}
            </div>
          </div>
        </td>
        <td style={{ ...td, background: rowBg }}>
          {canManageAccess ? (
            <select value={u.role} onChange={(e) => store.updateUser(u.id, { role: e.target.value as Role })} style={{ fontSize: 11.5 }}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          ) : (
            <Pill bg="var(--cream-2)">{ROLE_LABEL[u.role]}</Pill>
          )}
        </td>
        <td style={{ ...td, background: rowBg, fontSize: 12, color: "var(--ink)" }}>
          {company}
          {u.role === "trade" && (
            <div style={{ marginTop: 3, fontSize: 10.5, color: "var(--muted)", display: "flex", alignItems: "center", gap: 4 }}>
              by
              <select value={u.managedBy ?? "builder"} disabled={!canManageAccess} onChange={(e) => store.updateUser(u.id, { managedBy: e.target.value as "builder" | "owner" })} style={{ fontSize: 10.5, padding: "1px 2px" }}>
                <option value="builder">Builder</option>
                <option value="owner">Owner</option>
              </select>
            </div>
          )}
        </td>
        {MODULES.map((m) => {
          const eff = accessFor(u, u.role, m.key);
          return (
            <td key={m.key} style={{ ...td, textAlign: "center", background: rowBg }}>
              {canManageAccess ? (
                <select value={eff} onChange={(e) => store.setUserAccess(u.id, m.key, e.target.value as AccessLevel)} title={m.label} style={{ fontSize: 11, padding: "2px 3px", color: lvlColor(eff), fontWeight: eff === "edit" ? 700 : 400 }}>
                  {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              ) : (
                <span title={`${m.label}: ${eff}`} style={{ fontSize: 11.5, fontWeight: eff === "none" ? 400 : 700, color: lvlColor(eff) }}>{eff === "none" ? "—" : eff === "edit" ? "edit" : "view"}</span>
              )}
            </td>
          );
        })}
        <td style={{ ...td, textAlign: "center", background: rowBg }}>
          {canRemove && <button className="btn btn-sm" style={{ color: "var(--rust)", padding: "1px 6px" }} title="Remove user" onClick={() => onRemove({ id: u.id, name: u.name, email: u.email })}>✕</button>}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={MODULES.length + 4} style={{ padding: 0, borderBottom: "1px solid var(--line)", background: "var(--cream)" }}>
            <UserDetail u={u} ro={ro} seeContacts={seeContacts} canManageAccess={canManageAccess} />
          </td>
        </tr>
      )}
    </>
  );
}

function UserDetail({ u, ro, seeContacts, canManageAccess }: { u: User; ro: boolean; seeContacts: boolean; canManageAccess: boolean }) {
  const store = useStore();
  const pending = u.status && u.status !== "active";
  return (
    <div style={{ padding: "12px 16px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
      {/* Status & invite */}
      {pending === true && (
        <div>
          <Lbl>Status</Lbl>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5, flexWrap: "wrap" }}>
            <Pill color="#fff" bg={u.status === "invited" ? "var(--brass)" : "var(--rust)"}>{u.status === "invited" ? "invited — not yet joined" : "pending approval"}</Pill>
            {canManageAccess && u.status === "pending" && <button className="btn btn-sm" onClick={() => store.approveUser(u.id)}>Approve</button>}
            {!ro && u.status === "invited" && <RefreshInvite email={u.email} />}
            {!ro && u.status === "invited" && u.inviteToken && <CopyInvite token={u.inviteToken} />}
          </div>
        </div>
      )}

      {/* Contacts */}
      <div>
        <Lbl>Contact</Lbl>
        {seeContacts ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 5 }}>
            <ContactRow label="Email" value={u.email} disabled={ro} onSave={(v) => store.updateUser(u.id, { email: v })} />
            <ContactRow label="Phone" value={u.phone ?? ""} disabled={ro} onSave={(v) => store.updateUser(u.id, { phone: v })} />
            {(u.secondaryContacts ?? []).map((c) => (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, paddingLeft: 8, borderLeft: "2px solid var(--line)" }}>
                <span style={{ color: "var(--muted)", minWidth: 54 }}>{c.label ?? "Secondary"}</span>
                <input defaultValue={c.name ?? ""} placeholder="name" disabled={ro} onBlur={(e) => store.updateContact(u.id, c.id, { name: e.target.value })} style={{ width: 90, fontSize: 12 }} />
                <input defaultValue={c.phone ?? ""} placeholder="phone" disabled={ro} onBlur={(e) => store.updateContact(u.id, c.id, { phone: e.target.value })} style={{ width: 100, fontSize: 12 }} />
                {!ro && <button className="btn btn-sm" style={{ color: "var(--rust)" }} onClick={() => store.removeContact(u.id, c.id)}>✕</button>}
              </div>
            ))}
            {!ro && <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => store.addContact(u.id, { label: "Secondary" })}>+ Secondary contact</button>}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 5, fontStyle: "italic" }}>🔒 Trade contact managed by the builder — hidden from the owner.</div>
        )}
      </div>

      {/* Door code */}
      <div>
        <Lbl>Door code</Lbl>
        <input value={u.doorCode ?? ""} disabled={ro} placeholder="—" onChange={(e) => store.setDoorCode(u.id, e.target.value)} style={{ width: 120, fontSize: 12, marginTop: 5 }} />
      </div>
    </div>
  );
}

// Companies & billing — builder, owner, and each vendor trade, with the same
// contact/billing sheet editor (no more per-person module cards here).
function CompaniesBilling({ ro }: { ro: boolean }) {
  const store = useStore();
  const db = store.db;
  const viewerRole = store.session.role;
  const canManage = !ro && (viewerRole === "full_admin" || viewerRole === "builder");
  const vendorTradeIds = Array.from(new Set([
    ...db.contacts.filter((c) => c.party === "vendor" && c.tradeId).map((c) => c.tradeId!),
    ...(db.users.filter((u) => u.role === "trade").map(firstTrade).filter(Boolean) as string[]),
  ])).sort((a, b) => tradeName(db, a).localeCompare(tradeName(db, b)));

  const card = (key: string, party: "builder" | "owner" | "vendor", tradeId?: string) => {
    const trade = tradeId ? db.trades.find((t) => t.id === tradeId) : undefined;
    const ownerManaged = isOwnerManaged(trade);
    const sheet = party === "vendor" ? db.contacts.find((c) => c.party === "vendor" && c.tradeId === tradeId)
      : db.contacts.find((c) => c.party === party);
    const heading = party === "vendor" ? (trade ? tradeName(db, trade.id) : "Vendor") : party === "builder" ? "Builder / GC" : "Owner";
    const accent = party === "builder" ? "var(--walnut)" : party === "owner" ? "var(--brass)" : ownerManaged ? "var(--brass)" : "var(--sage)";
    const canEditCompany = canManage || (viewerRole === "owner" && (party === "owner" || (party === "vendor" && ownerManaged)));
    return (
      <div key={key} className="card" style={{ padding: 0, borderTop: `3px solid ${accent}`, overflow: "hidden" }}>
        <CompanyHeader sheet={sheet} party={party} tradeId={tradeId} heading={heading} ownerManaged={ownerManaged} trade={trade} canEdit={canEditCompany} />
        {party === "vendor" && canManage && tradeId && (
          <div style={{ padding: "8px 12px", background: "var(--cream)", borderTop: "1px solid var(--line)" }}>
            <InviteToTrade tradeId={tradeId} ownerManaged={ownerManaged} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {card("builder", "builder")}
      {card("owner", "owner")}
      {vendorTradeIds.map((tid) => card(`v-${tid}`, "vendor", tid))}
      {!vendorTradeIds.length && <div style={{ fontSize: 12.5, color: "var(--muted)", padding: "4px 2px" }}>No vendors yet{canManage ? " — add one above." : "."}</div>}
    </div>
  );
}

function CompanyHeader({ sheet, party, tradeId, heading, ownerManaged, trade, canEdit }: { sheet?: ContactSheet; party: "builder" | "owner" | "vendor" | "other"; tradeId?: string; heading?: string; ownerManaged: boolean; trade?: { id: string }; canEdit: boolean }) {
  const store = useStore();
  const [showBilling, setShowBilling] = useState(false);
  // Vendor cards: the trade/vendor display name is renamable (e.g. "Windows —
  // Diverse" vs "Windows — Builder" when two vendors cover the same trade).
  const headingNode = party === "vendor" && trade && canEdit && heading != null
    ? <input key={trade.id} defaultValue={heading} title="Rename this vendor / trade"
        onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== heading) store.updateTrade(trade.id, { name: v }); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="serif" style={{ fontSize: 15, fontWeight: 700, color: "var(--walnut)", border: "1px dashed transparent", borderRadius: 6, padding: "1px 4px", background: "transparent", minWidth: 140 }}
        onFocus={(e) => (e.target.style.borderColor = "var(--line)")}
        onBlurCapture={(e) => ((e.target as HTMLInputElement).style.borderColor = "transparent")} />
    : heading ? <strong className="serif" style={{ fontSize: 15, color: "var(--walnut)" }}>{heading}</strong> : null;
  if (!sheet) {
    return (
      <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "var(--paper)" }}>
        {headingNode}
        {ownerManaged && <Pill color="#fff" bg="var(--brass)">⌂ Owner Managed</Pill>}
        <span style={{ fontSize: 12, color: "var(--muted)" }}>No company / billing info yet.</span>
        {canEdit && <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => store.addContactSheet({ party: party === "vendor" ? "vendor" : (party as "builder" | "owner"), tradeId, company: heading ?? (party === "builder" ? "Our company (GC)" : "Owner") })}>＋ Add company &amp; billing</button>}
      </div>
    );
  }
  const c = sheet;
  return (
    <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8, background: "var(--paper)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {party === "vendor" ? headingNode : heading ? <span style={{ fontSize: 12, color: "var(--muted)" }}>{heading} ·</span> : null}
        {party === "vendor" && heading && <span style={{ fontSize: 12, color: "var(--muted)" }}>·</span>}
        <input value={c.company} disabled={!canEdit} placeholder="Company name" onChange={(e) => store.updateContactSheet(c.id, { company: e.target.value })} style={{ border: "none", background: "transparent", fontWeight: 700, fontSize: 15, fontFamily: "var(--font-serif)", color: "var(--walnut)", flex: 1, minWidth: 150 }} />
        {ownerManaged && <Pill color="#fff" bg="var(--brass)">⌂ Owner Managed</Pill>}
        {c.shareAll && <Pill bg="var(--sage-tint)">shared</Pill>}
        <button className="btn btn-sm" onClick={() => setShowBilling((v) => !v)}>💳 Billing {showBilling ? "▾" : "▸"}</button>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Field label="Office email" value={c.email} disabled={!canEdit} onChange={(v) => store.updateContactSheet(c.id, { email: v })} />
        <Field label="Office phone" value={c.phone} disabled={!canEdit} onChange={(v) => store.updateContactSheet(c.id, { phone: v })} />
        <Field label="Address" value={c.address} disabled={!canEdit} onChange={(v) => store.updateContactSheet(c.id, { address: v })} />
      </div>
      {showBilling && (
        <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Field label="Payable to / invoice from" value={c.billing?.payableTo} disabled={!canEdit} onChange={(v) => store.updateBilling(c.id, { payableTo: v })} />
            <Field label="Billing email" value={c.billing?.email} disabled={!canEdit} onChange={(v) => store.updateBilling(c.id, { email: v })} />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Field label="Tax ID / EIN" value={c.billing?.taxId} disabled={!canEdit} onChange={(v) => store.updateBilling(c.id, { taxId: v })} />
            <Field label="Payment terms" value={c.billing?.paymentTerms} disabled={!canEdit} onChange={(v) => store.updateBilling(c.id, { paymentTerms: v })} />
          </div>
          <Field label="Remittance (ACH / check-to / acct)" value={c.billing?.remittance} disabled={!canEdit} onChange={(v) => store.updateBilling(c.id, { remittance: v })} />
          <div style={{ fontSize: 11, color: "var(--muted)" }}>Flows onto this vendor’s contract, invoices &amp; draw remittance.</div>
        </div>
      )}
      {party === "vendor" && canEdit && trade && (
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 11.5, color: "var(--muted)", display: "inline-flex", gap: 5, alignItems: "center" }}>
            <input type="checkbox" checked={ownerManaged} onChange={(e) => store.setTradeManaged(trade.id, e.target.checked ? "owner" : "builder")} /> Owner-managed
          </label>
          <button className="btn btn-sm" onClick={() => store.toggleContactShare(c.id)} style={{ color: c.shareAll ? "var(--sage-2)" : "var(--muted)" }}>{c.shareAll ? "✓ Shared with team" : "Share with team"}</button>
          <button className="btn btn-sm" style={{ color: "var(--rust)", marginLeft: "auto" }} onClick={() => { if (confirm(`Remove company/billing for "${c.company}"? (People stay in the project.)`)) store.removeContactSheet(c.id); }}>Remove company</button>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, disabled }: { label: string; value?: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 130 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)" }}>{label}</span>
      <input value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value)} style={{ fontSize: 12.5 }} />
    </label>
  );
}

function InviteToTrade({ tradeId, ownerManaged }: { tradeId: string; ownerManaged: boolean }) {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const [n, setN] = useState("");
  const [e, setE] = useState("");
  if (!open) return <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setOpen(true)}>＋ Invite person</button>;
  return (
    <div className="card" style={{ padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
      <input placeholder="Name" value={n} onChange={(ev) => setN(ev.target.value)} style={{ fontSize: 12 }} />
      <input placeholder="Email" value={e} onChange={(ev) => setE(ev.target.value)} style={{ fontSize: 12 }} />
      <div style={{ display: "flex", gap: 6 }}>
        <button className="btn btn-sm btn-primary" disabled={!n.trim() || !e.trim()} onClick={() => { store.inviteUser({ name: n.trim(), email: e.trim(), role: "trade", tradeIds: [tradeId], managedBy: ownerManaged ? "owner" : "builder" }); setN(""); setE(""); setOpen(false); }}>Invite to app</button>
        <button className="btn btn-sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

function AddVendorTrade() {
  const store = useStore();
  const db = store.db;
  const isOwnerRole = store.session.role === "owner";
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [tradeId, setTradeId] = useState("");
  const [newName, setNewName] = useState("");
  const [cat, setCat] = useState<MacroCategory>("Exterior");
  const [ownerMgd, setOwnerMgd] = useState(isOwnerRole);
  const taken = new Set(db.contacts.filter((c) => c.party === "vendor").map((c) => c.tradeId));
  const trades = db.trades.filter((t) => !taken.has(t.id));
  if (!open) return <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>＋ Add vendor / trade</button>;
  return (
    <div className="card" style={{ padding: 10, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <select value={mode} onChange={(e) => setMode(e.target.value as "existing" | "new")} style={{ fontSize: 12 }}><option value="existing">Existing trade</option><option value="new">New trade</option></select>
      {mode === "existing" ? (
        <select value={tradeId} onChange={(e) => setTradeId(e.target.value)} style={{ fontSize: 12 }}>
          <option value="">— trade —</option>
          {MACRO_ORDER.map((c) => <optgroup key={c} label={c}>{trades.filter((t) => t.category === c).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>)}
        </select>
      ) : (
        <>
          <input placeholder="New trade name (e.g. Windows — Builder)" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ fontSize: 12, width: 190 }} />
          <select value={cat} onChange={(e) => setCat(e.target.value as MacroCategory)} style={{ fontSize: 12 }}>{MACRO_ORDER.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        </>
      )}
      {isOwnerRole ? <Pill color="#fff" bg="var(--brass)">⌂ Owner Managed</Pill> : (
        <label style={{ fontSize: 11.5, color: "var(--muted)", display: "inline-flex", gap: 4, alignItems: "center" }}>
          <input type="checkbox" checked={ownerMgd} onChange={(e) => setOwnerMgd(e.target.checked)} /> Owner-managed
        </label>
      )}
      <button className="btn btn-sm btn-primary" disabled={mode === "existing" ? !tradeId : !newName.trim()} onClick={() => {
        let tid = tradeId;
        const managedBy = isOwnerRole || ownerMgd ? "owner" as const : "builder" as const;
        if (mode === "new") tid = store.addTrade({ name: newName.trim(), category: cat, managedBy });
        else if (managedBy === "owner") store.setTradeManaged(tid, "owner");
        const tName = mode === "new" ? newName.trim() : db.trades.find((x) => x.id === tid)?.name;
        store.addContactSheet({ party: "vendor", tradeId: tid, company: `${tName ?? "Vendor"} vendor` });
        setOpen(false); setTradeId(""); setNewName("");
      }}>Add</button>
      <button className="btn btn-sm" onClick={() => setOpen(false)}>Cancel</button>
      <span style={{ fontSize: 11, color: "var(--muted)", width: "100%" }}>
        Two vendors can cover the same trade — add a <em>new trade</em> per vendor (e.g. “Windows — Diverse” owner-managed and “Windows — Builder”); each gets its own contract, costs &amp; schedule. Names are renamable on each vendor card below.
      </span>
    </div>
  );
}

function RemoveDialog({ target, onClose }: { target: { id: string; name: string; email: string }; onClose: () => void }) {
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const remove = async () => {
    setBusy(true); setMsg("Removing…");
    // 1) delete the Supabase auth account (best-effort — needs service role)
    const r = await removeAuthUser(target.email);
    // 2) remove the app record from the database
    store.removeUser(target.id);
    setBusy(false);
    if (r.ok) onClose();
    else { setMsg(`App access removed. Auth account: ${r.error}`); setTimeout(onClose, 2500); }
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(44,36,28,.5)", zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div className="card" style={{ maxWidth: 440, width: "100%", padding: 22 }} onClick={(e) => e.stopPropagation()}>
        <h3 className="serif" style={{ fontSize: 18, fontWeight: 700, color: "var(--walnut)" }}>Remove {target.name}?</h3>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "8px 0 4px" }}>
          This permanently removes <strong>{target.email}</strong> from the project and <strong>deletes their account from the database</strong>. They’ll lose all access immediately and can’t sign in.
        </p>
        <p style={{ fontSize: 12, color: "var(--muted)" }}>This can’t be undone. You can always re-invite them later.</p>
        {msg && <div style={{ fontSize: 12, color: "var(--brass-2)", marginTop: 8 }}>{msg}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button className="btn" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} style={{ background: "var(--rust)", borderColor: "var(--rust)" }} onClick={remove}>{busy ? "…" : "Yes, remove & delete"}</button>
        </div>
      </div>
    </div>
  );
}

function RefreshInvite({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "busy">("idle");
  const [msg, setMsg] = useState("");
  const [review, setReview] = useState<string>("");
  const run = async () => {
    setState("busy"); setMsg(""); setReview("");
    const r = await sendInviteEmail(email);
    setState("idle");
    // Account review (was the Supabase auth role set up?)
    if (r.review) {
      const v = r.review;
      setReview(!v.userExists ? "🔍 No Supabase account yet — this invite creates one."
        : v.confirmed ? `✅ Supabase account active${v.lastSignInAt ? ` · last sign-in ${new Date(v.lastSignInAt).toLocaleDateString()}` : " · not signed in yet"}`
        : "⚠️ Supabase account created but email not confirmed — re-invite resent.");
    }
    // Email re-send result
    if (!r.ok) setMsg(r.error ?? "Failed.");
    else if (r.emailed) setMsg("✓ Invitation email re-sent.");
    else if (r.link) { if (navigator.clipboard) navigator.clipboard.writeText(r.link); setMsg("✓ Fresh invite link copied (email re-send needs custom SMTP)."); }
    else setMsg("✓ Done.");
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <button className="btn btn-sm" disabled={state === "busy"} onClick={run} title="Re-push the invitation: review the Supabase account & re-send the email">{state === "busy" ? "…" : "↻ Re-push invite"}</button>
      {review && <span style={{ fontSize: 11, color: review.startsWith("✅") ? "var(--sage-2)" : review.startsWith("⚠️") ? "var(--rust)" : "var(--muted)" }}>{review}</span>}
      {msg && <span style={{ fontSize: 11, color: msg.startsWith("✓") ? "var(--sage-2)" : "var(--rust)" }}>{msg}</span>}
    </span>
  );
}

function CopyInvite({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const link = (typeof window !== "undefined" ? window.location.origin : "") + "/?invite=" + token;
  return (
    <button className="btn btn-sm" onClick={() => { if (navigator.clipboard) navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }} title={link}>
      {copied ? "✓ Copied invite link" : "Copy invite link"}
    </button>
  );
}

function InvitePanel({ viewerRole, name, setName, email, setEmail, nrole, setNrole }: {
  viewerRole: Role; name: string; setName: (s: string) => void; email: string; setEmail: (s: string) => void; nrole: Role; setNrole: (r: Role) => void;
}) {
  const store = useStore();
  const db = store.db;
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [tradeId, setTradeId] = useState("");
  const [warn, setWarn] = useState("");
  const canInviteAny = viewerRole === "full_admin";
  const canInviteVendor = viewerRole === "full_admin" || viewerRole === "builder" || viewerRole === "owner";
  // Full admin chooses any role; builder/owner can only invite trades.
  const inviteRole: Role = canInviteAny ? nrole : "trade";
  const needsTrade = inviteRole === "trade";
  const managedBy = viewerRole === "owner" ? ("owner" as const) : ("builder" as const);

  const assign = () => {
    setWarn("");
    if (!name.trim() || !email.trim()) { setWarn("Name and email required."); return null; }
    if (needsTrade && !tradeId) { setWarn("Assign which trade this vendor will do."); return null; }
    return { name: name.trim(), email: email.trim(), role: inviteRole, ...(needsTrade ? { tradeIds: [tradeId], managedBy } : {}) };
  };
  const [emailMsg, setEmailMsg] = useState("");
  const doInvite = async () => {
    const u = assign(); if (!u) return;
    const targetEmail = u.email;
    const token = store.inviteUser(u);
    setLastLink((typeof window !== "undefined" ? window.location.origin : "") + "/?invite=" + token);
    setName(""); setEmail(""); setTradeId("");
    setEmailMsg("Sending invite email…");
    const r = await sendInviteEmail(targetEmail);
    setEmailMsg(r.ok ? `✓ Invite emailed to ${targetEmail}.` : `Email not sent (${r.error}). Share the link below instead.`);
  };
  const doAdd = () => { const u = assign(); if (!u) return; store.addUser({ ...u, status: "active" }); setName(""); setEmail(""); setTradeId(""); };

  if (!canInviteAny && !canInviteVendor) return null;
  return (
    <div className="card" style={{ padding: 14, marginTop: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{canInviteAny ? "Invite a user" : "Invite a trade / vendor"}</div>
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 8 }}>Access is granted only by invite — the person is assigned their role{needsTrade ? " and trade" : ""} here, before they sign up.</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
        {canInviteAny ? (
          <select value={nrole} onChange={(e) => setNrole(e.target.value as Role)}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
        ) : (
          <Pill bg="var(--cream-2)">Trade / Vendor</Pill>
        )}
        {needsTrade && (
          <select value={tradeId} onChange={(e) => setTradeId(e.target.value)} style={{ borderColor: needsTrade && !tradeId ? "var(--rust)" : undefined }}>
            <option value="">Assign trade…</option>
            {MACRO_ORDER.map((c) => (
              <optgroup key={c} label={c}>{db.trades.filter((t) => t.category === c).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>
            ))}
          </select>
        )}
        <button className="btn btn-primary" onClick={doInvite}>✉ Send invite</button>
        {canInviteAny && <button className="btn" onClick={doAdd}>+ Add directly</button>}
      </div>
      {warn && <div style={{ fontSize: 12, color: "var(--rust)", marginTop: 8 }}>{warn}</div>}
      {emailMsg && <div style={{ fontSize: 12.5, color: emailMsg.startsWith("✓") ? "var(--sage-2)" : "var(--muted)", marginTop: 8 }}>{emailMsg}</div>}
      {lastLink && (
        <div style={{ marginTop: 10, padding: "8px 10px", background: "var(--sage-tint)", borderRadius: 8, fontSize: 12 }}>
          Invite created &amp; assigned. Share this link: <code style={{ fontSize: 11.5 }}>{lastLink}</code>
          <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => navigator.clipboard?.writeText(lastLink)}>Copy</button>
        </div>
      )}
    </div>
  );
}

function ContactRow({ label, value, disabled, onSave }: { label: string; value: string; disabled?: boolean; onSave: (v: string) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
      <span style={{ color: "var(--muted)", minWidth: 90 }}>{label}</span>
      <input defaultValue={value} disabled={disabled} onBlur={(e) => onSave(e.target.value)} style={{ flex: 1, fontSize: 12.5 }} />
    </div>
  );
}

function Lbl({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)" }}>{children}</div>;
}

// A horizontally-scrollable card whose scrollbar is mirrored by a thin bar that
// sticks to the bottom of the viewport — so wide tables can be panned while the
// column headers stay in view and the scrollbar never gets buried below the fold.
function PersistentScroll({ children, maxHeight, dep }: { children: React.ReactNode; maxHeight?: number | string; dep?: unknown }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const proxyRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ sw: 0, overflow: false });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setDims({ sw: el.scrollWidth, overflow: el.scrollWidth > el.clientWidth + 1 });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    window.addEventListener("resize", update);
    return () => { ro.disconnect(); window.removeEventListener("resize", update); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep]);

  // Wheel: translate horizontal/shift-wheel intent into scrollLeft (the box itself
  // has overflowX hidden so there's no native horizontal scrollbar to fight with).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : (e.shiftKey ? e.deltaY : 0);
      if (dx) { el.scrollLeft += dx; if (proxyRef.current) proxyRef.current.scrollLeft = el.scrollLeft; e.preventDefault(); }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <>
      <div ref={scrollRef} className="card" style={{ overflowX: "hidden", overflowY: "auto", maxHeight: maxHeight ?? "70vh", padding: 0 }}>
        {children}
      </div>
      {dims.overflow && (
        <div
          ref={proxyRef}
          onScroll={() => { const el = scrollRef.current; if (el && proxyRef.current) el.scrollLeft = proxyRef.current.scrollLeft; }}
          style={{ position: "sticky", bottom: 0, zIndex: 9, overflowX: "auto", overflowY: "hidden", height: 15, marginTop: -1, background: "var(--paper)", borderTop: "1px solid var(--line)", borderRadius: "0 0 10px 10px", boxShadow: "0 -3px 8px rgba(60,50,40,0.06)" }}
          title="Scroll the table sideways">
          <div style={{ width: dims.sw, height: 1 }} />
        </div>
      )}
    </>
  );
}

const thLeft: React.CSSProperties = { textAlign: "left", padding: "9px 12px", borderBottom: "2px solid var(--line)", position: "sticky", left: 0, top: 0, background: "var(--paper)", fontSize: 11.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" };
const thCell: React.CSSProperties = { textAlign: "center", padding: "9px 8px", borderBottom: "2px solid var(--line)", fontSize: 11, color: "var(--muted)", fontWeight: 700, position: "sticky", top: 0, background: "var(--paper)", zIndex: 3 };
const tdLeft: React.CSSProperties = { padding: "8px 12px", borderBottom: "1px solid var(--line)", position: "sticky", left: 0, background: "var(--paper)", minWidth: 170, zIndex: 2 };
const td: React.CSSProperties = { padding: "7px 8px", borderBottom: "1px solid var(--line)", verticalAlign: "top" };

"use client";

import { useState } from "react";
import { useStore } from "@/lib/data/hooks";
import { PageHeader, NoAccess, Pill, SectionTitle } from "../ui/bits";
import {
  accessFor, SCOPE_LABEL, ROLE_LABEL, type MacroCategory, type ModuleKey, type Role,
  type ScopeStatus, type AccessLevel, type RoomFloor,
} from "@/lib/data/types";
import { MACRO_ORDER, MACRO_COLOR } from "@/lib/data/money";

const SCOPE_CYCLE: ScopeStatus[] = ["unset", "in", "existing", "out"];
const SCOPE_COLOR: Record<ScopeStatus, string> = { in: "var(--sc-in)", out: "var(--sc-out)", existing: "var(--sc-existing)", unset: "transparent" };
const FLOORS: RoomFloor[] = ["Whole House", "First Floor", "Second Floor", "Basement", "Exterior"];

type Tab = "matrix" | "trade" | "users";

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
        subtitle="Define the project: which rooms are included, what each trade does in each room (in-scope / out / use-existing), and who can see and edit each part of the app."
        right={ro ? <Pill color="var(--muted)">View only</Pill> : undefined}
      />
      <div style={{ display: "flex", gap: 6, marginTop: 16, borderBottom: "1px solid var(--line)" }}>
        {([["matrix", "Rooms & Scope Matrix"], ["trade", "Trade Scope"], ["users", "Users & Access"]] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className="btn btn-sm"
            style={{ border: "none", borderBottom: tab === k ? "2px solid var(--sage)" : "2px solid transparent", background: "transparent", borderRadius: 0, color: tab === k ? "var(--walnut)" : "var(--muted)", fontWeight: 700 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === "matrix" && <MatrixTab ro={ro} />}
      {tab === "trade" && <TradeScopeTab ro={ro} />}
      {tab === "users" && <UsersTab ro={ro} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Rooms + scope matrix
// ---------------------------------------------------------------------------
function MatrixTab({ ro }: { ro: boolean }) {
  const store = useStore();
  const db = store.db;
  const [cat, setCat] = useState<MacroCategory>("Mechanicals (MEP)");
  const [newRoom, setNewRoom] = useState("");
  const [newFloor, setNewFloor] = useState<RoomFloor>("First Floor");

  const tradesInCat = db.trades.filter((t) => t.category === cat);
  const cellOf = (roomId: string, tradeId: string): ScopeStatus =>
    db.scope.find((c) => c.roomId === roomId && c.tradeId === tradeId)?.status ?? "unset";

  return (
    <>
      <SectionTitle right={
        <select value={cat} onChange={(e) => setCat(e.target.value as MacroCategory)}>
          {MACRO_ORDER.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      }>
        Scope Matrix
      </SectionTitle>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", marginBottom: 10, fontSize: 12, color: "var(--muted)" }}>
        <span>Click a cell to cycle:</span>
        {(["in", "existing", "out", "unset"] as ScopeStatus[]).map((s) => (
          <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 13, height: 13, borderRadius: 3, border: "1px solid var(--line)", background: SCOPE_COLOR[s] }} />
            {SCOPE_LABEL[s]}
          </span>
        ))}
      </div>

      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ fontSize: 12.5 }}>
          <thead>
            <tr>
              <th style={thLeft}>Room</th>
              {tradesInCat.map((t) => (
                <th key={t.id} style={{ ...thCell, minWidth: 96 }}>{t.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {db.rooms.map((room) => (
              <tr key={room.id}>
                <td style={tdLeft}>
                  <span style={{ fontWeight: 600 }}>{room.name}</span>
                  {room.addition && <span style={{ marginLeft: 6 }}><Pill color="#fff" bg="var(--brass)">addition</Pill></span>}
                  <div style={{ fontSize: 10.5, color: "var(--muted)" }}>{room.floor}</div>
                </td>
                {tradesInCat.map((t) => {
                  const s = cellOf(room.id, t.id);
                  return (
                    <td key={t.id} style={{ padding: 3, textAlign: "center" }}>
                      <button
                        disabled={ro}
                        onClick={() => {
                          const next = SCOPE_CYCLE[(SCOPE_CYCLE.indexOf(s) + 1) % SCOPE_CYCLE.length];
                          store.setScopeStatus(room.id, t.id, next);
                        }}
                        title={`${room.name} · ${t.name}: ${SCOPE_LABEL[s]}`}
                        className="scope-btn"
                        style={{
                          background: s === "unset" ? "var(--paper)" : SCOPE_COLOR[s],
                          color: s === "unset" ? "var(--muted)" : "#fff",
                          cursor: ro ? "default" : "pointer",
                        }}
                      >
                        {s === "unset" ? "·" : s === "in" ? "IN" : s === "existing" ? "EXIST" : "OUT"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SectionTitle>Rooms ({db.rooms.length})</SectionTitle>
      {!ro && (
        <div className="card" style={{ padding: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <input placeholder="New room name…" value={newRoom} onChange={(e) => setNewRoom(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
          <select value={newFloor} onChange={(e) => setNewFloor(e.target.value as RoomFloor)}>
            {FLOORS.map((f) => <option key={f}>{f}</option>)}
          </select>
          <button className="btn btn-primary" onClick={() => { if (newRoom.trim()) { store.addRoom(newRoom.trim(), newFloor); setNewRoom(""); } }}>+ Add room</button>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
        {db.rooms.map((room) => (
          <div key={room.id} className="card" style={{ padding: "9px 11px", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <input defaultValue={room.name} disabled={ro} onBlur={(e) => e.target.value.trim() && store.renameRoom(room.id, e.target.value.trim())}
                style={{ border: "none", background: "transparent", padding: 0, fontWeight: 600, fontSize: 13.5, width: "100%" }} />
              <div style={{ fontSize: 11, color: "var(--muted)" }}>{room.floor}{room.custom ? " · custom" : ""}</div>
            </div>
            {!ro && room.id !== "whole-house" && (
              <button className="btn btn-sm" onClick={() => store.removeRoom(room.id)} title="Remove" style={{ color: "var(--rust)", borderColor: "var(--line)" }}>✕</button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Trade scope — focused per-trade editor with apply-to-all / copy-to-rooms
// ---------------------------------------------------------------------------
function TradeScopeTab({ ro }: { ro: boolean }) {
  const store = useStore();
  const db = store.db;
  const [tradeId, setTradeId] = useState(db.trades.find((t) => t.id === "electrical")?.id ?? db.trades[0].id);
  const [newItem, setNewItem] = useState("");
  const trade = db.trades.find((t) => t.id === tradeId)!;

  const cellOf = (roomId: string) => db.scope.find((c) => c.roomId === roomId && c.tradeId === tradeId);
  const inRooms = db.rooms.filter((r) => cellOf(r.id)?.status === "in");

  return (
    <>
      <SectionTitle right={
        <select value={tradeId} onChange={(e) => setTradeId(e.target.value)}>
          {MACRO_ORDER.map((c) => (
            <optgroup key={c} label={c}>
              {db.trades.filter((t) => t.category === c).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </optgroup>
          ))}
        </select>
      }>
        {trade.name} — scope by room
      </SectionTitle>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <span style={{ alignSelf: "center", fontSize: 12.5, color: "var(--muted)" }}>Bulk:</span>
        {!ro && (["in", "existing", "out", "unset"] as ScopeStatus[]).map((s) => (
          <button key={s} className="btn btn-sm" onClick={() => store.applyScopeToAll(tradeId, s)}>
            Set all rooms → <strong style={{ marginLeft: 3 }}>{SCOPE_LABEL[s]}</strong>
          </button>
        ))}
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        {db.rooms.map((room, idx) => {
          const cell = cellOf(room.id);
          const status = cell?.status ?? "unset";
          return (
            <div key={room.id} style={{ padding: "9px 14px", borderTop: idx ? "1px solid var(--line)" : undefined, display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{ width: 200, flexShrink: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{room.name}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>{room.floor}</div>
              </div>
              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                {(["in", "existing", "out"] as ScopeStatus[]).map((s) => (
                  <button key={s} disabled={ro} onClick={() => store.setScopeStatus(room.id, tradeId, status === s ? "unset" : s)}
                    className="btn btn-sm"
                    style={{ background: status === s ? SCOPE_COLOR[s] : "var(--paper)", color: status === s ? "#fff" : "var(--ink)", borderColor: status === s ? SCOPE_COLOR[s] : "var(--line)" }}>
                    {SCOPE_LABEL[s]}
                  </button>
                ))}
              </div>
              <div style={{ flex: 1, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                {status === "in" && cell?.items.map((it) => (
                  <label key={it.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: it.included ? "var(--ink)" : "var(--muted)" }}>
                    <input type="checkbox" checked={it.included} disabled={ro} onChange={() => store.toggleScopeItem(room.id, tradeId, it.id)} />
                    {it.label}
                  </label>
                ))}
                {status !== "in" && <span style={{ fontSize: 12, color: "var(--muted)" }}>{SCOPE_LABEL[status]}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {!ro && (
        <div className="card" style={{ padding: 12, marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <strong style={{ fontSize: 13 }}>Copy this trade&apos;s scope</strong>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>from</span>
          <CopyControl tradeId={tradeId} />
        </div>
      )}

      <SectionTitle>Default checklist (template)</SectionTitle>
      <div className="card" style={{ padding: 14 }}>
        <p style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>
          These items seed every room you mark <strong>In Scope</strong> for {trade.name}. {inRooms.length} room{inRooms.length === 1 ? "" : "s"} currently in scope.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {(db.scopeTemplates.find((t) => t.tradeId === tradeId)?.items ?? []).map((it, i) => (
            <Pill key={i} bg="var(--sage-tint)">{it}</Pill>
          ))}
          {!(db.scopeTemplates.find((t) => t.tradeId === tradeId)?.items.length) && <span style={{ fontSize: 12.5, color: "var(--muted)" }}>No template yet — add scope items per room above.</span>}
        </div>
        {!ro && (
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <input placeholder="Add a scope item to in-scope rooms…" value={newItem} onChange={(e) => setNewItem(e.target.value)} style={{ flex: 1 }} />
            <button className="btn" onClick={() => {
              if (!newItem.trim()) return;
              inRooms.forEach((r) => store.addScopeItem(r.id, tradeId, newItem.trim()));
              setNewItem("");
            }}>Add to {inRooms.length} room{inRooms.length === 1 ? "" : "s"}</button>
          </div>
        )}
      </div>
    </>
  );
}

function CopyControl({ tradeId }: { tradeId: string }) {
  const store = useStore();
  const db = store.db;
  const [from, setFrom] = useState(db.rooms[1]?.id ?? db.rooms[0].id);
  const [targets, setTargets] = useState<string[]>([]);
  return (
    <>
      <select value={from} onChange={(e) => setFrom(e.target.value)}>
        {db.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      <span style={{ fontSize: 12.5, color: "var(--muted)" }}>to</span>
      <select multiple value={targets} onChange={(e) => setTargets(Array.from(e.target.selectedOptions, (o) => o.value))} style={{ minWidth: 180, height: 80 }}>
        {db.rooms.filter((r) => r.id !== from).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      <button className="btn btn-primary" disabled={!targets.length} onClick={() => { store.copyScopeToRooms(from, tradeId, targets); setTargets([]); }}>
        Copy to {targets.length || "…"} room{targets.length === 1 ? "" : "s"}
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------
// Users & access
// ---------------------------------------------------------------------------
const MODULES: { key: ModuleKey; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "admin", label: "Admin" },
  { key: "costs", label: "Costs" },
  { key: "budget", label: "Budget" },
  { key: "timing", label: "Timing" },
  { key: "materials", label: "Materials" },
  { key: "vendors", label: "Vendors" },
  { key: "artifacts", label: "Artifacts" },
];
const LEVELS: AccessLevel[] = ["none", "view", "edit"];
const ROLES: Role[] = ["owner", "builder", "trade", "viewer"];

function UsersTab({ ro }: { ro: boolean }) {
  const store = useStore();
  const db = store.db;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [nrole, setNrole] = useState<Role>("trade");

  return (
    <>
      <SectionTitle>Users &amp; Access</SectionTitle>
      <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: -6, marginBottom: 12 }}>
        Each row’s access falls back to the role default unless you override a module. The owner-only <strong>Budget</strong> is hidden from builders and trades by default. Door codes are granted per person.
      </p>
      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ fontSize: 12.5 }}>
          <thead>
            <tr>
              <th style={thLeft}>Person</th>
              <th style={thCell}>Role</th>
              <th style={thCell}>Door code</th>
              {MODULES.map((m) => <th key={m.key} style={{ ...thCell, minWidth: 74 }}>{m.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {db.users.map((u) => (
              <tr key={u.id}>
                <td style={tdLeft}>
                  <div style={{ fontWeight: 600 }}>{u.name}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{u.email}</div>
                </td>
                <td style={tdCell}>
                  <select value={u.role} disabled={ro} onChange={(e) => store.updateUser(u.id, { role: e.target.value as Role })}>
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                </td>
                <td style={tdCell}>
                  <input value={u.doorCode ?? ""} disabled={ro} placeholder="—" onChange={(e) => store.setDoorCode(u.id, e.target.value)} style={{ width: 64 }} />
                </td>
                {MODULES.map((m) => {
                  const eff = accessFor(u, u.role, m.key);
                  return (
                    <td key={m.key} style={{ ...tdCell, textAlign: "center" }}>
                      <select value={eff} disabled={ro} onChange={(e) => store.setUserAccess(u.id, m.key, e.target.value as AccessLevel)}
                        style={{ padding: "3px 4px", fontSize: 11, color: eff === "none" ? "var(--muted)" : eff === "edit" ? "var(--sage-2)" : "var(--ink)" }}>
                        {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!ro && (
        <div className="card" style={{ padding: 12, marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
          <select value={nrole} onChange={(e) => setNrole(e.target.value as Role)}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          <button className="btn btn-primary" onClick={() => { if (name.trim()) { store.addUser({ name: name.trim(), email: email.trim(), role: nrole }); setName(""); setEmail(""); } }}>+ Add user</button>
        </div>
      )}
    </>
  );
}

const thLeft: React.CSSProperties = { textAlign: "left", padding: "9px 12px", borderBottom: "2px solid var(--line)", position: "sticky", left: 0, background: "var(--paper)", fontSize: 11.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" };
const thCell: React.CSSProperties = { textAlign: "center", padding: "9px 8px", borderBottom: "2px solid var(--line)", fontSize: 11, color: "var(--muted)", fontWeight: 700 };
const tdLeft: React.CSSProperties = { padding: "8px 12px", borderBottom: "1px solid var(--line)", position: "sticky", left: 0, background: "var(--paper)", minWidth: 170 };
const tdCell: React.CSSProperties = { padding: "6px 8px", borderBottom: "1px solid var(--line)" };

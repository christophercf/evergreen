"use client";

import { useState } from "react";
import { useStore } from "@/lib/data/hooks";
import { PageHeader, NoAccess, Pill, SectionTitle } from "../ui/bits";
import {
  accessFor, canRemoveUser, canSeeContacts, SCOPE_LABEL, ROLE_LABEL,
  type MacroCategory, type ModuleKey, type Role, type ScopeStatus, type AccessLevel, type RoomFloor,
} from "@/lib/data/types";
import { MACRO_ORDER } from "@/lib/data/money";

const SCOPE_CYCLE: ScopeStatus[] = ["unset", "in", "existing", "out"];
const SCOPE_COLOR: Record<ScopeStatus, string> = { in: "var(--sc-in)", out: "var(--sc-out)", existing: "var(--sc-existing)", unset: "transparent" };
const cellText = (s: ScopeStatus) => (s === "unset" ? "·" : s === "in" ? "IN" : s === "existing" ? "EX" : "OUT");
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
        subtitle="Define the project: which rooms are included, what each trade does in each room (In / EX / Out), and who can see and edit each part of the app."
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
          <button className="btn btn-sm" disabled={!store.canUndoScope} onClick={() => store.undoScope()}>↶ Undo</button>
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

      {/* matrix — sticky header (top) + sticky room column (left) */}
      <div className="card" style={{ overflow: "auto", maxHeight: "70vh", padding: 0 }}>
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
      </div>

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
];
const LEVELS: AccessLevel[] = ["none", "view", "edit"];
const ROLES: Role[] = ["full_admin", "owner", "builder", "trade", "viewer"];

function UsersTab({ ro }: { ro: boolean }) {
  const store = useStore();
  const db = store.db;
  const viewerRole = store.session.role;
  const viewer = store.currentUser;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [nrole, setNrole] = useState<Role>("trade");

  return (
    <>
      <SectionTitle>Users &amp; Access</SectionTitle>
      <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: -6, marginBottom: 12 }}>
        Builders have general admin access (everything except the owner-only Budget). The owner can remove the builder and manage their own trades; the builder manages subs. Owner-managed trade contacts are shared with the builder; builder-managed trade contacts are private from the owner.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", gap: 12 }}>
        {db.users.map((u) => {
          const seeContacts = canSeeContacts(viewerRole, u);
          const canRemove = !ro && canRemoveUser(viewerRole, viewer, u);
          return (
            <div key={u.id} className="card" style={{ padding: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input defaultValue={u.name} disabled={ro} onBlur={(e) => e.target.value.trim() && store.updateUser(u.id, { name: e.target.value.trim() })} style={{ border: "none", background: "transparent", fontWeight: 700, fontSize: 15, flex: 1, fontFamily: "var(--font-serif)", color: "var(--walnut)" }} />
                <select value={u.role} disabled={ro} onChange={(e) => store.updateUser(u.id, { role: e.target.value as Role })} style={{ fontSize: 11.5 }}>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
                {canRemove && <button className="btn btn-sm" style={{ color: "var(--rust)" }} title="Remove user" onClick={() => store.removeUser(u.id)}>✕</button>}
              </div>
              {(u.status && u.status !== "active") && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                  <Pill color="#fff" bg={u.status === "invited" ? "var(--brass)" : "var(--rust)"}>{u.status === "invited" ? "invited — not yet joined" : "pending approval"}</Pill>
                  {!ro && u.status === "pending" && <button className="btn btn-sm" onClick={() => store.approveUser(u.id)}>Approve</button>}
                  {!ro && u.status === "invited" && u.inviteToken && <CopyInvite token={u.inviteToken} />}
                </div>
              )}

              {u.role === "trade" && (
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
                  Managed by
                  <select value={u.managedBy ?? "builder"} disabled={ro} onChange={(e) => store.updateUser(u.id, { managedBy: e.target.value as "builder" | "owner" })} style={{ fontSize: 11.5 }}>
                    <option value="builder">Builder</option>
                    <option value="owner">Owner</option>
                  </select>
                </div>
              )}

              {/* Contacts (gated) */}
              <div style={{ marginTop: 10 }}>
                <Lbl>Contacts</Lbl>
                {seeContacts ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 4 }}>
                    <ContactRow label="Primary email" value={u.email} disabled={ro} onSave={(v) => store.updateUser(u.id, { email: v })} />
                    <ContactRow label="Primary phone" value={u.phone ?? ""} disabled={ro} onSave={(v) => store.updateUser(u.id, { phone: v })} />
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
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, fontStyle: "italic" }}>🔒 Trade contact managed by the builder — hidden from the owner.</div>
                )}
              </div>

              {/* Door code */}
              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
                <Lbl>Door code</Lbl>
                <input value={u.doorCode ?? ""} disabled={ro} placeholder="—" onChange={(e) => store.setDoorCode(u.id, e.target.value)} style={{ width: 80, fontSize: 12 }} />
              </div>

              {/* Access */}
              <div style={{ marginTop: 10 }}>
                <Lbl>Module access</Lbl>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 5, marginTop: 4 }}>
                  {MODULES.map((m) => {
                    const eff = accessFor(u, u.role, m.key);
                    return (
                      <label key={m.key} style={{ fontSize: 11, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 2 }}>
                        {m.label}
                        <select value={eff} disabled={ro} onChange={(e) => store.setUserAccess(u.id, m.key, e.target.value as AccessLevel)} style={{ fontSize: 11, padding: "2px 4px", color: eff === "none" ? "var(--muted)" : eff === "edit" ? "var(--sage-2)" : "var(--ink)" }}>
                          {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                        </select>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {!ro && <InvitePanel viewerRole={viewerRole} name={name} setName={setName} email={email} setEmail={setEmail} nrole={nrole} setNrole={setNrole} />}
    </>
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
  const [lastLink, setLastLink] = useState<string | null>(null);
  const canInviteAny = viewerRole === "full_admin";
  const canInviteVendor = viewerRole === "full_admin" || viewerRole === "builder" || viewerRole === "owner";
  // Full admin chooses role; others can only invite vendors (trade).
  const inviteRole: Role = canInviteAny ? nrole : "trade";

  const doInvite = () => {
    if (!name.trim() || !email.trim()) return;
    const token = store.inviteUser({ name: name.trim(), email: email.trim(), role: inviteRole, ...(inviteRole === "trade" ? { managedBy: viewerRole === "owner" ? ("owner" as const) : ("builder" as const) } : {}) });
    setLastLink((typeof window !== "undefined" ? window.location.origin : "") + "/?invite=" + token);
    setName(""); setEmail("");
  };

  if (!canInviteAny && !canInviteVendor) return null;
  return (
    <div className="card" style={{ padding: 14, marginTop: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
        {canInviteAny ? "Add or invite a user" : "Invite a vendor"}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
        {canInviteAny ? (
          <select value={nrole} onChange={(e) => setNrole(e.target.value as Role)}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
        ) : (
          <Pill bg="var(--cream-2)">Trade / Vendor</Pill>
        )}
        <button className="btn btn-primary" onClick={doInvite}>✉ Send invite</button>
        {canInviteAny && <button className="btn" onClick={() => { if (name.trim()) { store.addUser({ name: name.trim(), email: email.trim(), role: nrole, status: "active", ...(nrole === "trade" ? { managedBy: "builder" as const } : {}) }); setName(""); setEmail(""); } }}>+ Add directly</button>}
      </div>
      {lastLink && (
        <div style={{ marginTop: 10, padding: "8px 10px", background: "var(--sage-tint)", borderRadius: 8, fontSize: 12 }}>
          Invite created. Share this link: <code style={{ fontSize: 11.5 }}>{lastLink}</code>
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

const thLeft: React.CSSProperties = { textAlign: "left", padding: "9px 12px", borderBottom: "2px solid var(--line)", position: "sticky", left: 0, top: 0, background: "var(--paper)", fontSize: 11.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" };
const thCell: React.CSSProperties = { textAlign: "center", padding: "9px 8px", borderBottom: "2px solid var(--line)", fontSize: 11, color: "var(--muted)", fontWeight: 700, position: "sticky", top: 0, background: "var(--paper)", zIndex: 3 };
const tdLeft: React.CSSProperties = { padding: "8px 12px", borderBottom: "1px solid var(--line)", position: "sticky", left: 0, background: "var(--paper)", minWidth: 170, zIndex: 2 };

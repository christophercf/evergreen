"use client";

import { Fragment, useMemo, useState } from "react";
import { useStore } from "@/lib/data/hooks";
import { PageHeader, NoAccess, StatCard, Pill } from "../ui/bits";
import { accessFor, MATERIAL_STATUS_LABEL, type Material, type MaterialStatus, type Purchaser } from "@/lib/data/types";
import { tradeName, MACRO_ORDER } from "@/lib/data/money";
import { CATALOG_CATEGORIES, optionsForCategory, tradeForCategory } from "@/lib/data/materialCatalog";
import { fileToDataURL } from "../ui/upload";
import { useFileDrop } from "../ui/use-drop";
import DesignStudio from "./studio";

const STATUS_BG: Record<MaterialStatus, string> = { needed: "var(--sc-unset)", ordered: "var(--brass)", purchased: "var(--sage)", delivered: "var(--ok)" };
const PURCH: Purchaser[] = ["owner", "trade", "builder"];

type SortKey = "room" | "trade" | "status" | "due";

export default function MaterialsPage() {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const user = store.currentUser;
  const access = accessFor(user, role, "materials");
  const [room, setRoom] = useState("all");
  const [trade, setTrade] = useState("all");
  const [cat, setCat] = useState("all");
  const [status, setStatus] = useState<"all" | MaterialStatus>("all");
  const [sort, setSort] = useState<SortKey>("room");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [ai, setAi] = useState<Material | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "studio">("list");

  if (access === "none") return <NoAccess module="Materials" />;
  const ro = access !== "edit";

  const roomLabel = (mt: Material) => mt.roomId ? (db.rooms.find((r) => r.id === mt.roomId)?.name ?? mt.roomLabel ?? "—") : (mt.roomLabel ?? "—");

  // Trades only see items essential to their job (auto-flagged by trade).
  const myTradeIds = role === "trade" ? new Set(user?.tradeIds ?? []) : null;
  const filtered = useMemo(() => {
    const list = db.materials.filter((mt) =>
      (!myTradeIds || (mt.tradeId ? myTradeIds.has(mt.tradeId) : false)) &&
      (room === "all" || mt.roomId === room || mt.roomLabel === room) &&
      (trade === "all" || mt.tradeId === trade) &&
      (cat === "all" || mt.category === cat) &&
      (status === "all" || mt.status === status));
    const k = (mt: Material) => sort === "room" ? roomLabel(mt) : sort === "trade" ? (mt.tradeId ?? "~") : sort === "status" ? mt.status : (mt.dueDate ?? "~9999");
    return [...list].sort((a, b) => k(a).localeCompare(k(b)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.materials, room, trade, cat, status, sort]);
  const catsUsed = Array.from(new Set([...CATALOG_CATEGORIES, ...db.materials.map((m) => m.category).filter(Boolean) as string[]]));

  const counts = { total: db.materials.length, needed: db.materials.filter((m) => m.status === "needed").length, purchased: db.materials.filter((m) => m.status === "purchased" || m.status === "delivered").length, owner: db.materials.filter((m) => m.purchaser === "owner").length };
  const tradesUsed = Array.from(new Set(db.materials.map((m) => m.tradeId).filter(Boolean) as string[]));
  const roomsUsed = Array.from(new Set(db.materials.map((m) => m.roomId).filter(Boolean) as string[]));

  const toggleSel = (id: string) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selIds = [...sel].filter((id) => filtered.some((m) => m.id === id));

  return (
    <>
      <PageHeader title="Materials" subtitle="Every material — sortable by room, trade, or status — with critical-path selection dates, spec links, who buys it, quantities, and where it's stored." />

      <div style={{ display: "inline-flex", gap: 6, marginTop: 14, background: "var(--cream-2)", padding: 4, borderRadius: 10 }}>
        {([["list", "📋 Material list"], ["studio", "✨ Design Studio"]] as const).map(([v, lbl]) => (
          <button key={v} onClick={() => setView(v)} className="btn btn-sm" style={view === v ? { background: "var(--walnut)", color: "#fff" } : { background: "transparent", border: "none" }}>{lbl}</button>
        ))}
      </div>

      {view === "studio" && <DesignStudio db={db} />}

      {view === "list" && <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))", gap: 12, marginTop: 16 }}>
        <StatCard label="Materials" value={`${counts.total}`} />
        <StatCard label="Still Needed" value={`${counts.needed}`} accent="var(--rust)" />
        <StatCard label="Purchased / Delivered" value={`${counts.purchased}`} accent="var(--ok)" />
        <StatCard label="Owner-Supplied" value={`${counts.owner}`} sub="vs trade/builder" />
      </div>

      {/* filters */}
      <div className="card" style={{ padding: 12, marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <Filter label="Room" value={room} onChange={setRoom} options={[["all", "All rooms"], ...roomsUsed.map((r) => [r, db.rooms.find((x) => x.id === r)?.name ?? r] as [string, string])]} />
        <Filter label="Trade" value={trade} onChange={setTrade} options={[["all", "All trades"], ...tradesUsed.map((t) => [t, tradeName(db, t)] as [string, string])]} />
        <Filter label="Category" value={cat} onChange={setCat} options={[["all", "All categories"], ...catsUsed.map((c) => [c, c] as [string, string])]} />
        <Filter label="Status" value={status} onChange={(v) => setStatus(v as "all" | MaterialStatus)} options={[["all", "All status"], ...(Object.keys(MATERIAL_STATUS_LABEL) as MaterialStatus[]).map((s) => [s, MATERIAL_STATUS_LABEL[s]] as [string, string])]} />
        <Filter label="Sort" value={sort} onChange={(v) => setSort(v as SortKey)} options={[["room", "Room"], ["trade", "Trade"], ["status", "Status"], ["due", "Due date"]]} />
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>{filtered.length} shown</span>
      </div>

      {/* bulk assign */}
      {!ro && selIds.length > 0 && (
        <div className="card" style={{ padding: 10, marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", borderLeft: "3px solid var(--sage)" }}>
          <strong style={{ fontSize: 13 }}>{selIds.length} selected</strong>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Assign purchaser:</span>
          {PURCH.map((p) => <button key={p} className="btn btn-sm" onClick={() => store.bulkAssignPurchaser(selIds, p)}>{p}</button>)}
          <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 8 }}>Set status:</span>
          {(Object.keys(MATERIAL_STATUS_LABEL) as MaterialStatus[]).map((s) => <button key={s} className="btn btn-sm" onClick={() => store.bulkSetMaterialStatus(selIds, s)}>{MATERIAL_STATUS_LABEL[s]}</button>)}
          <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}

      <div className="card" style={{ overflow: "auto", maxHeight: "64vh", marginTop: 12, padding: 0 }}>
        <table style={{ fontSize: 12.5 }}>
          <thead>
            <tr>
              {!ro && <th style={th}></th>}
              <th style={th}>Item</th><th style={th}>Room</th><th style={th}>Trade</th>
              <th style={thC}>Qty</th><th style={th}>Status</th><th style={th}>Buyer</th>
              <th style={th}>Due</th><th style={th}>Approval</th><th style={th}>Spec</th>{!ro && <th style={th}></th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((mt) => {
              const open = openId === mt.id;
              const colSpan = ro ? 10 : 12;
              return (
              <Fragment key={mt.id}>
              <tr style={{ background: open ? "var(--sage-tint)" : sel.has(mt.id) ? "var(--sage-tint)" : undefined }}>
                {!ro && <td style={td}><input type="checkbox" checked={sel.has(mt.id)} onChange={() => toggleSel(mt.id)} /></td>}
                <td style={td}>
                  <button onClick={() => setOpenId(open ? null : mt.id)} style={{ border: "none", background: "transparent", textAlign: "left", cursor: "pointer", padding: 0 }}>
                    <div style={{ fontWeight: 600 }}>{mt.critical && <span title="Critical path" style={{ color: "var(--rust)" }}>★ </span>}{mt.item} <span style={{ color: "var(--muted)", fontSize: 11 }}>{open ? "▾" : "▸"}</span></div>
                    {mt.desc && <div style={{ fontSize: 11, color: "var(--muted)" }}>{mt.desc}</div>}
                  </button>
                </td>
                <td style={td}>{roomLabel(mt)}</td>
                <td style={td}>{mt.tradeId ? tradeName(db, mt.tradeId) : "—"}</td>
                <td style={tdC}>{mt.qty ?? "—"}</td>
                <td style={td}>
                  <select value={mt.status} disabled={ro} onChange={(e) => store.updateMaterial(mt.id, { status: e.target.value as MaterialStatus })} style={{ fontSize: 11, padding: "2px 4px", color: "#fff", background: STATUS_BG[mt.status], border: "none", borderRadius: 5 }}>
                    {(Object.keys(MATERIAL_STATUS_LABEL) as MaterialStatus[]).map((s) => <option key={s} value={s} style={{ color: "var(--ink)", background: "var(--paper)" }}>{MATERIAL_STATUS_LABEL[s]}</option>)}
                  </select>
                </td>
                <td style={td}>
                  <select value={mt.purchaser} disabled={ro} onChange={(e) => store.updateMaterial(mt.id, { purchaser: e.target.value as Purchaser })} style={{ fontSize: 11, padding: "2px 4px" }}>
                    {PURCH.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </td>
                <td style={td}><input type="date" value={mt.dueDate ?? ""} disabled={ro} onChange={(e) => store.updateMaterial(mt.id, { dueDate: e.target.value })} style={{ fontSize: 11, width: 118 }} /></td>
                <td style={td}>{mt.designerApproved ? <Pill color="#fff" bg="var(--ok)">approved</Pill> : mt.approvalRequested ? <Pill color="var(--brass-2)" bg="#f0e6cd">requested</Pill> : <span style={{ color: "var(--muted)" }}>—</span>}</td>
                <td style={td}>{mt.specLink ? <a href={mt.specLink} target="_blank" rel="noreferrer" style={{ color: "var(--sage-2)", fontWeight: 600 }}>link ↗</a> : <span style={{ color: "var(--muted)" }}>—</span>}</td>
                {!ro && <td style={td}>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button className="btn btn-sm" title="AI: find cheapest" onClick={() => setAi(mt)}>✨</button>
                    <button className="btn btn-sm" style={{ color: "var(--rust)" }} onClick={() => store.removeMaterial(mt.id)}>✕</button>
                  </div>
                </td>}
              </tr>
              {open && <tr><td colSpan={colSpan} style={{ padding: 0, background: "var(--cream)", borderBottom: "1px solid var(--line)" }}><MaterialDetail mt={mt} ro={ro} /></td></tr>}
              </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {!ro && <AddMaterial />}
      </>}

      {ai && <AiModal mat={ai} onClose={() => setAi(null)} />}
    </>
  );
}

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label style={{ fontSize: 11.5, color: "var(--muted)", display: "inline-flex", alignItems: "center", gap: 6 }}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    </label>
  );
}

function MaterialDetail({ mt, ro }: { mt: Material; ro: boolean }) {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const name = store.session.displayName;
  const canApprove = role === "viewer" || role === "full_admin" || role === "owner"; // designer/admin
  const linked = db.schedule.find((s) => s.id === mt.linkedScheduleId);
  const { over, dropProps } = useFileDrop(async (files) => { store.updateMaterial(mt.id, { imageUrl: await fileToDataURL(files[0]) }); }, { accept: (f) => f.type.startsWith("image/"), disabled: ro });
  return (
    <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 16, padding: 16 }} className="ever-two">
      {/* image / preview */}
      <div>
        <div {...dropProps} style={{ position: "relative", borderRadius: 8, outline: over ? "2px dashed var(--sage)" : "none" }}>
          {over && <div style={{ position: "absolute", inset: 0, zIndex: 2, background: "var(--sage-tint)", opacity: 0.9, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "var(--walnut)", pointerEvents: "none" }}>⬆ Drop image</div>}
          {mt.imageUrl ? <img src={mt.imageUrl} alt={mt.item} style={{ width: "100%", borderRadius: 8, border: "1px solid var(--line)", display: "block" }} />
            : <div style={{ width: "100%", height: 130, borderRadius: 8, border: "1px dashed var(--line)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 12, textAlign: "center", padding: 8 }}>{ro ? "No image yet." : "No image — drop one here, or add a spec URL and fetch."}</div>}
        </div>
        {!ro && mt.specLink && <button className="btn btn-sm" style={{ marginTop: 6, width: "100%" }} onClick={() => store.fetchMaterialFromUrl(mt.id)}>✨ Fetch image &amp; specs</button>}
      </div>
      {/* details */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 11, color: "var(--muted)", flex: 1, minWidth: 200 }}>Product URL
            <input value={mt.specLink ?? ""} disabled={ro} placeholder="https://…" onChange={(e) => store.updateMaterial(mt.id, { specLink: e.target.value })} style={{ width: "100%", fontSize: 12 }} />
          </label>
          {mt.specLink && <a href={mt.specLink} target="_blank" rel="noreferrer" className="btn btn-sm" style={{ alignSelf: "flex-end" }}>Open ↗</a>}
        </div>
        {mt.specs && <div style={{ fontSize: 12, color: "var(--muted)", background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 8, padding: 8 }}>{mt.specs}</div>}
        {mt.notes && <div style={{ fontSize: 12, color: "var(--brass-2)" }}>Note: {mt.notes}</div>}

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", fontSize: 12 }}>
          <span style={{ color: "var(--muted)" }}>Auto-shared with: <strong style={{ color: "var(--ink)" }}>{mt.tradeId ? tradeName(db, mt.tradeId) : "all trades"}</strong></span>
          {!ro && <label style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><input type="checkbox" checked={!!mt.critical} onChange={() => store.toggleMaterialCritical(mt.id)} /> Critical-path item</label>}
          {!ro && (
            <label style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--muted)" }}>Tie to task
              <select value={mt.linkedScheduleId ?? ""} onChange={(e) => store.updateMaterial(mt.id, { linkedScheduleId: e.target.value || undefined })} style={{ fontSize: 11 }}>
                <option value="">—</option>
                {db.schedule.filter((s) => !mt.tradeId || s.tradeId === mt.tradeId || s.kind !== "work").map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
          )}
          {linked && <span style={{ color: "var(--sage-2)" }}>⛓ gates “{linked.label}” ({fmtDate(linked.start)})</span>}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", borderTop: "1px solid var(--line)", paddingTop: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>Designer approval:</span>
          {mt.designerApproved ? <Pill color="#fff" bg="var(--ok)">✓ Approved</Pill> : mt.approvalRequested ? <Pill color="var(--brass-2)" bg="#f0e6cd">requested</Pill> : <Pill color="var(--muted)">not requested</Pill>}
          {canApprove && (mt.designerApproved
            ? <button className="btn btn-sm" onClick={() => store.setMaterialApproved(mt.id, false, name)}>Revoke</button>
            : <button className="btn btn-sm btn-primary" onClick={() => store.setMaterialApproved(mt.id, true, name)}>✓ Approve (designer)</button>)}
          {!mt.designerApproved && !canApprove && <button className="btn btn-sm" onClick={() => store.requestMaterialApproval(mt.id, name)}>Request approval</button>}
          <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => store.requestMaterialDetails(mt.id, name)}>❓ Request details</button>
        </div>
      </div>
    </div>
  );
}

function fmtDate(d: string) { return new Date(`${d}T00:00:00`).toLocaleString("en-US", { month: "short", day: "numeric" }); }

function AddMaterial({ defaultRoomId }: { defaultRoomId?: string }) {
  const store = useStore();
  const db = store.db;
  const [category, setCategory] = useState<string>(CATALOG_CATEGORIES[0] ?? "");
  const [pick, setPick] = useState<string>("");
  const [custom, setCustom] = useState("");
  const [roomId, setRoomId] = useState(defaultRoomId ?? "");
  const opts = optionsForCategory(category);
  const isNew = pick === "__new__";
  const item = isNew ? custom.trim() : pick;

  const add = () => {
    if (!item) return;
    store.addMaterial({
      item,
      category: category || undefined,
      tradeId: tradeForCategory(category),
      roomId: roomId || undefined,
      roomLabel: roomId ? db.rooms.find((r) => r.id === roomId)?.name : undefined,
      status: "needed",
      purchaser: "owner",
    });
    setPick(""); setCustom("");
  };

  return (
    <div className="card" style={{ padding: 12, marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <strong style={{ fontSize: 13 }}>Add material</strong>
      <select value={category} onChange={(e) => { setCategory(e.target.value); setPick(""); }}>
        {CATALOG_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        <option value="">Other / uncategorized</option>
      </select>
      <select value={pick} onChange={(e) => setPick(e.target.value)} style={{ minWidth: 180 }}>
        <option value="" disabled>Choose item…</option>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        <option value="__new__">＋ New custom…</option>
      </select>
      {isNew && <input autoFocus placeholder="Custom material name…" value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} style={{ minWidth: 160 }} />}
      <select value={roomId} onChange={(e) => setRoomId(e.target.value)}><option value="">No room</option>{db.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
      <button className="btn btn-primary" disabled={!item} onClick={add}>+ Add{roomId ? ` to ${db.rooms.find((r) => r.id === roomId)?.name ?? "room"}` : ""}</button>
    </div>
  );
}

function AiModal({ mat, onClose }: { mat: Material; onClose: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(44,36,28,.45)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div className="card" style={{ maxWidth: 520, width: "100%", padding: 22 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ color: "var(--brass)" }}>✨</span><h3 className="serif" style={{ fontSize: 18, fontWeight: 700, color: "var(--walnut)" }}>AI sourcing — {mat.item}</h3></div>
        <div style={{ marginTop: 8, padding: "8px 10px", background: "#f0e6cd", borderRadius: 8, fontSize: 12, color: "var(--brass-2)" }}>Placeholder — wired but not yet connected to a live model.</div>
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
          {[{ v: "Build.com", p: "$182", note: "free ship" }, { v: "Ferguson", p: "$199", note: "matches spec" }, { v: "Wayfair", p: "$205", note: "−10% code" }].map((r) => (
            <div key={r.v} style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 }}><span><strong>{r.v}</strong> <span style={{ color: "var(--muted)" }}>· {r.note}</span></span><strong>{r.p}</strong></div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 12 }}>Will also surface local &amp; federal rebates / tax incentives (e.g. heat-pump water heater, efficient windows) for qualifying products.</div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}><button className="btn btn-primary" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: "8px 10px", borderBottom: "2px solid var(--line)", position: "sticky", top: 0, background: "var(--paper)", fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em", zIndex: 1 };
const thC: React.CSSProperties = { ...th, textAlign: "center" };
const td: React.CSSProperties = { padding: "6px 10px", borderBottom: "1px solid var(--line)", verticalAlign: "top" };
const tdC: React.CSSProperties = { ...td, textAlign: "center" };

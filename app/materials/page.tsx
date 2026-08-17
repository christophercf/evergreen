"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/data/hooks";
import { PageHeader, NoAccess, StatCard, Pill, NumInput, TextInput } from "../ui/bits";
import { accessFor, isArchitectUser, materialLockedCost, MATERIAL_STATUS_LABEL, type Material, type MaterialStatus, type ProductOption, type Purchaser } from "@/lib/data/types";
import { tradeName, MACRO_ORDER, materialDates } from "@/lib/data/money";
import { CATALOG_CATEGORIES } from "@/lib/data/materialCatalog";
import { fileToDataURL } from "../ui/upload";
import { useFileDrop } from "../ui/use-drop";
import { MsgButton } from "../ui/messenger";

const STATUS_BG: Record<MaterialStatus, string> = { needed: "var(--sc-unset)", identified: "#6b8fb5", ordered: "var(--brass)", purchased: "var(--sage)", delivered: "var(--ok)" };

// Product-link preview images, fetched once per URL via /api/link-preview
// (og:image scrape) and cached for the session. null = looked up, none found.
const previewCache = new Map<string, string | null>();

// True only for fetchable http(s) URLs — spreadsheet imports left free-text
// descriptions in some link fields.
function isHttpUrl(s?: string): boolean {
  if (!s) return false;
  try { return /^https?:$/.test(new URL(s).protocol); } catch { return false; }
}

function useLinkPreview(url?: string): string | null {
  const [img, setImg] = useState<string | null>(url ? (previewCache.get(url) ?? null) : null);
  useEffect(() => {
    if (!url || !isHttpUrl(url)) { setImg(null); return; }
    if (previewCache.has(url)) { setImg(previewCache.get(url) ?? null); return; }
    let dead = false;
    (async () => {
      try {
        const r = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`);
        const j = await r.json();
        const v: string | null = j.ok && j.image ? j.image : null;
        previewCache.set(url, v);
        if (!dead) setImg(v);
      } catch { previewCache.set(url, null); if (!dead) setImg(null); }
    })();
    return () => { dead = true; };
  }, [url]);
  return img;
}

// Spec column: thumbnail of the linked product (when the page exposes one) + link.
// Many big retailers bot-block scraping, so fall back to the store's favicon.
function SpecCell({ url }: { url?: string }) {
  const og = useLinkPreview(url);
  const [ogBroken, setOgBroken] = useState(false);
  const [favBroken, setFavBroken] = useState(false);
  if (!url) return <span style={{ color: "var(--muted)" }}>—</span>;
  // Free-text spec (not a link) — show it as a note instead of a broken link.
  if (!isHttpUrl(url)) return <span title={url} style={{ color: "var(--muted)", fontSize: 11.5, display: "inline-block", maxWidth: 110, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{url}</span>;
  let host = "";
  try { host = new URL(url).hostname; } catch { /* ignore */ }
  const fav = host && !favBroken ? `https://www.google.com/s2/favicons?domain=${host}&sz=64` : null;
  const src = og && !ogBroken ? og : fav;
  return (
    <a href={url} target="_blank" rel="noreferrer" title={host} style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--sage-2)", fontWeight: 600 }}>
      {src && (
        <img src={src} alt="" onError={() => (og && !ogBroken ? setOgBroken(true) : setFavBroken(true))}
          style={{ width: 34, height: 34, objectFit: og && !ogBroken ? "cover" : "contain", borderRadius: 6, border: "1px solid var(--line)", background: "#fff", flexShrink: 0, padding: og && !ogBroken ? 0 : 5 }} />
      )}
      link ↗
    </a>
  );
}
const STATUS_ORDER = Object.keys(MATERIAL_STATUS_LABEL) as MaterialStatus[];
const PURCH: Purchaser[] = ["owner", "trade", "builder"];

type SortKey = "item" | "room" | "trade" | "qty" | "status" | "buyer" | "budget" | "due" | "tied" | "spec";
type SortDir = "asc" | "desc";

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
  const [dir, setDir] = useState<SortDir>("asc");
  const clickSort = (k: SortKey) => { if (sort === k) setDir((d) => (d === "asc" ? "desc" : "asc")); else { setSort(k); setDir("asc"); } };
  const sortTh = (k: SortKey, label: React.ReactNode, center?: boolean, title?: string, cls?: string, extra?: React.CSSProperties) => (
    <th key={k} className={cls} onClick={() => clickSort(k)} title={`Sort by ${title ?? (typeof label === "string" ? label : k)}`}
      style={{ ...(center ? thC : th), cursor: "pointer", userSelect: "none", whiteSpace: "nowrap", ...extra }}>
      {label}<span style={{ marginLeft: 4, fontSize: 9, color: sort === k ? "var(--sage-2)" : "var(--line)" }}>{sort === k ? (dir === "asc" ? "▲" : "▼") : "↕"}</span>
    </th>
  );
  const [showFilters, setShowFilters] = useState(false);
  // Excel-style tied-task cells: click selects, double-click edits, Ctrl+C/Ctrl+V
  // copies and pastes across rows. tieClip holds the copied value ({v: undefined} = blank).
  const [tieClip, setTieClip] = useState<{ v?: string } | null>(null);
  const [tieSelCell, setTieSelCell] = useState<string | null>(null);
  const [tieEditCell, setTieEditCell] = useState<string | null>(null);
  const [ai, setAi] = useState<Material | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return; // don't hijack text editing
      if (e.key === "Escape") { setTieSelCell(null); setTieEditCell(null); return; }
      if (!tieSelCell || !(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "c") {
        const m = store.db.materials.find((x) => x.id === tieSelCell);
        if (m) { setTieClip({ v: m.linkedScheduleId }); e.preventDefault(); }
      } else if (k === "v") {
        if (access === "edit" && tieClip) { store.bulkSetMaterialTie([tieSelCell], tieClip.v); e.preventDefault(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tieSelCell, tieClip, access]);
  const [openId, setOpenId] = useState<string | null>(null);

  // Deep link from a Messenger context chip: /materials?item=<id>.
  //
  // Opening the row isn't enough on its own. Whatever filter, search or trade
  // view was last left on can exclude the item entirely, so the click reads as
  // "nothing happened" — the row is open in state and absent from the page. So
  // clear the filters first, then scroll it into view and mark it briefly.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("item");
    if (!id || !store.db.materials.some((m) => m.id === id)) return;
    setQ(""); setRoom("all"); setTrade("all"); setCat("all"); setStatus("all");
    setOpenId(id);
    // After the row has rendered under the cleared filters.
    const t = setTimeout(() => {
      const row = document.getElementById(`row-${id}`);
      if (!row) return;
      // Jump rather than glide: you asked to be taken to one specific item, and a
      // smooth scroll over sixty rows is both slow and easy to interrupt.
      row.scrollIntoView({ block: "center" });
      row.animate?.(
        [{ background: "var(--brass)" }, { background: "var(--sage-tint)" }],
        { duration: 1400, easing: "ease-out" },
      );
    }, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (access === "none") return <NoAccess module="Materials" />;
  const ro = access !== "edit";
  // Budgets, locked costs & product alternates are owner/designer/builder territory — not shown to trades.
  const showMoney = role !== "trade";

  const roomLabel = (mt: Material) => mt.roomId ? (db.rooms.find((r) => r.id === mt.roomId)?.name ?? mt.roomLabel ?? "—") : (mt.roomLabel ?? "—");
  // All timing items, chronological — options for the Tied-task column.
  const schedSorted = useMemo(() => [...db.schedule].sort((a, b) => a.start.localeCompare(b.start)), [db.schedule]);
  const schedLabel = (id?: string) => { const s = db.schedule.find((x) => x.id === id); return s ? s.label : "—"; };

  // Trades only see items essential to their job (auto-flagged by trade) —
  // except the architect, who reviews the full materials list.
  const myTradeIds = role === "trade" && !isArchitectUser(user) ? new Set(user?.tradeIds ?? []) : null;
  const filtered = useMemo(() => {
    // Free-text search across everything a person might remember about an item.
    const needle = q.trim().toLowerCase();
    const matchesQ = (mt: Material) => !needle ||
      [mt.item, mt.desc, roomLabel(mt), mt.tradeId ? tradeName(db, mt.tradeId) : "", mt.category, mt.notes, mt.specs, mt.status, ...(mt.options?.map((o) => o.label) ?? [])]
        .some((s) => s && s.toLowerCase().includes(needle));
    const list = db.materials.filter((mt) =>
      matchesQ(mt) &&
      (!myTradeIds || (mt.tradeId ? myTradeIds.has(mt.tradeId) : false)) &&
      (room === "all" || mt.roomId === room || mt.roomLabel === room) &&
      (trade === "all" || mt.tradeId === trade) &&
      (cat === "all" || mt.category === cat) &&
      (status === "all" || mt.status === status));
    const rank = (mt: Material): string | number => {
      switch (sort) {
        case "item": return mt.item.toLowerCase();
        case "room": return roomLabel(mt).toLowerCase();
        case "trade": return mt.tradeId ? tradeName(db, mt.tradeId).toLowerCase() : "~~~";
        case "qty": return mt.qty ?? -Infinity;
        case "status": return STATUS_ORDER.indexOf(mt.status);
        case "buyer": return mt.purchaser;
        case "budget": return materialLockedCost(mt) ?? mt.budget ?? -Infinity;
        case "tied": return mt.linkedScheduleId ? schedLabel(mt.linkedScheduleId).toLowerCase() : "~~~";
        case "spec": return mt.specLink ? 0 : 1;
        case "due": default: return materialDates(db, mt).identifyBy ?? "~9999";
      }
    };
    return [...list].sort((a, b) => {
      const va = rank(a), vb = rank(b);
      const r = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      if (r !== 0) return dir === "asc" ? r : -r;
      return a.item.localeCompare(b.item); // stable tiebreak
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.materials, q, room, trade, cat, status, sort, dir]);
  const catsUsed = Array.from(new Set([...CATALOG_CATEGORIES, ...db.materials.map((m) => m.category).filter(Boolean) as string[]]));

  const counts = { total: db.materials.length, needed: db.materials.filter((m) => m.status === "needed").length, purchased: db.materials.filter((m) => m.status === "purchased" || m.status === "delivered").length, owner: db.materials.filter((m) => m.purchaser === "owner").length };
  const budgetTotal = db.materials.reduce((a, m) => a + (m.budget ?? 0), 0);
  const lockedMats = db.materials.map((m) => materialLockedCost(m)).filter((v): v is number => v != null);
  const lockedTotal = lockedMats.reduce((a, v) => a + v, 0);
  const tradesUsed = Array.from(new Set(db.materials.map((m) => m.tradeId).filter(Boolean) as string[]));
  const roomsUsed = Array.from(new Set(db.materials.map((m) => m.roomId).filter(Boolean) as string[]));

  return (
    <>
      <PageHeader title="Materials" subtitle="Every material — sortable by any column — with schedule-driven due dates, spec links, who buys it, quantities, and where it's stored. Every item is critical by the time it's needed." />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))", gap: 12, marginTop: 16 }}>
        <StatCard label="Materials" value={`${counts.total}`} />
        <StatCard label="Still Needed" value={`${counts.needed}`} accent="var(--rust)" />
        <StatCard label="Purchased / Delivered" value={`${counts.purchased}`} accent="var(--ok)" />
        <StatCard label="Owner-Supplied" value={`${counts.owner}`} sub="vs trade/builder" />
        {showMoney && <StatCard label="Materials Budget" value={`$${budgetTotal.toLocaleString()}`} sub="planning total across items" />}
        {showMoney && <StatCard label="Locked Cost" value={`$${lockedTotal.toLocaleString()}`} accent="var(--brass-2)" sub={`${lockedMats.length} item${lockedMats.length === 1 ? "" : "s"} with approved product`} />}
      </div>

      {/* search — always visible, filters everything live */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Search materials — name, room, trade, notes…"
          style={{ flex: 1, maxWidth: 420, fontSize: 13, padding: "7px 12px", borderRadius: 99 }} />
        {q && <button className="btn btn-sm" onClick={() => setQ("")}>✕ Clear</button>}
        {q && <span style={{ fontSize: 12, color: "var(--muted)" }}>{filtered.length} match{filtered.length === 1 ? "" : "es"}</span>}
      </div>

      {/* filters — collapsed behind a toggle on phones */}
      <button className="btn btn-sm m-filters-toggle" style={{ marginTop: 10 }} onClick={() => setShowFilters((v) => !v)}>
        Filters {showFilters ? "▴" : "▾"} · {filtered.length} shown
      </button>
      <div className={`card m-filters${showFilters ? " open" : ""}`} style={{ padding: 12, marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <Filter label="Room" value={room} onChange={setRoom} options={[["all", "All rooms"], ...roomsUsed.map((r) => [r, db.rooms.find((x) => x.id === r)?.name ?? r] as [string, string])]} />
        <Filter label="Trade" value={trade} onChange={setTrade} options={[["all", "All trades"], ...tradesUsed.map((t) => [t, tradeName(db, t)] as [string, string])]} />
        <Filter label="Category" value={cat} onChange={setCat} options={[["all", "All categories"], ...catsUsed.map((c) => [c, c] as [string, string])]} />
        <Filter label="Status" value={status} onChange={(v) => setStatus(v as "all" | MaterialStatus)} options={[["all", "All status"], ...(Object.keys(MATERIAL_STATUS_LABEL) as MaterialStatus[]).map((s) => [s, MATERIAL_STATUS_LABEL[s]] as [string, string])]} />
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>· click a column header to sort</span>
        {tieClip && (
          <span style={{ fontSize: 11.5, color: "var(--sage-2)", display: "inline-flex", alignItems: "center", gap: 5 }}>
            ⛓ copied: <strong>{tieClip.v ? schedLabel(tieClip.v) : "(blank)"}</strong> — click a Tied-task cell, Ctrl+V to paste
            <button className="btn btn-sm" onClick={() => setTieClip(null)} style={{ padding: "0 5px" }}>✕</button>
          </span>
        )}
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>{filtered.length} shown</span>
      </div>

      <div className="card" style={{ overflow: "auto", maxHeight: "64vh", marginTop: 12, padding: 0 }}>
        <table style={{ fontSize: 12.5 }}>
          <thead>
            <tr>
              {sortTh("item", "Item", false, undefined, undefined, { left: 0, zIndex: 3 })}
              {sortTh("room", "Room", false, undefined, "m-hide")}
              {sortTh("trade", "Trade", false, undefined, "m-hide")}
              {sortTh("qty", "Qty", true, undefined, "m-hide")}
              {sortTh("status", "Status")}
              {sortTh("buyer", "Buyer", false, undefined, "m-hide")}
              {showMoney && sortTh("budget", "Budget", false, "Budget / locked cost", "m-hide")}
              {sortTh("due", "Due")}
              {sortTh("tied", "Tied task", false, undefined, "m-hide")}
              {sortTh("spec", "Spec", false, undefined, "m-hide")}
              {!ro && <th style={th} className="m-hide"></th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((mt) => {
              const open = openId === mt.id;
              const colSpan = 10 + (showMoney ? 1 : 0) + (ro ? 0 : 1);
              const locked = materialLockedCost(mt);
              return (
              <Fragment key={mt.id}>
              <tr id={`row-${mt.id}`} style={{ background: open ? "var(--sage-tint)" : undefined }}>
                {/* Item stays pinned while the table scrolls sideways. */}
                <td style={{ ...td, position: "sticky", left: 0, zIndex: 1, background: open ? "var(--sage-tint)" : "var(--paper)", minWidth: 150, maxWidth: 230, boxShadow: "2px 0 4px -2px rgba(44,36,28,.15)" }}>
                  <button onClick={() => setOpenId(open ? null : mt.id)} style={{ border: "none", background: "transparent", textAlign: "left", cursor: "pointer", padding: 0, maxWidth: "100%" }}>
                    <div style={{ fontWeight: 600 }}>{mt.item} <span style={{ color: "var(--muted)", fontSize: 11 }}>{open ? "▾" : "▸"}</span></div>
                    {mt.desc && <div style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mt.desc}</div>}
                  </button>
                </td>
                <td style={td} className="m-hide">
                  <select value={mt.roomId ?? ""} disabled={ro} onChange={(e) => store.updateMaterial(mt.id, { roomId: e.target.value || undefined, roomLabel: e.target.value ? db.rooms.find((r) => r.id === e.target.value)?.name : mt.roomLabel })} style={{ fontSize: 11.5, maxWidth: 130 }}>
                    <option value="">{mt.roomLabel ? `(${mt.roomLabel})` : "No room"}</option>
                    {db.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </td>
                <td style={td} className="m-hide">{mt.tradeId ? tradeName(db, mt.tradeId) : "—"}</td>
                <td style={tdC} className="m-hide"><NumInput value={mt.qty ?? 0} disabled={ro} onCommit={(v) => store.updateMaterial(mt.id, { qty: v > 0 ? v : undefined })} width={40} align="center" style={{ fontSize: 12 }} /></td>
                <td style={td}>
                  <select value={mt.status} disabled={ro} onChange={(e) => store.updateMaterial(mt.id, { status: e.target.value as MaterialStatus })} style={{ fontSize: 11, padding: "2px 4px", color: "#fff", background: STATUS_BG[mt.status], border: "none", borderRadius: 5 }}>
                    {(Object.keys(MATERIAL_STATUS_LABEL) as MaterialStatus[]).map((s) => <option key={s} value={s} style={{ color: "var(--ink)", background: "var(--paper)" }}>{MATERIAL_STATUS_LABEL[s]}</option>)}
                  </select>
                </td>
                <td style={td} className="m-hide">
                  <select value={mt.purchaser} disabled={ro} onChange={(e) => store.updateMaterial(mt.id, { purchaser: e.target.value as Purchaser })} style={{ fontSize: 11, padding: "2px 4px" }}>
                    {PURCH.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </td>
                {showMoney && <td style={td} className="m-hide">
                  {locked != null
                    ? <span title="Cost locked from the approved product — revoke the approval to change it" style={{ fontSize: 12, fontWeight: 700, color: "var(--brass-2)", whiteSpace: "nowrap" }}>🔒 ${locked.toLocaleString()}</span>
                    : <NumInput value={mt.budget ?? 0} disabled={ro} onCommit={(v) => store.updateMaterial(mt.id, { budget: v > 0 ? v : undefined })} width={64} money style={{ fontSize: 12 }} />}
                </td>}
                <td style={td}><DueCell mt={mt} ro={ro} /></td>
                <td style={td} className="m-hide">
                  {tieEditCell === mt.id && !ro ? (
                    <select autoFocus value={mt.linkedScheduleId ?? ""}
                      onChange={(e) => { store.updateMaterial(mt.id, { linkedScheduleId: e.target.value || undefined }); setTieEditCell(null); }}
                      onBlur={() => setTieEditCell(null)}
                      onKeyDown={(e) => { if (e.key === "Escape") setTieEditCell(null); }}
                      style={{ fontSize: 11, maxWidth: 150, padding: "2px 4px" }}>
                      <option value="">—</option>
                      {schedSorted.map((s) => <option key={s.id} value={s.id}>{s.label}{s.tradeId ? ` — ${tradeName(db, s.tradeId)}` : ""}</option>)}
                    </select>
                  ) : (
                    <div
                      onClick={() => setTieSelCell(mt.id)}
                      onDoubleClick={() => { if (!ro) { setTieSelCell(mt.id); setTieEditCell(mt.id); } }}
                      title={`${mt.linkedScheduleId ? `Gates “${schedLabel(mt.linkedScheduleId)}” · ` : ""}click to select · double-click to edit · Ctrl+C / Ctrl+V`}
                      style={{
                        fontSize: 11, minHeight: 22, display: "flex", alignItems: "center", padding: "2px 6px", borderRadius: 5,
                        cursor: "cell", maxWidth: 160, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        border: tieSelCell === mt.id ? "2px solid var(--sage)" : "1px solid transparent",
                        background: tieSelCell === mt.id ? "var(--sage-tint)" : undefined,
                        color: mt.linkedScheduleId ? "var(--ink)" : "var(--muted)",
                      }}>
                      {mt.linkedScheduleId ? `⛓ ${schedLabel(mt.linkedScheduleId)}` : "—"}
                    </div>
                  )}
                </td>
                <td style={td} className="m-hide"><SpecCell url={mt.specLink} /></td>
                {!ro && <td style={td} className="m-hide">
                  <div style={{ display: "flex", gap: 4 }}>
                    <MsgButton kind="material" refId={mt.id} label={mt.item} href={`/materials?item=${mt.id}`} small />
                    <button className="btn btn-sm" title="AI: find cheapest" onClick={() => setAi(mt)}>✨</button>
                    <button className="btn btn-sm" style={{ color: "var(--rust)" }} onClick={() => store.removeMaterial(mt.id)}>✕</button>
                  </div>
                </td>}
              </tr>
              {open && <tr><td colSpan={colSpan} style={{ padding: 0, background: "var(--cream)", borderBottom: "1px solid var(--line)" }}><MaterialDetail mt={mt} ro={ro} onAi={() => setAi(mt)} /></td></tr>}
              </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {!ro && <AddMaterial />}

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

function MaterialDetail({ mt, ro, onAi }: { mt: Material; ro: boolean; onAi?: () => void }) {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const name = store.session.displayName;
  const canApproveDesigner = role === "viewer" || role === "full_admin"; // designer / admin
  const canApproveOwner = role === "owner" || role === "full_admin"; // owner / admin
  const canApproveAny = canApproveDesigner || canApproveOwner;
  const linked = db.schedule.find((s) => s.id === mt.linkedScheduleId);
  const { over, dropProps } = useFileDrop(async (files) => { store.updateMaterial(mt.id, { imageUrl: await fileToDataURL(files[0]) }); }, { accept: (f) => f.type.startsWith("image/"), disabled: ro });
  // Live preview scraped from the product link (used when no image is saved yet).
  const preview = useLinkPreview(mt.imageUrl ? undefined : mt.specLink);
  const [previewBroken, setPreviewBroken] = useState(false);
  const shownPreview = !mt.imageUrl && preview && !previewBroken ? preview : null;
  const imgFileRef = useRef<HTMLInputElement>(null);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 16, padding: 16 }} className="ever-two">
      {/* image / preview */}
      <div>
        <div {...dropProps} style={{ position: "relative", borderRadius: 8, outline: over ? "2px dashed var(--sage)" : "none" }}>
          {over && <div style={{ position: "absolute", inset: 0, zIndex: 2, background: "var(--sage-tint)", opacity: 0.9, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "var(--walnut)", pointerEvents: "none" }}>⬆ Drop image</div>}
          {mt.imageUrl ? <img src={mt.imageUrl} alt={mt.item} style={{ width: "100%", borderRadius: 8, border: "1px solid var(--line)", display: "block" }} />
            : shownPreview ? <img src={shownPreview} alt={mt.item} onError={() => setPreviewBroken(true)} style={{ width: "100%", borderRadius: 8, border: "1px solid var(--line)", display: "block" }} />
            : <div style={{ width: "100%", height: 130, borderRadius: 8, border: "1px dashed var(--line)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 12, textAlign: "center", padding: 8 }}>{ro ? "No image yet." : mt.specLink ? "This store blocks link previews — upload a photo or screenshot instead." : "No image — upload one, or add a product URL below."}</div>}
        </div>
        {shownPreview && <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 4, textAlign: "center" }}>preview from product link</div>}
        {!ro && shownPreview && <button className="btn btn-sm" style={{ marginTop: 6, width: "100%" }} onClick={() => store.updateMaterial(mt.id, { imageUrl: shownPreview })}>💾 Save image to item</button>}
        {!ro && (
          <>
            <input ref={imgFileRef} type="file" accept="image/*" style={{ display: "none" }}
              onChange={async (e) => { const f = e.target.files?.[0]; if (f) store.updateMaterial(mt.id, { imageUrl: await fileToDataURL(f) }); e.target.value = ""; }} />
            <button className="btn btn-sm" style={{ marginTop: 6, width: "100%" }} onClick={() => imgFileRef.current?.click()}>📷 {mt.imageUrl ? "Replace image" : "Upload image"}</button>
          </>
        )}
      </div>
      {/* details */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {/* item name & description — editable after creation */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label style={{ fontSize: 11, color: "var(--muted)", flex: 1, minWidth: 160 }}>Item name
            <TextInput value={mt.item} disabled={ro} onCommit={(v) => v.trim() && store.updateMaterial(mt.id, { item: v.trim() })} style={{ width: "100%", fontSize: 13, fontWeight: 600 }} />
          </label>
          <label style={{ fontSize: 11, color: "var(--muted)", flex: 2, minWidth: 200 }}>Description
            <TextInput value={mt.desc ?? ""} disabled={ro} placeholder="e.g. 3'x5' — Egress" onCommit={(v) => store.updateMaterial(mt.id, { desc: v.trim() || undefined })} style={{ width: "100%", fontSize: 12 }} />
          </label>
        </div>
        {/* mobile-only: fields hidden from the table's phone layout live here */}
        <div className="m-only" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end", borderBottom: "1px solid var(--line)", paddingBottom: 10 }}>
          <label style={{ fontSize: 11, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 3 }}>Room
            <select value={mt.roomId ?? ""} disabled={ro} onChange={(e) => store.updateMaterial(mt.id, { roomId: e.target.value || undefined, roomLabel: e.target.value ? db.rooms.find((r) => r.id === e.target.value)?.name : mt.roomLabel })} style={{ maxWidth: 160 }}>
              <option value="">{mt.roomLabel ? `(${mt.roomLabel})` : "No room"}</option>
              {db.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 11, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 3 }}>Qty
            <NumInput value={mt.qty ?? 0} disabled={ro} onCommit={(v) => store.updateMaterial(mt.id, { qty: v > 0 ? v : undefined })} width={56} align="center" />
          </label>
          <label style={{ fontSize: 11, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 3 }}>Buyer
            <select value={mt.purchaser} disabled={ro} onChange={(e) => store.updateMaterial(mt.id, { purchaser: e.target.value as Purchaser })}>
              {PURCH.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 11, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 3 }}>Tied task
            <select value={mt.linkedScheduleId ?? ""} disabled={ro} onChange={(e) => store.updateMaterial(mt.id, { linkedScheduleId: e.target.value || undefined })} style={{ maxWidth: 180 }}>
              <option value="">—</option>
              {[...db.schedule].sort((a, b) => a.start.localeCompare(b.start)).map((s) => (
                <option key={s.id} value={s.id}>{s.label}{s.tradeId ? ` — ${tradeName(db, s.tradeId)}` : ""}</option>
              ))}
            </select>
          </label>
          {!ro && onAi && <button className="btn btn-sm" onClick={onAi}>✨ Price</button>}
          {!ro && <button className="btn btn-sm" style={{ color: "var(--rust)" }} onClick={() => store.removeMaterial(mt.id)}>✕ Remove</button>}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 11, color: "var(--muted)", flex: 1, minWidth: 200 }}>Product URL
            <TextInput value={mt.specLink ?? ""} disabled={ro} placeholder="https://…" onCommit={(v) => store.updateMaterial(mt.id, { specLink: v })} style={{ width: "100%", fontSize: 12 }} />
          </label>
          {mt.specLink && <a href={mt.specLink} target="_blank" rel="noreferrer" className="btn btn-sm" style={{ alignSelf: "flex-end" }}>Open ↗</a>}
        </div>
        {mt.specs && <div style={{ fontSize: 12, color: "var(--muted)", background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 8, padding: 8 }}>{mt.specs}</div>}
        {mt.notes && <div style={{ fontSize: 12, color: "var(--brass-2)" }}>Note: {mt.notes}</div>}

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", fontSize: 12 }}>
          <span style={{ color: "var(--muted)" }}>Auto-shared with: <strong style={{ color: "var(--ink)" }}>{mt.tradeId ? tradeName(db, mt.tradeId) : "all trades"}</strong></span>
          {linked && <span style={{ color: "var(--sage-2)" }}>⛓ gates “{linked.label}” ({fmtDate(linked.start)})</span>}
        </div>

        <TimingBlock mt={mt} ro={ro} />

        {role !== "trade" && <ProductOptions mt={mt} ro={ro} />}

        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>Sign-offs:</span>
            <ApprovalRow label="Designer" approved={!!mt.designerApproved} requested={!!mt.approvalRequested} canApprove={canApproveDesigner}
              onApprove={() => store.setMaterialApproved(mt.id, true, name, "designer")} onRevoke={() => store.setMaterialApproved(mt.id, false, name, "designer")} />
            <ApprovalRow label="Owner" approved={!!mt.ownerApproved} requested={!!mt.approvalRequested} canApprove={canApproveOwner}
              onApprove={() => store.setMaterialApproved(mt.id, true, name, "owner")} onRevoke={() => store.setMaterialApproved(mt.id, false, name, "owner")} />
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {!canApproveAny && !(mt.designerApproved && mt.ownerApproved) && <button className="btn btn-sm" onClick={() => store.requestMaterialApproval(mt.id, name)}>Request approval</button>}
            <MsgButton kind="material" refId={mt.id} label={mt.item} href={`/materials?item=${mt.id}`} />
            <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => store.requestMaterialDetails(mt.id, name)}>❓ Request details</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function fmtDate(d: string) { return new Date(`${d}T00:00:00`).toLocaleString("en-US", { month: "short", day: "numeric" }); }

// ---------------------------------------------------------------------------
// Product alternates: owner/builder add 2-3 candidates; owner + designer
// compare and approve exactly one. Approval locks its price in as the item's
// cost ("the budget is solidified") and points the spec link at the winner.
// ---------------------------------------------------------------------------
function ProductOptions({ mt, ro }: { mt: Material; ro: boolean }) {
  const store = useStore();
  const role = store.session.role;
  const name = store.session.displayName;
  const canAdd = !ro && ["full_admin", "owner", "builder"].includes(role);
  const canApprove = ["full_admin", "owner", "viewer"].includes(role);
  const opts = mt.options ?? [];
  const locked = materialLockedCost(mt);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [price, setPrice] = useState("");

  const add = () => {
    if (!label.trim()) return;
    store.addMaterialOption(mt.id, { label, url, price: price ? Number(price.replace(/[^0-9.]/g, "")) : undefined }, name);
    setLabel(""); setUrl(""); setPrice(""); setAdding(false);
  };

  return (
    <div style={{ borderTop: "1px solid var(--line)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>Product options ({opts.length}/3):</span>
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>owner &amp; builder propose · owner &amp; designer approve ONE</span>
        <span style={{ marginLeft: "auto", fontSize: 11.5, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: "var(--muted)" }}>Budget</span>
          {locked != null
            ? <strong style={{ color: "var(--brass-2)" }}>🔒 ${locked.toLocaleString()} locked{mt.budget != null && <span style={{ fontWeight: 400, color: locked <= mt.budget ? "var(--ok)" : "var(--rust)" }}> · ${Math.abs(mt.budget - locked).toLocaleString()} {locked <= mt.budget ? "under" : "over"} budget</span>}</strong>
            : <NumInput value={mt.budget ?? 0} disabled={ro} onCommit={(v) => store.updateMaterial(mt.id, { budget: v > 0 ? v : undefined })} width={70} money style={{ fontSize: 12 }} />}
        </span>
      </div>

      {opts.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>No alternates yet{canAdd ? " — add 2-3 products to compare." : "."}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 8 }}>
        {opts.map((o) => <OptionCard key={o.id} mt={mt} o={o} canAdd={canAdd} canApprove={canApprove} />)}
      </div>

      {canAdd && !adding && opts.length < 3 && (
        <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setAdding(true)}>+ Additional Product Options for review</button>
      )}
      {canAdd && adding && (
        <div className="card" style={{ padding: 8, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end", background: "var(--paper)" }}>
          <label style={{ fontSize: 10.5, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 2 }}>Product / vendor
            <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Kohler Highline — Home Depot" style={{ fontSize: 12, minWidth: 190 }} onKeyDown={(e) => e.key === "Enter" && add()} />
          </label>
          <label style={{ fontSize: 10.5, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 2 }}>Link
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" style={{ fontSize: 12, minWidth: 170 }} />
          </label>
          <label style={{ fontSize: 10.5, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 2 }}>Price $
            <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="0" style={{ fontSize: 12, width: 76 }} onKeyDown={(e) => e.key === "Enter" && add()} />
          </label>
          <button className="btn btn-sm btn-primary" disabled={!label.trim()} onClick={add}>Add</button>
          <button className="btn btn-sm" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

function OptionCard({ mt, o, canAdd, canApprove }: { mt: Material; o: ProductOption; canAdd: boolean; canApprove: boolean }) {
  const store = useStore();
  const name = store.session.displayName;
  const img = useLinkPreview(o.url);
  const [broken, setBroken] = useState(false);
  const isWinner = mt.approvedOptionId === o.id;
  const anotherApproved = !!mt.approvedOptionId && !isWinner;
  const fmtTs = (s?: string) => (s ? new Date(s).toLocaleString("en-US", { month: "short", day: "numeric" }) : "");
  return (
    <div style={{ border: isWinner ? "2px solid var(--ok)" : "1px solid var(--line)", borderRadius: 8, padding: 8, display: "flex", flexDirection: "column", gap: 5, opacity: anotherApproved ? 0.55 : 1, background: isWinner ? "var(--sage-tint)" : undefined }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        {img && !broken && <img src={img} alt="" onError={() => setBroken(true)} style={{ width: 46, height: 46, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)", background: "#fff", flexShrink: 0 }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.25 }}>{o.label} {isWinner && <Pill color="#fff" bg="var(--ok)">✓ approved</Pill>}</div>
          <div style={{ fontSize: 11, color: "var(--muted)", display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
            {o.url && <a href={o.url} target="_blank" rel="noreferrer" style={{ color: "var(--sage-2)", fontWeight: 600 }}>open ↗</a>}
            {o.addedBy && <span>by {o.addedBy}</span>}
            {isWinner && o.approvedBy && <span style={{ color: "var(--ok)" }}>✓ {o.approvedBy} · {fmtTs(o.approvedAt)}</span>}
          </div>
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
          {isWinner
            ? <span style={{ color: "var(--brass-2)" }}>🔒 {o.price != null ? `$${o.price.toLocaleString()}` : "—"}</span>
            : canAdd
              ? <NumInput value={o.price ?? 0} onCommit={(v) => store.updateMaterialOption(mt.id, o.id, { price: v > 0 ? v : undefined })} width={62} money style={{ fontSize: 12 }} />
              : (o.price != null ? `$${o.price.toLocaleString()}` : "—")}
        </span>
      </div>
      {o.note && <div style={{ fontSize: 11, color: "var(--muted)" }}>{o.note}</div>}
      <div style={{ display: "flex", gap: 6 }}>
        {canApprove && (
          isWinner
            ? <button className="btn btn-sm" onClick={() => store.approveMaterialOption(mt.id, o.id, name)}>Revoke approval</button>
            : <button className="btn btn-sm btn-primary" onClick={() => store.approveMaterialOption(mt.id, o.id, name)} title={anotherApproved ? "Approving this moves the approval here (only one product per item)" : "Approve this product — locks its price as the item's cost"}>✓ Approve</button>
        )}
        <MsgButton kind="material" refId={mt.id} label={`${mt.item} — ${o.label}`} href={`/materials?item=${mt.id}`} small />
        {canAdd && !isWinner && <button className="btn btn-sm" style={{ color: "var(--rust)", marginLeft: "auto" }} onClick={() => store.removeMaterialOption(mt.id, o.id)}>✕</button>}
      </div>
    </div>
  );
}

// One approver's sign-off (Designer or Owner) with an Approve/Revoke control.
function ApprovalRow({ label, approved, requested, canApprove, onApprove, onRevoke }: { label: string; approved: boolean; requested: boolean; canApprove: boolean; onApprove: () => void; onRevoke: () => void }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "1px solid var(--line)", borderRadius: 8, padding: "3px 7px" }}>
      <span style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 700 }}>{label}</span>
      {approved ? <Pill color="#fff" bg="var(--ok)">✓ Approved</Pill> : requested ? <Pill color="var(--brass-2)" bg="#f0e6cd">requested</Pill> : <Pill color="var(--muted)">—</Pill>}
      {canApprove && (approved
        ? <button className="btn btn-sm" onClick={onRevoke}>Revoke</button>
        : <button className="btn btn-sm btn-primary" onClick={onApprove}>✓ Approve</button>)}
    </span>
  );
}


// The Due column: a single hard date, or the two trade-derived critical-path dates.
function DueCell({ mt, ro }: { mt: Material; ro: boolean }) {
  const store = useStore();
  const db = store.db;
  if (mt.dueMode === "trade") {
    const d = materialDates(db, mt);
    const tName = mt.tradeId ? tradeName(db, mt.tradeId) : "trade";
    const lastWk = d.needBy === "finish";
    return (
      <div className="m-due" style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 11, minWidth: 104 }}>
        <span title={`Identify / spec before ${tName} starts`} style={{ color: "var(--brass-2)" }}>🔍 {d.identifyBy ? fmtDate(d.identifyBy) : "—"}</span>
        <span title={`On hand ${lastWk ? `by ${tName}'s last week` : `before ${tName} starts`}`} style={{ color: "var(--sage-2)" }}>
          📦 {d.onHandBy ? fmtDate(d.onHandBy) : "—"}{lastWk && <span style={{ color: "var(--brass-2)", fontWeight: 700 }}> · last wk</span>}
        </span>
      </div>
    );
  }
  return <input type="date" value={mt.dueDate ?? ""} disabled={ro} onChange={(e) => store.updateMaterial(mt.id, { dueDate: e.target.value })} style={{ fontSize: 11, width: 118 }} />;
}

// Detail-panel control: choose a hard date or tie the material's timing to a trade's Gantt.
function TimingBlock({ mt, ro }: { mt: Material; ro: boolean }) {
  const store = useStore();
  const db = store.db;
  const mode = mt.dueMode === "trade" ? "trade" : "hard";
  const d = materialDates(db, mt);
  const tName = mt.tradeId ? tradeName(db, mt.tradeId) : null;
  return (
    <div style={{ borderTop: "1px solid var(--line)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>Critical-path timing:</span>
        <label style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 }}>
          <input type="radio" name={`due-${mt.id}`} checked={mode === "hard"} disabled={ro} onChange={() => store.updateMaterial(mt.id, { dueMode: "hard" })} /> Hard date
        </label>
        <label style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 }}>
          <input type="radio" name={`due-${mt.id}`} checked={mode === "trade"} disabled={ro} onChange={() => store.updateMaterial(mt.id, { dueMode: "trade" })} /> Tie to trade schedule
        </label>
      </div>
      {mode === "hard" ? (
        <label style={{ fontSize: 11, color: "var(--muted)", display: "inline-flex", alignItems: "center", gap: 8 }}>On-hand / selection due
          <input type="date" value={mt.dueDate ?? ""} disabled={ro} onChange={(e) => store.updateMaterial(mt.id, { dueDate: e.target.value })} style={{ fontSize: 12 }} />
        </label>
      ) : (
        <>
          <label style={{ fontSize: 11, color: "var(--muted)", display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>Driven by trade
            <select value={mt.tradeId ?? ""} disabled={ro} onChange={(e) => store.updateMaterial(mt.id, { tradeId: e.target.value || undefined })} style={{ fontSize: 12 }}>
              <option value="">— pick trade —</option>
              {MACRO_ORDER.map((c) => <optgroup key={c} label={c}>{db.trades.filter((t) => t.category === c).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>)}
            </select>
          </label>
          {!mt.tradeId ? (
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Pick the trade whose Gantt sets these dates.</span>
          ) : (d.identifyBy || d.onHandBy) ? (
            <>
              <label style={{ fontSize: 11, color: "var(--muted)", display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>Needed on-hand
                <select value={mt.needBy ?? "start"} disabled={ro} onChange={(e) => store.updateMaterial(mt.id, { needBy: e.target.value as "start" | "finish" })} style={{ fontSize: 12 }}>
                  <option value="start">Before {tName} starts</option>
                  <option value="finish">By {tName}’s last week (finishing)</option>
                </select>
              </label>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12 }}>
                <span style={{ color: "var(--brass-2)" }}>🔍 Identify by <strong>{d.identifyBy ? fmtDate(d.identifyBy) : "—"}</strong> <span style={{ color: "var(--muted)" }}>· before {tName} starts</span></span>
                <span style={{ color: "var(--sage-2)" }}>📦 On-hand by <strong>{d.onHandBy ? fmtDate(d.onHandBy) : "—"}</strong> <span style={{ color: "var(--muted)" }}>· {d.needBy === "finish" ? `${tName}’s last week` : `before ${tName} starts`}</span></span>
              </div>
            </>
          ) : (
            <span style={{ fontSize: 11.5, color: "var(--rust)" }}>No Gantt bars for {tName} yet — add it to the schedule (Timing tab) to drive these dates.</span>
          )}
          <span style={{ fontSize: 11, color: "var(--muted)" }}>Identify-by is always the trade’s start; on-hand follows your choice above. Both shift automatically if the builder moves {tName ?? "the trade"}.</span>
        </>
      )}
    </div>
  );
}

function AddMaterial({ defaultRoomId }: { defaultRoomId?: string }) {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const user = store.currentUser;
  // Trades can only add materials for their own trade(s); the designer (viewer)
  // and owner/builder/admin can add & assign for any trade.
  const ownTrades = role === "trade" ? (user?.tradeIds ?? []) : null;
  const tradeChoices = ownTrades ? db.trades.filter((t) => ownTrades.includes(t.id)) : null;
  const [item, setItem] = useState("");
  const [roomId, setRoomId] = useState(defaultRoomId ?? "");
  const [tradeId, setTradeId] = useState(ownTrades?.length === 1 ? ownTrades[0] : "");
  const [qty, setQty] = useState("1");
  const [dep, setDep] = useState("");
  const [needBy, setNeedBy] = useState<"start" | "finish">("start");

  // Dependency can be ANY line item on the timing chart; the chosen trade's own
  // tasks are grouped first for convenience.
  const byStart = (a: (typeof db.schedule)[number], b: (typeof db.schedule)[number]) => a.start.localeCompare(b.start);
  const tradeTasks = tradeId ? db.schedule.filter((s) => s.tradeId === tradeId).sort(byStart) : [];
  const otherTasks = db.schedule.filter((s) => !tradeId || s.tradeId !== tradeId).sort(byStart);
  const needsDep = db.schedule.length > 0;
  const ready = !!item.trim() && !!roomId && !!tradeId && Number(qty) >= 1 && (!needsDep || !!dep);

  const add = () => {
    if (!ready) return;
    store.addMaterial({
      item: item.trim(),
      roomId,
      roomLabel: db.rooms.find((r) => r.id === roomId)?.name,
      tradeId,
      qty: Math.max(1, Math.round(Number(qty) || 1)),
      linkedScheduleId: dep || undefined,
      dueMode: "trade", // timing follows the assigned trade's Gantt
      needBy,
      status: "needed",
      purchaser: "owner",
    });
    // keep room, trade & on-hand choice so several items can be added in a row
    setItem(""); setQty("1"); setDep("");
  };

  const cell = (label: string, node: React.ReactNode) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)" }}>{label}</span>
      {node}
    </label>
  );

  return (
    <div className="card" style={{ padding: 12, marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
      <strong style={{ fontSize: 13, alignSelf: "center" }}>Add material</strong>
      {cell("Item", <input autoFocus placeholder="e.g. Kitchen faucet" value={item} onChange={(e) => setItem(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} style={{ minWidth: 180 }} />)}
      {cell("Room", (
        <select value={roomId} onChange={(e) => setRoomId(e.target.value)} style={{ borderColor: !roomId ? "var(--rust)" : undefined }}>
          <option value="">— room —</option>
          {db.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      ))}
      {cell("Trade", (
        <select value={tradeId} onChange={(e) => { setTradeId(e.target.value); setDep(""); }} style={{ borderColor: !tradeId ? "var(--rust)" : undefined }}>
          <option value="">— trade —</option>
          {tradeChoices
            ? tradeChoices.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)
            : MACRO_ORDER.map((c) => <optgroup key={c} label={c}>{db.trades.filter((t) => t.category === c).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>)}
        </select>
      ))}
      {cell("Qty", <input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} style={{ width: 58 }} />)}
      {cell("Timing dependency", (
        <select value={dep} onChange={(e) => setDep(e.target.value)} style={{ minWidth: 180, borderColor: needsDep && !dep ? "var(--rust)" : undefined }}>
          <option value="">{needsDep ? "— link a timing item —" : "no timing items yet"}</option>
          {tradeTasks.length > 0 && <optgroup label="This trade’s tasks">{tradeTasks.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</optgroup>}
          <optgroup label={tradeTasks.length ? "Other timing items" : "All timing items"}>
            {otherTasks.map((s) => <option key={s.id} value={s.id}>{s.label}{s.tradeId ? ` — ${tradeName(db, s.tradeId)}` : ""}</option>)}
          </optgroup>
        </select>
      ))}
      {cell("Needed on-hand", (
        <select value={needBy} onChange={(e) => setNeedBy(e.target.value as "start" | "finish")} style={{ minWidth: 150 }} title="Identify-by is always the trade start; this sets when it must be delivered.">
          <option value="start">Before trade starts</option>
          <option value="finish">By trade’s last week</option>
        </select>
      ))}
      <button className="btn btn-primary" disabled={!ready} onClick={add}>+ Add material</button>
    </div>
  );
}

type PriceOption = { vendor?: string; product?: string; price?: string; url?: string; note?: string };
type PriceData = { options?: PriceOption[]; rebates?: string[]; summary?: string };

function AiModal({ mat, onClose }: { mat: Material; onClose: () => void }) {
  const store = useStore();
  const db = store.db;
  const ro = accessFor(store.currentUser, store.session.role, "materials") !== "edit";
  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  const [msg, setMsg] = useState("");
  const [data, setData] = useState<PriceData | null>(null);
  const [applied, setApplied] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/price", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            item: mat.item, desc: mat.desc, specs: mat.specs, specLink: mat.specLink,
            qty: mat.qty, category: mat.category,
            room: mat.roomId ? db.rooms.find((r) => r.id === mat.roomId)?.name : mat.roomLabel,
          }),
        });
        const j = await res.json();
        if (cancelled) return;
        if (j.ok) { setData(j.data as PriceData); setState("done"); }
        else { setMsg(j.error || "Lookup failed."); setState("error"); }
      } catch { if (!cancelled) { setMsg("Couldn’t reach the pricing service."); setState("error"); } }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mat.id]);

  const use = (url?: string) => { if (!url || ro) return; store.updateMaterial(mat.id, { specLink: url }); setApplied(url); };
  const options = data?.options ?? [];
  const name = store.session.displayName;
  const canAddOpt = !ro && ["full_admin", "owner", "builder"].includes(store.session.role);
  const liveOptCount = store.db.materials.find((m) => m.id === mat.id)?.options?.length ?? 0;
  const addAsOption = (o: PriceOption) => {
    const label = [o.vendor, o.product].filter(Boolean).join(" — ") || "Option";
    const p = o.price ? Number(o.price.replace(/[^0-9.]/g, "")) : undefined;
    store.addMaterialOption(mat.id, { label, url: o.url, price: Number.isFinite(p) ? p : undefined, note: o.note }, name);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(44,36,28,.45)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div className="card" style={{ maxWidth: 560, width: "100%", padding: 22, maxHeight: "86vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--brass)" }}>✨</span>
          <h3 className="serif" style={{ fontSize: 18, fontWeight: 700, color: "var(--walnut)" }}>AI sourcing — {mat.item}</h3>
        </div>

        {state === "loading" && (
          <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--muted)" }}>
            <span className="spin" style={{ width: 16, height: 16, border: "2px solid var(--line)", borderTopColor: "var(--sage)", borderRadius: "50%", display: "inline-block" }} />
            Searching the web for current prices &amp; rebates… <span style={{ color: "var(--muted)" }}>(a thorough search can take 1–3 minutes — feel free to keep working, then reopen ✨)</span>
          </div>
        )}

        {state === "error" && (
          <div style={{ marginTop: 14, padding: "10px 12px", background: "#f7e6e0", borderRadius: 8, fontSize: 12.5, color: "var(--rust)" }}>{msg}</div>
        )}

        {state === "done" && (
          <>
            {data?.summary && <div style={{ marginTop: 12, fontSize: 12.5, color: "var(--brass-2)" }}>{data.summary}</div>}
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {options.map((o, i) => (
                <div key={i} style={{ padding: "9px 11px", border: "1px solid var(--line)", borderRadius: 8, background: applied && applied === o.url ? "var(--sage-tint)" : undefined }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                    <div style={{ fontSize: 13 }}><strong>{o.vendor ?? "Vendor"}</strong>{o.product ? <span style={{ color: "var(--muted)" }}> · {o.product}</span> : null}</div>
                    <strong style={{ fontSize: 13, whiteSpace: "nowrap" }}>{o.price ?? "—"}</strong>
                  </div>
                  {o.note && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{o.note}</div>}
                  <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                    {o.url && <a href={o.url} target="_blank" rel="noreferrer" className="btn btn-sm">Open ↗</a>}
                    {o.url && !ro && <button className="btn btn-sm btn-primary" onClick={() => use(o.url)}>{applied === o.url ? "✓ Saved to material" : "Use this link"}</button>}
                    {canAddOpt && liveOptCount < 3 && <button className="btn btn-sm" title="Add to this item's product options for owner/designer comparison" onClick={() => addAsOption(o)}>＋ Add as option</button>}
                  </div>
                </div>
              ))}
              {!options.length && <div style={{ fontSize: 12.5, color: "var(--muted)" }}>No structured options came back{data?.summary ? " — see the note above." : "."}</div>}
            </div>
            {!!data?.rebates?.length && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--muted)" }}>Rebates &amp; incentives</div>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 12, color: "var(--sage-2)" }}>
                  {data.rebates.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </div>
            )}
            <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 12 }}>AI-sourced from live web results — verify price &amp; availability before ordering.</div>
          </>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}><button className="btn btn-primary" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: "8px 10px", borderBottom: "2px solid var(--line)", position: "sticky", top: 0, background: "var(--paper)", fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em", zIndex: 1 };
const thC: React.CSSProperties = { ...th, textAlign: "center" };
const td: React.CSSProperties = { padding: "6px 10px", borderBottom: "1px solid var(--line)", verticalAlign: "top" };
const tdC: React.CSSProperties = { ...td, textAlign: "center" };

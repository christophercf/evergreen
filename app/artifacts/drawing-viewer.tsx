"use client";

import { useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/data/hooks";
import { Pill } from "../ui/bits";
import { fileToDataURL, driveViewLink } from "../ui/upload";
import { useFileDrop } from "../ui/use-drop";
import { tradeName } from "@/lib/data/money";
import type { Artifact, DrawingPin, PinKind } from "@/lib/data/types";

const PIN_META: Record<PinKind, { icon: string; color: string; label: string }> = {
  comment: { icon: "💬", color: "#4a7a8c", label: "Comment" },
  photo: { icon: "📷", color: "#8f6f2e", label: "Photo detail" },
  change: { icon: "⚑", color: "#b5552f", label: "Change request (architect)" },
};

function latestImage(a: Artifact): string | undefined {
  const v = [...(a.versions ?? [])].reverse().find((x) => x.fileUrl || x.driveUrl);
  if (v?.fileUrl) return v.fileUrl;
  if (v?.driveUrl) return driveViewLink(v.driveUrl);
  return a.url || undefined;
}

export default function DrawingViewer({ artifactId, initialTrade, onClose }: { artifactId: string; initialTrade?: string; onClose: () => void }) {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const me = store.currentUser;
  const by = store.session.displayName;
  const canEdit = ["full_admin", "owner", "builder"].includes(role);
  const isTrade = role === "trade";

  const a = db.artifacts.find((x) => x.id === artifactId);
  const [mode, setMode] = useState<"markup" | "scope" | "zones">(initialTrade ? "scope" : "markup");
  const [pendingKind, setPendingKind] = useState<PinKind | null>(null);
  const [openPin, setOpenPin] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  // trade for scope view: a trade user is locked to their own trade
  const myTrade = me?.tradeIds?.[0];
  const [scopeTrade, setScopeTrade] = useState<string>(initialTrade ?? myTrade ?? "");
  const [zoneRoom, setZoneRoom] = useState<string>("");
  const [drag, setDrag] = useState<null | { x0: number; y0: number; x1: number; y1: number }>(null);
  const [broken, setBroken] = useState(false);

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const painting = useRef(false);

  const img = a ? latestImage(a) : undefined;
  const tradesInScope = useMemo(() => Array.from(new Set(db.scope.filter((c) => c.status === "in").map((c) => c.tradeId))), [db.scope]);

  const { over: dropOver, dropProps } = useFileDrop(async (files) => {
    if (!a || !canEdit) return;
    const f = files[0];
    store.addArtifactVersion(a.id, { label: `v${(a.versions?.length ?? 0) + 1}`, fileUrl: await fileToDataURL(f), fileName: f.name }, by);
    setBroken(false);
  }, { accept: (f) => f.type.startsWith("image/"), disabled: !canEdit });

  if (!a) return null;

  const pct = (e: React.PointerEvent | React.MouseEvent) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 };
  };

  // --- scope shading data ---
  const scopeRoomIds = scopeTrade ? db.scope.filter((c) => c.tradeId === scopeTrade && c.status === "in").map((c) => c.roomId) : [];
  const scopeZones = (a.zones ?? []).filter((z) => scopeRoomIds.includes(z.roomId));
  const scopeItems = scopeTrade ? db.scope.filter((c) => c.tradeId === scopeTrade && c.status === "in").map((c) => ({
    room: db.rooms.find((r) => r.id === c.roomId)?.name ?? c.roomId,
    items: c.items.filter((i) => i.included).map((i) => i.label),
  })) : [];
  const scopeMaterials = scopeTrade ? db.materials.filter((m) => m.tradeId === scopeTrade) : [];

  // --- handlers ---
  const onImgClick = (e: React.MouseEvent) => {
    if (mode !== "markup" || !pendingKind || !canEditMarkup()) return;
    const p = pct(e);
    store.addDrawingPin(a.id, { x: p.x, y: p.y, kind: pendingKind, by, tradeId: isTrade ? myTrade : undefined });
    setPendingKind(null);
  };
  function canEditMarkup() { return canEdit || isTrade; } // vendors can pin too

  // scribble
  const startPaint = (e: React.PointerEvent) => { if (!drawing) return; painting.current = true; const c = canvasRef.current!; const ctx = c.getContext("2d")!; const r = c.getBoundingClientRect(); ctx.strokeStyle = "#b5552f"; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo((e.clientX - r.left) * (c.width / r.width), (e.clientY - r.top) * (c.height / r.height)); };
  const movePaint = (e: React.PointerEvent) => { if (!drawing || !painting.current) return; const c = canvasRef.current!; const ctx = c.getContext("2d")!; const r = c.getBoundingClientRect(); ctx.lineTo((e.clientX - r.left) * (c.width / r.width), (e.clientY - r.top) * (c.height / r.height)); ctx.stroke(); };
  const endPaint = () => { painting.current = false; };
  const saveScribble = () => { store.setDrawingScribble(a.id, canvasRef.current!.toDataURL("image/png")); setDrawing(false); };

  // zone drag
  const zoneDown = (e: React.PointerEvent) => { if (mode !== "zones" || !zoneRoom || !canEdit) return; const p = pct(e); setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); };
  const zoneMove = (e: React.PointerEvent) => { if (!drag) return; const p = pct(e); setDrag({ ...drag, x1: p.x, y1: p.y }); };
  const zoneUp = () => {
    if (!drag || !zoneRoom) { setDrag(null); return; }
    const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1), w = Math.abs(drag.x1 - drag.x0), h = Math.abs(drag.y1 - drag.y0);
    if (w > 2 && h > 2) store.setRoomZone(a.id, { roomId: zoneRoom, x, y, w, h });
    setDrag(null);
  };

  const shareLink = () => {
    const url = `${window.location.origin}/artifacts?artifact=${a.id}${mode === "scope" && scopeTrade ? `&view=scope&trade=${scopeTrade}` : ""}`;
    void navigator.clipboard?.writeText(url);
  };

  const zonesToShow = mode === "scope" ? scopeZones : (a.zones ?? []);
  const roomName = (id: string) => db.rooms.find((r) => r.id === id)?.name ?? id;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(28,24,20,.6)", zIndex: 50, display: "flex", padding: 18, overflow: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ margin: "auto", width: "min(1100px, 100%)", padding: 16, background: "var(--cream)" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h3 className="serif" style={{ fontSize: 18, fontWeight: 700, color: "var(--walnut)" }}>{a.name}</h3>
          <Pill bg="var(--cream-2)">{a.source ?? "drawing"}</Pill>
          <div style={{ marginLeft: "auto", display: "inline-flex", gap: 6, background: "var(--cream-2)", padding: 4, borderRadius: 9 }}>
            {([["markup", "✍️ Markup"], ["scope", "🎯 Scope view"], ...(canEdit ? [["zones", "🗺️ Map rooms"] as const] : [])] as const).map(([v, lbl]) => (
              <button key={v} onClick={() => { setMode(v); setPendingKind(null); setDrawing(false); }} className="btn btn-sm" style={mode === v ? { background: "var(--walnut)", color: "#fff" } : { background: "transparent", border: "none" }}>{lbl}</button>
            ))}
          </div>
          <button className="btn btn-sm" onClick={onClose}>✕ Close</button>
        </div>

        {/* toolbars */}
        {mode === "markup" && (
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Add a pin, then click the drawing:</span>
            {(Object.keys(PIN_META) as PinKind[]).map((k) => (
              <button key={k} className="btn btn-sm" onClick={() => setPendingKind(pendingKind === k ? null : k)} style={pendingKind === k ? { background: PIN_META[k].color, color: "#fff" } : undefined}>{PIN_META[k].icon} {PIN_META[k].label}</button>
            ))}
            <span style={{ width: 1, height: 18, background: "var(--line)" }} />
            {!drawing ? <button className="btn btn-sm" onClick={() => setDrawing(true)}>✏️ Scribble</button>
              : <><button className="btn btn-sm btn-primary" onClick={saveScribble}>Save scribble</button><button className="btn btn-sm" onClick={() => setDrawing(false)}>Cancel</button></>}
            {a.scribble && !drawing && <button className="btn btn-sm" style={{ color: "var(--rust)" }} onClick={() => store.setDrawingScribble(a.id, undefined)}>Clear scribble</button>}
            {pendingKind && <Pill bg="var(--sage-tint)">Click to place {PIN_META[pendingKind].label}</Pill>}
          </div>
        )}
        {mode === "scope" && (
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Shade a trade's rooms:</span>
            <select value={scopeTrade} disabled={isTrade} onChange={(e) => setScopeTrade(e.target.value)}>
              <option value="">— pick a trade —</option>
              {tradesInScope.map((t) => <option key={t} value={t}>{tradeName(db, t)}</option>)}
            </select>
            <button className="btn btn-sm" onClick={shareLink}>🔗 Copy scope link</button>
            {canEdit && scopeTrade && (
              a.id === db.vendorAgreements.find((v) => v.tradeId === scopeTrade)?.scopeDrawingId
                ? <button className="btn btn-sm" style={{ color: "var(--rust)" }} onClick={() => store.setScopeDrawing(scopeTrade, undefined)}>✓ Appended to contract — remove</button>
                : <button className="btn btn-sm btn-primary" onClick={() => store.setScopeDrawing(scopeTrade, a.id)}>Append to {tradeName(db, scopeTrade)}'s contract</button>
            )}
          </div>
        )}
        {mode === "zones" && (
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Pick a room, then drag a box on the drawing to map it:</span>
            <select value={zoneRoom} onChange={(e) => setZoneRoom(e.target.value)}>
              <option value="">— pick a room —</option>
              {db.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}{(a.zones ?? []).some((z) => z.roomId === r.id) ? " ✓" : ""}</option>)}
            </select>
            {zoneRoom && (a.zones ?? []).some((z) => z.roomId === zoneRoom) && <button className="btn btn-sm" style={{ color: "var(--rust)" }} onClick={() => store.removeRoomZone(a.id, zoneRoom)}>Remove {roomName(zoneRoom)} zone</button>}
          </div>
        )}

        {/* the drawing surface */}
        <div style={{ display: "grid", gridTemplateColumns: mode === "scope" && scopeTrade ? "1fr 280px" : "1fr", gap: 14, marginTop: 12, alignItems: "start" }}>
          <div ref={wrapRef} {...dropProps} onClick={onImgClick} onPointerDown={mode === "zones" ? zoneDown : undefined} onPointerMove={mode === "zones" ? zoneMove : undefined} onPointerUp={mode === "zones" ? zoneUp : undefined}
            style={{ position: "relative", width: "100%", aspectRatio: "4 / 3", borderRadius: 10, overflow: "hidden", border: `1px solid ${dropOver ? "var(--sage)" : "var(--line)"}`, outline: dropOver ? "2px dashed var(--sage)" : "none", background: "#f4f1e8", cursor: pendingKind ? "crosshair" : mode === "zones" && zoneRoom ? "crosshair" : "default", touchAction: "none" }}>
            {dropOver && <div style={{ position: "absolute", inset: 0, zIndex: 5, background: "var(--sage-tint)", opacity: 0.9, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: "var(--walnut)", pointerEvents: "none" }}>⬆ Drop an image to set the drawing</div>}
            {img && !broken
              ? <img src={img} alt={a.name} onError={() => setBroken(true)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
              : <Placeholder />}

            {/* room zones */}
            {zonesToShow.map((z) => (
              <div key={z.roomId} style={{ position: "absolute", left: `${z.x}%`, top: `${z.y}%`, width: `${z.w}%`, height: `${z.h}%`, background: mode === "scope" ? "rgba(94,125,79,.34)" : "rgba(176,138,62,.18)", border: `1.5px solid ${mode === "scope" ? "var(--sc-in)" : "var(--brass)"}`, borderRadius: 4, display: "flex", alignItems: "flex-start", justifyContent: "flex-start" }}>
                <span style={{ fontSize: 10, background: "rgba(255,255,255,.85)", padding: "0 4px", borderRadius: 3, margin: 2 }}>{roomName(z.roomId)}</span>
              </div>
            ))}
            {/* live zone drag preview */}
            {drag && <div style={{ position: "absolute", left: `${Math.min(drag.x0, drag.x1)}%`, top: `${Math.min(drag.y0, drag.y1)}%`, width: `${Math.abs(drag.x1 - drag.x0)}%`, height: `${Math.abs(drag.y1 - drag.y0)}%`, border: "2px dashed var(--brass-2)", background: "rgba(176,138,62,.15)" }} />}

            {/* saved scribble overlay */}
            {a.scribble && <img src={a.scribble} alt="markup" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }} />}

            {/* live scribble canvas */}
            {drawing && <canvas ref={canvasRef} width={1000} height={750} onPointerDown={startPaint} onPointerMove={movePaint} onPointerUp={endPaint} onPointerLeave={endPaint}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", cursor: "crosshair", touchAction: "none" }} />}

            {/* pins */}
            {mode !== "zones" && (a.pins ?? []).map((p) => (
              <button key={p.id} onClick={(e) => { e.stopPropagation(); setOpenPin(openPin === p.id ? null : p.id); }}
                style={{ position: "absolute", left: `${p.x}%`, top: `${p.y}%`, transform: "translate(-50%,-100%)", border: "none", background: "transparent", cursor: "pointer", fontSize: 20, filter: p.resolved ? "grayscale(1) opacity(.5)" : "none" }}
                title={`${PIN_META[p.kind].label} · ${p.by}`}>📍</button>
            ))}

            {/* pin popover */}
            {openPin && (() => { const p = (a.pins ?? []).find((x) => x.id === openPin); if (!p) return null; return (
              <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", left: `${Math.min(p.x, 70)}%`, top: `${Math.min(p.y, 80)}%`, width: 230, background: "#fff", border: "1px solid var(--line)", borderRadius: 8, padding: 10, boxShadow: "0 8px 24px rgba(0,0,0,.18)", zIndex: 3 }}>
                <PinEditor artId={a.id} pin={p} canEdit={canEdit || p.by === by} onClose={() => setOpenPin(null)} />
              </div>
            ); })()}
          </div>

          {/* scope side panel */}
          {mode === "scope" && scopeTrade && (
            <div className="card" style={{ padding: 12, maxHeight: 460, overflow: "auto" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--walnut)" }}>{tradeName(db, scopeTrade)} — your job</div>
              {!scopeZones.length && <div style={{ fontSize: 11.5, color: "var(--brass-2)", marginTop: 4 }}>No rooms mapped yet on this drawing. {canEdit ? "Use “Map rooms” to shade them." : ""}</div>}
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)", marginTop: 8 }}>Scope by room</div>
              {scopeItems.length ? scopeItems.map((s) => (
                <div key={s.room} style={{ marginTop: 6 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{s.room}</div>
                  {s.items.length ? <ul style={{ margin: "2px 0 0 16px", fontSize: 12, color: "var(--ink)" }}>{s.items.map((i) => <li key={i}>{i}</li>)}</ul> : <div style={{ fontSize: 11.5, color: "var(--muted)" }}>—</div>}
                </div>
              )) : <div style={{ fontSize: 12, color: "var(--muted)" }}>Not in scope for any room.</div>}
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)", marginTop: 10 }}>Materials ({scopeMaterials.length})</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
                {scopeMaterials.slice(0, 12).map((m) => <div key={m.id} style={{ fontSize: 12 }}>• {m.item}{m.qty ? ` ×${m.qty}` : ""}</div>)}
                {!scopeMaterials.length && <div style={{ fontSize: 12, color: "var(--muted)" }}>None assigned.</div>}
              </div>
            </div>
          )}
        </div>

        {/* pin list */}
        {mode !== "zones" && (a.pins ?? []).length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)" }}>Markups ({(a.pins ?? []).length})</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
              {(a.pins ?? []).map((p) => (
                <div key={p.id} style={{ display: "flex", gap: 8, fontSize: 12, alignItems: "center", opacity: p.resolved ? 0.55 : 1 }}>
                  <span>{PIN_META[p.kind].icon}</span>
                  <span style={{ flex: 1 }}><strong>{PIN_META[p.kind].label}</strong>{p.text ? ` — ${p.text}` : ""} <span style={{ color: "var(--muted)" }}>· {p.by}</span></span>
                  {p.resolved && <Pill bg="var(--sage-tint)">resolved</Pill>}
                  <button className="btn btn-sm" onClick={() => setOpenPin(p.id)}>open</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PinEditor({ artId, pin, canEdit, onClose }: { artId: string; pin: DrawingPin; canEdit: boolean; onClose: () => void }) {
  const store = useStore();
  const [text, setText] = useState(pin.text ?? "");
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <strong style={{ fontSize: 12 }}>{PIN_META[pin.kind].icon} {PIN_META[pin.kind].label}</strong>
        <button className="btn btn-sm" style={{ marginLeft: "auto", padding: "0 6px" }} onClick={onClose}>✕</button>
      </div>
      {pin.photo && <img src={pin.photo} alt="detail" style={{ width: "100%", borderRadius: 6, margin: "6px 0" }} />}
      <textarea value={text} disabled={!canEdit} placeholder={pin.kind === "change" ? "Describe the change for the architect…" : "Add a comment…"} onChange={(e) => setText(e.target.value)} onBlur={() => canEdit && store.updateDrawingPin(artId, pin.id, { text })} style={{ width: "100%", minHeight: 46, fontSize: 12, marginTop: 6, resize: "vertical" }} />
      {pin.kind === "photo" && canEdit && (
        <>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={async (e) => { const f = e.target.files?.[0]; if (f) store.updateDrawingPin(artId, pin.id, { photo: await fileToDataURL(f) }); }} />
          <button className="btn btn-sm" style={{ marginTop: 4 }} onClick={() => fileRef.current?.click()}>📷 {pin.photo ? "Replace" : "Attach"} photo</button>
        </>
      )}
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        {canEdit && <button className="btn btn-sm" onClick={() => store.updateDrawingPin(artId, pin.id, { resolved: !pin.resolved })}>{pin.resolved ? "Reopen" : "Resolve"}</button>}
        {canEdit && <button className="btn btn-sm" style={{ color: "var(--rust)", marginLeft: "auto" }} onClick={() => { store.removeDrawingPin(artId, pin.id); onClose(); }}>Delete</button>}
      </div>
      <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 4 }}>{pin.by} · {new Date(pin.at).toLocaleDateString()}</div>
    </div>
  );
}

function Placeholder() {
  // a faux floor-plan backdrop so pins & zones are demonstrable without a real upload
  return (
    <svg viewBox="0 0 400 300" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      <rect width="400" height="300" fill="#f4f1e8" />
      {Array.from({ length: 20 }).map((_, i) => <line key={`v${i}`} x1={i * 20} y1="0" x2={i * 20} y2="300" stroke="#e2dcce" />)}
      {Array.from({ length: 15 }).map((_, i) => <line key={`h${i}`} x1="0" y1={i * 20} x2="400" y2={i * 20} stroke="#e2dcce" />)}
      <rect x="40" y="40" width="150" height="110" fill="none" stroke="#b8ad97" strokeWidth="2" />
      <rect x="210" y="40" width="150" height="110" fill="none" stroke="#b8ad97" strokeWidth="2" />
      <rect x="40" y="170" width="320" height="90" fill="none" stroke="#b8ad97" strokeWidth="2" />
      <text x="200" y="288" textAnchor="middle" fontSize="11" fill="#9a8f79">Upload a drawing image/photo to annotate the real plan — pins & zones still work here.</text>
    </svg>
  );
}

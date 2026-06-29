"use client";

import { useEffect, useRef, useState } from "react";

// A small canvas signature pad. Draw with mouse or finger, then Adopt to emit a
// trimmed PNG data URL. Used to adopt a signature onto a profile and to sign.
export function SignaturePad({ onAdopt, onCancel }: { onAdopt: (dataUrl: string) => void; onCancel?: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    ctx.scale(2, 2); // crisp on retina (canvas is 2× its CSS size)
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#2c2a28";
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent) => { drawing.current = true; const ctx = ref.current!.getContext("2d")!; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); ref.current!.setPointerCapture(e.pointerId); };
  const move = (e: React.PointerEvent) => { if (!drawing.current) return; const ctx = ref.current!.getContext("2d")!; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); setDirty(true); };
  const up = () => { drawing.current = false; };
  const clear = () => { const c = ref.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); setDirty(false); };

  return (
    <div>
      <canvas ref={ref} width={520} height={150} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
        style={{ width: 260, height: 75, border: "1px dashed var(--line)", borderRadius: 8, background: "#fff", touchAction: "none", cursor: "crosshair", display: "block" }} />
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <button className="btn btn-sm btn-primary" disabled={!dirty} onClick={() => onAdopt(ref.current!.toDataURL("image/png"))}>✒ Adopt signature</button>
        <button className="btn btn-sm" onClick={clear} disabled={!dirty}>Clear</button>
        {onCancel && <button className="btn btn-sm" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}

// Render an adopted signature (image) or a fallback script-style name.
export function SignatureMark({ img, name }: { img?: string; name: string }) {
  if (img) return <img src={img} alt={`${name} signature`} style={{ height: 38, maxWidth: 200, objectFit: "contain" }} />;
  return <span style={{ fontFamily: "var(--font-serif)", fontSize: 18, color: "var(--walnut)", fontStyle: "italic" }}>✒ {name}</span>;
}

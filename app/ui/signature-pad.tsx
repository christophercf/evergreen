"use client";

import { useEffect, useRef, useState } from "react";
import { PenIcon } from "./icons";

// A small canvas signature pad. Draw with mouse or finger, then Adopt to emit a
// trimmed PNG data URL. Used to adopt a signature onto a profile and to sign.
export function SignaturePad({ onAdopt, onCancel }: { onAdopt: (dataUrl: string) => void; onCancel?: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);

  // The canvas fills whatever box it is given — a finger needs the width of the
  // card, not 260px of it. Its internal bitmap is kept at 2× the CSS size so
  // strokes land under the fingertip instead of offset from it.
  useEffect(() => {
    const c = ref.current, wrap = box.current;
    if (!c || !wrap) return;
    const size = () => {
      // Resizing clears the bitmap, so a signature in progress is left alone.
      if (drawing.current || dirty) return;
      const w = Math.max(200, Math.round(wrap.clientWidth));
      const h = Math.round(Math.min(150, Math.max(96, w * 0.34)));
      c.width = w * 2; c.height = h * 2;
      c.style.width = `${w}px`; c.style.height = `${h}px`;
      const ctx = c.getContext("2d")!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(2, 2);
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#2c2a28";
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [dirty]);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent) => { drawing.current = true; const ctx = ref.current!.getContext("2d")!; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); ref.current!.setPointerCapture(e.pointerId); };
  const move = (e: React.PointerEvent) => { if (!drawing.current) return; const ctx = ref.current!.getContext("2d")!; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); setDirty(true); };
  const up = () => { drawing.current = false; };
  const clear = () => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.restore();
    setDirty(false);
  };

  return (
    <div ref={box} style={{ width: "100%", maxWidth: 520 }}>
      <canvas ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
        style={{ width: "100%", height: 96, border: "1px dashed var(--line)", borderRadius: 8, background: "#fff", touchAction: "none", cursor: "crosshair", display: "block" }} />
      <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 3 }}>Sign with a finger or a mouse.</div>
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <button className="btn btn-sm btn-primary" disabled={!dirty} onClick={() => onAdopt(ref.current!.toDataURL("image/png"))}><PenIcon width={14} height={14} /> Adopt signature</button>
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

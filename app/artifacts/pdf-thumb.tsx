"use client";

import { useEffect, useRef, useState } from "react";

// Render the first page of a PDF to a canvas (a real "screen grab" thumbnail).
// pdf.js is dynamically imported so it only loads when a PDF is shown. The worker
// is pulled from unpkg at the exact installed version.
let pdfjsP: Promise<typeof import("pdfjs-dist")> | null = null;
function getPdfjs() {
  if (!pdfjsP) {
    pdfjsP = import("pdfjs-dist").then((m) => {
      m.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${m.version}/build/pdf.worker.min.mjs`;
      return m;
    });
  }
  return pdfjsP;
}

export function PdfThumb({ src, height = 150, fit = "cover" }: { src: string; height?: number; fit?: "cover" | "contain" }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"loading" | "done" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    (async () => {
      try {
        const pdfjs = await getPdfjs();
        const doc = await pdfjs.getDocument(src).promise;
        if (cancelled) return;
        const page = await doc.getPage(1);
        const canvas = canvasRef.current;
        if (!canvas) return;
        const targetW = Math.max(220, wrapRef.current?.clientWidth ?? 280) * (window.devicePixelRatio || 1);
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: targetW / base.width });
        canvas.width = vp.width;
        canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
        if (!cancelled) setState("done");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [src]);

  return (
    <div ref={wrapRef} style={{ width: "100%", height, overflow: "hidden", position: "relative", background: "#fff", display: "flex", justifyContent: "center" }}>
      <canvas ref={canvasRef} style={{ width: fit === "contain" ? "auto" : "100%", height: fit === "contain" ? "100%" : "auto", objectFit: fit, display: state === "done" ? "block" : "none" }} />
      {state === "loading" && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 12 }}>Rendering PDF…</div>}
      {state === "error" && <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 12, gap: 4 }}><span style={{ fontSize: 30 }}>📄</span>PDF</div>}
      {state === "done" && <span style={{ position: "absolute", bottom: 4, right: 4, fontSize: 9, fontWeight: 700, color: "#fff", background: "rgba(44,36,28,.7)", borderRadius: 4, padding: "1px 5px" }}>PDF</span>}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/data/hooks";

// One toast, bottom-centre, announcing that a save or a send actually landed.
// The store fires it (debounced) on every mutation; this just shows the latest
// and clears itself. Rendered once, in the app frame.
export function Toaster() {
  const store = useStore();
  const [msg, setMsg] = useState<string | null>(null);
  const [shownAt, setShownAt] = useState(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    store.setToastHandler((text) => {
      setMsg(text);
      setShownAt(Date.now()); // re-key so the animation replays on a repeat toast
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setMsg(null), 2200);
    });
    return () => { store.setToastHandler(null); if (timer) clearTimeout(timer); };
  }, [store]);

  if (!msg) return null;
  return (
    <div
      key={shownAt}
      className="ever-toast"
      role="status"
      aria-live="polite"
      style={{
        position: "fixed", left: "50%", bottom: "calc(env(safe-area-inset-bottom, 0px) + 74px)",
        zIndex: 4000, display: "inline-flex", alignItems: "center", gap: 8,
        padding: "9px 16px 9px 13px", borderRadius: 999,
        background: "var(--walnut)", color: "#fdf8ee",
        fontSize: 13.5, fontWeight: 600, boxShadow: "0 6px 22px rgba(44,36,28,.32)",
        maxWidth: "min(88vw, 420px)",
      }}
    >
      <span style={{
        width: 18, height: 18, flex: "none", borderRadius: 999, background: "var(--sage)",
        display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#fff",
      }}>✓</span>
      {msg}
    </div>
  );
}

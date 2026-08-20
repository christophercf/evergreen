"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/data/hooks";
import type { ToastTone } from "@/lib/data/store";

// One toast, bottom-centre, announcing that a save or a send actually landed.
// The store fires it (debounced) on every mutation; this just shows the latest
// and clears itself. Rendered once, in the app frame.
//
// A failure is not a louder success: it keeps a different colour, a different
// mark, and it stays until dismissed. A save that did not reach the server is
// the one message a person must not scroll past.
export function Toaster() {
  const store = useStore();
  const [msg, setMsg] = useState<string | null>(null);
  const [tone, setTone] = useState<ToastTone>("ok");
  const [shownAt, setShownAt] = useState(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    store.setToastHandler((text, t = "ok") => {
      setMsg(text);
      setTone(t);
      setShownAt(Date.now()); // re-key so the animation replays on a repeat toast
      if (timer) clearTimeout(timer);
      // Successes are ambient and clear themselves. Failures wait to be read.
      if (t === "ok") timer = setTimeout(() => setMsg(null), 2200);
    });
    return () => { store.setToastHandler(null); if (timer) clearTimeout(timer); };
  }, [store]);

  if (!msg) return null;
  const bad = tone === "error";
  return (
    <div
      key={shownAt}
      className="ever-toast"
      role={bad ? "alert" : "status"}
      aria-live={bad ? "assertive" : "polite"}
      style={{
        position: "fixed", left: "50%", bottom: "calc(env(safe-area-inset-bottom, 0px) + 74px)",
        zIndex: 4000, display: "inline-flex", alignItems: "center", gap: 8,
        padding: "9px 13px", borderRadius: bad ? 12 : 999,
        background: bad ? "var(--rust)" : "var(--walnut)", color: "#fdf8ee",
        fontSize: 13.5, fontWeight: 600, boxShadow: "0 6px 22px rgba(44,36,28,.32)",
        maxWidth: "min(88vw, 460px)", lineHeight: 1.4, textAlign: "left",
      }}
    >
      <span style={{
        width: 18, height: 18, flex: "none", borderRadius: 999,
        background: bad ? "#fdf8ee" : "var(--sage)", color: bad ? "var(--rust)" : "#fff",
        display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12,
      }}>{bad ? "!" : "✓"}</span>
      <span style={{ minWidth: 0 }}>{msg}</span>
      {bad && (
        <button
          onClick={() => setMsg(null)}
          aria-label="Dismiss"
          style={{
            flex: "none", marginLeft: 4, minHeight: 26, padding: "0 9px", cursor: "pointer",
            borderRadius: 7, border: "1px solid rgba(253,248,238,.5)",
            background: "transparent", color: "#fdf8ee", fontSize: 12, fontWeight: 700,
          }}
        >Dismiss</button>
      )}
    </div>
  );
}

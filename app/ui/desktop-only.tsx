"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// A screen that is honestly a desktop screen.
//
// Most of this app earns its place on a phone. A few screens do not, and
// pretending otherwise is worse than saying so: a cramped, half-usable version
// of a money screen invites mistakes that are expensive to undo.
//
// So the mobile answer is a plain explanation and somewhere useful to go —
// never a blank page, and never a shrunken version of the real thing.
// ---------------------------------------------------------------------------

/** The app's own definition of "not a desktop", answered synchronously on the
 *  first render so nothing flashes the wrong layout. */
export function useNarrowViewport(max = 860): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined" && window.matchMedia(`(max-width: ${max}px)`).matches);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${max}px)`);
    const sync = () => setNarrow(mq.matches);
    sync();
    // resize as well as change: emulated viewports resize the page without
    // ever firing the media-query event.
    mq.addEventListener("change", sync);
    window.addEventListener("resize", sync);
    return () => { mq.removeEventListener("change", sync); window.removeEventListener("resize", sync); };
  }, [max]);
  return narrow;
}

export function DesktopOnly({ title, because, elsewhere, children }: {
  /** What the screen is called, in the user's words. */
  title: string;
  /** Why it needs the width. Say the real reason, not "for the best experience". */
  because: string;
  /** Somewhere genuinely useful to go from a phone. */
  elsewhere?: { href: string; label: string; note: string }[];
  children: ReactNode;
}) {
  const narrow = useNarrowViewport();
  if (!narrow) return <>{children}</>;

  return (
    <div style={{ maxWidth: 460, margin: "8px auto 0" }}>
      <div className="card" style={{ padding: 20 }}>
        <div className="serif" style={{ fontSize: 20, fontWeight: 700, color: "var(--walnut)", lineHeight: 1.2 }}>
          {title} is a desktop screen
        </div>
        <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, marginTop: 10 }}>{because}</p>
        <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, marginTop: 10 }}>
          Open it on a laptop or desktop and it will be here waiting.
        </p>

        {elsewhere?.length ? (
          <>
            <div style={{ borderTop: "1px solid var(--line)", margin: "16px 0 12px" }} />
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 8 }}>
              From here you can still
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {elsewhere.map((e) => (
                <Link key={e.href} href={e.href} className="btn" style={{ justifyContent: "flex-start", textAlign: "left", height: "auto", padding: "10px 12px" }}>
                  <span>
                    <span style={{ display: "block", fontWeight: 700, fontSize: 13 }}>{e.label} →</span>
                    <span style={{ display: "block", fontSize: 11.5, color: "var(--muted)", marginTop: 2, whiteSpace: "normal" }}>{e.note}</span>
                  </span>
                </Link>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

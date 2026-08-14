"use client";

import type { CSSProperties, ReactNode } from "react";

// Small shared pieces for the Bid Management screens. The layout and behaviour
// follow the handoff design; the palette and type are Evergreen's own, so this
// section reads as part of the same app rather than a bolted-on tool.

export const num = (v: unknown): number | null => {
  const s = String(v ?? "").replace(/[^0-9.\-]/g, "");
  return s === "" || isNaN(Number(s)) ? null : Number(s);
};
export const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : "$" + Math.round(n).toLocaleString("en-US");

/** Uppercase micro-label — the section's workhorse for field and group names. */
export function Kicker({ children, tone = "brass", style }: { children: ReactNode; tone?: "brass" | "muted"; style?: CSSProperties }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".11em", textTransform: "uppercase", color: tone === "brass" ? "var(--brass-2)" : "var(--muted)", ...style }}>
      {children}
    </div>
  );
}

/** Every screen opens the same way: title, one line of why, action on the right. */
export function ScreenHead({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
      <div style={{ minWidth: 0 }}>
        <h2 className="serif" style={{ fontSize: 22, fontWeight: 700, color: "var(--walnut)", lineHeight: 1.15 }}>{title}</h2>
        {sub && <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--muted)", marginTop: 4, maxWidth: 620 }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}

/** A selectable card — trades, contacts, bids in the inbox. */
export function Tile({ on, onClick, children, style }: { on: boolean; onClick?: () => void; children: ReactNode; style?: CSSProperties }) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: "left", cursor: onClick ? "pointer" : "default", font: "inherit", color: "inherit",
        background: on ? "var(--sage-tint)" : "var(--paper)",
        border: `1px solid ${on ? "var(--sage)" : "var(--line)"}`,
        borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 5, width: "100%", minWidth: 0, ...style,
      }}
    >
      {children}
    </button>
  );
}

/** The little square that shows a tile is picked. */
export function Check({ on }: { on: boolean }) {
  return (
    <span style={{
      width: 17, height: 17, flex: "none", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 11, fontWeight: 700, color: "#fff",
      background: on ? "var(--sage)" : "transparent", border: `1px solid ${on ? "var(--sage)" : "var(--line)"}`,
    }}>{on ? "✓" : ""}</span>
  );
}

/** Two-line option button used for pricing basis and submission route. */
export function OptionBtn({ on, label, hint, onClick, disabled }: { on: boolean; label: string; hint: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        minHeight: 54, padding: "7px 10px", display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start",
        textAlign: "left", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, borderRadius: 8,
        background: on ? "var(--sage)" : "var(--paper)", color: on ? "#fff" : "var(--ink)",
        border: `1px solid ${on ? "var(--sage)" : "var(--line)"}`,
      }}
    >
      <span className="serif" style={{ fontSize: 13.5, fontWeight: 700 }}>{label}</span>
      <span style={{ fontSize: 10.5, lineHeight: 1.3, opacity: 0.8, whiteSpace: "normal" }}>{hint}</span>
    </button>
  );
}

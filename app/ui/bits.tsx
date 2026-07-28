"use client";

import { useRef, useState, type ReactNode, type CSSProperties } from "react";
import type { ScopeStatus } from "@/lib/data/types";
import { SCOPE_LABEL } from "@/lib/data/types";
import { fmt } from "@/lib/data/money";

// ---------------------------------------------------------------------------
// Commit-on-blur inputs. Free-form entry must never fight the typist: while a
// field is focused it shows a local draft and writes NOTHING to the store, then
// commits once on blur/Enter. This avoids the classic "auto-adjusts what I type"
// bug where a controlled value is transformed (rounded, ×100, comma-formatted)
// or the row re-sorts on every keystroke.
// ---------------------------------------------------------------------------
function numText(v: number): string {
  if (!Number.isFinite(v)) return "";
  if (Number.isInteger(v)) return String(v);
  return String(Math.round(v * 1e6) / 1e6); // strip float artifacts + trailing zeros
}

export function NumInput({ value, onCommit, disabled, money, suffix, width = 90, align = "right", style }: {
  value: number; onCommit: (v: number) => void; disabled?: boolean; money?: boolean; suffix?: string; width?: number; align?: "right" | "center" | "left"; style?: CSSProperties;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const edited = useRef(false); // ref so blur sees live edits even before re-render
  const idle = money ? Math.round(value).toLocaleString("en-US") : numText(value);
  const blur = (raw: string) => {
    if (edited.current) { const n = Number(raw.replace(/[^0-9.\-]/g, "")); onCommit(Number.isFinite(n) ? n : 0); }
    edited.current = false;
    setDraft(null);
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2, justifyContent: align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start" }}>
      {money && <span style={{ color: "var(--muted)" }}>$</span>}
      <input
        type="text" inputMode="decimal"
        value={draft !== null ? draft : idle}
        disabled={disabled}
        onFocus={() => setDraft(numText(value))}
        onChange={(e) => { edited.current = true; setDraft(e.target.value); }}
        onBlur={(e) => blur(e.currentTarget.value)}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        style={{ width, textAlign: align, fontVariantNumeric: "tabular-nums", ...style }}
      />
      {suffix && <span style={{ color: "var(--muted)" }}>{suffix}</span>}
    </span>
  );
}

export function TextInput({ value, onCommit, disabled, placeholder, style, type }: {
  value: string; onCommit: (v: string) => void; disabled?: boolean; placeholder?: string; style?: CSSProperties; type?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const edited = useRef(false);
  return (
    <input
      type={type}
      value={draft !== null ? draft : value}
      disabled={disabled}
      placeholder={placeholder}
      onFocus={() => setDraft(value)}
      onChange={(e) => { edited.current = true; setDraft(e.target.value); }}
      onBlur={(e) => { if (edited.current) onCommit(e.currentTarget.value); edited.current = false; setDraft(null); }}
      onKeyDown={(e) => { if (type !== "textarea" && e.key === "Enter") e.currentTarget.blur(); }}
      style={style}
    />
  );
}

export function Money({ value, className, cents }: { value: number; className?: string; cents?: boolean }) {
  return <span className={className} style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(value, { cents })}</span>;
}

export function Pill({ children, color, bg }: { children: ReactNode; color?: string; bg?: string }) {
  return <span className="pill" style={{ color: color ?? "var(--ink)", background: bg ?? "var(--cream-2)" }}>{children}</span>;
}

const SCOPE_BG: Record<ScopeStatus, string> = {
  in: "var(--sc-in)", out: "var(--sc-out)", existing: "var(--sc-existing)", unset: "var(--sc-unset)",
};
export function ScopePill({ status }: { status: ScopeStatus }) {
  if (status === "unset") return <Pill color="var(--muted)">—</Pill>;
  return <Pill color="#fff" bg={SCOPE_BG[status]}>{SCOPE_LABEL[status]}</Pill>;
}

export function StatCard({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: string }) {
  return (
    <div className="card" style={{ padding: "14px 16px", minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)" }}>{label}</div>
      <div className="serif" style={{ fontSize: 26, fontWeight: 700, color: accent ?? "var(--ink)", lineHeight: 1.15, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, margin: "26px 0 12px" }}>
      <h2 className="serif" style={{ fontSize: 19, fontWeight: 700, color: "var(--walnut)" }}>{children}</h2>
      {right}
    </div>
  );
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
      <div>
        <h1 className="serif" style={{ fontSize: 28, fontWeight: 700, color: "var(--walnut)", lineHeight: 1.1 }}>{title}</h1>
        {subtitle && <p style={{ color: "var(--muted)", marginTop: 5, maxWidth: 640, fontSize: 14 }}>{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

/** Horizontal proportion bar split by segments. */
export function StackBar({ segments, height = 10 }: { segments: { value: number; color: string; label?: string }[]; height?: number }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  return (
    <div style={{ display: "flex", width: "100%", height, borderRadius: 99, overflow: "hidden", background: "var(--cream-2)" }}>
      {segments.map((s, i) => (
        <div key={i} title={s.label} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div style={{ padding: 28, textAlign: "center", color: "var(--muted)", fontSize: 14 }}>{children}</div>;
}

export function NoAccess({ module }: { module: string }) {
  return (
    <div className="card" style={{ padding: 40, textAlign: "center", maxWidth: 460, margin: "60px auto" }}>
      <div className="serif" style={{ fontSize: 20, color: "var(--walnut)", marginBottom: 8 }}>Restricted</div>
      <p style={{ color: "var(--muted)", fontSize: 14 }}>
        Your current role doesn’t have access to <strong>{module}</strong>. Switch persona from the top bar, or ask the
        owner to grant access in the Administrative → Users panel.
      </p>
    </div>
  );
}

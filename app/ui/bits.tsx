"use client";

import type { ReactNode } from "react";
import type { ScopeStatus } from "@/lib/data/types";
import { SCOPE_LABEL } from "@/lib/data/types";
import { fmt } from "@/lib/data/money";

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

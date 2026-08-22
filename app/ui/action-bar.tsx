"use client";

import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// The floating action bar.
//
// Extracted from the bundle picker, which had it right: a list that can outgrow
// the viewport must not put its action at the end of the list, or the user
// scrolls to find out what they have done. The bar carries the running count,
// so nobody scrolls back to check either.
//
// It owns the awkward parts once: the fixed position, clearing the phone's tab
// bar and safe area, and the spacer that stops it covering the last row.
// ---------------------------------------------------------------------------

export function ActionBar({ summary, primary, secondary, show = true }: {
  /** Left side: what is picked, and what it adds up to. */
  summary: ReactNode;
  primary: { label: string; disabled?: boolean; onClick: () => void; title?: string };
  secondary?: { label: string; onClick: () => void };
  /** Usually "something is selected" — a bar with nothing to do is noise. */
  show?: boolean;
}) {
  if (!show) return null;
  return (
    <>
      {/* Keeps the last row reachable above the bar. */}
      <div aria-hidden style={{ height: 92 }} />
      <div className="ever-actionbar">
        <div style={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.35, color: "var(--muted)" }}>{summary}</div>
        {secondary ? <button className="btn btn-sm" onClick={secondary.onClick}>{secondary.label}</button> : null}
        <button className="btn btn-primary" disabled={primary.disabled} onClick={primary.onClick} title={primary.title}>
          {primary.label}
        </button>
      </div>
    </>
  );
}

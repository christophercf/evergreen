"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ActionBar } from "../ui/action-bar";
import {
  INTAKE_LABEL, PRICING_BASIS_LABEL, bidIntakeComplete, bidIntakeMissing,
  type BidPackage, type ContactSheet, type DB, type VendorBid,
} from "@/lib/data/types";

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
export function Kicker({ children, tone = "brass", style }: { children: ReactNode; tone?: "brass" | "muted" | "rust"; style?: CSSProperties }) {
  const color = tone === "brass" ? "var(--brass-2)" : tone === "rust" ? "var(--rust)" : "var(--muted)";
  return (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".11em", textTransform: "uppercase", color, ...style }}>
      {children}
    </div>
  );
}

/** Every screen opens the same way: title, one line of why, action on the right. */
export function ScreenHead({ title, sub, tag, right }: { title: string; sub?: ReactNode; tag?: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
          <h2 className="serif" style={{ fontSize: 22, fontWeight: 700, color: "var(--walnut)", lineHeight: 1.15 }}>{title}</h2>
          {tag}
        </div>
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

/** Outline tag — the package basis, "3 trades", a single flag sentence. */
export function Tag({ children, tone = "line", style }: { children: ReactNode; tone?: "line" | "rust"; style?: CSSProperties }) {
  const c = tone === "rust" ? "var(--rust)" : "var(--line)";
  return (
    <span style={{
      display: "inline-block", fontSize: 10.5, lineHeight: 1.35, fontWeight: 600, borderRadius: 7, padding: "2px 7px",
      color: tone === "rust" ? "var(--rust)" : "var(--muted)", border: `1px solid ${c}`, ...style,
    }}>{children}</span>
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

// ---------------------------------------------------------------------------
// Reading a bid
// ---------------------------------------------------------------------------

/** Why a bid isn't like-for-like. One list feeds the inbox line, the comparison,
 *  the award guard rail and the mobile cards, so a bid never reads one way on
 *  one screen and another way on the next. */
export function flagsFor(p: BidPackage, b: VendorBid): string[] {
  const out: string[] = [];
  if (p.pricingBasis && b.pricingBasis && b.pricingBasis !== p.pricingBasis) {
    out.push(`Priced as ${PRICING_BASIS_LABEL[b.pricingBasis].toLowerCase()}, not the ${PRICING_BASIS_LABEL[p.pricingBasis].toLowerCase()} basis this package went out on.`);
  }
  const missing = bidIntakeMissing(b);
  if (missing.length) out.push(`Not stated in their bid: ${missing.map((k) => INTAKE_LABEL[k].toLowerCase()).join(", ")}.`);
  // Only worth raising once the rest of the bid is in: a blank materials line on
  // a half-keyed bid is an unfinished form, not an exclusion.
  if (!b.materialsCost && bidIntakeComplete(b)) {
    out.push("No materials line — check whether materials are excluded before comparing on total.");
  }
  return out;
}

/** How a bid treats materials — the field that most often makes two totals look
 *  comparable when they aren't. */
export const materialsPolicy = (b: VendorBid) =>
  b.materialsCost ? `materials ${money(b.materialsCost)}` : "materials not priced";

export const contactOf = (db: DB, b: VendorBid): ContactSheet | undefined =>
  b.contactId ? db.contacts.find((c) => c.id === b.contactId) : undefined;

/** "Name · phone", the second line of every vendor row in this section. */
export const contactLine = (c?: ContactSheet) =>
  [c?.contactName, c?.phone].filter(Boolean).join(" · ") || "No contact details";

/** The internal review belongs to the vendor record, not to a bid — you rate the
 *  company once and read it everywhere. Bid Management only ever displays it. */
export function vendorReview(db: DB, b: VendorBid): { rating: string; note?: string; provenance: string } {
  const c = contactOf(db, b);
  const jobs = c?.jobsWithUs ?? 0;
  return {
    rating: c?.rating ? `${c.rating} / 5` : "No history",
    note: c?.internalNote?.trim() || undefined,
    provenance: `From the vendor record · ${jobs} job${jobs === 1 ? "" : "s"} with us`,
  };
}

// ---------------------------------------------------------------------------
// Mobile
// ---------------------------------------------------------------------------

/** The shell's own breakpoint, read after mount — there is no window on the
 *  server, and rendering the desktop layout first would flash the wrong thing. */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 880px)");
    const sync = () => setNarrow(mq.matches);
    sync();
    // resize as well as change: emulated viewports (device toolbars, embedded
    // previews) resize the page without ever firing the media-query event.
    mq.addEventListener("change", sync);
    window.addEventListener("resize", sync);
    return () => { mq.removeEventListener("change", sync); window.removeEventListener("resize", sync); };
  }, []);
  return narrow;
}

export interface TriageRow {
  id: string;
  title: string;
  /** Right-aligned figure or state — the one thing worth reading on a phone. */
  value?: string;
  meta?: string;
  flag?: string;
  on?: boolean;
  onClick?: () => void;
}

/** On a phone this module is triage, not data entry: whichever screen you are on
 *  collapses to one scannable list and one way forward. */
export function Triage({ rows, empty, back, next }: {
  rows: TriageRow[];
  empty?: string;
  back?: () => void;
  next?: { label: string; disabled?: boolean; onClick: () => void };
}) {
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {!rows.length && <div className="card" style={{ padding: 16, fontSize: 12.5, color: "var(--muted)" }}>{empty ?? "Nothing here yet."}</div>}
        {rows.map((r) => (
          <div key={r.id} className="card"
            role={r.onClick ? "button" : undefined} tabIndex={r.onClick ? 0 : undefined}
            onClick={r.onClick}
            onKeyDown={(e) => { if (r.onClick && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); r.onClick(); } }}
            style={{
              padding: 12, display: "flex", flexDirection: "column", gap: 4, cursor: r.onClick ? "pointer" : "default",
              background: r.on ? "var(--sage-tint)" : undefined, borderColor: r.on ? "var(--sage)" : undefined,
            }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
              <span className="serif" style={{ fontSize: 15, fontWeight: 700, color: "var(--walnut)", lineHeight: 1.2 }}>{r.title}</span>
              {r.value && <span className="serif" style={{ fontSize: 14, fontWeight: 700, color: "var(--walnut)", textAlign: "right", whiteSpace: "nowrap" }}>{r.value}</span>}
            </div>
            {r.meta && <span style={{ fontSize: 11.5, lineHeight: 1.4, color: "var(--muted)" }}>{r.meta}</span>}
            {r.flag && <span><Tag tone="rust">{r.flag}</Tag></span>}
          </div>
        ))}
      </div>
      {/* The primary action floats instead of sitting at the end of the list —
          on a long vendor directory it was a scroll away from every row. */}
      {next ? (
        <ActionBar
          summary={<><strong style={{ color: "var(--walnut)" }}>{rows.filter((r) => r.on).length}</strong> of {rows.length} picked</>}
          primary={{ label: next.label, disabled: next.disabled, onClick: next.onClick }}
          secondary={back ? { label: "← Back", onClick: back } : undefined}
        />
      ) : null}
      {/* Back stays in the flow only when there is no bar to carry it. */}
      {back && !next ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
          <button className="btn btn-sm" onClick={back}>← Back</button>
        </div>
      ) : null}
    </>
  );
}

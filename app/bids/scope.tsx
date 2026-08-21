"use client";

import { useMemo } from "react";
import { useStore } from "@/lib/data/hooks";
import {
  MATERIALS_BASIS_LABEL, PRICING_BASIS_LABEL, PRICING_BASIS_HINT, addWorkingDays,
  type BidPackage, type CostLine, type MaterialsBasis, type PricingBasis,
} from "@/lib/data/types";
import { romRows, tradeName, fmt } from "@/lib/data/money";
import { Kicker } from "./kit";
import { Pill } from "../ui/bits";

// ---------------------------------------------------------------------------
// Scope — what the vendors are being asked to price.
//
// Organised by budget line, because that is what the package is made of: a
// vendor reads "here is the work on Rough Carpentry, in these rooms, with
// these materials" rather than a flat list that has lost track of which line
// anything belongs to.
//
// Costs never appear. This document goes to people who are about to quote a
// price; showing them the budget is how you stop getting a real one.
// ---------------------------------------------------------------------------

const MUTED = "var(--muted)";
const fmtDate = (iso?: string) => iso
  ? new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  : "—";

export function ScopeScreen({ p, ro, onNext }: { p: BidPackage; ro: boolean; onBack?: () => void; onNext: () => void }) {
  const store = useStore();
  const db = store.db;

  // The budget lines this package is built from.
  const tradeIds = useMemo(() => [...new Set([p.tradeId, ...(p.tradeIds ?? [])])].filter(Boolean), [p]);
  const lines = useMemo(() => {
    const rows = romRows(db);
    return tradeIds.map((tid) => {
      const matching = rows.filter((r) => r.tradeId === tid);
      const costLines = matching.flatMap((r) => r.lines);
      const roomIds = [...new Set(costLines.flatMap((l: CostLine) => l.roomIds ?? []))];
      return {
        tradeId: tid,
        name: matching[0]?.label ?? tradeName(db, tid),
        // Scope text off the budget line — never its cost.
        scope: costLines.map((l: CostLine) => l.desc || l.contractSummary).filter(Boolean) as string[],
        rooms: roomIds.map((id) => db.rooms.find((x) => x.id === id)?.name).filter(Boolean) as string[],
        materials: db.materials.filter((m) => m.tradeId === tid),
      };
    });
  }, [db, tradeIds]);

  // The overview starts as what the budget lines already say, so the GC is
  // editing a draft rather than facing an empty box.
  const suggested = useMemo(() => lines
    .map((l) => {
      const bits = [l.scope.join(" ")].filter(Boolean);
      if (l.rooms.length) bits.push(`Rooms: ${l.rooms.join(", ")}.`);
      return `${l.name} — ${bits.join(" ") || "scope to be written."}`;
    })
    .join("\n\n"), [lines]);

  const gaps = [
    !((p.overview ?? "").trim() || (p.scopeDetails ?? "").trim()) && "an overview of the work",
    !p.materialsBasis && "who supplies the materials",
    !p.pricingBasis && "lump sum or time & materials",
    !p.returnBy && "a date you need the bid back",
  ].filter(Boolean) as string[];

  const set = (patch: Partial<BidPackage>) => store.updateBidPackage(p.id, patch);

  return (
    <>
      <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.6, maxWidth: "76ch" }}>
        This is the request. Everything here goes on the one-page document vendors price against,
        organised by the budget lines the package is built from. Costs are never on it.
      </div>

      {/* ---- overview ---- */}
      <div style={{ marginTop: 18 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <Kicker>Overview</Kicker>
          {!ro && !(p.overview ?? "").trim() && suggested ? (
            <button className="btn btn-sm" onClick={() => set({ overview: suggested })}>
              Start from the budget lines
            </button>
          ) : null}
        </div>
        <textarea
          className="input" disabled={ro}
          defaultValue={p.overview ?? suggested}
          key={p.overview ? "set" : "suggested"}
          onBlur={(e) => set({ overview: e.target.value })}
          placeholder="What is being built, how it sits in the programme, and what done looks like."
          style={{ width: "100%", minHeight: 130, fontSize: 13, lineHeight: 1.55, marginTop: 5 }}
        />
        <div style={{ fontSize: 11.5, color: MUTED, marginTop: 4, lineHeight: 1.5, maxWidth: "74ch" }}>
          Pre-filled from the budget lines below — their scope and rooms, never their cost. Add what a
          vendor needs that the budget does not say: access, sequencing, site conditions, what
          &ldquo;finished&rdquo; means here.
        </div>
      </div>

      {/* ---- the work, one budget line at a time ---- */}
      <div style={{ marginTop: 20 }}>
        <Kicker>The work — {lines.length} budget line{lines.length === 1 ? "" : "s"}</Kicker>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 7 }}>
          {lines.map((l) => (
            <div key={l.tradeId} className="card" style={{ padding: 14 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <strong className="serif" style={{ fontSize: 15.5, color: "var(--walnut)" }}>{l.name}</strong>
                <span style={{ fontSize: 11.5, color: MUTED }}>
                  {l.materials.length} material{l.materials.length === 1 ? "" : "s"}
                </span>
              </div>

              <div style={{ fontSize: 10, letterSpacing: ".09em", textTransform: "uppercase", color: MUTED, marginTop: 10 }}>Rooms in scope</div>
              <div style={{ fontSize: 12.5, lineHeight: 1.5, marginTop: 2 }}>
                {l.rooms.length ? l.rooms.join(" · ") : <em style={{ color: MUTED }}>Whole project — no rooms marked.</em>}
              </div>

              <div style={{ fontSize: 10, letterSpacing: ".09em", textTransform: "uppercase", color: MUTED, marginTop: 10 }}>Scope</div>
              {l.scope.length
                ? l.scope.map((sc, i) => <div key={i} style={{ fontSize: 12.5, lineHeight: 1.55, marginTop: 2 }}>{sc}</div>)
                : <div style={{ fontSize: 12, color: MUTED, fontStyle: "italic", marginTop: 2 }}>
                    Nothing written on this budget line yet — describe it in the overview above, or add it on the line itself.
                  </div>}

              <div style={{ fontSize: 10, letterSpacing: ".09em", textTransform: "uppercase", color: MUTED, marginTop: 10 }}>
                Materials on this line
              </div>
              {!l.materials.length ? (
                <div style={{ fontSize: 12, color: MUTED, fontStyle: "italic", marginTop: 2 }}>
                  None listed. Leave empty if the vendor takes off their own quantities.
                </div>
              ) : (
                <div style={{ marginTop: 3 }}>
                  {l.materials.slice(0, 12).map((m) => (
                    <div key={m.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "3px 0", borderBottom: "1px solid var(--line)", fontSize: 12 }}>
                      <span>{m.qty && m.qty > 1 ? `${m.qty} × ` : ""}{m.item}{m.roomLabel ? <span style={{ color: MUTED }}> · {m.roomLabel}</span> : null}</span>
                      <span style={{ color: MUTED, whiteSpace: "nowrap" }}>
                        {m.purchaser === "owner" ? "owner supplies" : m.purchaser === "trade" ? "trade supplies" : "builder supplies"}
                      </span>
                    </div>
                  ))}
                  {l.materials.length > 12 ? (
                    <div style={{ fontSize: 11.5, color: MUTED, marginTop: 4 }}>+{l.materials.length - 12} more on the materials list</div>
                  ) : null}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ---- the terms every bid is priced on ---- */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginTop: 20 }}>
        <div>
          <Kicker>Who supplies materials</Kicker>
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 5 }}>
            {(Object.keys(MATERIALS_BASIS_LABEL) as MaterialsBasis[]).map((k) => (
              <button key={k} className="btn btn-sm" disabled={ro} onClick={() => set({ materialsBasis: k })}
                style={{
                  justifyContent: "flex-start", textAlign: "left",
                  background: p.materialsBasis === k ? "var(--sage)" : undefined,
                  color: p.materialsBasis === k ? "#fff" : undefined,
                  fontWeight: p.materialsBasis === k ? 700 : 400,
                }}>{MATERIALS_BASIS_LABEL[k]}</button>
            ))}
          </div>

          <Kicker style={{ marginTop: 14 }}>Pricing basis</Kicker>
          <div style={{ display: "flex", gap: 5, marginTop: 5, flexWrap: "wrap" }}>
            {(Object.keys(PRICING_BASIS_LABEL) as PricingBasis[]).map((k) => (
              <button key={k} className="btn btn-sm" disabled={ro} onClick={() => set({ pricingBasis: k })}
                title={PRICING_BASIS_HINT[k]}
                style={{
                  background: p.pricingBasis === k ? "var(--sage)" : undefined,
                  color: p.pricingBasis === k ? "#fff" : undefined,
                  fontWeight: p.pricingBasis === k ? 700 : 400,
                }}>{PRICING_BASIS_LABEL[k]}</button>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: MUTED, marginTop: 5, lineHeight: 1.5 }}>
            {p.pricingBasis ? PRICING_BASIS_HINT[p.pricingBasis] : "Every bid comes back on this basis. One that arrives the other way is flagged, never converted."}
          </div>
        </div>

        <div>
          <Kicker>Dates</Kicker>
          <div style={{ display: "flex", gap: 12, marginTop: 5, flexWrap: "wrap" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 11, color: MUTED }}>Bid back by</span>
              <input type="date" className="input" disabled={ro} defaultValue={p.returnBy ?? ""}
                onBlur={(e) => set({ returnBy: e.target.value })} style={{ fontSize: 12.5 }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 11, color: MUTED }}>On site from</span>
              <input type="date" className="input" disabled={ro} defaultValue={p.expectedStart ?? ""}
                onBlur={(e) => set({ expectedStart: e.target.value })} style={{ fontSize: 12.5 }} />
            </label>
          </div>
          {p.expectedStart ? (
            <div style={{ fontSize: 11.5, color: MUTED, marginTop: 5 }}>
              A 10-day bid starting {fmtDate(p.expectedStart)} would finish {fmtDate(addWorkingDays(p.expectedStart, 10))} — weekends skipped.
            </div>
          ) : null}

          <Kicker style={{ marginTop: 14 }}>Not in this scope</Kicker>
          <textarea className="input" disabled={ro} defaultValue={p.exclusions ?? ""}
            onBlur={(e) => set({ exclusions: e.target.value })}
            placeholder="Work you expect others to do — so they don't price it, and it doesn't become a change order."
            style={{ width: "100%", minHeight: 74, fontSize: 12.5, lineHeight: 1.5, marginTop: 5 }} />
        </div>
      </div>

      {/* ---- the floating progress control ---- */}
      {!ro ? (
        <>
          <div className="ever-scopebar" style={{
            position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 60,
            background: "var(--paper)", borderTop: "1px solid var(--line)",
            boxShadow: "0 -6px 22px rgba(44,36,28,.10)",
            padding: "10px 18px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          }}>
            <div style={{ flex: 1, minWidth: 220, fontSize: 12, color: MUTED, lineHeight: 1.45 }}>
              {gaps.length
                ? <>Still needed: <strong style={{ color: "var(--brass-2)" }}>{gaps.join(", ")}</strong>. You can proceed and come back.</>
                : <span style={{ color: "var(--sage-2)", fontWeight: 600 }}>✓ Ready to send to vendors.</span>}
            </div>
            {gaps.length ? <Pill color="var(--walnut)" bg="#f7f1e2">{gaps.length} to fill in</Pill> : null}
            <button className="btn btn-primary btn-sm" onClick={onNext} style={{ fontWeight: 700 }}>
              Save and proceed to Add New Vendors to Bid →
            </button>
          </div>
          <div style={{ height: 76 }} />
          <style>{`
            @media (max-width: 860px) {
              .ever-scopebar { bottom: calc(env(safe-area-inset-bottom, 0px) + 56px) !important; }
            }
          `}</style>
        </>
      ) : null}
    </>
  );
}

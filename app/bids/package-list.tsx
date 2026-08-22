"use client";

import { useMemo } from "react";
import { useStore } from "@/lib/data/hooks";
import type { BidPackage, CostLine, DB } from "@/lib/data/types";
import { fmt, tradeName, lineBase, lineTotal, lineDrawn, linePaid, approvedNetChange } from "@/lib/data/money";
import { Pill, StatCard } from "../ui/bits";

// ---------------------------------------------------------------------------
// The package list — every package, banded by whether it is still being bid or
// already in place.
//
// A package's money is not stored on the package: it is read off the budget
// line the award landed on. So the list cannot disagree with Budget
// Management, because it is the same figures seen from the other end.
// ---------------------------------------------------------------------------

const MUTED = "var(--muted)";

export type PkgRow = {
  p: BidPackage;
  no: number;
  inPlace: boolean;
  vendor: string | null;
  line?: CostLine;
  awarded: number;
  changeOrders: number;
  total: number;
  drawn: number;
  remaining: number;
  bidsIn: number;
  invited: number;
  status: string;
  /** Draws scheduled beyond what is left on the line — flagged, not corrected. */
  over: number;
};

export function packageRows(db: DB): PkgRow[] {
  const pkgs = db.bidPackages ?? [];
  return pkgs
    .map((p, i) => {
      const won = p.bids?.find((b) => b.id === p.awardedBidId);
      const line = p.lineId ? db.costLines.find((l) => l.id === p.lineId) : undefined;
      const awarded = won?.amount ?? 0;
      const changeOrders = line ? approvedNetChange(line) : 0;
      const fee = line ? lineTotal(line) - lineBase(line) : 0;
      const total = line ? lineBase(line) + changeOrders + fee : awarded;
      const drawn = line ? lineDrawn(db, line.id) : 0;
      const paid = line ? linePaid(db, line) : 0;
      const inPlace = !!p.awardedBidId;
      const bidsIn = (p.bids ?? []).filter((b) => typeof b.amount === "number").length;
      return {
        p, no: i + 1, inPlace, line,
        vendor: won?.vendorName ?? null,
        awarded, changeOrders, total, drawn,
        remaining: Math.max(0, total - paid),
        bidsIn, invited: (p.bids ?? []).length,
        status: !inPlace
          ? (p.status === "draft" ? "Drafting" : bidsIn ? `${bidsIn} bid${bidsIn === 1 ? "" : "s"} in` : "Bidding")
          : line ? "Awarded · in progress" : "Awarded · no line",
        over: Math.max(0, drawn - total),
      };
    })
    // In place first inside the bands; newest package last so numbering reads.
    .sort((a, b) => Number(b.inPlace) - Number(a.inPlace) || (a.vendor ?? "").localeCompare(b.vendor ?? "") || a.no - b.no);
}

export function PackageList({ onOpen, onNew, canEdit }: {
  onOpen: (id: string) => void; onNew: () => void; canEdit: boolean;
}) {
  const store = useStore();
  const db = store.db;
  const rows = useMemo(() => packageRows(db), [db]);

  const t = rows.reduce((a, r) => ({
    // An unawarded package contributes nothing: a figure only enters the
    // roll-up once a contract stands behind it.
    committed: a.committed + (r.inPlace ? r.total : 0),
    changeOrders: a.changeOrders + r.changeOrders,
    drawn: a.drawn + r.drawn,
    remaining: a.remaining + (r.inPlace ? r.remaining : 0),
    awardedCount: a.awardedCount + (r.inPlace ? 1 : 0),
  }), { committed: 0, changeOrders: 0, drawn: 0, remaining: 0, awardedCount: 0 });
  const bidding = rows.filter((r) => !r.inPlace);
  const inPlace = rows.filter((r) => r.inPlace);
  const vendors = new Set(rows.map((r) => r.vendor).filter(Boolean)).size;

  const band = (label: string, color: string, list: PkgRow[]) => list.length ? (
    <>
      <tr>
        <td colSpan={7} style={{ padding: "10px 10px 4px" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: MUTED }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: color }} />
            {label} — {list.length}
          </span>
        </td>
      </tr>
      {list.map((r) => <Row key={r.p.id} r={r} onOpen={onOpen} />)}
    </>
  ) : null;

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(165px, 1fr))", gap: 10, marginTop: 16 }}>
        <StatCard label="Total committed" value={fmt(t.committed)} sub="awards plus approved change orders" accent="var(--walnut)" />
        <StatCard label="Awarded" value={`${t.awardedCount} of ${rows.length}`} sub={vendors ? `${vendors} vendor${vendors === 1 ? "" : "s"}` : "no vendors yet"} />
        <StatCard label="Change orders" value={t.changeOrders ? fmt(t.changeOrders) : "—"} sub={t.changeOrders ? "approved, on awarded lines" : "none approved"} accent={t.changeOrders ? "var(--rust)" : undefined} />
        <StatCard label="Drawn" value={fmt(t.drawn)} accent="var(--ok)"
          sub={t.committed ? `${Math.round((t.drawn / t.committed) * 100)}% released` : "nothing committed yet"} />
        <StatCard label="Remaining to draw" value={fmt(t.remaining)} sub="committed, not yet paid" />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "18px 0 6px" }}>
        <div style={{ fontSize: 12.5, color: MUTED, flex: 1, minWidth: 220 }}>
          {rows.length} package{rows.length === 1 ? "" : "s"} · {bidding.length} bidding, {inPlace.length} in place
        </div>
        {canEdit ? <button className="btn btn-sm btn-primary" onClick={onNew}>＋ New package</button> : null}
      </div>

      {!rows.length ? (
        <div className="card" style={{ padding: 20, fontSize: 12.5, color: MUTED }}>
          No packages yet. A package is one scope of work put out to bid — start the first one above.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 0, fontSize: 12.5 }}>
            <thead>
              <tr>
                {/* On a phone only vendor, package and total survive — the rest
                    are in the package itself, one tap away. */}
                {["Vendor", "Package & trades", "Awarded", "Change orders", "Total", "Drawn", "Remaining"].map((h, i) => (
                  <th key={h} className={[2, 3, 5, 6].includes(i) ? "m-hide" : undefined} style={{
                    textAlign: i < 2 ? "left" : "right", padding: "7px 10px", whiteSpace: "nowrap",
                    fontSize: 10, letterSpacing: ".09em", textTransform: "uppercase", color: MUTED,
                    borderBottom: "1px solid var(--line)",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {band("Bidding", "var(--brass)", bidding)}
              {band("In place", "var(--sage)", inPlace)}
              <tr style={{ borderTop: "2px solid var(--line)", fontWeight: 700 }}>
                <td style={{ padding: "9px 10px" }}>{vendors} vendor{vendors === 1 ? "" : "s"}</td>
                <td style={{ padding: "9px 10px" }}>Total — {rows.length} packages</td>
                <Num v={rows.reduce((a, r) => a + (r.inPlace ? r.awarded : 0), 0)} bold hide />
                <Num v={t.changeOrders} bold hide />
                <Num v={t.committed} bold />
                <Num v={t.drawn} bold hide />
                <Num v={t.remaining} bold hide />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontSize: 11.5, lineHeight: 1.55, color: MUTED, marginTop: 10, maxWidth: "80ch" }}>
        An unawarded package contributes nothing to the roll-up — a figure only enters the total once
        a contract stands behind it. Every figure here is read off the budget line the award landed
        on, so this and Budget Management cannot disagree.
      </div>
    </>
  );
}

function Row({ r, onOpen }: { r: PkgRow; onOpen: (id: string) => void }) {
  const store = useStore();
  const db = store.db;
  const trades = [...new Set([r.p.tradeId, ...(r.p.tradeIds ?? [])])].filter(Boolean);

  return (
    <tr onClick={() => onOpen(r.p.id)} style={{ cursor: "pointer", borderBottom: "1px solid var(--line)" }}>
      <td style={{ padding: "9px 10px" }}>
        {r.vendor
          ? <strong style={{ color: "var(--walnut)" }}>{r.vendor}</strong>
          : <span style={{ color: "var(--rust)" }}>Not awarded</span>}
        <div style={{ fontSize: 10.5, color: MUTED, marginTop: 2 }}>
          {r.inPlace ? r.status : `${r.invited} invited · ${r.bidsIn} in`}
        </div>
      </td>
      <td style={{ padding: "9px 10px", minWidth: 220 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600 }}>{r.p.title}</span>
          {r.over > 0 ? <Pill color="#fff" bg="var(--rust)">over by {fmt(r.over)}</Pill> : null}
        </div>
        <div style={{ fontSize: 10.5, color: MUTED, marginTop: 2 }}>
          Pkg {String(r.no).padStart(2, "0")} · {trades.map((t) => tradeName(db, t)).join(" + ") || "no trade"}
        </div>
        {/* What the hidden columns said, for the phone. */}
        <div className="m-only" style={{ fontSize: 10.5, color: MUTED, marginTop: 3, gap: 8, flexWrap: "wrap" }}>
          {r.awarded ? <span>awarded {fmt(r.awarded)}</span> : null}
          {r.changeOrders ? <span>· COs {fmt(r.changeOrders)}</span> : null}
          {r.drawn ? <span>· drawn {fmt(r.drawn)}</span> : null}
          {r.remaining ? <span>· {fmt(r.remaining)} left</span> : null}
        </div>
      </td>
      <Num v={r.awarded} hide />
      <Num v={r.changeOrders} hide />
      <Num v={r.total} bold />
      <Num v={r.drawn} hide />
      <Num v={r.remaining} hide />
    </tr>
  );
}

function Num({ v, bold, hide }: { v: number; bold?: boolean; hide?: boolean }) {
  return (
    <td className={hide ? "m-hide" : undefined} style={{
      padding: "9px 10px", textAlign: "right", whiteSpace: "nowrap",
      fontVariantNumeric: "tabular-nums", fontWeight: bold ? 700 : 400,
      color: v === 0 && !bold ? MUTED : "var(--ink)",
    }}>{v === 0 && !bold ? "—" : fmt(v)}</td>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/data/hooks";
import { vendorCovers, type CostLine } from "@/lib/data/types";
import { fmt, romRows, tradeName, macroOrder, tradePhaseDates, type RomRow } from "@/lib/data/money";
import { Pill, StatCard } from "../ui/bits";

// ---------------------------------------------------------------------------
// Building a package out of budget lines.
//
// A GC does not pick trades in the abstract — they bundle work that ONE vendor
// can price and mobilise for once. So the question this screen answers is not
// "which trades?" but "what can sensibly go out together?", and the binding
// constraint is coverage: if nobody in the roster covers every line you have
// picked, you have made something nobody can bid.
//
// The money that matters is what is left to bid — the agreed ROM ceiling less
// whatever is already under contract. That is the number a bid has to come in
// under, and it is the only figure a GC is actually holding in their head.
// ---------------------------------------------------------------------------

const MUTED = "var(--muted)";

type Candidate = {
  row: RomRow;
  /** Agreed ceiling less what is already contracted — what is left to bid. */
  remaining: number;
  rooms: string[];
  window?: { start?: string; end?: string };
  /** Vendors in the roster who cover this trade. */
  coverage: number;
  /** Why this line cannot go out to bid, if it cannot. */
  blocked?: string;
};

export function BundlePicker({ ro, onCreated }: { ro: boolean; onCreated: (id: string) => void }) {
  const store = useStore();
  const db = store.db;
  const [picked, setPicked] = useState<string[]>([]);
  const [title, setTitle] = useState("");

  const candidates = useMemo<Candidate[]>(() => {
    const openPkgTrades = new Set(
      (db.bidPackages ?? []).filter((p) => !p.awardedBidId)
        .flatMap((p) => [p.tradeId, ...(p.tradeIds ?? [])]),
    );
    // A trade priced two ways is two budget rows but ONE thing to bid, so the
    // rows are merged back together here. Keying candidates by trade also
    // keeps the selection unambiguous — a package bundles trades.
    const merged = new Map<string, RomRow>();
    for (const r of romRows(db).filter((x) => x.state !== "removed")) {
      const prev = merged.get(r.tradeId);
      if (!prev) { merged.set(r.tradeId, { ...r }); continue; }
      merged.set(r.tradeId, {
        ...prev,
        lines: [...prev.lines, ...r.lines],
        romFigure: prev.romFigure + r.romFigure,
        allIn: prev.allIn + r.allIn,
        contracted: prev.contracted + r.contracted,
        lockedCount: prev.lockedCount + r.lockedCount,
        committed: prev.committed || r.committed,
        complete: prev.complete && r.complete,
      });
    }
    return [...merged.values()]
      .map((r) => {
        const rooms = [...new Set(r.lines.flatMap((l: CostLine) => l.roomIds ?? []))]
          .map((id) => db.rooms.find((x) => x.id === id)?.name).filter(Boolean) as string[];
        const coverage = db.contacts.filter((c) => c.party === "vendor" && vendorCovers(c, r.tradeId)).length;
        const remaining = Math.max(0, (r.committed ? r.romFigure : r.allIn) - r.contracted);
        const blocked = r.complete ? "paid in full"
          : r.state === "hold" ? "on hold"
          : openPkgTrades.has(r.tradeId) ? "already in a package"
          : r.contracted > 0 && r.lockedCount === r.lines.length ? "fully contracted"
          : undefined;
        return { row: r, remaining, rooms, coverage, window: tradePhaseDates(db, r.tradeId), blocked };
      })
      .sort((a, b) => b.remaining - a.remaining);
  }, [db]);

  const byId = new Map(candidates.map((c) => [c.row.tradeId, c]));
  const chosen = picked.map((id) => byId.get(id)).filter(Boolean) as Candidate[];

  // The constraint that decides whether a bundle is real: who covers ALL of it.
  const coversAll = db.contacts.filter((c) =>
    c.party === "vendor" && picked.length > 0 && picked.every((tid) => vendorCovers(c, tid)));
  const ceiling = chosen.reduce((a, c) => a + c.remaining, 0);
  const sharedRooms = chosen.length > 1
    ? chosen.map((c) => new Set(c.rooms)).reduce((a, b) => new Set([...a].filter((x) => b.has(x))))
    : new Set(chosen[0]?.rooms ?? []);

  const toggle = (tid: string) => setPicked((p) => p.includes(tid) ? p.filter((x) => x !== tid) : [...p, tid]);

  const create = () => {
    if (!picked.length) return;
    const primary = picked[0];
    const name = title.trim() || (picked.length === 1
      ? `${tradeName(db, primary)} — ${db.project.name}`
      : `${chosen.map((c) => tradeName(db, c.row.tradeId)).join(" + ")} — ${db.project.name}`);
    const id = store.addBidPackage({
      title: name,
      tradeId: primary,
      tradeIds: picked,
      // Every room any bundled trade is scoped into rides along, so an award
      // lands on a budget line that knows where the work is.
      roomIds: [...new Set(picked.flatMap((tid) =>
        db.scope.filter((c) => c.tradeId === tid && c.status === "in").map((c) => c.roomId)))],
      scopeDetails: "",
      pricingBasis: "lump",
    });
    if (id) onCreated(id);
  };

  const groups = macroOrder(db)
    .map((cat) => ({ cat, items: candidates.filter((c) => c.row.category === cat) }))
    .filter((g) => g.items.length);

  return (
    <>
      <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.6, maxWidth: "76ch", marginBottom: 14 }}>
        Pick the budget lines going out together. Bundle work one vendor can price and mobilise for
        once — lines in the same rooms, in the same part of the programme. The figure that matters is
        what is <strong>left to bid</strong>: the agreed ceiling less anything already contracted.
      </div>

      {/* The live read on the bundle, including whether it can be bid at all. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 14 }}>
        <StatCard label="Lines picked" value={String(picked.length)}
          sub={picked.length ? chosen.map((c) => tradeName(db, c.row.tradeId)).join(" + ").slice(0, 44) : "nothing yet"} />
        <StatCard label="Budget to bid against" value={fmt(ceiling)} accent="var(--brass-2)"
          sub={picked.length ? "combined, less what is contracted" : "pick a line"} />
        <StatCard label="Vendors who cover it all" value={String(coversAll.length)}
          accent={picked.length && !coversAll.length ? "var(--rust)" : "var(--ok)"}
          sub={!picked.length ? "pick a line"
            : coversAll.length ? coversAll.map((c) => c.company).join(", ").slice(0, 40)
            : "nobody can bid this bundle"} />
        <StatCard label="Rooms in common" value={String(sharedRooms.size)}
          sub={sharedRooms.size ? [...sharedRooms].join(", ").slice(0, 40) : picked.length > 1 ? "none shared" : "—"} />
      </div>

      {picked.length > 1 && !coversAll.length ? (
        <div className="card" style={{ padding: 12, marginBottom: 14, borderLeft: "3px solid var(--rust)", fontSize: 12.5, lineHeight: 1.55, maxWidth: "74ch" }}>
          <strong style={{ color: "var(--rust)" }}>Nobody in the roster covers all of these.</strong> You can still create it —
          a vendor can be invited anyway, and coverage is editable on their profile — but as it stands
          this bundle has nobody to price it. Splitting it, or widening a vendor&rsquo;s trades in
          Administrative, both fix it.
        </div>
      ) : null}

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 0, fontSize: 12.5 }}>
          <thead>
            <tr>
              {/* Rooms, dates and coverage drop below 700px — they are under
                  the budget line's own name there. */}
              {["", "Budget line", "Left to bid", "Rooms", "On site", "Who can bid it"].map((h, i) => (
                <th key={h || i} className={i >= 3 ? "m-hide" : undefined} style={{
                  textAlign: i === 2 ? "right" : "left", padding: "7px 10px", whiteSpace: "nowrap",
                  fontSize: 10, letterSpacing: ".09em", textTransform: "uppercase", color: MUTED,
                  borderBottom: "1px solid var(--line)",
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(({ cat, items }) => (
              <>
                <tr key={cat}>
                  <td colSpan={6} style={{ padding: "10px 10px 4px", fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: MUTED }}>
                    {cat}
                  </td>
                </tr>
                {items.map((c) => {
                  const on = picked.includes(c.row.tradeId);
                  return (
                    <tr key={c.row.tradeId}
                      onClick={() => !ro && !c.blocked && toggle(c.row.tradeId)}
                      style={{
                        cursor: ro || c.blocked ? "default" : "pointer",
                        borderBottom: "1px solid var(--line)",
                        background: on ? "var(--sage-tint)" : undefined,
                        opacity: c.blocked ? 0.5 : 1,
                      }}>
                      <td style={{ padding: "8px 10px", width: 28 }}>
                        {c.blocked ? null : (
                          <span style={{
                            display: "inline-flex", width: 16, height: 16, borderRadius: 4, alignItems: "center", justifyContent: "center",
                            border: `1px solid ${on ? "var(--sage)" : "var(--line)"}`, background: on ? "var(--sage)" : "var(--paper)",
                            color: "#fff", fontSize: 11,
                          }}>{on ? "✓" : ""}</span>
                        )}
                      </td>
                      <td style={{ padding: "8px 10px" }}>
                        <strong style={{ color: "var(--walnut)" }}>{c.row.label}</strong>
                        <div style={{ fontSize: 10.5, color: MUTED, marginTop: 2 }}>
                          {c.blocked
                            ? c.blocked
                            : c.row.committed ? `agreed ${fmt(c.row.romFigure)}` : "ROM not agreed yet"}
                          {c.row.contracted > 0 && !c.blocked ? ` · ${fmt(c.row.contracted)} contracted` : ""}
                        </div>
                        {/* What the dropped columns said. */}
                        <div className="m-only" style={{ fontSize: 10.5, color: MUTED, marginTop: 2, gap: 6, flexWrap: "wrap" }}>
                          <span>{c.rooms.length ? c.rooms.slice(0, 2).join(", ") + (c.rooms.length > 2 ? ` +${c.rooms.length - 2}` : "") : "whole project"}</span>
                        </div>
                      </td>
                      <td style={{ padding: "8px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                        {c.blocked ? "—" : fmt(c.remaining)}
                      </td>
                      <td className="m-hide" style={{ padding: "8px 10px", fontSize: 11.5, color: MUTED, maxWidth: 200 }}>
                        {c.rooms.length ? c.rooms.slice(0, 3).join(", ") + (c.rooms.length > 3 ? ` +${c.rooms.length - 3}` : "") : "whole project"}
                      </td>
                      <td style={{ padding: "8px 10px", fontSize: 11.5, color: MUTED, whiteSpace: "nowrap" }}>
                        {c.window?.start ? `${c.window.start} → ${c.window.end ?? "?"}` : "not scheduled"}
                      </td>
                      <td style={{ padding: "8px 10px" }}>
                        {c.coverage
                          ? <span style={{ fontSize: 11.5 }}>{c.coverage} vendor{c.coverage === 1 ? "" : "s"}</span>
                          : <Pill color="#fff" bg="var(--rust)">nobody covers it</Pill>}
                      </td>
                    </tr>
                  );
                })}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* The action floats, the way a cart bar does: a selection made at the top
          of forty lines should not need a scroll to the bottom to act on. It
          appears only once something is picked, so an untouched screen is just
          the table. */}
      {!ro && picked.length > 0 ? (
        <div className="ever-actionbar">
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", minWidth: 0 }}>
            <strong style={{ fontSize: 13.5, color: "var(--walnut)" }}>
              {picked.length} line{picked.length === 1 ? "" : "s"}
            </strong>
            <span style={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
              <span style={{ color: MUTED }}>to bid </span><strong>{fmt(ceiling)}</strong>
            </span>
            <span style={{ fontSize: 12, color: coversAll.length ? "var(--sage-2)" : "var(--rust)", fontWeight: 600 }}>
              {coversAll.length
                ? `${coversAll.length} vendor${coversAll.length === 1 ? "" : "s"} can bid it`
                : "nobody can bid this bundle"}
            </span>
            {picked.length > 1 && sharedRooms.size > 0 ? (
              <span style={{ fontSize: 12, color: MUTED }}>{sharedRooms.size} room{sharedRooms.size === 1 ? "" : "s"} shared</span>
            ) : null}
          </div>

          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder={chosen.map((c) => tradeName(db, c.row.tradeId)).join(" + ").slice(0, 40) || "Package name"}
            style={{ flex: 1, minWidth: 160, maxWidth: 320, fontSize: 12.5 }} />

          <button className="btn btn-sm" onClick={() => { setPicked([]); setTitle(""); }}>Clear</button>
          <button className="btn btn-primary btn-sm" onClick={create} style={{ fontWeight: 700 }}>
            {picked.length === 1 ? "Create the package" : `Bundle ${picked.length} lines`} →
          </button>
        </div>
      ) : null}

      {/* Room for the bar so the last rows are never hidden behind it. */}
      {!ro && picked.length > 0 ? <div style={{ height: 76 }} /> : null}

      <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.55, marginTop: 10, maxWidth: "78ch" }}>
        Lines already in an open package, fully contracted, on hold or paid in full are shown but not
        selectable — they have nothing left to put out. Grouping follows the budget&rsquo;s own categories,
        which is how trades bundle in practice; rooms and the on-site window are the signals for
        whether a specific bundle makes sense.
      </div>
    </>
  );
}

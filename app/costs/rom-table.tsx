"use client";

import { useState } from "react";
import { useStore } from "@/lib/data/hooks";
import { accessFor } from "@/lib/data/types";
import { fmt, romRows, romTotals, romCanLock, type RomRow } from "@/lib/data/money";
import { Pill, StatCard, TextInput } from "../ui/bits";

// ---------------------------------------------------------------------------
// The ROM table — one row per trade, richest first.
//
// Read-only in this first cut, deliberately. The whole model goes in over live
// figures with nothing writable and the lock not thrown, so it can be read
// against the real budget and backed out of before any of it is irreversible.
// ---------------------------------------------------------------------------

const MUTED = "var(--muted)";

export function RomTable() {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const user = store.currentUser;
  const [open, setOpen] = useState<string | null>(null);

  if (accessFor(user, role, "costs") === "none") return null;

  const rows = romRows(db);
  const t = romTotals(db);
  if (!rows.length) return null;

  // The owner agrees a figure; the builder declares them all agreed. Neither
  // does the other's job.
  const canCommit = !db.romLocked && ["full_admin", "owner"].includes(role);
  const canLock = ["full_admin", "builder"].includes(role);
  // The builder writes the assumption; the owner reads it before agreeing.
  const canNote = !db.romLocked && canLock;
  const ready = romCanLock(db);

  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 className="serif" style={{ fontSize: 19, fontWeight: 700, color: "var(--walnut)", margin: 0 }}>The ROM</h2>
          <div style={{ fontSize: 12.5, color: MUTED, marginTop: 3, lineHeight: 1.5, maxWidth: "68ch" }}>
            One line per trade, from the figure the owner agrees through to what has been paid.
            {db.romLocked
              ? " The ROM is locked — the budget is negotiated inside the packages now."
              : " Nothing here is writable yet: this is the model over your real figures, to be read before it goes live."}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Pill color="#fff" bg={db.romLocked ? "var(--walnut)" : "var(--brass)"}>
            {db.romLocked ? `ROM locked ${db.romLockedAt ?? ""}`.trim() : "Drafting the ROM"}
          </Pill>
          {canLock && !db.romLocked ? (
            <button
              className={`btn btn-sm ${ready ? "btn-primary" : ""}`}
              disabled={!ready}
              title={ready ? undefined : `${t.rows - t.committedRows} line(s) still with the owner`}
              onClick={() => {
                if (confirm(`Lock the ROM at ${fmt(t.agreed)}?

It does not move again. From here the budget is negotiated inside the packages, and a signed package changes only through a change order.`)) store.lockRom();
              }}
            >{ready ? "🔒 Lock the ROM" : `${t.rows - t.committedRows} still with the owner`}</button>
          ) : null}
        </div>
      </div>

      {/* Four cards. "Agreed" counts only committed lines — an uncommitted
          figure is not something the owner has signed up to. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10, marginTop: 14 }}>
        <StatCard label="ROM agreed, all-in" value={fmt(t.agreed)}
          sub={`${t.committedRows} of ${t.rows} lines committed`} accent="var(--brass-2)" />
        <StatCard label="Under contract" value={fmt(t.underContract)}
          sub={t.agreed > 0
            ? `${Math.round((t.underContractCommitted / t.agreed) * 100)}% of the agreed ceiling, on committed lines`
            : "nothing agreed yet"} />
        <StatCard label="Paid" value={fmt(t.paid)} accent="var(--ok)"
          sub={`${fmt(Math.max(0, t.underContract - t.paid))} still to draw`} />
        <StatCard label="Variance on priced trades" value={t.variance === 0 ? "—" : fmt(t.variance)}
          accent={t.variance > 0 ? "var(--rust)" : "var(--ok)"}
          sub={t.committedRows ? "against the agreed figure" : "nothing committed to measure yet"} />
      </div>

      <div style={{ overflowX: "auto", marginTop: 14 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 860, fontSize: 12.5 }}>
          <thead>
            <tr>
              {["Budget line", "ROM, agreed", "Under contract", "Change orders", "Paid", "Remaining", "Variance"].map((h, i) => (
                <th key={h} style={{
                  textAlign: i === 0 ? "left" : "right", padding: "7px 10px", whiteSpace: "nowrap",
                  fontSize: 10, letterSpacing: ".09em", textTransform: "uppercase", color: MUTED,
                  borderBottom: "1px solid var(--line)",
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Row key={r.key} r={r} canCommit={canCommit} canNote={canNote} on={open === r.key} onToggle={() => setOpen(open === r.key ? null : r.key)} />
            ))}
            <tr style={{ borderTop: "2px solid var(--line)", fontWeight: 700 }}>
              <td style={{ padding: "9px 10px" }}>Total — {t.rows} lines</td>
              <Num v={t.agreed} bold />
              <Num v={t.underContract} bold />
              <Num v={t.changeOrders} bold />
              <Num v={t.paid} bold />
              <Num v={t.remaining} bold />
              <td style={{ padding: "9px 10px", textAlign: "right", color: t.variance > 0 ? "var(--rust)" : "var(--ok)" }}>
                {t.variance === 0 ? "—" : fmt(t.variance)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 11.5, lineHeight: 1.55, color: MUTED, marginTop: 10, maxWidth: "78ch" }}>
        Under contract is locked lines plus approved change orders — nothing lands in that column
        without a contract behind it. A range counts as met anywhere inside it, so variance only
        appears once a priced figure falls above the ceiling or below the floor. A line the owner
        has not committed carries no variance at all.
        {romCanLock(db) ? " Every line is committed — the ROM is ready to lock." : ""}
      </div>
    </div>
  );
}

function Row({ r, canCommit, canNote, on, onToggle }: { r: RomRow; canCommit: boolean; canNote: boolean; on: boolean; onToggle: () => void }) {
  const store = useStore();
  const agreed = r.ranged
    ? <span>{fmt(r.low)}<span style={{ color: MUTED }}> – </span>{fmt(r.high)}</span>
    : fmt(r.high);
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer", borderBottom: "1px solid var(--line)", background: on ? "var(--cream)" : undefined }}>
        <td style={{ padding: "9px 10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, color: MUTED }}>{on ? "▾" : "▸"}</span>
            <strong style={{ color: "var(--walnut)" }}>{r.label}</strong>
            {r.lines.length > 1 ? <span style={{ fontSize: 10.5, color: MUTED }}>{r.lines.length} lines</span> : null}
            <Pill color="#fff" bg={r.committed ? "var(--sage)" : "var(--brass)"}>
              {r.committed ? (r.autoCommitted ? "Committed — under contract" : "Committed") : "Draft — with the owner"}
            </Pill>
            {r.owner === "owner" ? <Pill color="var(--walnut)" bg="var(--cream-2)">Owner-carried</Pill> : null}
          </div>
          <div style={{ fontSize: 10.5, color: MUTED, marginTop: 2, paddingLeft: 17 }}>
            {r.markupLabel} · {fmt(r.markup)} markup · {r.category}
          </div>
        </td>
        <Num v={r.high} node={agreed} />
        <Num v={r.underContract} />
        <Num v={r.changeOrders} />
        <Num v={r.paid} />
        <Num v={r.remaining} />
        <td style={{
          padding: "9px 10px", textAlign: "right", whiteSpace: "nowrap",
          color: r.variance === null ? MUTED : r.variance > 0 ? "var(--rust)" : "var(--ok)",
        }}>
          {r.variance === null ? "not committed" : r.variance === 0 ? "on the ROM" : fmt(r.variance)}
        </td>
      </tr>
      {on ? (
        <tr>
          <td colSpan={7} style={{ padding: "2px 10px 14px 27px", borderBottom: "1px solid var(--line)" }}>
            <div style={{ fontSize: 10, letterSpacing: ".09em", textTransform: "uppercase", color: MUTED, margin: "6px 0" }}>
              The cost lines behind this row
            </div>
            {r.lines.map((l) => (
              <div key={l.id} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", padding: "3px 0", fontSize: 12 }}>
                <span style={{ minWidth: 190 }}>{l.name}</span>
                <Pill color="#fff" bg={l.locked ? "var(--sage)" : "var(--cream-2)"}>{l.locked ? "🔒 locked" : "estimate"}</Pill>
                <span style={{ color: MUTED }}>{l.markupModel === "passthrough" ? `${l.markupPct}% on top` : "in fee"}</span>
                <span style={{ color: MUTED }}>{l.owner === "owner" ? "owner-carried" : "builder-carried"}</span>
              </div>
            ))}
            {/* The sentence that explains the figure. The owner is agreeing a
                number; this is where she reads what it assumes before she does. */}
            {canNote ? (
              <div style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
                <div style={{ fontSize: 10, letterSpacing: ".09em", textTransform: "uppercase", color: MUTED, marginBottom: 4 }}>
                  What this figure assumes
                </div>
                <TextInput
                  value={r.rom?.note ?? ""}
                  placeholder="e.g. paint-grade boxes, no crown, existing layout kept"
                  onCommit={(v) => store.setRomNote(r.tradeId, r.markupModel, v)}
                  style={{ width: "100%", maxWidth: 560, fontSize: 12.5 }}
                />
              </div>
            ) : r.rom?.note ? (
              <div style={{ fontSize: 12, color: "var(--ink)", marginTop: 9, maxWidth: "62ch", lineHeight: 1.5 }}>
                <span style={{ color: MUTED }}>Assumes: </span>{r.rom.note}
              </div>
            ) : (
              <div style={{ fontSize: 11.5, color: MUTED, marginTop: 9, fontStyle: "italic" }}>
                No assumption recorded — ask the builder what this figure covers before agreeing it.
              </div>
            )}
            {r.committed && r.rom?.committedBy ? (
              <div style={{ fontSize: 11.5, color: "var(--sage-2)", marginTop: 7 }}>
                Agreed by {r.rom.committedBy}{r.rom.committedOn ? ` on ${r.rom.committedOn}` : ""} at {fmt(r.rom.agreedHigh ?? r.high)}.
              </div>
            ) : null}
            {canCommit ? (
              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <button
                  className={`btn btn-sm ${r.committed ? "" : "btn-primary"}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (r.committed) {
                      if (confirm(`Withdraw agreement on ${r.label}?`)) store.commitRomLine(r.tradeId, r.markupModel, false);
                    } else {
                      store.commitRomLine(r.tradeId, r.markupModel, true);
                    }
                  }}
                >{r.committed ? "Withdraw agreement" : r.ranged ? `Commit — agrees the ${fmt(r.high)} ceiling` : `Commit ${fmt(r.high)}`}</button>
                <span style={{ fontSize: 11, color: MUTED, lineHeight: 1.45, maxWidth: "46ch" }}>
                  {r.committed
                    ? "The figure is fixed at what was agreed; editing an allowance will not move it."
                    : r.ranged
                      ? "Committing a range agrees its ceiling. The figure is captured now, so it cannot drift afterwards."
                      : "Captured as agreed at this figure."}
                </span>
              </div>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function Num({ v, bold, node }: { v: number; bold?: boolean; node?: React.ReactNode }) {
  return (
    <td style={{
      padding: "9px 10px", textAlign: "right", whiteSpace: "nowrap",
      fontVariantNumeric: "tabular-nums", fontWeight: bold ? 700 : 400,
      color: v === 0 && !bold ? MUTED : "var(--ink)",
    }}>{node ?? (v === 0 && !bold ? "—" : fmt(v))}</td>
  );
}

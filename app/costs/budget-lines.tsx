"use client";

import { useState } from "react";
import { useStore } from "@/lib/data/hooks";
import { accessFor, type MacroCategory } from "@/lib/data/types";
import { fmt, romRows, romTotals, romCanLock, MACRO_ORDER, type RomRow } from "@/lib/data/money";
import { Pill, StatCard, TextInput, NumInput } from "../ui/bits";
import { ChangeOrders } from "./line-parts";

// ---------------------------------------------------------------------------
// Budget lines.
//
// One row per trade per fee treatment. The columns read left to right the way
// the money actually moves: what the owner agreed (ROM), what we then agreed
// with the builder (contracted), what has been added since (change orders and
// fee), what that totals, what has been drawn and paid, and the gap between
// the contract and the total.
// ---------------------------------------------------------------------------

const MUTED = "var(--muted)";

const COLS = [
  "Budget line", "ROM", "Contracted", "Change orders", "Builder fee",
  "Total", "Draw", "Paid", "Variance",
] as const;

export function BudgetLines() {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const user = store.currentUser;
  const [open, setOpen] = useState<string | null>(null);

  const access = accessFor(user, role, "costs");
  if (access === "none") return null;
  const ro = access !== "edit";

  const rows = romRows(db);
  const t = romTotals(db);

  const canCommit = !db.romLocked && ["full_admin", "owner"].includes(role);
  const canLock = ["full_admin", "builder"].includes(role);
  const canEditLine = !ro && ["full_admin", "builder"].includes(role);
  const canAdd = !ro && ["full_admin", "builder", "owner"].includes(role);
  const ready = romCanLock(db);

  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 className="serif" style={{ fontSize: 19, fontWeight: 700, color: "var(--walnut)", margin: 0 }}>Budget lines</h2>
          <div style={{ fontSize: 12.5, color: MUTED, marginTop: 3, lineHeight: 1.5, maxWidth: "70ch" }}>
            One line per trade, from the figure the owner agreed through to what has been paid.
            Open a line for its scope, the rooms it covers, and the change orders against it.
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
              onClick={() => {
                if (confirm(`Lock the ROM at ${fmt(t.romFigure)}?\n\nIt does not move again. From here the budget is negotiated inside the packages, and a signed line changes only through a change order.`)) store.lockRom();
              }}
            >{ready ? "🔒 Lock the ROM" : `${t.rows - t.committedRows} still with the owner`}</button>
          ) : null}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginTop: 14 }}>
        <StatCard label="ROM agreed" value={fmt(t.agreed)} sub={`${t.committedRows} of ${t.rows} lines committed`} accent="var(--brass-2)" />
        <StatCard label="Contracted" value={fmt(t.contracted)} sub="agreed with the builder, before fee" />
        <StatCard label="Total" value={fmt(t.total)} sub="contracted + change orders + fee" accent="var(--walnut)" />
        <StatCard label="Paid" value={fmt(t.paid)} accent="var(--ok)" sub={`${fmt(Math.max(0, t.total - t.paid))} outstanding`} />
        <StatCard label="Variance" value={t.variance === 0 ? "—" : fmt(t.variance)} accent={t.variance > 0 ? "var(--rust)" : "var(--ok)"} sub="added since contract" />
      </div>

      {rows.length === 0 ? (
        <div className="card" style={{ padding: 18, marginTop: 14, fontSize: 12.5, color: MUTED }}>
          No budget lines yet — add the first one below.
        </div>
      ) : (
        <div style={{ overflowX: "auto", marginTop: 14 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1040, fontSize: 12.5 }}>
            <thead>
              <tr>
                {COLS.map((h, i) => (
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
                <Row key={r.key} r={r} canCommit={canCommit} canEditLine={canEditLine}
                  on={open === r.key} onToggle={() => setOpen(open === r.key ? null : r.key)} />
              ))}
              <tr style={{ borderTop: "2px solid var(--line)", fontWeight: 700 }}>
                <td style={{ padding: "9px 10px" }}>Total — {t.rows} lines</td>
                <Num v={t.romFigure} bold /><Num v={t.contracted} bold /><Num v={t.changeOrders} bold />
                <Num v={t.builderFee} bold /><Num v={t.total} bold /><Num v={t.draw} bold /><Num v={t.paid} bold />
                <td style={{ padding: "9px 10px", textAlign: "right", color: t.variance > 0 ? "var(--rust)" : "var(--ok)" }}>
                  {t.variance === 0 ? "—" : fmt(t.variance)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontSize: 11.5, lineHeight: 1.55, color: MUTED, marginTop: 10, maxWidth: "80ch" }}>
        Contracted is the work itself, before fee — what we agreed the builder would do it for.
        Total is that plus approved change orders and the builder&rsquo;s fee, and variance is the gap
        between the two: everything added since the contract was signed. A line paid in full closes,
        and only a change order re-opens it.
      </div>

      {canAdd ? <AddBudgetLine /> : null}
    </div>
  );
}

function Row({ r, canCommit, canEditLine, on, onToggle }: {
  r: RomRow; canCommit: boolean; canEditLine: boolean; on: boolean; onToggle: () => void;
}) {
  const store = useStore();
  const db = store.db;
  const rooms = [...new Set(r.lines.flatMap((l) => l.roomIds ?? []))]
    .map((id) => db.rooms.find((x) => x.id === id)?.name).filter(Boolean) as string[];
  const scope = r.lines.map((l) => l.desc || l.contractSummary).filter(Boolean) as string[];

  return (
    <>
      <tr onClick={onToggle} style={{
        cursor: "pointer", borderBottom: "1px solid var(--line)",
        background: on ? "var(--cream)" : r.complete ? "var(--sage-tint)" : undefined,
      }}>
        <td style={{ padding: "9px 10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, color: MUTED }}>{on ? "▾" : "▸"}</span>
            <strong style={{ color: "var(--walnut)" }}>{r.label}</strong>
            {r.lines.length > 1 ? <span style={{ fontSize: 10.5, color: MUTED }}>{r.lines.length} lines</span> : null}
            {r.complete
              ? <Pill color="#fff" bg="var(--sage)">✓ Complete — locked</Pill>
              : <Pill color="#fff" bg={r.committed ? "var(--sage)" : "var(--brass)"}>
                  {r.committed ? (r.autoCommitted ? "Committed — under contract" : "Committed") : "Draft — with the owner"}
                </Pill>}
            {r.ownerManagedDirect ? <Pill color="var(--walnut)" bg="var(--cream-2)">Owner managed direct</Pill> : null}
            {r.lockedCount > 0 && !r.complete
              ? <Pill color="var(--walnut)" bg="var(--cream-2)">🔒 {r.lockedCount === r.lines.length ? "Locked" : `${r.lockedCount}/${r.lines.length} locked`}</Pill>
              : null}
          </div>
          <div style={{ fontSize: 10.5, color: MUTED, marginTop: 2, paddingLeft: 17 }}>
            {r.ownerManagedDirect ? "no builder fee" : r.markupLabel} · {r.category}
          </div>
        </td>
        <Num v={r.romFigure} node={r.ranged ? <span>{fmt(r.low)}<span style={{ color: MUTED }}> – </span>{fmt(r.high)}</span> : undefined} />
        <Num v={r.contracted} />
        <Num v={r.changeOrders} />
        <Num v={r.builderFee} />
        <Num v={r.total} bold />
        <Num v={r.draw} />
        <Num v={r.paid} />
        <td style={{ padding: "9px 10px", textAlign: "right", whiteSpace: "nowrap", color: r.variance > 0 ? "var(--rust)" : MUTED }}>
          {r.variance === 0 ? "—" : fmt(r.variance)}
        </td>
      </tr>

      {on ? (
        <tr>
          <td colSpan={COLS.length} style={{ padding: "4px 10px 16px 27px", borderBottom: "1px solid var(--line)", background: "var(--cream)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18 }}>
              <div>
                <Kick>Scope</Kick>
                {scope.length
                  ? scope.map((sc, i) => <div key={i} style={{ fontSize: 12, lineHeight: 1.5, marginTop: 3 }}>{sc}</div>)
                  : <div style={{ fontSize: 11.5, color: MUTED, fontStyle: "italic", marginTop: 3 }}>No scope written yet.</div>}

                <Kick style={{ marginTop: 12 }}>Rooms included</Kick>
                <div style={{ fontSize: 12, lineHeight: 1.5, marginTop: 3 }}>
                  {rooms.length ? rooms.join(" · ") : <span style={{ color: MUTED, fontStyle: "italic" }}>Whole project — no rooms marked.</span>}
                </div>

                <Kick style={{ marginTop: 12 }}>Fee treatment</Kick>
                <div style={{ fontSize: 12, lineHeight: 1.5, marginTop: 3 }}>
                  {r.ownerManagedDirect
                    ? "Owner managed direct — the owner contracts and pays this trade, and no builder fee applies."
                    : `Builder fee applies: ${r.markupLabel}, ${fmt(r.builderFee)} on the contracted work.`}
                </div>

                <Kick style={{ marginTop: 12 }}>The cost lines behind this row</Kick>
                {r.lines.map((l) => (
                  <div key={l.id} style={{ display: "flex", gap: 9, alignItems: "baseline", flexWrap: "wrap", padding: "3px 0", fontSize: 12 }}>
                    <span style={{ minWidth: 170 }}>{l.name}</span>
                    <Pill color="#fff" bg={l.locked ? "var(--sage)" : "var(--cream-2)"}>{l.locked ? "🔒 locked" : "estimate"}</Pill>
                    <span style={{ color: MUTED }}>{l.owner === "owner" ? "owner-carried" : "builder-carried"}</span>
                  </div>
                ))}
              </div>

              <div onClick={(e) => e.stopPropagation()}>
                <Kick>What this figure assumes</Kick>
                {canEditLine ? (
                  <TextInput value={r.rom?.note ?? ""} placeholder="e.g. paint-grade boxes, no crown, existing layout kept"
                    onCommit={(v) => store.setRomNote(r.tradeId, r.markupModel, v)}
                    style={{ width: "100%", fontSize: 12.5, marginTop: 4 }} />
                ) : r.rom?.note ? (
                  <div style={{ fontSize: 12, lineHeight: 1.5, marginTop: 3 }}>{r.rom.note}</div>
                ) : (
                  <div style={{ fontSize: 11.5, color: MUTED, fontStyle: "italic", marginTop: 3 }}>
                    Nothing recorded — ask the builder what this figure covers.
                  </div>
                )}

                {r.committed && r.rom?.committedBy ? (
                  <div style={{ fontSize: 11.5, color: "var(--sage-2)", marginTop: 9 }}>
                    Agreed by {r.rom.committedBy}{r.rom.committedOn ? ` on ${r.rom.committedOn}` : ""} at {fmt(r.rom.agreedHigh ?? r.high)}.
                  </div>
                ) : null}

                {canCommit && !r.committed && !r.complete ? (
                  <button className="btn btn-sm btn-primary" style={{ marginTop: 10 }}
                    onClick={() => store.commitRomLine(r.tradeId, r.markupModel, true)}>
                    {r.ranged ? `Commit — agrees the ${fmt(r.high)} ceiling` : `Commit ${fmt(r.high)}`}
                  </button>
                ) : null}

                {/* A change order is the only thing that re-opens a closed line,
                    so it stays available once the line is complete. */}
                {canEditLine ? (
                  <div style={{ marginTop: 14 }}>
                    <Kick>Change orders</Kick>
                    {r.complete ? (
                      <div style={{ fontSize: 11.5, color: MUTED, marginTop: 3, lineHeight: 1.5 }}>
                        Paid in full and closed. Raising a change order re-opens it.
                      </div>
                    ) : null}
                    {r.lines.map((l) => (
                      <div key={l.id} style={{ marginTop: 8 }}>
                        {r.lines.length > 1 ? <div style={{ fontSize: 11, color: MUTED, marginBottom: 3 }}>{l.name}</div> : null}
                        <ChangeOrders line={l} ro={false} />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Adding a line. Before the ROM is locked a new line joins it as a draft the
// owner still has to agree. Once locked the ROM does not re-open, so the line
// goes in as contracted and is sent for approval instead.
// ---------------------------------------------------------------------------
function AddBudgetLine() {
  const store = useStore();
  const db = store.db;
  const [openForm, setOpenForm] = useState(false);
  const [tradeId, setTradeId] = useState("");
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState("");

  const locked = !!db.romLocked;
  const trade = db.trades.find((t) => t.id === tradeId);
  const ready = !!tradeId && amount > 0;

  if (!openForm) {
    return <button className="btn btn-sm" style={{ marginTop: 14 }} onClick={() => setOpenForm(true)}>＋ Add a budget line</button>;
  }

  return (
    <div className="card" style={{ padding: 14, marginTop: 14, display: "flex", flexDirection: "column", gap: 10, maxWidth: 720 }}>
      <div>
        <div className="serif" style={{ fontSize: 16, fontWeight: 700, color: "var(--walnut)" }}>Add a budget line</div>
        <div style={{ fontSize: 11.5, color: MUTED, marginTop: 3, lineHeight: 1.5 }}>
          {locked
            ? "The ROM is locked, so this cannot join it. The line goes in as contracted and is sent to the owner for approval."
            : "The ROM is still open, so this joins it as a draft for the owner to agree."}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 11, color: MUTED }}>Trade</span>
          <select className="input" value={tradeId} onChange={(e) => setTradeId(e.target.value)} style={{ fontSize: 12.5 }}>
            <option value="">Choose…</option>
            {MACRO_ORDER.map((cat: MacroCategory) => {
              const inCat = db.trades.filter((tr) => tr.category === cat);
              if (!inCat.length) return null;
              return (
                <optgroup key={cat} label={cat}>
                  {inCat.map((tr) => <option key={tr.id} value={tr.id}>{tr.name}</option>)}
                </optgroup>
              );
            })}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 11, color: MUTED }}>Cost to the trade, before fee</span>
          <NumInput value={amount} onCommit={setAmount} />
        </label>
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ fontSize: 11, color: MUTED }}>What this figure assumes</span>
        <TextInput value={note} onCommit={setNote} placeholder="What the price covers, and what it does not" style={{ fontSize: 12.5 }} />
      </label>

      <div style={{ display: "flex", gap: 7, justifyContent: "flex-end" }}>
        <button className="btn btn-sm" onClick={() => setOpenForm(false)}>Cancel</button>
        <button className={`btn btn-sm ${ready ? "btn-primary" : ""}`} disabled={!ready}
          onClick={() => {
            store.addBudgetLine({ tradeId, amount, note, category: trade?.category as MacroCategory | undefined });
            setOpenForm(false); setTradeId(""); setAmount(0); setNote("");
          }}>
          {!ready ? "Trade and a figure required" : locked ? "Add and send for approval" : "Add to the ROM"}
        </button>
      </div>
    </div>
  );
}

function Kick({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ fontSize: 10, letterSpacing: ".09em", textTransform: "uppercase", color: MUTED, ...style }}>{children}</div>;
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

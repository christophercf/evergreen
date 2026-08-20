"use client";

import { useState } from "react";
import { useStore } from "@/lib/data/hooks";
import { accessFor, type CostOwner, type MacroCategory } from "@/lib/data/types";
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
  "Total", "Drawn / Paid",
] as const;

// The contract cell carries the line's standing, so the state is read where
// the money is rather than as a badge beside the name.
const CELL_BG: Record<string, string | undefined> = {
  active: undefined, hold: "#f7f1e2", removed: "var(--cream-2)",
};

const REMOVE_MSG = (label: string) =>
  `Remove ${label}?\n\nIt stops counting towards the budget but stays on the record, and can be brought back.`;

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
          {db.romLocked ? <Pill color="#fff" bg="var(--walnut)">{`ROM locked ${db.romLockedAt ?? ""}`.trim()}</Pill> : null}
          {/* Only shown once it can actually be pressed — a disabled button that
              names what it is waiting for is just a status flag. */}
          {canLock && !db.romLocked && ready ? (
            <button
              className="btn btn-sm btn-primary"
              onClick={() => {
                if (confirm(`Lock the ROM at ${fmt(t.romFigure)}?\n\nIt does not move again. From here the budget is negotiated inside the packages, and a signed line changes only through a change order.`)) store.lockRom();
              }}
            >🔒 Lock the ROM</button>
          ) : null}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginTop: 14 }}>
        <StatCard label="ROM agreed" value={fmt(t.agreed)} sub={`${t.committedRows} of ${t.rows} lines committed`} accent="var(--brass-2)" />
        <StatCard label="Contracted" value={fmt(t.contracted)} sub="agreed with the builder, before fee" />
        <StatCard label="Total" value={fmt(t.total)} sub="contracted + change orders + fee" accent="var(--walnut)" />
        <StatCard label="Drawn / Paid" value={fmt(t.paid)} accent="var(--ok)" sub={`${fmt(Math.max(0, t.total - t.paid))} outstanding`} />
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
                <td style={{ padding: "9px 10px" }}>Total — {t.rows} lines{t.removedRows ? ` · ${t.removedRows} removed` : ""}</td>
                <Num v={t.romFigure} bold /><Num v={t.contracted} bold /><Num v={t.changeOrders} bold />
                <Num v={t.builderFee} bold /><Num v={t.total} bold /><Num v={t.paid} bold />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontSize: 11.5, lineHeight: 1.55, color: MUTED, marginTop: 10, maxWidth: "80ch" }}>
        Contracted is the work itself, before fee — what was agreed with whoever is doing it —
        and its cell turns green once that is in place, amber on hold, grey once removed.
        Total is contracted plus approved change orders and the builder&rsquo;s fee. Whoever manages a
        line fills in its contract figure, its change orders and its payments.
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
  const role = store.session.role;
  // Either party may say who manages a line; only its manager fills it in.
  const canManage = canEditLine || ["full_admin", "owner", "builder"].includes(role);
  const iManage = role === "full_admin"
    || (role === "builder" && r.manager === "builder")
    || (role === "owner" && r.manager === "owner");
  const rooms = [...new Set(r.lines.flatMap((l) => l.roomIds ?? []))]
    .map((id) => db.rooms.find((x) => x.id === id)?.name).filter(Boolean) as string[];
  const scope = r.lines.map((l) => l.desc || l.contractSummary).filter(Boolean) as string[];

  return (
    <>
      <tr onClick={onToggle} style={{
        cursor: "pointer", borderBottom: "1px solid var(--line)",
        background: on ? "var(--cream)" : undefined,
        opacity: r.state === "removed" ? 0.55 : 1,
      }}>
        <td style={{ padding: "9px 10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, color: MUTED }}>{on ? "▾" : "▸"}</span>
            <strong style={{ color: "var(--walnut)" }}>{r.label}</strong>
            {r.lines.length > 1 ? <span style={{ fontSize: 10.5, color: MUTED }}>{r.lines.length} lines</span> : null}
            {r.state === "removed" ? <Pill color="#fff" bg="var(--muted)">Removed</Pill> : null}
          </div>
          <div style={{ fontSize: 10.5, color: MUTED, marginTop: 2, paddingLeft: 17 }}>
            {r.manager === "owner" ? "Owner managed · no builder fee" : `GC managed · ${r.markupLabel}`} · {r.category}
          </div>
        </td>
        <Num v={r.romFigure} node={r.ranged ? <span>{fmt(r.low)}<span style={{ color: MUTED }}> – </span>{fmt(r.high)}</span> : undefined} />
        {/* Green once the line is actually under contract, amber on hold,
            grey once removed. */}
        <Num v={r.contracted}
          bg={r.state === "active" ? (r.lockedCount > 0 ? "var(--sage-tint)" : undefined) : CELL_BG[r.state]}
          title={r.state === "removed" ? "Removed — counts towards nothing"
            : r.state === "hold" ? "On hold"
            : r.lockedCount > 0 ? `Under contract${r.lockedCount < r.lines.length ? ` — ${r.lockedCount} of ${r.lines.length} lines` : ""}` : "Not yet contracted"} />
        <Num v={r.changeOrders} />
        <Num v={r.builderFee} />
        <Num v={r.total} bold />
        <Num v={r.paid} node={r.draw !== r.paid
          ? <span>{fmt(r.paid)}<span style={{ color: MUTED, fontSize: 11 }}> of {fmt(r.draw)} drawn</span></span>
          : undefined} />
      </tr>

      {on ? (
        <tr>
          <td colSpan={COLS.length} style={{ padding: "4px 10px 16px 27px", borderBottom: "1px solid var(--line)", background: "var(--cream)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18 }}>
              <div>
                {/* The line's own name. Defaults to the trade's, and renaming it
                    renames this line only — the trade is still the trade on the
                    schedule, the materials list and the vendor roster. */}
                <Kick>Name</Kick>
                {canManage ? (
                  <>
                    <TextInput value={r.rom?.label ?? ""} placeholder={r.defaultLabel}
                      onCommit={(v) => store.setBudgetLineLabel(r.tradeId, r.markupModel, v)}
                      style={{ width: "100%", fontSize: 13, fontWeight: 600, marginTop: 4 }} />
                    <div style={{ fontSize: 11, color: MUTED, marginTop: 3, lineHeight: 1.45 }}>
                      {r.rom?.label
                        ? `Renamed. Clear it to go back to "${r.defaultLabel}".`
                        : "Renames this budget line only — the trade keeps its name everywhere else."}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 3 }}>{r.label}</div>
                )}

                <Kick style={{ marginTop: 12 }}>Scope</Kick>
                {scope.length
                  ? scope.map((sc, i) => <div key={i} style={{ fontSize: 12, lineHeight: 1.5, marginTop: 3 }}>{sc}</div>)
                  : <div style={{ fontSize: 11.5, color: MUTED, fontStyle: "italic", marginTop: 3 }}>No scope written yet.</div>}

                <Kick style={{ marginTop: 12 }}>Rooms included</Kick>
                <div style={{ fontSize: 12, lineHeight: 1.5, marginTop: 3 }}>
                  {rooms.length ? rooms.join(" · ") : <span style={{ color: MUTED, fontStyle: "italic" }}>Whole project — no rooms marked.</span>}
                </div>

                <Kick style={{ marginTop: 12 }}>Who manages this line</Kick>
                <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                  {([["builder", "GC managed"], ["owner", "Owner managed"]] as const).map(([k, label]) => (
                    <button key={k} className="btn btn-sm" disabled={!canManage}
                      onClick={() => store.setBudgetLineManager(r.tradeId, r.markupModel, k)}
                      style={{
                        background: r.manager === k ? "var(--sage)" : undefined,
                        color: r.manager === k ? "#fff" : undefined,
                        fontWeight: r.manager === k ? 700 : 400,
                      }}>{label}</button>
                  ))}
                </div>
                <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5, marginTop: 5 }}>
                  {r.manager === "owner"
                    ? "The owner contracts and pays this trade direct, and no builder fee applies."
                    : `The GC carries this line. Builder fee: ${r.markupLabel}, ${fmt(r.builderFee)} on the contracted work.`}
                  {" "}The manager fills in the contract figure, the change orders and the payments.
                </div>

                <Kick style={{ marginTop: 12 }}>Under contract, and paid</Kick>
                <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.45, margin: "3px 0 6px" }}>
                  {iManage
                    ? "Enter the figure agreed with the trade, before fee. Clearing it takes the line back out of contract."
                    : `Read-only — ${r.manager === "owner" ? "the owner" : "the GC"} manages this line.`}
                </div>
                {r.lines.map((l) => (
                  <div key={l.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "4px 0", fontSize: 12 }}>
                    <span style={{ minWidth: 150 }}>{l.name}</span>
                    {iManage ? (
                      <>
                        <label style={{ display: "inline-flex", alignItems: "center", gap: 4, color: MUTED, fontSize: 11 }}>
                          contract
                          <NumInput value={l.lockedCost ?? 0} onCommit={(v) => store.setLineContracted(l.id, v)} width={96} />
                        </label>
                        <label style={{ display: "inline-flex", alignItems: "center", gap: 4, color: MUTED, fontSize: 11 }}>
                          paid
                          <NumInput value={l.directPaid ?? 0} onCommit={(v) => store.setLineDirectPaid(l.id, v)} width={96} />
                        </label>
                      </>
                    ) : (
                      <>
                        <Pill color="#fff" bg={l.locked ? "var(--sage)" : "var(--cream-2)"}>{l.locked ? "under contract" : "not contracted"}</Pill>
                        <span style={{ color: MUTED }}>{l.lockedCost ? fmt(l.lockedCost) : "—"}</span>
                      </>
                    )}
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
                {canManage ? (
                  <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                    <Kick>This line</Kick>
                    <div style={{ display: "flex", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
                      {r.state === "removed" ? (
                        <button className="btn btn-sm btn-primary"
                          onClick={() => store.setBudgetLineState(r.tradeId, r.markupModel, "active")}>Bring it back</button>
                      ) : (
                        <>
                          <button className="btn btn-sm"
                            onClick={() => store.setBudgetLineState(r.tradeId, r.markupModel, r.state === "hold" ? "active" : "hold")}
                            style={{ background: r.state === "hold" ? "#f7f1e2" : undefined }}>
                            {r.state === "hold" ? "Take off hold" : "Put on hold"}
                          </button>
                          <button className="btn btn-sm" style={{ color: "var(--rust)" }}
                            onClick={() => { if (confirm(REMOVE_MSG(r.label))) store.setBudgetLineState(r.tradeId, r.markupModel, "removed"); }}>
                            Remove this line
                          </button>
                        </>
                      )}
                    </div>
                    <div style={{ fontSize: 11.5, color: MUTED, marginTop: 5, lineHeight: 1.45 }}>
                      A removed line counts towards nothing and stops holding up the ROM lock, but it is kept rather than deleted.
                    </div>
                  </div>
                ) : null}

                {iManage ? (
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
  const [scope, setScope] = useState("");
  const [roomIds, setRoomIds] = useState<string[]>([]);
  const [manager, setManager] = useState<CostOwner>("builder");

  const locked = !!db.romLocked;
  const trade = db.trades.find((t) => t.id === tradeId);

  // Everything a line needs to mean something: who does it, what it covers,
  // where, what it costs, and whose money it is.
  const missing = [
    !tradeId && "a trade",
    !(amount > 0) && "a cost",
    !scope.trim() && "the scope",
    !roomIds.length && "at least one room",
  ].filter(Boolean) as string[];
  const ready = !missing.length;

  const reset = () => {
    setOpenForm(false); setTradeId(""); setAmount(0); setScope(""); setRoomIds([]); setManager("builder");
  };

  if (!openForm) {
    return <button className="btn btn-sm" style={{ marginTop: 14 }} onClick={() => setOpenForm(true)}>＋ Add a budget line</button>;
  }

  return (
    <div className="card" style={{ padding: 16, marginTop: 14, display: "flex", flexDirection: "column", gap: 14, borderLeft: "3px solid var(--sage)" }}>
      <div>
        <div className="serif" style={{ fontSize: 17, fontWeight: 700, color: "var(--walnut)" }}>Add a budget line</div>
        <div style={{ fontSize: 11.5, color: MUTED, marginTop: 3, lineHeight: 1.5, maxWidth: "70ch" }}>
          {locked
            ? "The ROM is locked and does not re-open, so this line goes straight in as contracted and the owner is asked to approve it."
            : "The ROM is still open, so this joins it as a draft for the owner to agree."}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18 }}>
        <div>
          <Kick>Trade</Kick>
          <select className="input" value={tradeId} onChange={(e) => setTradeId(e.target.value)}
            style={{ fontSize: 12.5, width: "100%", marginTop: 4 }}>
            <option value="">Choose…</option>
            {MACRO_ORDER.map((cat: MacroCategory) => {
              const inCat = db.trades.filter((tr) => tr.category === cat);
              if (!inCat.length) return null;
              return <optgroup key={cat} label={cat}>{inCat.map((tr) => <option key={tr.id} value={tr.id}>{tr.name}</option>)}</optgroup>;
            })}
          </select>

          <Kick style={{ marginTop: 12 }}>Scope</Kick>
          <textarea className="input" value={scope} onChange={(e) => setScope(e.target.value)}
            placeholder="What this line covers, and what it does not"
            style={{ width: "100%", minHeight: 74, fontSize: 12.5, lineHeight: 1.5, marginTop: 4 }} />

          <Kick style={{ marginTop: 12 }}>{locked ? "Contracted cost, before fee" : "Cost to the trade, before fee"}</Kick>
          <div style={{ marginTop: 4 }}>
            <NumInput value={amount} onCommit={setAmount} width={140} />
          </div>
        </div>

        <div>
          <Kick>Rooms included</Kick>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 5, maxHeight: 168, overflowY: "auto" }}>
            {db.rooms.map((rm) => {
              const on = roomIds.includes(rm.id);
              return (
                <button key={rm.id} className="btn btn-sm"
                  onClick={() => setRoomIds((p) => on ? p.filter((x) => x !== rm.id) : [...p, rm.id])}
                  style={{
                    background: on ? "var(--sage)" : undefined, color: on ? "#fff" : undefined,
                    fontWeight: on ? 700 : 400, fontSize: 11.5,
                  }}>{rm.name}</button>
              );
            })}
          </div>

          <Kick style={{ marginTop: 14 }}>Who manages this line</Kick>
          <div style={{ display: "flex", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
            {([["builder", "GC managed"], ["owner", "Owner managed"]] as const).map(([k, label]) => (
              <button key={k} className="btn btn-sm" onClick={() => setManager(k)}
                style={{
                  background: manager === k ? "var(--sage)" : undefined,
                  color: manager === k ? "#fff" : undefined,
                  fontWeight: manager === k ? 700 : 400,
                }}>{label}</button>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5, marginTop: 5 }}>
            {manager === "owner"
              ? "The owner contracts and pays this trade direct. No builder fee applies."
              : `The GC carries it, at ${db.project.builderMarkupPct ?? 20}% on top.`}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 7, justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn-sm" onClick={reset}>Cancel</button>
        <button className={`btn btn-sm ${ready ? "btn-primary" : ""}`} disabled={!ready}
          onClick={() => {
            store.addBudgetLine({
              tradeId, amount, note: scope, roomIds, manager,
              category: trade?.category as MacroCategory | undefined,
            });
            reset();
          }}>
          {!ready ? `Needs ${missing.join(", ")}` : locked ? "Add as contracted, and send for approval" : "Add to the ROM"}
        </button>
      </div>
    </div>
  );
}

function Kick({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ fontSize: 10, letterSpacing: ".09em", textTransform: "uppercase", color: MUTED, ...style }}>{children}</div>;
}

function Num({ v, bold, node, bg, title }: { v: number; bold?: boolean; node?: React.ReactNode; bg?: string; title?: string }) {
  return (
    <td title={title} style={{
      padding: "9px 10px", textAlign: "right", whiteSpace: "nowrap",
      fontVariantNumeric: "tabular-nums", fontWeight: bold ? 700 : 400,
      background: bg,
      color: v === 0 && !bold ? MUTED : "var(--ink)",
    }}>{node ?? (v === 0 && !bold ? "—" : fmt(v))}</td>
  );
}

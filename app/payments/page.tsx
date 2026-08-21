"use client";

import { useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/data/hooks";
import { PageHeader, NoAccess, Pill, SectionTitle, Money, StatCard, StackBar, NumInput } from "../ui/bits";
import { accessFor, DRAW_STATUS_LABEL, type CostLine, type DB, type Draw, type DrawAllocation } from "@/lib/data/types";
import { totals, drawAmount, lineCurrent, lineDrawn, allocationAmount, fmt, tradeName, linePaid, lineUnpaid } from "@/lib/data/money";
import { lineContractState, lineDrawable, contractMissingSigs } from "@/lib/data/contract";

const STATUS_BG: Record<Draw["status"], string> = { planned: "var(--sc-unset)", pushed: "var(--brass)", paid: "var(--ok)" };

// The in-scope item labels a budget line covers (its trade × the line's rooms).
function lineScope(db: DB, line: CostLine): string[] {
  const roomSet = line.roomIds.length ? new Set(line.roomIds) : null;
  const labels = new Set<string>();
  db.scope
    .filter((c) => c.tradeId === line.tradeId && c.status === "in" && (!roomSet || roomSet.has(c.roomId)))
    .forEach((c) => c.items.filter((i) => i.included).forEach((i) => labels.add(i.label)));
  return [...labels];
}

export default function PaymentsPage() {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const user = store.currentUser;
  const access = accessFor(user, role, "payments");
  const [dragLine, setDragLine] = useState<string | null>(null);
  if (access === "none") return <NoAccess module="Draw Management" />;
  const ro = access !== "edit";

  const t = totals(db.costLines);
  const allocated = db.draws.reduce((a, d) => a + drawAmount(db, d), 0);
  // Paid = paid draws + direct (outside-draw) line payments.
  const paid = db.costLines.reduce((a, l) => a + linePaid(db, l), 0);
  const directTotal = db.costLines.reduce((a, l) => a + Math.min(l.directPaid ?? 0, lineUnpaid(db, l) + (l.directPaid ?? 0)), 0);
  const unallocated = Math.max(0, t.grand - allocated);

  const lines = [...db.costLines].filter((l) => lineCurrent(l) > 0).sort((a, b) => a.category.localeCompare(b.category) || lineCurrent(b) - lineCurrent(a));
  // A paid draw is finished: the money has moved and nothing about it changes
  // again. It leaves the working list for the archive rather than sitting at
  // the bottom of it forever.
  const order = { planned: 0, pushed: 1, paid: 2 } as const;
  const live = db.draws.filter((d) => d.status !== "paid").sort((a, b) => order[a.status] - order[b.status]);
  const archived = db.draws.filter((d) => d.status === "paid")
    .sort((a, b) => (b.paidDate ?? "").localeCompare(a.paidDate ?? ""));
  const archivedTotal = archived.reduce((a, d) => a + drawAmount(db, d), 0);

  return (
    <>
      <PageHeader
        title="Draw Management"
        subtitle="What has actually left. Drag budget lines into draws, set each line's share (% or flat $), spell out which scope is covered, then send it to the client. A draw runs Saved → Client approved → Client paid, and paid draws move to the archive; the budget on the left tracks total → drawn → remaining live."
        right={ro ? <Pill color="var(--muted)">View only</Pill> : undefined}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px,1fr))", gap: 12, marginTop: 16 }}>
        <StatCard label="Contract Value" value={<Money value={t.grand} />} sub="current, all lines" />
        <StatCard label="Allocated to Draws" value={<Money value={allocated} />} accent="var(--brass-2)" sub={`${Math.round((allocated / (t.grand || 1)) * 100)}% of budget`} />
        <StatCard label="Paid" value={<Money value={paid} />} accent="var(--ok)" sub={directTotal > 0 ? `incl. ${fmt(directTotal)} paid directly` : `${db.draws.filter((d) => d.status === "paid").length} paid draw(s)`} />
        <StatCard label="Unallocated" value={<Money value={unallocated} />} sub="not yet in a draw" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 18, alignItems: "start" }} className="ever-pay">
        {/* LEFT: budget modules */}
        <div>
          <SectionTitle>Budget</SectionTitle>
          <div className="card" style={{ padding: 10, maxHeight: "74vh", overflow: "auto" }}>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 8 }}>{ro ? "Lines and their draw status — click a line to see its scope." : "A line opens up once its contract is signed. Drag one into a draw → · click to see its scope."}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {lines.map((l) => <BudgetLine key={l.id} line={l} ro={ro} dragLine={dragLine} setDragLine={setDragLine} />)}
            </div>
          </div>
        </div>

        {/* RIGHT: draws, stacked */}
        <div>
          <SectionTitle right={!ro ? <button className="btn btn-primary btn-sm" onClick={() => store.addDraw(`Draw ${db.draws.length + 1}`)}>+ Add draw</button> : undefined}>Draws</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {live.map((d) => <DrawCard key={d.id} draw={d} ro={ro} />)}
            {!live.length && (
              <div className="card" style={{ padding: 20, fontSize: 13, color: "var(--muted)" }}>
                {archived.length ? "No open draws — every draw has been paid. The archive is below." : "No draws yet. Add one, then drag budget lines in."}
              </div>
            )}
            {archived.length ? (
              <ArchiveBand draws={archived} total={archivedTotal} ro={ro} />
            ) : null}
          </div>
        </div>
      </div>

      {/* A grid item defaults to min-width:auto, so a single 1fr column still
          refuses to shrink below its widest un-wrappable child — which is how
          this page ran 77px past a phone while claiming to be one column. */}
      <style>{`
        .ever-pay > * { min-width: 0; }
        @media (max-width: 860px){ .ever-pay{ grid-template-columns: 1fr !important; } }
      `}</style>
    </>
  );
}

function BudgetLine({ line, ro, dragLine, setDragLine }: { line: CostLine; ro: boolean; dragLine: string | null; setDragLine: (v: string | null) => void }) {
  const store = useStore();
  const db = store.db;
  const [open, setOpen] = useState(false);
  const total = lineCurrent(line);
  const drawn = lineDrawn(db, line.id);
  const rem = total - drawn;
  const paid = linePaid(db, line);
  const allocUnpaid = Math.max(0, drawn - paid); // allocated to a draw but not yet paid
  const unpaidLeft = lineUnpaid(db, line);
  const scope = lineScope(db, line);
  // A line opens up to be drawn against when the contract behind it is signed
  // — not when a price is typed in. The lock is the price; the signature is the
  // agreement, and only one of those is a promise to pay.
  const cstate = lineContractState(db, line);
  const drawable = lineDrawable(db, line);
  const canDrag = drawable && !ro;
  const waiting = cstate === "issued" && !drawable
    ? `Contract issued — waiting on ${contractMissingSigs(db, line.tradeId).map((p) => p === "trade" ? "the vendor" : p === "owner" ? "the homeowner" : "the GC").join(" and ")} to sign.`
    : null;
  const [hover, setHover] = useState(false);

  return (
    <div
      draggable={canDrag}
      onDragStart={(e) => { if (!canDrag) { e.preventDefault(); return; } e.dataTransfer.setData("text/plain", line.id); setDragLine(line.id); }}
      onDragEnd={() => setDragLine(null)}
      onMouseEnter={() => !drawable && setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={!drawable && !ro ? (waiting ?? "Award this work and get the contract signed before drawing against it.") : undefined}
      className="card"
      style={{ position: "relative", padding: "8px 10px", cursor: canDrag ? "grab" : (drawable ? "default" : "not-allowed"), opacity: dragLine === line.id ? 0.5 : drawable ? 1 : 0.62, background: "var(--paper)", borderLeft: `3px solid ${drawable ? "var(--ok)" : cstate === "issued" ? "var(--brass)" : "var(--line)"}` }}>
      {/* Why this line can't be dragged yet — said where the hand already is. */}
      {!drawable && hover && !ro && (
        <div style={{ position: "absolute", left: 8, right: 8, bottom: "100%", marginBottom: 4, zIndex: 5, background: "var(--walnut)", color: "#fff", fontSize: 11.5, padding: "6px 9px", borderRadius: 7, boxShadow: "0 6px 18px rgba(0,0,0,.25)" }}>
          {waiting ?? "No contract yet — award the work in Bid and Package Management."}
          <Link href={waiting ? "/vendors" : "/bids"} style={{ color: "#ffe6b8", marginLeft: 6, fontWeight: 600 }}>{waiting ? "Sign it →" : "Open packages →"}</Link>
        </div>
      )}
      {/* The name gives way before the row does: flex:1 alone will not shrink
          below its own text, which pushed this past the width of a phone. */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {canDrag && <span style={{ color: "var(--muted)", fontSize: 13 }}>⋮⋮</span>}
        <button onClick={() => setOpen((v) => !v)} title="Show scope" style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)", fontSize: 11, padding: 0 }}>{open ? "▾" : "▸"}</button>
        <span style={{ fontWeight: 600, fontSize: 12.5, flex: "1 1 90px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{line.name}</span>
        {cstate === "signed" || drawable
          ? <Pill color="#fff" bg="var(--ok)">{cstate === "signed" ? "Contract signed" : "Contract issued"}</Pill>
          : cstate === "issued" ? <Pill color="#fff" bg="var(--brass)">Contract issued</Pill>
          : <Pill color="var(--muted)">No contract</Pill>}
      </div>
      <div style={{ display: "flex", gap: 8, fontSize: 11, color: "var(--muted)", marginTop: 3, paddingLeft: ro ? 17 : 36, flexWrap: "wrap" }}>
        <span>Total <strong style={{ color: "var(--ink)" }}>{fmt(total)}</strong></span>
        <span>Paid <strong style={{ color: "var(--ok)" }}>{fmt(paid)}</strong></span>
        <span>Drawn <strong style={{ color: "var(--brass-2)" }}>{fmt(drawn)}</strong></span>
        <span>Left <strong style={{ color: unpaidLeft > 0 ? "var(--ink)" : "var(--ok)" }}>{fmt(unpaidLeft)}</strong></span>
      </div>
      <div style={{ marginTop: 4, paddingLeft: ro ? 17 : 36 }} title={`Paid ${fmt(paid)} · Allocated-unpaid ${fmt(allocUnpaid)} · Remaining ${fmt(Math.max(0, total - paid - allocUnpaid))}`}><StackBar height={5} segments={[{ value: paid, color: "var(--ok)" }, { value: allocUnpaid, color: "var(--brass)" }, { value: Math.max(0, total - paid - allocUnpaid), color: "var(--cream-2)" }]} /></div>
      {open && (
        <div style={{ marginTop: 6, paddingLeft: ro ? 17 : 36 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)" }}>Scope in this line</div>
          {scope.length ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>{scope.map((s) => <Pill key={s} bg="var(--sage-tint)">{s}</Pill>)}</div>
          ) : <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>No scope items marked in the Admin matrix for this line’s trade/rooms.</div>}
        </div>
      )}
    </div>
  );
}

/** Paid draws, folded away. They are kept — a paid draw is the record of the
 *  money leaving — but they are no longer part of the work in front of you. */
function ArchiveBand({ draws, total, ro }: { draws: Draw[]; total: number; ro: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 4 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
          border: "1px solid var(--line)", borderRadius: 8, background: "transparent",
          padding: "8px 10px", color: "var(--muted)", fontSize: 11.5, fontWeight: 700,
          letterSpacing: ".06em", textTransform: "uppercase",
        }}>
        <span style={{ fontSize: 13 }}>{open ? "▾" : "▸"}</span>
        Archive — {draws.length} paid draw{draws.length === 1 ? "" : "s"}
        <span style={{ marginLeft: "auto", textTransform: "none", letterSpacing: 0, fontVariantNumeric: "tabular-nums" }}>{fmt(total)}</span>
      </button>
      {open ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
          {draws.map((d) => <DrawCard key={d.id} draw={d} ro={ro} />)}
        </div>
      ) : null}
    </div>
  );
}

function DrawCard({ draw, ro }: { draw: Draw; ro: boolean }) {
  const store = useStore();
  const db = store.db;
  const [over, setOver] = useState(false);
  const locked = draw.status === "paid";
  const [collapsed, setCollapsed] = useState(locked); // completed draws start collapsed
  const total = drawAmount(db, draw);

  return (
    <div
      onDragOver={(e) => { if (!ro && !locked) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const id = e.dataTransfer.getData("text/plain"); if (id) { store.addAllocation(draw.id, id); setCollapsed(false); } }}
      className="card"
      style={{ padding: 14, borderLeft: `3px solid ${STATUS_BG[draw.status]}`, outline: over ? "2px dashed var(--sage)" : "none", background: over ? "var(--sage-tint)" : undefined }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => setCollapsed((v) => !v)} title={collapsed ? "Expand" : "Collapse"} style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)", fontSize: 13 }}>{collapsed ? "▸" : "▾"}</button>
        <input value={draw.name} disabled={ro || locked} onChange={(e) => store.renameDraw(draw.id, e.target.value)} style={{ border: "none", background: "transparent", fontWeight: 700, fontSize: 15, fontFamily: "var(--font-serif)", color: "var(--walnut)", minWidth: 110, flex: 1 }} />
        <Pill color="#fff" bg={STATUS_BG[draw.status]}>{DRAW_STATUS_LABEL[draw.status]}{draw.paidDate ? ` · ${draw.paidDate}` : draw.approvedDate ? ` · ${draw.approvedDate}` : ""}</Pill>
        <span style={{ fontSize: 17, fontWeight: 700, fontFamily: "var(--font-serif)" }}><Money value={total} /></span>
      </div>

      {collapsed ? (
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6, paddingLeft: 22 }}>{draw.allocations.length} line{draw.allocations.length === 1 ? "" : "s"}{locked ? " · paid & locked" : ""} — click ▸ to expand</div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {draw.allocations.map((a) => <AllocationRow key={a.lineId} draw={draw} alloc={a} ro={ro} locked={locked} />)}
            {!draw.allocations.length && <div style={{ fontSize: 12, color: "var(--muted)", padding: "10px 0", textAlign: "center", border: "1px dashed var(--line)", borderRadius: 8 }}>{ro ? "No lines." : "Drag budget lines here"}</div>}
          </div>

          <RemitTo draw={draw} />


          {/* Draw-level note */}
          {(!ro && !locked) ? (
            <textarea value={draw.note ?? ""} placeholder="Draw note (milestone, condition for release, inspection sign-off…)" onChange={(e) => store.setDrawNote(draw.id, e.target.value)} style={{ width: "100%", marginTop: 8, minHeight: 38, fontSize: 12, resize: "vertical" }} />
          ) : draw.note ? <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>📝 {draw.note}</div> : null}

          {!ro && (
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              {/* Saved → client approved → client paid. Each button records
                  what the client has done; paid is final and archives. */}
              {draw.status === "planned" && (
                <button className="btn btn-sm btn-primary" disabled={!draw.allocations.length}
                  title={draw.allocations.length ? "" : "Add at least one budget line first"}
                  onClick={() => store.setDrawStatus(draw.id, "pushed")}>Mark client approved</button>
              )}
              {draw.status === "pushed" && <button className="btn btn-sm btn-primary" onClick={() => store.setDrawStatus(draw.id, "paid")}>Mark client paid 🔒</button>}
              {draw.status === "pushed" && (
                <button className="btn btn-sm" onClick={() => store.setDrawStatus(draw.id, "planned")}>Back to saved</button>
              )}
              {!locked && <button className="btn btn-sm" style={{ color: "var(--rust)", marginLeft: "auto" }} onClick={() => store.removeDraw(draw.id)}>Delete</button>}
            </div>
          )}
          {locked && <div style={{ fontSize: 11.5, color: "var(--ok)", marginTop: 8 }}>🔒 Paid {draw.paidDate} — locked. If costs increase, raise a change order in <Link href="/costs" style={{ color: "var(--sage-2)", fontWeight: 600 }}>Budget Management</Link> (a paid draw can’t be edited).</div>}
          {draw.status === "pushed" && (
            <div style={{ fontSize: 11.5, color: "var(--brass-2)", marginTop: 8 }}>
              ✓ Client approved{draw.approvedDate ? ` ${draw.approvedDate}` : ""}{draw.approvedBy ? ` · recorded by ${draw.approvedBy}` : ""} — contracts issued to the trades in this draw. Mark it paid once the money lands.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AllocationRow({ draw, alloc, ro, locked }: { draw: Draw; alloc: DrawAllocation; ro: boolean; locked: boolean }) {
  const store = useStore();
  const db = store.db;
  const [open, setOpen] = useState(false);
  const l = db.costLines.find((x) => x.id === alloc.lineId);
  if (!l) return null;
  const scope = lineScope(db, l);
  const editable = !ro && !locked;
  const included = new Set(alloc.includedScope ?? []);

  return (
    <div style={{ borderBottom: "1px solid var(--line)", paddingBottom: 5 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
        <button onClick={() => setOpen((v) => !v)} title="Clarify scope / notes" style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)", fontSize: 10, padding: 0 }}>{open ? "▾" : "▸"}</button>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
        {editable ? (
          <>
            <select value={alloc.mode} onChange={(e) => store.setAllocation(draw.id, alloc.lineId, { mode: e.target.value as "pct" | "flat" })} style={{ fontSize: 11, padding: "1px 3px" }}>
              <option value="pct">%</option><option value="flat">$</option>
            </select>
            <NumInput value={alloc.value} onCommit={(v) => store.setAllocation(draw.id, alloc.lineId, { value: v })} width={56} style={{ fontSize: 11 }} />
          </>
        ) : <span style={{ color: "var(--muted)" }}>{alloc.mode === "pct" ? `${alloc.value}%` : "$"}</span>}
        <span style={{ width: 72, textAlign: "right", fontWeight: 700 }}>{fmt(allocationAmount(l, alloc))}</span>
        {editable && <button className="btn btn-sm" style={{ color: "var(--rust)", padding: "1px 6px" }} onClick={() => store.removeAllocation(draw.id, alloc.lineId)}>✕</button>}
      </div>

      {/* quick summary of what's included when collapsed */}
      {!open && (included.size > 0 || alloc.note) && (
        <div style={{ fontSize: 11, color: "var(--muted)", paddingLeft: 18, marginTop: 2 }}>
          {included.size > 0 ? `Covers: ${[...included].join(", ")}` : ""}{included.size > 0 && alloc.note ? " · " : ""}{alloc.note ? `📝 ${alloc.note}` : ""}
        </div>
      )}

      {open && (
        <div style={{ paddingLeft: 18, marginTop: 6 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)" }}>Scope covered by this draw</div>
          {scope.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 4 }}>
              {scope.map((s) => (
                <label key={s} style={{ display: "flex", gap: 7, fontSize: 12, alignItems: "center", color: included.has(s) ? "var(--ink)" : "var(--muted)" }}>
                  <input type="checkbox" checked={included.has(s)} disabled={!editable} onChange={(e) => store.toggleAllocationScope(draw.id, alloc.lineId, s, e.target.checked)} />
                  {s}
                </label>
              ))}
              <div style={{ fontSize: 11, color: "var(--muted)" }}>Tick the items this draw funds, or use the % field above for a partial share.</div>
            </div>
          ) : <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>No scope items on this line — use the % / $ amount above.</div>}
          <textarea value={alloc.note ?? ""} disabled={!editable} placeholder="Notes on what's included in this draw for this line…" onChange={(e) => store.setAllocation(draw.id, alloc.lineId, { note: e.target.value })} style={{ width: "100%", marginTop: 6, minHeight: 34, fontSize: 12, resize: "vertical" }} />
        </div>
      )}
    </div>
  );
}

// Remit/billing summary for the trades in this draw (from Admin → Contacts).
function RemitTo({ draw }: { draw: Draw }) {
  const store = useStore();
  const db = store.db;
  const tradeIds = [...new Set(draw.allocations.map((a) => db.costLines.find((l) => l.id === a.lineId)?.tradeId).filter(Boolean) as string[])];
  const rows = tradeIds.map((tid) => ({ tid, c: db.contacts.find((x) => x.party === "vendor" && x.tradeId === tid), owner: db.trades.find((t) => t.id === tid)?.managedBy === "owner" })).filter((r) => r.c);
  if (!rows.length) return null;
  return (
    <div style={{ marginTop: 8, borderTop: "1px solid var(--line)", paddingTop: 6 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)" }}>Remit to</div>
      {rows.map(({ tid, c, owner }) => (
        <div key={tid} style={{ fontSize: 11.5, marginTop: 2 }}>
          <strong>{tradeName(db, tid)}</strong>{owner && <span style={{ color: "var(--brass-2)" }}> ⌂ Owner Managed</span>} — {c!.billing?.payableTo ?? c!.company}{c!.billing?.paymentTerms ? <span style={{ color: "var(--muted)" }}> · {c!.billing.paymentTerms}</span> : ""}
        </div>
      ))}
    </div>
  );
}


"use client";

import { useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/data/hooks";
import { PageHeader, NoAccess, Pill, SectionTitle, Money, StatCard, PaceBar, NumInput } from "../ui/bits";
import { accessFor, DRAW_STATUS_LABEL, type CostLine, type DB, type Draw, type DrawAllocation } from "@/lib/data/types";
import { totals, drawAmount, lineCurrent, lineDrawn, allocationAmount, fmt, tradeName, linePaid, lineUnpaid } from "@/lib/data/money";
import { lineContractState, lineDrawable, contractMissingSigs } from "@/lib/data/contract";
import { scopeOptionsFor, lineHeadroom, drawHeadroom, type ScopeSource } from "@/lib/data/drawscope";
import { DesktopOnly, useNarrowViewport } from "../ui/desktop-only";
import { renderDrawRequest, projectHeadroom } from "@/lib/data/drawdoc";
import { pushEmail } from "../ui/messenger";
import { SignaturePad, SignatureMark } from "../ui/signature-pad";
import { useConfirm } from "../ui/confirm";

const STATUS_BG: Record<Draw["status"], string> = { planned: "var(--sc-unset)", pushed: "var(--brass)", paid: "var(--ok)" };

/** Where a line's parts came from. A GC ticking off work should know whether
 *  the list is what the vendor priced or something the office wrote. */
const SOURCE_NOTE: Record<ScopeSource, string> = {
  package: "from the package as bid",
  contract: "from the signed contract",
  matrix: "from the scope matrix — this line was never bid",
};

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
  // The line waiting for a draw to land in. Tapping a line arms it; tapping a
  // draw adds it; tapping anywhere else puts it down.
  const [armed, setArmed] = useState<string | null>(null);
  const phone = useNarrowViewport();
  if (access === "none") return <NoAccess module="Draw Management" />;
  const ro = access !== "edit";

  const t = totals(db.costLines);
  const allocated = db.draws.reduce((a, d) => a + drawAmount(db, d), 0);
  // Paid = paid draws + direct (outside-draw) line payments.
  const paid = db.costLines.reduce((a, l) => a + linePaid(db, l), 0);
  const directTotal = db.costLines.reduce((a, l) => a + Math.min(l.directPaid ?? 0, lineUnpaid(db, l) + (l.directPaid ?? 0)), 0);
  const unallocated = Math.max(0, t.grand - allocated);
  // What the contracted lines still have left to give. This is the figure a GC
  // building a draw actually needs: unallocated counts lines nobody can draw
  // against yet.
  const head = projectHeadroom(db);

  const lines = [...db.costLines].filter((l) => lineCurrent(l) > 0).sort((a, b) => a.category.localeCompare(b.category) || lineCurrent(b) - lineCurrent(a));
  // A paid draw is finished: the money has moved and nothing about it changes
  // again. It leaves the working list for the archive rather than sitting at
  // the bottom of it forever.
  const order = { planned: 0, pushed: 1, paid: 2 } as const;
  const live = db.draws.filter((d) => d.status !== "paid").sort((a, b) => order[a.status] - order[b.status]);
  const archived = db.draws.filter((d) => d.status === "paid")
    .sort((a, b) => (b.paidDate ?? "").localeCompare(a.paidDate ?? ""));
  const archivedTotal = archived.reduce((a, d) => a + drawAmount(db, d), 0);
  const openDraws = live.length;

  // A desktop screen, said plainly. Building a draw is dragging money across
  // two columns and reading five figures per line while you do it — on a phone
  // that is a cramped version of a mistake. The signable draw request already
  // covers the phone half of this workflow: the client can read and sign from
  // anywhere, it is only the BUILDING that needs a desk.
  if (phone) {
    return (
      <DesktopOnly
        title="Draw Management"
        because="Building a draw means working two columns at once — the budget lines on one side, the draws they fund on the other — with running figures on both. It needs the width of a real screen, and money screens are the wrong place to squint."
        elsewhere={[
          { href: "/costs", label: "Budget Management", note: "Every line's contracted, drawn and paid figures — readable on a phone." },
          { href: "/vendors", label: "Contracts", note: "Draw requests live here once issued; signing works fine from a phone." },
        ]}
      >
        {null}
      </DesktopOnly>
    );
  }

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
        <StatCard label="Left to draw" value={<Money value={head.remaining} />} accent="var(--brass-2)"
          sub={`of ${fmt(head.contracted)} under contract`} />
      </div>

      <div onClick={() => setArmed(null)}
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 18, alignItems: "start" }} className="ever-pay">
        {/* LEFT: budget modules */}
        <div>
          <SectionTitle>Budget</SectionTitle>
          <div className="card" style={{ padding: 10, maxHeight: "74vh", overflow: "auto" }}>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 8 }}>{ro ? "Lines and their draw status — click a line to see its scope." : "A line opens up once its contract is signed. Tap one to add it to a draw (or drag it across); the caret shows its scope."}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {lines.map((l) => (
              <BudgetLine key={l.id} line={l} ro={ro} dragLine={dragLine} setDragLine={setDragLine}
                armed={armed === l.id} onArm={() => setArmed(armed === l.id ? null : l.id)} openDraws={openDraws} />
            ))}
            </div>
          </div>
        </div>

        {/* RIGHT: draws, stacked */}
        <div>
          <SectionTitle right={!ro ? <button className="btn btn-primary btn-sm" onClick={() => store.addDraw(`Draw ${db.draws.length + 1}`)}>+ Add draw</button> : undefined}>Draws</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {live.map((d) => <DrawCard key={d.id} draw={d} ro={ro} armedLine={armed} onTake={() => setArmed(null)} />)}
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

function BudgetLine({ line, ro, dragLine, setDragLine, armed, onArm, openDraws }: {
  line: CostLine; ro: boolean; dragLine: string | null; setDragLine: (v: string | null) => void;
  armed: boolean; onArm: () => void; openDraws: number;
}) {
  const store = useStore();
  const db = store.db;
  const [open, setOpen] = useState(false);
  const total = lineCurrent(line);
  const drawn = lineDrawn(db, line.id);
  const rem = total - drawn;
  const paid = linePaid(db, line);
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
      onClick={(e) => {
        if (!canDrag) return;
        e.stopPropagation();
        // With one open draw there is nothing to choose between, so the tap
        // just does it. Undo is in the toast either way.
        if (openDraws === 1) { store.addAllocationToFirstOpenDraw(line.id); return; }
        onArm();
      }}
      onMouseEnter={() => !drawable && setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={!drawable && !ro ? (waiting ?? "Award this work and get the contract signed before drawing against it.") : undefined}
      className="card"
      style={{
        position: "relative", padding: "8px 10px",
        cursor: canDrag ? "grab" : (drawable ? "default" : "not-allowed"),
        opacity: dragLine === line.id ? 0.5 : drawable ? 1 : 0.62,
        background: armed ? "var(--sage-tint)" : "var(--paper)",
        outline: armed ? "2px solid var(--sage)" : undefined,
        borderLeft: `3px solid ${drawable ? "var(--ok)" : cstate === "issued" ? "var(--brass)" : "var(--line)"}`,
      }}>
      {armed ? (
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sage-2)", marginBottom: 3 }}>
          Adding this line — now tap a draw
        </div>
      ) : null}
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
        <button className="tap" onClick={() => setOpen((v) => !v)} title="Show scope" aria-label={open ? "Hide scope" : "Show scope"} style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)", fontSize: 11, padding: 0 }}>{open ? "▾" : "▸"}</button>
        <span style={{ fontWeight: 600, fontSize: 12.5, flex: "1 1 90px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{line.name}</span>
        {cstate === "signed" || drawable
          ? <Pill color="#fff" bg="var(--ok)">{cstate === "signed" ? "Contract signed" : "Contract issued"}</Pill>
          : cstate === "issued" ? <Pill color="#fff" bg="var(--brass)">Contract issued</Pill>
          : <Pill color="var(--muted)">No contract</Pill>}
      </div>
      <div className="m-read" style={{ display: "flex", gap: 8, fontSize: 11, color: "var(--muted)", marginTop: 3, paddingLeft: ro ? 17 : 36, flexWrap: "wrap" }}>
        <span>Total <strong style={{ color: "var(--ink)" }}>{fmt(total)}</strong></span>
        <span>Paid <strong style={{ color: "var(--ok)" }}>{fmt(paid)}</strong></span>
        <span>Drawn <strong style={{ color: "var(--brass-2)" }}>{fmt(drawn)}</strong></span>
        <span>Left <strong style={{ color: unpaidLeft > 0 ? "var(--ink)" : "var(--ok)" }}>{fmt(unpaidLeft)}</strong></span>
      </div>
      <div style={{ marginTop: 4, paddingLeft: ro ? 17 : 36 }}><PaceBar paid={paid} drawn={drawn} total={total} /></div>
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

function DrawCard({ draw, ro, armedLine, onTake }: { draw: Draw; ro: boolean; armedLine?: string | null; onTake?: () => void }) {
  const store = useStore();
  const ask = useConfirm();
  const db = store.db;
  const [over, setOver] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const locked = draw.status === "paid";
  const [collapsed, setCollapsed] = useState(locked); // completed draws start collapsed
  const total = drawAmount(db, draw);
  // What the lines in this draw still had left to give, and by how much the
  // draw exceeds it.
  const dh = drawHeadroom(db, draw.id);
  // Pacing across the lines this draw touches — the same three figures the
  // budget side shows, so the two bars are the same bar.
  const pace = draw.allocations.reduce((acc, a) => {
    const l = db.costLines.find((x) => x.id === a.lineId);
    if (!l) return acc;
    return {
      paid: acc.paid + linePaid(db, l),
      drawn: acc.drawn + lineDrawn(db, l.id),
      total: acc.total + lineCurrent(l),
    };
  }, { paid: 0, drawn: 0, total: 0 });
  const req = draw.request;
  const canIssue = ["full_admin", "builder"].includes(store.session.role);

  return (
    <div
      onDragOver={(e) => { if (!ro && !locked) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const id = e.dataTransfer.getData("text/plain"); if (id) { store.addAllocation(draw.id, id); setCollapsed(false); } }}
      className="card"
      style={{ padding: 14, borderLeft: `3px solid ${STATUS_BG[draw.status]}`, outline: over ? "2px dashed var(--sage)" : "none", background: over ? "var(--sage-tint)" : undefined }}>
      {/* The other half of tap-to-add: while a line is armed, every draw that
          can still take one says so. */}
      {armedLine && !ro && !locked ? (
        <button
          onClick={(e) => { e.stopPropagation(); store.addAllocation(draw.id, armedLine); setCollapsed(false); onTake?.(); }}
          style={{
            width: "100%", marginBottom: 10, padding: "9px 10px", borderRadius: 8, cursor: "pointer",
            border: "1.5px dashed var(--sage)", background: "var(--sage-tint)",
            color: "var(--sage-2)", fontWeight: 700, fontSize: 12.5,
          }}>
          ＋ Add it to {draw.name}
        </button>
      ) : null}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button className="tap" onClick={() => setCollapsed((v) => !v)} title={collapsed ? "Expand" : "Collapse"} aria-label={collapsed ? "Expand this draw" : "Collapse this draw"} style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)", fontSize: 13 }}>{collapsed ? "▸" : "▾"}</button>
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

          {/* The same pacing bar the budget side uses, for the lines this draw
              touches: where those lines stand overall, with this draw in it. */}
          <div style={{ marginTop: 10 }}>
            <PaceBar paid={pace.paid} drawn={pace.drawn} total={pace.total} height={7} legend />
          </div>

          {/* The budget this draw is drawing against, said once for the whole
              draw rather than only line by line. */}
          <div style={{ fontSize: 11.5, color: dh.over > 0 ? "var(--rust)" : "var(--muted)", marginTop: 8, fontWeight: dh.over > 0 ? 600 : 400 }}>
            {dh.over > 0
              ? `${fmt(dh.over)} more than these lines have left — ${fmt(dh.budget)} was available.`
              : `${fmt(Math.max(0, dh.budget - total))} would still be available on these lines after this draw.`}
          </div>

          <RemitTo draw={draw} />


          {/* Draw-level note */}
          {(!ro && !locked) ? (
            <textarea value={draw.note ?? ""} placeholder="Draw note (milestone, condition for release, inspection sign-off…)" onChange={(e) => store.setDrawNote(draw.id, e.target.value)} style={{ width: "100%", marginTop: 8, minHeight: 38, fontSize: 12, resize: "vertical" }} />
          ) : draw.note ? <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>📝 {draw.note}</div> : null}

          {!ro && (
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              {/* Saved → client approved → client paid. The signed document is
                  the real route; the button is the fallback for a client who
                  approved some other way. */}
              {draw.status === "planned" && !req && canIssue && (
                <button className="btn btn-sm btn-primary" disabled={!draw.allocations.length}
                  onClick={() => setIssuing(true)}>Issue this draw for signature</button>
              )}
              {draw.status === "planned" && (
                <button className="btn btn-sm" disabled={!draw.allocations.length}
                  onClick={() => store.setDrawStatus(draw.id, "pushed")}>Approved another way</button>
              )}
              {/* Said on the screen, not in a tooltip a thumb can never open. */}
              {draw.status === "planned" && !draw.allocations.length ? (
                <div style={{ flexBasis: "100%", fontSize: 11.5, color: "var(--muted)" }}>
                  Add at least one budget line before this draw can go anywhere.
                </div>
              ) : null}
              {draw.status === "planned" && draw.allocations.length && !req ? (
                <div style={{ flexBasis: "100%", fontSize: 11.5, color: "var(--muted)" }}>
                  &ldquo;Approved another way&rdquo; is for a client who said yes outside the app.
                </div>
              ) : null}
              {draw.status === "pushed" && <button className="btn btn-sm btn-primary" onClick={() => store.setDrawStatus(draw.id, "paid")}>Mark client paid 🔒</button>}
              {draw.status === "pushed" && (
                <button className="btn btn-sm" onClick={() => store.setDrawStatus(draw.id, "planned")}>Back to saved</button>
              )}
              {!locked && (
                <button className="btn btn-sm" style={{ color: "var(--rust)", marginLeft: "auto" }}
                  onClick={async () => {
                    if (await ask({
                      title: `Delete ${draw.name}?`,
                      body: draw.allocations.length
                        ? `Its ${draw.allocations.length} budget line${draw.allocations.length === 1 ? "" : "s"} go back to being undrawn. Nothing has been paid against it.`
                        : "It has nothing in it.",
                      danger: "Delete the draw",
                    })) store.removeDraw(draw.id);
                  }}>Delete</button>
              )}
            </div>
          )}
          {locked && <div style={{ fontSize: 11.5, color: "var(--ok)", marginTop: 8 }}>🔒 Paid {draw.paidDate} — locked. If costs increase, raise a change order in <Link href="/costs" style={{ color: "var(--sage-2)", fontWeight: 600 }}>Budget Management</Link> (a paid draw can’t be edited).</div>}
          {issuing ? <IssueDrawPanel draw={draw} onClose={() => setIssuing(false)} /> : null}
          {req ? <RequestState draw={draw} /> : null}
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

// ---------------------------------------------------------------------------
// Issuing the draw: pick the client, read the document, send it.
// ---------------------------------------------------------------------------
function IssueDrawPanel({ draw, onClose }: { draw: Draw; onClose: () => void }) {
  const store = useStore();
  const db = store.db;
  // Whoever can approve money on this job. A draw request goes to a person,
  // not to a role — somebody has to sign it.
  const clients = db.users.filter((u) => !u.disabled && ["owner", "full_admin"].includes(u.role));
  const [to, setTo] = useState(clients[0]?.id ?? "");
  const [showDoc, setShowDoc] = useState(false);
  const body = renderDrawRequest(db, draw);

  return (
    <div className="card" style={{ padding: 12, marginTop: 10, background: "var(--cream-2)", borderColor: "var(--brass)", display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)" }}>
        Issue this draw for signature
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
        This writes the draw out as a document — every line, what it claims is finished, and what is
        left on each line afterwards. It freezes at issue, so what you send is what gets signed.
      </div>

      <label style={{ fontSize: 11.5, color: "var(--muted)", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        Send it to
        <select value={to} onChange={(e) => setTo(e.target.value)} style={{ fontSize: 12.5 }}>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.email ? ` · ${c.email}` : ""}</option>)}
        </select>
      </label>
      {!clients.length ? (
        <div style={{ fontSize: 11.5, color: "var(--rust)" }}>Nobody on this project can approve money, so there is nobody to send it to.</div>
      ) : null}

      <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setShowDoc((v) => !v)}>
        {showDoc ? "Hide the document" : "Read the document"}
      </button>
      {showDoc ? <Doc text={body} /> : null}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button className="btn btn-sm btn-primary" disabled={!to}
          onClick={() => { if (store.issueDrawRequest(draw.id, to, body, drawAmount(db, draw))) onClose(); }}>
          Issue it
        </button>
        <button className="btn btn-sm" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

/** Where an issued request stands, and the client's place to sign it. */
function RequestState({ draw }: { draw: Draw }) {
  const store = useStore();
  const db = store.db;
  const [showDoc, setShowDoc] = useState(false);
  const req = draw.request!;
  const canSign = !req.signedBy && (req.toUserId === store.session.userId || store.session.role === "full_admin");
  const canIssue = ["full_admin", "builder"].includes(store.session.role);

  return (
    <div style={{ marginTop: 10, borderTop: "1px solid var(--line)", paddingTop: 9, display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ fontSize: 11.5, color: req.signedBy ? "var(--ok)" : "var(--brass-2)", fontWeight: 600 }}>
        {req.signedBy
          ? `\u2713 Signed by ${req.signedBy} on ${req.signedAt?.slice(0, 10)} — filed in Contracts.`
          : `\u{1F4C4} Issued to ${req.toName} on ${req.issuedAt.slice(0, 10)} by ${req.issuedBy} — waiting on their signature.`}
      </div>
      {!req.signedBy && req.emailedAt ? (
        <div style={{ fontSize: 11, color: "var(--muted)" }}>Emailed {req.emailedAt.slice(0, 10)}.</div>
      ) : null}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button className="btn btn-sm" onClick={() => setShowDoc((v) => !v)}>{showDoc ? "Hide" : "Read it"}</button>
        {!req.signedBy && canIssue && req.toEmail ? (
          <button className="btn btn-sm" onClick={() => {
            pushEmail([req.toEmail!], `Draw request — ${draw.name}`, req.body, { senderName: req.issuedBy });
            store.markDrawRequestEmailed(draw.id);
          }}>Email it to {req.toName}</button>
        ) : null}
        {!req.signedBy && canIssue ? (
          <button className="btn btn-sm" style={{ color: "var(--rust)" }} onClick={() => store.withdrawDrawRequest(draw.id)}>Withdraw</button>
        ) : null}
      </div>

      {showDoc ? <Doc text={req.body} /> : null}

      {canSign ? (
        <div className="card" style={{ padding: 10, background: "var(--paper)" }}>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 6 }}>
            Signing approves {fmt(req.total)} for payment and accepts the work listed as complete.
          </div>
          <DrawSignature draw={draw} />
        </div>
      ) : null}
    </div>
  );
}

/** Sign with the signature you already adopted, or draw a new one — the same
 *  two choices the vendor contracts offer, so signing feels like signing. */
function DrawSignature({ draw }: { draw: Draw }) {
  const store = useStore();
  const me = store.currentUser;
  const [pad, setPad] = useState(false);
  const saved = me?.signature;

  if (pad) {
    return (
      <div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Draw your signature, then adopt &amp; sign:</div>
        <SignaturePad
          onAdopt={(img) => { if (me) store.setUserSignature(me.id, img); store.signDrawRequest(draw.id, img); setPad(false); }}
          onCancel={() => setPad(false)}
        />
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {saved ? <button className="btn btn-sm btn-primary" onClick={() => store.signDrawRequest(draw.id, saved)}>✒ Sign with adopted signature</button> : null}
      <button className="btn btn-sm" onClick={() => setPad(true)}>{saved ? "Draw a new signature" : "✒ Adopt signature & sign"}</button>
      {saved ? <div style={{ fontSize: 10.5, color: "var(--muted)" }}>Your saved signature: <SignatureMark img={saved} name="" /></div> : null}
    </div>
  );
}

function Doc({ text }: { text: string }) {
  return (
    <pre style={{
      margin: 0, maxHeight: 300, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word",
      fontSize: 11, lineHeight: 1.5, background: "var(--paper)", border: "1px solid var(--line)",
      borderRadius: 8, padding: 10, fontFamily: "var(--font-sans)",
    }}>{text}</pre>
  );
}

function AllocationRow({ draw, alloc, ro, locked }: { draw: Draw; alloc: DrawAllocation; ro: boolean; locked: boolean }) {
  const store = useStore();
  const db = store.db;
  const [open, setOpen] = useState(false);
  const l = db.costLines.find((x) => x.id === alloc.lineId);
  if (!l) return null;
  const editable = !ro && !locked;
  const included = new Set(alloc.includedScope ?? []);
  // What this line has left to give, ignoring this draw — the headroom being
  // spent, not the headroom after it has been spent.
  const head = lineHeadroom(db, l, draw.id);
  const amount = allocationAmount(l, alloc);
  const over = Math.max(0, amount - head.remaining);
  // The parts of the work, from the package that was bid where there is one.
  const options = scopeOptionsFor(db, l, draw.id);
  const finishing = options.filter((o) => included.has(o.label));

  return (
    <div style={{ borderBottom: "1px solid var(--line)", paddingBottom: 5 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
        <button className="tap" onClick={() => setOpen((v) => !v)} title="Clarify scope / notes" aria-label={open ? "Hide the detail" : "Show what this draw finishes"} style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)", fontSize: 10, padding: 0 }}>{open ? "▾" : "▸"}</button>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
        {editable ? (
          <>
            <select value={alloc.mode} onChange={(e) => store.setAllocation(draw.id, alloc.lineId, { mode: e.target.value as "pct" | "flat" })} style={{ fontSize: 11, padding: "1px 3px" }}>
              <option value="pct">%</option><option value="flat">$</option>
            </select>
            <NumInput value={alloc.value} onCommit={(v) => store.setAllocation(draw.id, alloc.lineId, { value: v })} width={56} style={{ fontSize: 11 }} />
          </>
        ) : <span style={{ color: "var(--muted)" }}>{alloc.mode === "pct" ? `${alloc.value}%` : "$"}</span>}
        <span style={{ width: 72, textAlign: "right", fontWeight: 700, color: over > 0 ? "var(--rust)" : undefined }}>{fmt(amount)}</span>
        {editable && <button className="btn btn-sm tap" title="Remove this line from the draw" aria-label="Remove this line from the draw" style={{ color: "var(--rust)", padding: "1px 6px" }} onClick={() => store.removeAllocation(draw.id, alloc.lineId)}>✕</button>}
      </div>

      {/* How much of this line is still available to draw against. It sits on
          the row because that is where the figure is being decided. */}
      <div className="m-read" style={{ fontSize: 10.5, color: "var(--muted)", paddingLeft: 18, marginTop: 1 }}>
        {over > 0 ? (
          <span style={{ color: "var(--rust)", fontWeight: 600 }}>
            {fmt(over)} more than this line has left — {fmt(head.remaining)} of {fmt(head.total)} remains
            {head.drawnElsewhere > 0 ? ` (${fmt(head.drawnElsewhere)} is in other draws)` : ""}.
          </span>
        ) : (
          <>
            {fmt(head.remaining)} left to draw of {fmt(head.total)}
            {head.drawnElsewhere > 0 ? ` · ${fmt(head.drawnElsewhere)} in other draws` : ""}
            {amount > 0 ? ` · ${fmt(Math.max(0, head.remaining - amount))} would remain after this` : ""}
          </>
        )}
      </div>

      {/* What this draw says is finished on this line, when collapsed. */}
      {!open && (included.size > 0 || alloc.note) && (
        <div style={{ fontSize: 11, color: "var(--muted)", paddingLeft: 18, marginTop: 2 }}>
          {included.size > 0 ? `Finishes: ${[...included].join(", ")}` : ""}{included.size > 0 && alloc.note ? " · " : ""}{alloc.note ? `📝 ${alloc.note}` : ""}
        </div>
      )}

      {open && (
        <div style={{ paddingLeft: 18, marginTop: 6 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)" }}>What this draw finishes</div>
            {options.length ? <span style={{ fontSize: 10.5, color: "var(--muted)" }}>{SOURCE_NOTE[options[0].from]}</span> : null}
          </div>
          {options.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 4 }}>
              {options.map((o) => (
                <label key={o.label} style={{ display: "flex", gap: 7, fontSize: 12, alignItems: "flex-start", color: included.has(o.label) ? "var(--ink)" : "var(--muted)" }}>
                  <input type="checkbox" checked={included.has(o.label)} disabled={!editable}
                    onChange={(e) => store.toggleAllocationScope(draw.id, alloc.lineId, o.label, e.target.checked)} style={{ marginTop: 2 }} />
                  <span>
                    {o.label}
                    {/* Two draws claiming the same work is how a line gets paid
                        twice, so the other draw is named rather than hidden. */}
                    {o.coveredBy ? <span style={{ color: "var(--brass-2)" }}> · already in {o.coveredBy}</span> : null}
                  </span>
                </label>
              ))}
              {editable ? (
                <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                  <button className="btn btn-sm" style={{ padding: "1px 7px", fontSize: 11 }}
                    onClick={() => options.filter((o) => !o.coveredBy).forEach((o) => store.toggleAllocationScope(draw.id, alloc.lineId, o.label, true))}>
                    Everything not yet drawn
                  </button>
                  <button className="btn btn-sm" style={{ padding: "1px 7px", fontSize: 11 }}
                    onClick={() => options.forEach((o) => store.toggleAllocationScope(draw.id, alloc.lineId, o.label, false))}>
                    Clear
                  </button>
                </div>
              ) : null}
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                {finishing.length} of {options.length} part{options.length === 1 ? "" : "s"} in this draw. The money is the % or $ above; this is what is being claimed as done for it.
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>
              Nothing was itemised for this line, in its package or the scope matrix — say what it finishes in the note below.
            </div>
          )}
          <textarea value={alloc.note ?? ""} disabled={!editable} placeholder="Anything the list above does not say…" onChange={(e) => store.setAllocation(draw.id, alloc.lineId, { note: e.target.value })} style={{ width: "100%", marginTop: 6, minHeight: 34, fontSize: 12, resize: "vertical" }} />
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


"use client";

import { useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/data/hooks";
import { PageHeader, NoAccess, Pill, SectionTitle, Money, StatCard, StackBar } from "../ui/bits";
import { accessFor, type CostLine, type CostOwner, type MarkupModel } from "@/lib/data/types";
import {
  lineBase, lineMarkup, lineTotal, lineStart, lineDelta, totals, byCategory, byTrade,
  tradeName, MACRO_ORDER, MACRO_COLOR, fmt,
} from "@/lib/data/money";

type GroupBy = "category" | "trade" | "owner";

export default function CostsPage() {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const user = store.currentUser;
  const access = accessFor(user, role, "costs");
  const [group, setGroup] = useState<GroupBy>("category");
  const [aiFor, setAiFor] = useState<string | null>(null);

  if (access === "none") return <NoAccess module="Building Costs" />;
  const ro = access !== "edit";

  const t = totals(db.costLines);
  const buffer = (t.grand * db.project.bufferPct) / 100;

  const groups = groupLines(db.costLines, group, db);

  return (
    <>
      <PageHeader
        title="Building Costs"
        subtitle="Track every line from first estimate to locked-in price. Wrap costs to the builder (with markup) or the owner, map each line to rooms, and watch the price evolve so nothing slips into a surprise change order."
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {ro && <Pill color="var(--muted)">View only</Pill>}
            <Link href="/timing" className="btn btn-sm">Paired with Timing →</Link>
          </div>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12, marginTop: 16 }}>
        <StatCard label="Builder Scope" value={<Money value={t.builder} />} sub={`incl. ${fmt(t.markup)} markup`} />
        <StatCard label="Owner Scope" value={<Money value={t.owner} />} sub="direct / black-box" />
        <StatCard label="Total Project" value={<Money value={t.grand} />} accent="var(--brass-2)" />
        <StatCard label={`+${db.project.bufferPct}% Buffer`} value={<Money value={t.grand + buffer} />} sub={`buffer ${fmt(buffer)}`} />
      </div>

      <div className="card" style={{ padding: 16, marginTop: 14 }}>
        <StackBar height={13} segments={MACRO_ORDER.map((c) => ({ value: byCategory(db.costLines).find((x) => x.key === c)?.total ?? 0, color: MACRO_COLOR[c], label: c }))} />
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 12, fontSize: 12 }}>
          {MACRO_ORDER.map((c) => {
            const v = byCategory(db.costLines).find((x) => x.key === c)?.total ?? 0;
            if (!v) return null;
            return <span key={c} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: MACRO_COLOR[c] }} />{c} · <strong><Money value={v} /></strong></span>;
          })}
        </div>
      </div>

      <SectionTitle right={
        <div style={{ display: "flex", gap: 6 }}>
          {(["category", "trade", "owner"] as GroupBy[]).map((g) => (
            <button key={g} className="btn btn-sm" onClick={() => setGroup(g)} style={{ background: group === g ? "var(--sage-tint)" : undefined, fontWeight: 700 }}>
              by {g}
            </button>
          ))}
        </div>
      }>
        Cost Lines
      </SectionTitle>

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {groups.map((grp) => (
          <div key={grp.key}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 2px 7px" }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: grp.color }} />
              <h3 className="serif" style={{ fontSize: 15, fontWeight: 700, color: "var(--walnut)" }}>{grp.label}</h3>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{grp.lines.length} line{grp.lines.length === 1 ? "" : "s"}</span>
              <span style={{ marginLeft: "auto", fontWeight: 700 }}><Money value={grp.lines.reduce((a, l) => a + lineTotal(l), 0)} /></span>
            </div>
            <div className="card" style={{ overflow: "hidden" }}>
              {grp.lines.map((l, i) => (
                <CostRow key={l.id} line={l} ro={ro} first={i === 0} onAi={() => setAiFor(l.id)} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <ContractsSection ro={ro} />

      {aiFor && <AiModal line={db.costLines.find((l) => l.id === aiFor)!} onClose={() => setAiFor(null)} />}
    </>
  );
}

function groupLines(lines: CostLine[], group: GroupBy, db: ReturnType<typeof useStore>["db"]) {
  if (group === "owner") {
    return [
      { key: "builder", label: "Builder-carried", color: "var(--sage)", lines: lines.filter((l) => l.owner === "builder") },
      { key: "owner", label: "Owner-carried", color: "var(--brass)", lines: lines.filter((l) => l.owner === "owner") },
    ].filter((g) => g.lines.length);
  }
  if (group === "trade") {
    return byTrade(db, lines).map((r) => ({ key: r.key, label: r.label, color: "var(--sage)", lines: lines.filter((l) => l.tradeId === r.key) }));
  }
  return MACRO_ORDER.map((c) => ({ key: c, label: c, color: MACRO_COLOR[c], lines: lines.filter((l) => l.category === c) })).filter((g) => g.lines.length);
}

// ---------------------------------------------------------------------------
function CostRow({ line, ro, first, onAi }: { line: CostLine; ro: boolean; first: boolean; onAi: () => void }) {
  const store = useStore();
  const db = store.db;
  const [open, setOpen] = useState(false);
  const delta = lineDelta(line);

  // Pairing with Timing: the scheduled window(s) for this line's trade.
  const sched = db.schedule.filter((s) => s.tradeId === line.tradeId && s.kind !== "milestone");
  const schedWindow = sched.length
    ? (() => {
        const fmtD = (d: string) => new Date(`${d}T00:00:00`).toLocaleString("en-US", { month: "short", day: "numeric" });
        const start = sched.map((s) => s.start).sort()[0];
        const end = sched.map((s) => s.end).sort().slice(-1)[0];
        return `${fmtD(start)} – ${fmtD(end)}`;
      })()
    : null;

  return (
    <div style={{ borderTop: first ? undefined : "1px solid var(--line)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", cursor: "pointer" }} onClick={() => setOpen((v) => !v)}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{line.name}</span>
            <Pill color="#fff" bg={line.owner === "owner" ? "var(--brass)" : "var(--sage)"}>{line.owner}</Pill>
            <StatusPill status={line.status} />
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
            {tradeName(db, line.tradeId)} · {line.roomIds.length === 0 ? "whole project" : `${line.roomIds.length} room${line.roomIds.length === 1 ? "" : "s"}`}
            {line.markupModel === "passthrough" ? ` · +${line.markupPct}% markup` : " · fee included"}
            {schedWindow && <> · <span style={{ color: "var(--sage-2)" }}>🗓 {schedWindow}</span></>}
          </div>
        </div>
        {delta !== 0 && (
          <span style={{ fontSize: 11.5, fontWeight: 700, color: delta > 0 ? "var(--rust)" : "var(--ok)" }}>
            {delta > 0 ? "▲" : "▼"} {fmt(Math.abs(delta))}
          </span>
        )}
        <div style={{ textAlign: "right", minWidth: 96 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5 }}><Money value={lineTotal(line)} /></div>
          {line.markupModel === "passthrough" && lineMarkup(line) > 0 && <div style={{ fontSize: 11, color: "var(--muted)" }}>base {fmt(lineBase(line))}</div>}
        </div>
      </div>

      {open && (
        <div style={{ padding: "4px 14px 16px", background: "var(--cream)", borderTop: "1px dashed var(--line)" }}>
          {line.desc && <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "10px 0", whiteSpace: "pre-wrap", maxHeight: 120, overflow: "auto" }}>{line.desc}</p>}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }} className="ever-two">
            {/* Price history */}
            <div>
              <Label>Price history</Label>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                {line.history.map((p, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, gap: 8 }}>
                    <span style={{ color: "var(--muted)" }}>{p.label} <span style={{ opacity: .6 }}>· {p.date}</span></span>
                    <span style={{ fontWeight: 600 }}><Money value={p.amount} /></span>
                  </div>
                ))}
                {!line.history.length && <span style={{ fontSize: 12, color: "var(--muted)" }}>No history — allowance {fmt(line.allowanceLow ?? 0)}–{fmt(line.allowanceHigh ?? 0)}</span>}
              </div>
              {delta !== 0 && (
                <div style={{ fontSize: 12, marginTop: 6, color: delta > 0 ? "var(--rust)" : "var(--ok)" }}>
                  {delta > 0 ? "Up" : "Down"} {fmt(Math.abs(delta))} since first estimate ({fmt(lineStart(line))} → {fmt(lineBase(line))})
                </div>
              )}
              {!ro && <AddPrice lineId={line.id} />}
            </div>

            {/* Controls */}
            <div>
              <Label>Cost owner &amp; markup</Label>
              <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
                <select value={line.owner} disabled={ro} onChange={(e) => store.updateCostLine(line.id, { owner: e.target.value as CostOwner })}>
                  <option value="builder">Builder-carried</option>
                  <option value="owner">Owner-carried</option>
                </select>
                <select value={line.markupModel} disabled={ro} onChange={(e) => store.updateCostLine(line.id, { markupModel: e.target.value as MarkupModel })}>
                  <option value="passthrough">Pass-through + markup</option>
                  <option value="blackbox">Black-box (fee included)</option>
                </select>
                {line.markupModel === "passthrough" && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <input type="number" value={line.markupPct} disabled={ro} onChange={(e) => store.updateCostLine(line.id, { markupPct: Number(e.target.value) })} style={{ width: 60 }} />%
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6 }}>
                Base <strong>{fmt(lineBase(line))}</strong>
                {line.markupModel === "passthrough" && <> + markup <strong>{fmt(lineMarkup(line))}</strong></>}
                {" = "}<strong style={{ color: "var(--ink)" }}>{fmt(lineTotal(line))}</strong>
              </div>
              <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={onAi}>✨ AI: find this cheapest</button>
            </div>
          </div>

          {/* Rooms */}
          <Label style={{ marginTop: 14 }}>Rooms included</Label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            {db.rooms.map((r) => {
              const on = line.roomIds.includes(r.id);
              return (
                <button key={r.id} disabled={ro} onClick={() => store.toggleRoomOnLine(line.id, r.id)} className="btn btn-sm"
                  style={{ background: on ? "var(--sage)" : "var(--paper)", color: on ? "#fff" : "var(--muted)", borderColor: on ? "var(--sage)" : "var(--line)" }}>
                  {on ? "✓ " : ""}{r.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function AddPrice({ lineId }: { lineId: string }) {
  const store = useStore();
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
      <input placeholder="Label (e.g. Final Bid)" value={label} onChange={(e) => setLabel(e.target.value)} style={{ flex: 1, fontSize: 12 }} />
      <input placeholder="$" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 90, fontSize: 12 }} />
      <button className="btn btn-sm" onClick={() => {
        if (!label.trim() || !amount) return;
        store.addPricePoint(lineId, { label: label.trim(), date: new Date().toISOString().slice(0, 10), amount: Number(amount) });
        setLabel(""); setAmount("");
      }}>+ Add</button>
    </div>
  );
}

function StatusPill({ status }: { status: CostLine["status"] }) {
  const map: Record<CostLine["status"], { c: string; b: string }> = {
    estimate: { c: "var(--muted)", b: "var(--cream-2)" },
    allowance: { c: "var(--brass-2)", b: "#f0e6cd" },
    contracted: { c: "#fff", b: "var(--sage-2)" },
    complete: { c: "#fff", b: "var(--walnut)" },
  };
  return <Pill color={map[status].c} bg={map[status].b}>{status}</Pill>;
}

function Label({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)", ...style }}>{children}</div>;
}

// ---------------------------------------------------------------------------
function ContractsSection({ ro }: { ro: boolean }) {
  const store = useStore();
  const db = store.db;
  return (
    <>
      <SectionTitle>Contracts &amp; Funding Phases</SectionTitle>
      <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: -6, marginBottom: 12 }}>
        Costs roll into contracts under agreed terms. The builder breaks the total into phases — each with a % of funds and a clear gate that must be met to release the next round.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {db.contracts.map((c) => {
          const lines = db.costLines.filter((l) => l.contractId === c.id);
          const total = lines.reduce((a, l) => a + lineTotal(l), 0);
          const releasedPct = c.phases.filter((p) => p.released).reduce((a, p) => a + p.pct, 0);
          return (
            <div key={c.id} className="card" style={{ padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <h3 className="serif" style={{ fontSize: 16, fontWeight: 700, color: "var(--walnut)" }}>{c.name}</h3>
                <Pill color={c.termsAccepted ? "#fff" : "var(--rust)"} bg={c.termsAccepted ? "var(--ok)" : "#f3ddd6"}>{c.termsAccepted ? "Terms accepted" : "Terms pending"}</Pill>
                <span style={{ marginLeft: "auto", fontWeight: 700 }}><Money value={total} /></span>
              </div>
              <p style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 12px", whiteSpace: "pre-wrap" }}>{c.terms}</p>

              <div style={{ marginBottom: 10 }}>
                <StackBar height={10} segments={[{ value: releasedPct, color: "var(--ok)" }, { value: Math.max(0, 100 - releasedPct), color: "var(--cream-2)" }]} />
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>{releasedPct}% of contract released · {fmt((total * releasedPct) / 100)} of {fmt(total)}</div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {c.phases.map((p) => (
                  <div key={p.id} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "9px 11px", borderRadius: 8, background: p.released ? "var(--sage-tint)" : "var(--cream)" }}>
                    <button disabled={ro} onClick={() => store.togglePhaseReleased(c.id, p.id)} className="btn btn-sm"
                      style={{ background: p.released ? "var(--ok)" : "var(--paper)", color: p.released ? "#fff" : "var(--ink)", borderColor: p.released ? "var(--ok)" : "var(--line)", flexShrink: 0, minWidth: 96 }}>
                      {p.released ? "✓ Released" : "Release"}
                    </button>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                        <span style={{ fontWeight: 600, fontSize: 13.5 }}>{p.name}</span>
                        <span style={{ fontSize: 12, color: "var(--muted)" }}>{p.pct}% · <strong style={{ color: "var(--ink)" }}>{fmt((total * p.pct) / 100)}</strong></span>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}><strong>Gate:</strong> {p.gate}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
function AiModal({ line, onClose }: { line: CostLine; onClose: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(44,36,28,.45)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div className="card" style={{ maxWidth: 520, width: "100%", padding: 22 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--brass)" }}>✨</span>
          <h3 className="serif" style={{ fontSize: 18, fontWeight: 700, color: "var(--walnut)" }}>AI sourcing — {line.name}</h3>
        </div>
        <div style={{ marginTop: 8, padding: "8px 10px", background: "#f0e6cd", borderRadius: 8, fontSize: 12, color: "var(--brass-2)" }}>
          Placeholder result — this button is wired but not yet connected to a live model. (You chose “stub for now.”)
        </div>
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            { v: "Build.com", p: "$1,180", note: "free ship, in stock" },
            { v: "Ferguson", p: "$1,240", note: "matches spec link" },
            { v: "Wayfair", p: "$1,295", note: "−10% w/ code" },
          ].map((r) => (
            <div key={r.v} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 }}>
              <span><strong>{r.v}</strong> <span style={{ color: "var(--muted)" }}>· {r.note}</span></span>
              <strong>{r.p}</strong>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 12 }}>
          Will also surface local & federal rebates / tax incentives (e.g. energy-efficiency credits) for qualifying products.
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

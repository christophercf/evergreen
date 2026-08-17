"use client";

import { useState } from "react";
import { useStore } from "@/lib/data/hooks";
import {
  MATERIALS_BASIS_LABEL, addWorkingDays,
  type BidPackage, type MaterialsBasis,
} from "@/lib/data/types";
import { Kicker, ScreenHead, Tag, Triage, useNarrow, type TriageRow } from "./kit";

// ---------------------------------------------------------------------------
// 02 — Scope. What the vendors are actually being asked to price.
//
// Without this the flow is a dead end: you can pick trades, pick vendors and
// press "Issue request", and nothing leaves the building. Everything here ends
// up on the one-page request document, and every field exists because leaving it
// out is what makes two bids look comparable when they aren't.
// ---------------------------------------------------------------------------

const toItems = (s: string) => s.split(/\r?\n/).map((x) => x.replace(/^[\s•\-*]+/, "").trim()).filter(Boolean);
const fmtDate = (iso?: string) => iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

export function ScopeScreen({ p, ro, onBack, onNext }: { p: BidPackage; ro: boolean; onBack: () => void; onNext: () => void }) {
  const store = useStore();
  const narrow = useNarrow();
  const items = p.scopeItems ?? toItems(p.scopeDetails);
  const mats = p.materialsList ?? [];
  const ownerSupplied = mats.filter((m) => m.suppliedBy === "owner").length;

  // What has to be true before a vendor can price this honestly.
  const gaps = [
    items.length < 2 && "at least 2 priceable lines — nobody can price a one-liner",
    !p.materialsBasis && "who supplies materials",
    !p.returnBy && "a date you need the bid back",
  ].filter(Boolean) as string[];

  const head = (
    <ScreenHead
      title="What are they pricing?"
      sub="This is the request. Everything here goes on the one-page document the vendors price against — and every bid comes back measured against it."
      tag={gaps.length ? <Tag tone="rust">{gaps.length} to fill in</Tag> : <Tag>Ready to issue</Tag>}
      right={!narrow && <button className="btn btn-primary btn-sm" onClick={onNext}>Contacts →</button>}
    />
  );

  if (narrow) {
    const rows: TriageRow[] = [
      { id: "lines", title: "Priceable lines", value: String(items.length), meta: items.slice(0, 3).join(" · ") || "None yet" },
      { id: "mats", title: "Materials listed", value: String(mats.length), meta: p.materialsBasis ? MATERIALS_BASIS_LABEL[p.materialsBasis] : "Supply basis not set" },
      { id: "back", title: "Bid due", value: fmtDate(p.returnBy), meta: p.expectedStart ? `On site from ${fmtDate(p.expectedStart)}` : "No start date given" },
    ];
    return <>{head}<Triage rows={rows} empty="Nothing scoped yet." back={onBack} next={{ label: "Contacts", onClick: onNext }} /></>;
  }

  return (
    <>
      {head}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.15fr) minmax(0,1fr)", gap: 14, alignItems: "start" }} className="ever-intake">
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <Card label="Overview">
            <textarea className="input" disabled={ro} defaultValue={p.overview ?? ""}
              placeholder="What's being built, where it sits in the schedule, and what a complete job looks like. Keep it to what the vendor needs in order to price."
              onBlur={(e) => store.updateBidPackage(p.id, { overview: e.target.value })}
              style={{ minHeight: 92, fontSize: 12.5, lineHeight: 1.55 }} />
          </Card>

          <Card label={`Priceable lines — ${items.length}`} aside="One per line. Vendors price each.">
            <ScopeLines p={p} ro={ro} />
          </Card>

          <Card label={`Materials needed — ${mats.length}`} aside={ownerSupplied ? `${ownerSupplied} you supply` : undefined}>
            <MaterialsList p={p} ro={ro} />
          </Card>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <Card label="Who supplies materials">
            <select disabled={ro} value={p.materialsBasis ?? ""} style={{ fontSize: 12.5, width: "100%" }}
              onChange={(e) => store.updateBidPackage(p.id, { materialsBasis: (e.target.value || undefined) as MaterialsBasis })}>
              <option value="">Choose…</option>
              {(Object.keys(MATERIALS_BASIS_LABEL) as MaterialsBasis[]).map((k) => <option key={k} value={k}>{MATERIALS_BASIS_LABEL[k]}</option>)}
            </select>
            <textarea className="input" disabled={ro} defaultValue={p.supplyNote ?? ""}
              placeholder="Anything already on site, free-issued, or being bought by you."
              onBlur={(e) => store.updateBidPackage(p.id, { supplyNote: e.target.value })}
              style={{ minHeight: 56, fontSize: 12, lineHeight: 1.5, marginTop: 7 }} />
          </Card>

          <Card label="Dates">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>Bid back by</span>
                <input type="date" disabled={ro} defaultValue={p.returnBy ?? ""} style={{ fontSize: 12 }}
                  onBlur={(e) => store.updateBidPackage(p.id, { returnBy: e.target.value })} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>On site from</span>
                <input type="date" disabled={ro} defaultValue={p.expectedStart ?? ""} style={{ fontSize: 12 }}
                  onBlur={(e) => store.updateBidPackage(p.id, { expectedStart: e.target.value })} />
              </label>
            </div>
            {p.expectedStart && (
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 7, lineHeight: 1.45 }}>
                A 10-day bid starting {fmtDate(p.expectedStart)} would finish{" "}
                <strong style={{ color: "var(--ink)" }}>{fmtDate(addWorkingDays(p.expectedStart, 10))}</strong> — weekends skipped.
              </div>
            )}
          </Card>

          <Card label="Not in this scope" aside="Where change orders come from">
            <textarea className="input" disabled={ro} defaultValue={p.exclusions ?? ""}
              placeholder="Work you expect others to carry out — so they don't price it, and can't claim it later."
              onBlur={(e) => store.updateBidPackage(p.id, { exclusions: e.target.value })}
              style={{ minHeight: 72, fontSize: 12, lineHeight: 1.5 }} />
          </Card>

          {gaps.length > 0 && (
            <div style={{ fontSize: 11.5, lineHeight: 1.6, background: "#f7f1e2", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px" }}>
              <Kicker tone="muted" style={{ marginBottom: 3 }}>Still needed before this goes out</Kicker>
              {gaps.map((g) => <div key={g} style={{ color: "var(--brass-2)" }}>· {g}</div>)}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Card({ label, aside, children }: { label: string; aside?: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: 13 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
        <Kicker>{label}</Kicker>
        {aside && <span style={{ fontSize: 10.5, color: "var(--muted)" }}>{aside}</span>}
      </div>
      {children}
    </div>
  );
}

/** The priceable lines. Edited as text because that's how a builder writes a
 *  scope; stored as a list because that's how bids get compared line for line. */
function ScopeLines({ p, ro }: { p: BidPackage; ro: boolean }) {
  const store = useStore();
  const [text, setText] = useState((p.scopeItems ?? toItems(p.scopeDetails)).join("\n"));
  const dirty = toItems(text).join("\n") !== (p.scopeItems ?? toItems(p.scopeDetails)).join("\n");
  return (
    <>
      <textarea className="input" disabled={ro} value={text} onChange={(e) => setText(e.target.value)}
        placeholder={"One piece of work per line — the more specific, the fewer change orders.\n\nRebuild retaining wall, 18 lf, salvaged brick\nTuckpoint south elevation\nRe-brick two window wells"}
        style={{ minHeight: 132, fontSize: 12.5, lineHeight: 1.6 }} />
      {!ro && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 7 }}>
          <button className={`btn btn-sm ${dirty ? "btn-primary" : ""}`} disabled={!dirty}
            onClick={() => store.setBidScopeItems(p.id, toItems(text))}>
            {dirty ? "Save lines" : "Saved"}
          </button>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>{toItems(text).length} lines</span>
        </div>
      )}
    </>
  );
}

function MaterialsList({ p, ro }: { p: BidPackage; ro: boolean }) {
  const store = useStore();
  const [draft, setDraft] = useState({ qty: "", unit: "", item: "" });
  const mats = p.materialsList ?? [];

  const add = () => {
    if (!draft.item.trim()) return;
    store.addScopeMaterial(p.id, { ...draft, suppliedBy: "vendor" });
    setDraft({ qty: "", unit: "", item: "" });
  };

  return (
    <>
      {!mats.length && <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 8 }}>Nothing listed. Leave empty if the vendor takes off their own quantities.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {mats.map((m) => (
          <div key={m.id} style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 12, flexWrap: "wrap" }}>
            <span style={{ color: "var(--muted)", minWidth: 62 }}>{[m.qty, m.unit].filter(Boolean).join(" ") || "—"}</span>
            <span style={{ flex: 1, minWidth: 110 }}>{m.item}</span>
            <button className="btn btn-sm" disabled={ro} style={{ fontSize: 10.5, padding: "1px 7px" }}
              title="Who buys this line"
              onClick={() => store.updateScopeMaterial(p.id, m.id, { suppliedBy: m.suppliedBy === "vendor" ? "owner" : "vendor" })}>
              {m.suppliedBy === "vendor" ? "vendor buys" : "you buy"}
            </button>
            {!ro && <button className="btn btn-sm" style={{ color: "var(--rust)", padding: "1px 6px" }} onClick={() => store.removeScopeMaterial(p.id, m.id)}>✕</button>}
          </div>
        ))}
      </div>
      {!ro && (
        <div style={{ display: "flex", gap: 6, marginTop: 9, flexWrap: "wrap" }}>
          <input className="input" placeholder="Qty" value={draft.qty} onChange={(e) => setDraft((d) => ({ ...d, qty: e.target.value }))} style={{ width: 58, minHeight: 32, fontSize: 12 }} />
          <input className="input" placeholder="Unit" value={draft.unit} onChange={(e) => setDraft((d) => ({ ...d, unit: e.target.value }))} style={{ width: 64, minHeight: 32, fontSize: 12 }} />
          <input className="input" placeholder="Material and specification" value={draft.item}
            onChange={(e) => setDraft((d) => ({ ...d, item: e.target.value }))}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
            style={{ flex: 1, minWidth: 140, minHeight: 32, fontSize: 12 }} />
          <button className="btn btn-sm" disabled={!draft.item.trim()} onClick={add}>Add</button>
        </div>
      )}
    </>
  );
}

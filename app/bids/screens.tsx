"use client";

import { useState, type ReactNode } from "react";
import { useStore } from "@/lib/data/hooks";
import { Pill } from "../ui/bits";
import {
  BID_ROUTE_SHORT, INTAKE_KEYS, INTAKE_LABEL, INTAKE_REQUIRED, PRICING_BASIS_LABEL,
  bidCostPerDay, bidIntakeComplete,
  type BidPackage, type Confidence, type IntakeKey, type VendorBid,
} from "@/lib/data/types";
import { tradeName } from "@/lib/data/money";
import { storeFile, fileToBase64Payload } from "../ui/upload";
import {
  Kicker, ScreenHead, Tag, Tile, Triage, contactOf, flagsFor, materialsPolicy, money, num, useNarrow, vendorReview,
  type TriageRow,
} from "./kit";

// ---------------------------------------------------------------------------
// Screens 4–6: what happens once bids start coming back.
//
// The invariant running through all three: a bid's completeness is DERIVED from
// its five values, never latched by a "confirmed" flag. Blank a field and the
// bid drops out of the comparison again. Without that, "cheapest" quietly
// starts meaning "least complete".
// ---------------------------------------------------------------------------

const duration = (b: VendorBid) => (b.workingDays ? `${b.workingDays} days` : "duration not stated");

// ---------------------------------------------------------------------------
// 04 — bids in. Inbox on the left, the five fields on the right.
export function IntakeScreen({ p, ro, onBack, onNext }: { p: BidPackage; ro: boolean; onBack: () => void; onNext: () => void }) {
  const narrow = useNarrow();
  const [openId, setOpenId] = useState(p.bids[0]?.id ?? "");
  const open = p.bids.find((b) => b.id === openId) ?? p.bids[0];
  const pending = p.bids.filter((b) => !bidIntakeComplete(b)).length;

  const head = (
    <ScreenHead
      title="Bids received"
      sub={pending
        ? `${pending} of ${p.bids.length} bids still need a field confirmed before they compare like-for-like.`
        : `All ${p.bids.length} bids carry the five required fields.`}
      right={!narrow && <button className="btn btn-primary btn-sm" onClick={onNext}>Compare bids →</button>}
    />
  );

  if (narrow) {
    const rows: TriageRow[] = p.bids.map((b) => {
      const flags = flagsFor(p, b);
      return {
        id: b.id,
        title: b.vendorName,
        value: money(b.amount),
        meta: `${b.route ? BID_ROUTE_SHORT[b.route] : "Route not set"} · ${duration(b)} · ${materialsPolicy(b)}`,
        flag: flags[0],
      };
    });
    return <>{head}<Triage rows={rows} empty="Nobody invited yet." back={onBack} next={{ label: "Compare bids", onClick: onNext }} /></>;
  }

  return (
    <>
      {head}
      {!p.bids.length && <div className="card" style={{ padding: 16, fontSize: 12.5, color: "var(--muted)" }}>Nobody invited yet — go back to <strong>Contacts</strong>.</div>}
      <div className="ever-intake" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.1fr) minmax(0,1fr)", gap: 14, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
          {p.bids.map((b) => <InboxCard key={b.id} p={p} b={b} ro={ro} on={b.id === open?.id} onOpen={() => setOpenId(b.id)} />)}
        </div>
        {open && <ExtractPanel key={open.id} p={p} b={open} ro={ro} />}
      </div>
    </>
  );
}

function InboxCard({ p, b, ro, on, onOpen }: { p: BidPackage; b: VendorBid; ro: boolean; on: boolean; onOpen: () => void }) {
  const store = useStore();
  const ok = bidIntakeComplete(b);
  const flags = flagsFor(p, b);
  return (
    <Tile on={on} onClick={onOpen}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, width: "100%" }}>
        <span className="serif" style={{ fontSize: 15.5, fontWeight: 700, color: "var(--walnut)" }}>{b.vendorName}</span>
        <span className="serif" style={{ fontSize: 15, fontWeight: 700, color: "var(--walnut)" }}>{money(b.amount)}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <Kicker>{b.route ? BID_ROUTE_SHORT[b.route] : "Route not set"}</Kicker>
        <Pill color="#fff" bg={ok ? "var(--ok)" : "var(--brass)"}>{ok ? "Complete" : "Needs review"}</Pill>
      </div>
      <span style={{ fontSize: 11.5, lineHeight: 1.4, color: "var(--muted)" }}>
        {flags[0] ?? `${b.workingDays} days · ${b.crewSize} on site · ${materialsPolicy(b)}`}
      </span>
      {/* Who actually filed the document. Both are first-class: a trade may upload
          its own quote, or email it over for us to file on their behalf. */}
      {b.route === "upload" && !ro && (
        <span style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, width: "100%", marginTop: 2 }}>
          {([["trade", "Trade uploaded"], ["gc", "Emailed to us — we upload"]] as const).map(([k, label]) => (
            <span key={k} role="button" tabIndex={0}
              onClick={(e) => { e.stopPropagation(); store.updateBid(p.id, b.id, { uploadedBy: k }); onOpen(); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); store.updateBid(p.id, b.id, { uploadedBy: k }); } }}
              style={{
                minHeight: 32, padding: "4px 7px", borderRadius: 7, fontSize: 11, lineHeight: 1.25, textAlign: "center",
                display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                background: b.uploadedBy === k ? "var(--sage)" : "var(--paper)", color: b.uploadedBy === k ? "#fff" : "var(--ink)",
                border: `1px solid ${b.uploadedBy === k ? "var(--sage)" : "var(--line)"}`,
              }}>{label}</span>
          ))}
        </span>
      )}
    </Tile>
  );
}

const CONF_STYLE: Record<Confidence, { bg: string; fg: string; label: string }> = {
  high: { bg: "var(--sage-tint)", fg: "var(--sage-2)", label: "High" },
  medium: { bg: "#f7f1e2", fg: "var(--brass-2)", label: "Medium" },
  none: { bg: "transparent", fg: "var(--rust)", label: "Not found" },
};

function ExtractPanel({ p, b, ro }: { p: BidPackage; b: VendorBid; ro: boolean }) {
  const store = useStore();
  const db = store.db;
  const [draft, setDraft] = useState<Record<IntakeKey, string>>(() =>
    Object.fromEntries(INTAKE_KEYS.map((k) => [k, b[k] == null ? "" : String(b[k])])) as Record<IntakeKey, string>);
  const [scan, setScan] = useState({ busy: false, msg: "" });

  const missing = INTAKE_REQUIRED.filter((k) => num(draft[k]) === null);
  const confOf = (k: IntakeKey): Confidence => ((draft[k] ?? "").trim() ? (b.confidence?.[k] ?? "high") : "none");

  // Read the vendor's own document into the five fields. Whatever it can't find
  // stays empty and blocks the confirm — that is the point, not a shortcoming.
  const scanDoc = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setScan({ busy: true, msg: `Reading ${f.name}…` });
    try {
      const [{ fileUrl, fileName }, payload] = await Promise.all([storeFile(f), fileToBase64Payload(f)]);
      const res = await fetch("/api/scan-scope", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: payload.data, mediaType: payload.mediaType, fileName, trade: tradeName(db, p.tradeId) }),
      });
      const j = await res.json();
      if (!j.ok) { setScan({ busy: false, msg: j.error ?? "Couldn't read that document." }); return; }
      const d = j.data ?? {};
      const conf: Confidence = d.confidence === "high" ? "high" : d.confidence === "low" ? "none" : "medium";
      setDraft((prev) => ({
        ...prev,
        amount: d.price > 0 ? String(d.price) : prev.amount,
        materialsCost: d.materialsCost > 0 ? String(d.materialsCost) : prev.materialsCost,
        laborCost: d.laborCost > 0 ? String(d.laborCost) : prev.laborCost,
        workingDays: d.workingDays > 0 ? String(d.workingDays) : prev.workingDays,
        crewSize: d.crewSize > 0 ? String(d.crewSize) : prev.crewSize,
      }));
      store.updateBid(p.id, b.id, {
        sourceDoc: { name: fileName, url: fileUrl, scannedAt: new Date().toISOString() },
        scopeText: Array.isArray(d.items) ? d.items.join("\n") : b.scopeText,
        confidence: Object.fromEntries(INTAKE_KEYS.map((k) => [k, conf])) as Partial<Record<IntakeKey, Confidence>>,
      });
      setScan({ busy: false, msg: `Read ${fileName}. Check every field before confirming — ${d.note ?? "anything it couldn't find is blank."}` });
    } catch { setScan({ busy: false, msg: "Couldn't read that document." }); }
  };

  const confirm = () => {
    if (missing.length) return;
    store.updateBid(p.id, b.id, {
      amount: num(draft.amount) ?? undefined,
      materialsCost: num(draft.materialsCost) ?? undefined,
      laborCost: num(draft.laborCost) ?? undefined,
      workingDays: num(draft.workingDays) ?? undefined,
      crewSize: num(draft.crewSize) ?? undefined,
      // A bid we key ourselves is priced on the package's basis by definition.
      // Only a vendor's own document can put it off-basis.
      pricingBasis: b.pricingBasis ?? p.pricingBasis,
      status: b.status === "requested" ? "received" : b.status,
    });
  };

  return (
    <div className="card" style={{ padding: 14, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <Kicker>Confirm extracted fields</Kicker>
        {b.sourceDoc
          ? <a href={b.sourceDoc.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--sage-2)", fontWeight: 600 }}>
              {b.sourceDoc.name} · uploaded by {b.uploadedBy === "gc" ? "us" : "the trade"}
            </a>
          : <span style={{ fontSize: 11, color: "var(--muted)" }}>No document — keyed directly</span>}
      </div>
      <div className="serif" style={{ fontSize: 17, fontWeight: 700, color: "var(--walnut)", marginTop: 6 }}>{b.vendorName}</div>
      <div style={{ fontSize: 11.5, lineHeight: 1.45, color: "var(--muted)", margin: "3px 0 12px" }}>
        {b.route === "upload"
          ? "Read from their own template. Anything it couldn't find is blank; the rest needs a glance before this bid enters the comparison."
          : "This bid is entered on our own form, so every field is typed straight in."}
      </div>

      {b.route === "upload" && !ro && (
        <div style={{ marginBottom: 12 }}>
          <label className="btn btn-sm" style={{ cursor: "pointer" }}>
            {scan.busy ? "Reading…" : "📄 Read their document"}
            <input type="file" accept="application/pdf,image/*" hidden disabled={scan.busy} onChange={(e) => void scanDoc(e.target.files)} />
          </label>
          {scan.msg && <div style={{ fontSize: 11, lineHeight: 1.4, color: "var(--muted)", marginTop: 5 }}>{scan.msg}</div>}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {INTAKE_KEYS.map((k) => {
          const c = CONF_STYLE[confOf(k)];
          return (
            <div key={k} style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>{INTAKE_LABEL[k]}</span>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 99, background: c.bg, color: c.fg,
                  border: `1px solid ${c.fg === "var(--rust)" ? "var(--rust)" : "transparent"}`,
                }}>{c.label}</span>
              </div>
              <input className="input" disabled={ro} value={draft[k]} inputMode="decimal"
                placeholder={k === "workingDays" || k === "crewSize" ? "Not found" : "$"}
                onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                style={{ minHeight: 34, fontSize: 13, width: "100%" }} />
            </div>
          );
        })}
      </div>

      {/* The gate is the whole feature: the button names what is still missing and
          stays outlined until every required field parses to a number. */}
      {!ro && (
        <button className={`btn ${missing.length ? "" : "btn-primary"}`} disabled={missing.length > 0} onClick={confirm}
          style={{ marginTop: 12, minHeight: 38, fontSize: 12.5, width: "100%", justifyContent: "center", textAlign: "center" }}>
          {missing.length
            ? `Still empty: ${missing.map((k) => INTAKE_LABEL[k].toLowerCase()).join(", ")}`
            : bidIntakeComplete(b) ? "Confirmed — enters the comparison" : "Confirm fields"}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 05 — compare. Same five fields, side by side, nothing silently adjusted.
// Nothing on this screen writes: the figures are as bid and the internal review
// belongs to the vendor record, so there is no read-only variant to draw.
export function CompareScreen({ p, onBack, onNext }: { p: BidPackage; onBack: () => void; onNext: () => void }) {
  const store = useStore();
  const db = store.db;
  const narrow = useNarrow();
  const [view, setView] = useState<"matrix" | "cards">("matrix");

  const bids = p.bids;
  const vals = (pick: (b: VendorBid) => number | null | undefined) =>
    bids.map(pick).filter((v): v is number => typeof v === "number" && v > 0);
  const lowTotal = Math.min(...vals((b) => b.amount), Infinity);
  const lowLabor = Math.min(...vals((b) => b.laborCost), Infinity);
  const lowDays = Math.min(...vals((b) => b.workingDays), Infinity);
  const maxTotal = Math.max(...vals((b) => b.amount), 0);
  const flagged = bids.map((b) => ({ b, flags: flagsFor(p, b) })).filter((x) => x.flags.length);

  const head = (
    <ScreenHead
      title={`${tradeName(db, p.tradeId)} — ${bids.length} bid${bids.length === 1 ? "" : "s"}`}
      tag={p.pricingBasis && <Tag>{PRICING_BASIS_LABEL[p.pricingBasis]} basis</Tag>}
      sub={flagged.length
        ? `${flagged.length === 1 ? "One bid is" : `${flagged.length} bids are`} flagged as not like-for-like. Figures are shown as bid; nothing is silently adjusted.`
        : `All ${bids.length} bids arrived on the same five fields. Lowest figure in each row is tinted.`}
      right={!narrow && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn btn-sm" style={{ background: view === "matrix" ? "var(--sage-tint)" : undefined }} onClick={() => setView("matrix")}>Matrix</button>
          <button className="btn btn-sm" style={{ background: view === "cards" ? "var(--sage-tint)" : undefined }} onClick={() => setView("cards")}>Scorecards</button>
          <button className="btn btn-primary btn-sm" onClick={onNext}>Award →</button>
        </div>
      )}
    />
  );

  if (narrow) {
    const rows: TriageRow[] = bids.map((b) => ({
      id: b.id,
      title: b.vendorName,
      value: money(b.amount),
      meta: `${duration(b)} · ${bidCostPerDay(b) ? `${money(bidCostPerDay(b))} per working day` : "no per-day figure"} · ${b.route ? BID_ROUTE_SHORT[b.route] : "—"}`,
      flag: flagsFor(p, b)[0],
    }));
    return <>{head}<Triage rows={rows} empty="No bids to compare yet." back={onBack} next={{ label: "Award", onClick: onNext }} /></>;
  }

  const cell = (key: string, v: string, note: string | undefined, best: boolean) => (
    <td key={key} style={{ background: best ? "var(--sage-tint)" : undefined, padding: "7px 9px", borderBottom: "1px solid var(--line)", verticalAlign: "top" }}>
      <span className={best ? "serif" : undefined} style={{ fontSize: best ? 15 : 12.5, fontWeight: best ? 700 : 400, color: best ? "var(--walnut)" : "var(--ink)" }}>{v}</span>
      {note && <span style={{ display: "block", fontSize: 10.5, lineHeight: 1.3, color: "var(--muted)", marginTop: 2 }}>{note}</span>}
    </td>
  );

  const rows: { label: string; render: (b: VendorBid) => ReactNode }[] = [
    { label: "Total project cost", render: (b) => cell(b.id, money(b.amount), b.amount === lowTotal ? "lowest" : undefined, b.amount === lowTotal) },
    { label: "Labor line", render: (b) => cell(b.id, money(b.laborCost), b.laborCost === lowLabor ? "lowest" : undefined, b.laborCost === lowLabor) },
    { label: "Working days", render: (b) => cell(b.id, b.workingDays ? `${b.workingDays} days` : "Not stated", b.workingDays ? undefined : "field missing", b.workingDays === lowDays) },
    { label: "Cost per day", render: (b) => cell(b.id, money(bidCostPerDay(b)), undefined, false) },
    { label: "Pricing basis", render: (b) => cell(b.id, b.pricingBasis ? PRICING_BASIS_LABEL[b.pricingBasis] : "Not stated", p.pricingBasis && b.pricingBasis && b.pricingBasis !== p.pricingBasis ? "off-basis" : undefined, false) },
    // Crew rate and the cap only mean anything on a time & materials package.
    ...(p.pricingBasis === "tm"
      ? [{ label: "Crew rate", render: (b: VendorBid) => cell(b.id, b.crewRate ? `$${b.crewRate}/hr` : "Not stated", b.notToExceed ? `cap ${money(b.notToExceed)}` : undefined, false) }]
      : []),
    { label: "Materials in bid", render: (b) => cell(b.id, money(b.materialsCost), b.materialsCost ? undefined : "not priced", false) },
    { label: "Crew on site", render: (b) => cell(b.id, b.crewSize ? String(b.crewSize) : "Not stated", b.crewSize ? undefined : "field missing", false) },
    { label: "Internal review", render: (b) => { const r = vendorReview(db, b); return cell(b.id, r.rating, r.note, false); } },
    { label: "Like-for-like", render: (b) => cell(b.id, flagsFor(p, b).length ? "Flagged" : "Comparable", undefined, false) },
  ];

  return (
    <>
      {head}

      {view === "matrix" ? (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 520, borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", width: 150, padding: "8px 9px", borderBottom: "1px solid var(--line)", position: "sticky", left: 0, background: "var(--paper)" }} />
                {bids.map((b) => (
                  <th key={b.id} style={{ textAlign: "left", padding: "8px 9px", borderBottom: "1px solid var(--line)" }}>
                    <div className="serif" style={{ fontSize: 14, fontWeight: 700, color: "var(--walnut)" }}>{b.vendorName}</div>
                    <Kicker style={{ marginTop: 2 }}>{b.route ? BID_ROUTE_SHORT[b.route] : "—"}</Kicker>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <td style={{ fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)", padding: "7px 9px", borderBottom: "1px solid var(--line)", position: "sticky", left: 0, background: "var(--paper)" }}>{r.label}</td>
                  {bids.map((b) => r.render(b))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(215px, 1fr))", gap: 12 }}>
          {bids.map((b) => {
            const review = vendorReview(db, b);
            const flags = flagsFor(p, b);
            return (
              <div key={b.id} className="card" style={{ padding: 13, display: "flex", flexDirection: "column", gap: 9 }}>
                <div>
                  <div className="serif" style={{ fontSize: 15.5, fontWeight: 700, color: "var(--walnut)" }}>{b.vendorName}</div>
                  <Kicker style={{ marginTop: 2 }}>{b.route ? BID_ROUTE_SHORT[b.route] : "—"}</Kicker>
                </div>
                <div>
                  <div className="serif" style={{ fontSize: 25, lineHeight: 1, fontWeight: 700, color: b.amount === lowTotal ? "var(--sage-2)" : "var(--walnut)" }}>{money(b.amount)}</div>
                  <div style={{ height: 5, background: "var(--cream-2)", borderRadius: 3, marginTop: 6 }}>
                    <div style={{ height: 5, borderRadius: 3, background: "var(--sage)", width: maxTotal ? `${Math.round(((b.amount ?? 0) / maxTotal) * 100)}%` : "0%" }} />
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 4 }}>
                    {bidCostPerDay(b) ? `${money(bidCostPerDay(b))} per working day` : "Duration not stated"}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
                  {([
                    ["Labor line", money(b.laborCost)],
                    ["Materials line", money(b.materialsCost)],
                    ["Working days", b.workingDays ? String(b.workingDays) : "—"],
                    ["Crew", b.crewSize ? String(b.crewSize) : "—"],
                    ["Pricing basis", b.pricingBasis ? PRICING_BASIS_LABEL[b.pricingBasis] : "—"],
                  ] as const).map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ color: "var(--muted)" }}>{k}</span><span>{v}</span>
                    </div>
                  ))}
                </div>
                <div style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
                  <Kicker>Internal review</Kicker>
                  <div style={{ fontSize: 12.5, marginTop: 3 }}>{review.rating}</div>
                  {review.note && <div style={{ fontSize: 11.5, lineHeight: 1.45, color: "var(--ink)", marginTop: 2 }}>{review.note}</div>}
                  <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>{review.provenance}</div>
                </div>
                {flags.map((f) => <span key={f}><Tag tone="rust">{f}</Tag></span>)}
              </div>
            );
          })}
        </div>
      )}

      {flagged.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginTop: 12 }}>
          {flagged.map(({ b, flags }) => (
            <div key={b.id} className="card" style={{ padding: 12 }}>
              <Kicker tone="rust">Not like-for-like — {b.vendorName}</Kicker>
              {flags.map((f) => <div key={f} style={{ fontSize: 12, lineHeight: 1.45, marginTop: 4 }}>{f}</div>)}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// 06 — shortlist and award. The internal review is read here, never written.
export function AwardScreen({ p, ro, onBack }: { p: BidPackage; ro: boolean; onBack: () => void }) {
  const store = useStore();
  const db = store.db;
  const narrow = useNarrow();
  const shortlisted = p.bids.filter((b) => b.shortlisted).length;
  const awarded = p.bids.find((b) => b.id === p.awardedBidId);
  const priced = p.bids.filter((b) => typeof b.amount === "number");
  const cheapest = priced.length ? priced.reduce((a, b) => (b.amount! < a.amount! ? b : a)) : undefined;
  const cheapestFlags = cheapest ? flagsFor(p, cheapest) : [];

  const award = (b: VendorBid) => {
    if (confirm(`Award ${b.vendorName} at ${money(b.amount)}? This locks the price into Project Budget.`)) store.awardBid(p.id, b.id);
  };

  const head = (
    <ScreenHead
      title="Shortlist and award"
      sub={`${shortlisted} shortlisted. Internal reviews are pulled from the vendor record, read-only.`}
    />
  );

  if (narrow) {
    const rows: TriageRow[] = p.bids.map((b) => ({
      id: b.id,
      title: b.vendorName,
      value: money(b.amount),
      meta: `${duration(b)} · ${materialsPolicy(b)}${b.shortlisted ? " · ★ shortlisted" : ""}${p.awardedBidId === b.id ? " · 🏆 awarded" : ""}`,
      flag: flagsFor(p, b)[0],
      on: p.awardedBidId === b.id,
      onClick: ro ? undefined : () => store.toggleBidShortlist(p.id, b.id),
    }));
    return <>{head}<Triage rows={rows} empty="No bids to award." back={onBack} /></>;
  }

  return (
    <>
      {head}
      <div className="ever-intake" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", gap: 14, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
          {p.bids.map((b) => {
            const isAwarded = p.awardedBidId === b.id;
            return (
              <div key={b.id} className="card" style={{ padding: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", background: isAwarded ? "var(--sage-tint)" : undefined, borderColor: isAwarded ? "var(--sage)" : undefined }}>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <div className="serif" style={{ fontSize: 15.5, fontWeight: 700, color: "var(--walnut)" }}>{b.vendorName}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
                    {money(b.amount)} · {duration(b)} · {materialsPolicy(b)}
                  </div>
                </div>
                {!ro && (
                  <>
                    <button className="btn btn-sm" style={{ background: b.shortlisted ? "var(--sage-tint)" : undefined }} onClick={() => store.toggleBidShortlist(p.id, b.id)}>
                      {b.shortlisted ? "★ Shortlisted" : "Shortlist"}
                    </button>
                    <button className={`btn btn-sm ${isAwarded ? "btn-primary" : ""}`} disabled={b.amount == null || p.status === "awarded"}
                      title={b.amount == null ? "This bid has no total yet" : undefined} onClick={() => award(b)}>
                      {isAwarded ? "🏆 Awarded" : "Award"}
                    </button>
                  </>
                )}
              </div>
            );
          })}
          {!p.bids.length && <div className="card" style={{ padding: 16, fontSize: 12.5, color: "var(--muted)" }}>No bids to award yet.</div>}
        </div>

        <div className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <Kicker>Decision record</Kicker>
          <div className="serif" style={{ fontSize: 19, fontWeight: 700, color: "var(--walnut)", lineHeight: 1.15 }}>{awarded?.vendorName ?? "No award yet"}</div>
          <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--muted)" }}>
            {awarded
              ? `${money(awarded.amount)} · ${awarded.route ? BID_ROUTE_SHORT[awarded.route] : "—"}${p.lineId ? " · promoted into Project Budget" : ""}`
              : "Pick a bid on the left. The reason travels with the package."}
          </div>
          <div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 4 }}>Why this bid</div>
            <textarea className="input" disabled={ro} defaultValue={p.awardReason ?? ""} placeholder="One line the team can read in six months."
              onBlur={(e) => store.updateBidPackage(p.id, { awardReason: e.target.value })}
              style={{ minHeight: 84, fontSize: 12.5, lineHeight: 1.5, width: "100%" }} />
          </div>
          {/* The cheapest bid is the one most likely to be awarded on autopilot, so
              its flags get the last word before anybody clicks Award. */}
          {cheapest && cheapestFlags.length > 0 && (
            <div style={{ fontSize: 11, lineHeight: 1.5, color: "var(--muted)", borderTop: "1px solid var(--line)", paddingTop: 9 }}>
              <strong style={{ color: "var(--rust)" }}>{cheapest.vendorName}</strong> is the lowest figure but is flagged: {cheapestFlags[0]} Read it against the others before awarding.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

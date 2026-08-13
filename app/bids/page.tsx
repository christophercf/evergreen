"use client";

import { useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/data/hooks";
import { PageHeader, NoAccess, Pill, SectionTitle, NumInput, TextInput } from "../ui/bits";
import { TradeRatingChip } from "../ui/rating";
import {
  accessFor, BID_ORIGIN_LABEL, BID_REQ_DEFAULT, BID_REQ_HINT, BID_REQ_KEYS, BID_REQ_LABEL, MATERIALS_BASIS_LABEL,
  bidCompleteness, packageReadiness,
  type BidComparison, type BidOrigin, type BidPackage, type BidReqKey, type MaterialsBasis, type ScopeDoc, type VendorBid,
} from "@/lib/data/types";
import { tradeName, MACRO_ORDER, fmt } from "@/lib/data/money";
import { storeFile, fileToBase64Payload } from "../ui/upload";
import { jsPDF } from "jspdf";

// ---------------------------------------------------------------------------
// Scope Support — pre-budget bidding.
//   1. Build a package three ways (trade default template / builder-written /
//      import the trade's own template) — all harmonize into the same scope
//      line items so bids stay comparable.
//   2. Send to vendors, collect bids, see who's high/low at a glance with the
//      vendor's performance rating alongside the number.
//   3. AI scope check flags bids that aren't apples-to-apples.
//   4. Award → promotes into Project Budget (ROM → BUDGET).
// ---------------------------------------------------------------------------

const fmtD = (s: string) => new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const VIA: VendorBid["receivedVia"][] = ["email", "text", "phone", "form", "pdf"];
const toItems = (s: string) => s.split(/\r?\n/).map((x) => x.replace(/^[\s•\-*]+/, "").trim()).filter(Boolean);

function downloadBidRequestPdf(opts: { projectName: string; title: string; trade: string; rooms: string[]; scope: string; items: string[]; rfp: boolean; requirements?: BidReqKey[]; materialsBasis?: MaterialsBasis }) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const M = 48, W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  let y = M;
  const ensure = (h = 14) => { if (y + h > H - M) { doc.addPage(); y = M; } };
  const text = (s: string, o: { size?: number; bold?: boolean; color?: [number, number, number]; gap?: number; indent?: number } = {}) => {
    const size = o.size ?? 10, color = o.color ?? [44, 36, 28], gap = o.gap ?? 4, indent = o.indent ?? 0;
    doc.setFont("helvetica", o.bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(...color);
    for (const ln of doc.splitTextToSize(s, W - 2 * M - indent)) { ensure(size + gap); doc.text(ln, M + indent, y); y += size + gap; }
  };
  const rule = () => { ensure(16); doc.setDrawColor(221, 210, 189); doc.line(M, y, W - M, y); y += 12; };
  const blank = (label: string, lines = 1) => {
    text(label, { size: 10, bold: true, color: [58, 47, 37] });
    for (let i = 0; i < lines; i++) { ensure(22); doc.setDrawColor(150, 140, 120); doc.line(M, y + 12, W - M, y + 12); y += 22; }
    y += 4;
  };

  text("EVERGREEN AI", { size: 9, bold: true, color: [176, 138, 62] });
  text(`${opts.rfp ? "Request for Proposal" : "Bid Request"} — ${opts.title}`, { size: 18, bold: true, color: [58, 47, 37], gap: 2 });
  text(`${opts.projectName} · Trade: ${opts.trade}${opts.rooms.length ? ` · Rooms: ${opts.rooms.join(", ")}` : ""}`, { size: 10, color: [122, 111, 96] });
  if (opts.materialsBasis) text(`Materials: ${MATERIALS_BASIS_LABEL[opts.materialsBasis]}`, { size: 10, bold: true, color: [176, 138, 62] });
  rule();
  if (opts.items.length) {
    text("Price each line below. Leave blank anything you are not including.", { size: 10, bold: true });
    y += 2;
    for (const it of opts.items) {
      ensure(26);
      text(`• ${it}`, { size: 10, gap: 2 });
      doc.setDrawColor(150, 140, 120); doc.line(W - M - 130, y + 9, W - M, y + 9);
      doc.setFontSize(8); doc.setTextColor(122, 111, 96); doc.text("$", W - M - 138, y + 9);
      y += 18;
    }
    y += 6;
  } else {
    text(opts.rfp ? "Brief description of work:" : "Scope of work:", { size: 11, bold: true });
    text(opts.scope || "(to be discussed)", { size: 10, color: [80, 72, 60] });
    y += 8;
  }
  if (opts.rfp) {
    text("VENDOR: please detail your proposed scope of work below.", { size: 10, bold: true, color: [176, 138, 62] });
    blank("Proposed scope of work", 8);
  }
  blank("Total price (USD)", 1);
  // Required answers — a bid missing these can't be compared fairly.
  const reqs = opts.requirements ?? [];
  if (reqs.length) {
    y += 2;
    text("REQUIRED — a bid without these can't be evaluated:", { size: 10, bold: true, color: [176, 138, 62] });
    for (const k of reqs) {
      if (k === "lineItemPricing") continue; // already priced line-by-line above
      blank(BID_REQ_LABEL[k], k === "exclusions" || k === "ownerSupplied" ? 2 : 1);
    }
  }
  blank("Company · Contact · Phone · Email", 2);
  blank("Signature & date", 1);
  text("Return by email, text or phone — your bid will be logged in the project's Scope Support board.", { size: 8.5, color: [122, 111, 96] });
  doc.save(`${opts.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${opts.rfp ? "rfp" : "bid-request"}.pdf`);
}

export default function BidsPage() {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const user = store.currentUser;
  const access = accessFor(user, role, "bids");
  if (access === "none") return <NoAccess module="Scope Support" />;
  const ro = access !== "edit";

  const packages = db.bidPackages ?? [];
  const drafts = packages.filter((p) => p.status === "draft");
  const open = packages.filter((p) => p.status === "collecting");
  const awarded = packages.filter((p) => p.status === "awarded");

  // Cluster collecting packages by Building Costs category (a vendor spanning
  // several trades shows under each).
  const catOf = (p: BidPackage) => db.trades.find((t) => t.id === p.tradeId)?.category ?? "Soft Costs";
  const grouped = MACRO_ORDER.map((cat) => ({ cat, items: open.filter((p) => catOf(p) === cat) })).filter((g) => g.items.length);

  return (
    <>
      <PageHeader
        title="Scope Support"
        subtitle="Competitive bidding before the budget: build a scope three ways, send it to multiple vendors, compare bids line-for-line with an AI apples-to-apples check, then award — the price promotes straight into Project Budget."
        right={<Link href="/costs" className="btn btn-sm">Project Budget →</Link>}
      />

      {!ro && <NewPackage />}

      {drafts.length > 0 && (
        <>
          <SectionTitle>Drafts ({drafts.length})</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {drafts.map((p) => <PackageCard key={p.id} p={p} ro={ro} />)}
          </div>
        </>
      )}

      <SectionTitle>Collecting bids ({open.length})</SectionTitle>
      {!open.length && <div className="card" style={{ padding: 16, fontSize: 12.5, color: "var(--muted)" }}>No packages out to vendors yet.</div>}
      {grouped.map(({ cat, items }) => (
        <div key={cat} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--brass-2)", margin: "10px 0 6px" }}>{cat}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {items.map((p) => <PackageCard key={p.id} p={p} ro={ro} />)}
          </div>
        </div>
      ))}

      {awarded.length > 0 && (
        <>
          <SectionTitle>Awarded ({awarded.length})</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {awarded.map((p) => <PackageCard key={p.id} p={p} ro={ro} />)}
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
function NewPackage() {
  const store = useStore();
  const db = store.db;
  const [openForm, setOpenForm] = useState(false);
  const [origin, setOrigin] = useState<BidOrigin | null>(null);
  const [title, setTitle] = useState("");
  const [tradeId, setTradeId] = useState("");
  const [rooms, setRooms] = useState<string[]>([]);
  const [scope, setScope] = useState("");
  const [basis, setBasis] = useState<MaterialsBasis | "">("");
  const [reqs, setReqs] = useState<BidReqKey[]>(BID_REQ_DEFAULT);
  const [target, setTarget] = useState("");
  const [sendTo, setSendTo] = useState<string[]>([]);
  // vendor_import scan state
  const [scan, setScan] = useState<{ busy: boolean; msg: string; doc?: ScopeDoc; conf?: string }>({ busy: false, msg: "" });

  const tpl = tradeId ? db.scopeTemplates.find((t) => t.tradeId === tradeId) : undefined;
  const vendorContacts = db.contacts.filter((c) => c.party === "vendor");
  const tradeVendors = tradeId ? vendorContacts.filter((c) => c.tradeId === tradeId) : [];
  const otherVendors = vendorContacts.filter((c) => !tradeId || c.tradeId !== tradeId);

  const loadTradeTemplate = (tid: string) => {
    const cells = db.scope.filter((c) => c.tradeId === tid && c.status === "in");
    setRooms(cells.map((c) => c.roomId));
    const fromTemplate = db.scopeTemplates.find((t) => t.tradeId === tid)?.items ?? [];
    const fromMatrix = Array.from(new Set(cells.flatMap((c) => c.items.filter((i) => i.included).map((i) => i.label))));
    setScope((fromTemplate.length ? fromTemplate : fromMatrix).join("\n"));
  };

  const pick = (o: BidOrigin) => {
    setOrigin(o);
    if (o === "trade_template" && tradeId) loadTradeTemplate(tradeId);
    if (o !== "trade_template") setScope("");
  };

  // Scan a vendor's PDF or a phone photo into template-shaped line items.
  const scanFile = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setScan({ busy: true, msg: `Reading ${f.name}…` });
    try {
      const [{ fileUrl, fileName }, payload] = await Promise.all([storeFile(f), fileToBase64Payload(f)]);
      const doc: ScopeDoc = { name: fileName, url: fileUrl, scannedAt: new Date().toISOString() };
      const res = await fetch("/api/scan-scope", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: payload.data, mediaType: payload.mediaType, fileName, trade: tradeId ? tradeName(db, tradeId) : undefined, templateItems: tpl?.items ?? [] }),
      });
      const j = await res.json();
      if (!j.ok) { setScan({ busy: false, msg: j.error ?? "Scan failed.", doc }); return; }
      const d = j.data ?? {};
      if (Array.isArray(d.items) && d.items.length) setScope(d.items.join("\n"));
      if (!title.trim() && d.vendor) setTitle(`${d.vendor} — scope`);
      if (d.price > 0) setTarget(String(d.price));
      if (d.materialsIncluded === "included") setBasis("vendor_supplies");
      else if (d.materialsIncluded === "labor_only") setBasis("owner_supplies");
      else if (d.materialsIncluded === "partial") setBasis("mixed");
      setScan({ busy: false, doc, conf: d.confidence, msg: `Read ${(d.items ?? []).length} line item${(d.items ?? []).length === 1 ? "" : "s"}${d.price > 0 ? ` · total $${Number(d.price).toLocaleString()}` : ""}${d.confidence ? ` · ${d.confidence} confidence` : ""}${d.note ? ` — ${d.note}` : ""}` });
    } catch {
      setScan({ busy: false, msg: "Couldn't read that file." });
    }
  };

  const create = (issue: boolean) => {
    if (!title.trim() || !tradeId || !origin) return;
    const id = store.addBidPackage({
      title, tradeId, roomIds: rooms, scopeDetails: scope, scopeItems: toItems(scope), origin,
      status: "draft", materialsBasis: basis || undefined, requirements: reqs,
      targetBudget: target ? Number(target.replace(/[^0-9.]/g, "")) : undefined,
      sourceDoc: scan.doc,
    });
    if (sendTo.length) store.addBidsForContacts(id, sendTo);
    if (issue) store.issueBidPackage(id);
    setTitle(""); setTradeId(""); setRooms([]); setScope(""); setOrigin(null); setBasis(""); setTarget("");
    setSendTo([]); setReqs(BID_REQ_DEFAULT); setScan({ busy: false, msg: "" });
    setOpenForm(false);
  };

  if (!openForm) return <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => setOpenForm(true)}>＋ New bid package</button>;

  const OPTIONS: { o: BidOrigin; icon: string; blurb: string }[] = [
    { o: "trade_template", icon: "📋", blurb: "Use this trade's standard checklist and in-scope rooms, then pick who to email it to." },
    { o: "builder_scope", icon: "✍️", blurb: "You write the scope; the vendor prices it and fills in any detail you leave open (RFP)." },
    { o: "vendor_import", icon: "📥", blurb: "Scan a vendor's PDF or snap a photo of their quote — we translate it into the template format." },
  ];

  // Live readiness against the same rules the package uses.
  const draftForCheck = { title, tradeId, roomIds: rooms, scopeItems: toItems(scope), materialsBasis: basis || undefined, requirements: reqs } as BidPackage;
  const check = packageReadiness(draftForCheck);

  return (
    <div className="card" style={{ padding: 14, marginTop: 14, borderLeft: "3px solid var(--sage)", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input autoFocus placeholder="Package title — e.g. Basement windows supply & install" value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: 1, minWidth: 220, fontSize: 13.5 }} />
        <select value={tradeId} onChange={(e) => { setTradeId(e.target.value); if (origin === "trade_template" && e.target.value) loadTradeTemplate(e.target.value); }} style={{ fontSize: 12.5 }}>
          <option value="">— trade —</option>
          {MACRO_ORDER.map((c) => <optgroup key={c} label={c}>{db.trades.filter((t) => t.category === c).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>)}
        </select>
      </div>

      <div>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 5 }}>How do you want to build this scope?</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(215px, 1fr))", gap: 8 }}>
          {OPTIONS.map(({ o, icon, blurb }) => (
            <button key={o} onClick={() => pick(o)} disabled={!tradeId && o === "trade_template"}
              style={{ textAlign: "left", padding: "9px 11px", borderRadius: 10, cursor: tradeId || o !== "trade_template" ? "pointer" : "not-allowed",
                border: origin === o ? "2px solid var(--sage)" : "1px solid var(--line)", background: origin === o ? "var(--sage-tint)" : "var(--paper)" }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--walnut)" }}>{icon} {BID_ORIGIN_LABEL[o]}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3, lineHeight: 1.35 }}>{blurb}</div>
            </button>
          ))}
        </div>
        {origin === "trade_template" && tradeId && (
          <div style={{ fontSize: 11.5, color: "var(--sage-2)", marginTop: 6 }}>
            Loaded {toItems(scope).length} item{toItems(scope).length === 1 ? "" : "s"} {tpl?.items.length ? "from the trade scope template" : "from the scope matrix"} · {rooms.length} room{rooms.length === 1 ? "" : "s"}
          </div>
        )}
      </div>

      {/* Import & scan */}
      {origin === "vendor_import" && (
        <div style={{ border: "1px dashed var(--line)", borderRadius: 10, padding: 10, background: "var(--paper)" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <label className="btn btn-sm" style={{ cursor: "pointer" }}>
              📄 Upload PDF
              <input type="file" accept="application/pdf" style={{ display: "none" }} onChange={(e) => { void scanFile(e.target.files); e.target.value = ""; }} />
            </label>
            <label className="btn btn-sm" style={{ cursor: "pointer" }}>
              📷 Photo of a paper quote
              <input type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => { void scanFile(e.target.files); e.target.value = ""; }} />
            </label>
            {scan.busy && <span style={{ fontSize: 12, color: "var(--muted)" }}>✨ {scan.msg}</span>}
            {scan.doc && !scan.busy && <a className="btn btn-sm" href={scan.doc.url} target="_blank" rel="noreferrer">👁 View original</a>}
          </div>
          {!scan.busy && scan.msg && (
            <div style={{ fontSize: 11.5, marginTop: 7, color: scan.conf === "low" ? "var(--rust)" : "var(--sage-2)" }}>
              ✨ {scan.msg}
              {scan.conf === "low" && <strong> — check the original before sending.</strong>}
            </div>
          )}
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>Or just paste their text below. The original file stays attached either way.</div>
        </div>
      )}

      {origin && (
        <>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {db.rooms.map((r) => {
              const on = rooms.includes(r.id);
              return <button key={r.id} className="btn btn-sm" onClick={() => setRooms((p) => on ? p.filter((x) => x !== r.id) : [...p, r.id])}
                style={{ fontSize: 11, padding: "2px 8px", background: on ? "var(--sage)" : undefined, color: on ? "#fff" : undefined, borderColor: on ? "var(--sage)" : undefined }}>{r.name}</button>;
            })}
          </div>
          <label style={{ fontSize: 10.5, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 3 }}>
            Scope line items — one per line. Every vendor prices this same list.
            <textarea value={scope} onChange={(e) => setScope(e.target.value)}
              placeholder={origin === "builder_scope" ? "Remove existing gutters\nInstall 6\" seamless aluminum gutters\nDownspouts to grade + splash blocks" : origin === "vendor_import" ? "Paste the vendor's scope here — one item per line" : ""}
              style={{ minHeight: 120, fontSize: 12.5 }} />
          </label>

          {/* Guard rails */}
          <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)" }}>Bid requirements</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
                Materials
                <select value={basis} onChange={(e) => setBasis(e.target.value as MaterialsBasis)} style={{ fontSize: 12, borderColor: basis ? undefined : "var(--rust)" }}>
                  <option value="">— who supplies? —</option>
                  {(Object.keys(MATERIALS_BASIS_LABEL) as MaterialsBasis[]).map((k) => <option key={k} value={k}>{MATERIALS_BASIS_LABEL[k]}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6, color: "var(--muted)" }}>
                Target budget (optional)
                <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" placeholder="$" style={{ width: 92, fontSize: 12 }} />
              </label>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "2px 12px" }}>
              {BID_REQ_KEYS.map((k) => (
                <label key={k} title={BID_REQ_HINT[k]} style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={reqs.includes(k)} onChange={() => setReqs((p) => p.includes(k) ? p.filter((x) => x !== k) : [...p, k])} />
                  {BID_REQ_LABEL[k]}
                </label>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>These print on the bid request as required answers, and each bid shows how many came back.</div>
          </div>

          {/* Who are we sending to? */}
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 5 }}>
              Send to {sendTo.length > 0 && <span style={{ color: "var(--sage-2)" }}>· {sendTo.length} selected</span>}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[...tradeVendors, ...otherVendors].map((c) => {
                const on = sendTo.includes(c.id);
                const sameTrade = c.tradeId === tradeId;
                return (
                  <button key={c.id} className="btn btn-sm" onClick={() => setSendTo((p) => on ? p.filter((x) => x !== c.id) : [...p, c.id])}
                    title={c.tradeId ? tradeName(db, c.tradeId) : "Vendor"}
                    style={{ fontSize: 11.5, background: on ? "var(--sage)" : undefined, color: on ? "#fff" : undefined, borderColor: on ? "var(--sage)" : sameTrade ? "var(--brass)" : undefined }}>
                    {on ? "✓ " : ""}{c.company}{sameTrade ? " ★" : ""}
                  </button>
                );
              })}
              {!vendorContacts.length && <span style={{ fontSize: 12, color: "var(--muted)" }}>No vendor contacts yet — add them in Admin → Team, Access &amp; Billing.</span>}
            </div>
            {tradeVendors.length > 0 && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>★ = already assigned to this trade</div>}
          </div>

          {/* Readiness */}
          {(check.blocking.length > 0 || check.warnings.length > 0) && (
            <div style={{ fontSize: 11.5, background: check.blocking.length ? "#f7e6e0" : "#f7f1e2", border: "1px solid var(--line)", borderRadius: 8, padding: "7px 10px" }}>
              {check.blocking.map((b) => <div key={b} style={{ color: "var(--rust)" }}>✕ {b}</div>)}
              {check.warnings.map((w) => <div key={w} style={{ color: "var(--brass-2)" }}>⚠ {w}</div>)}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn btn-primary btn-sm" disabled={!check.ready} title={check.ready ? undefined : check.blocking.join(" · ")} onClick={() => create(true)}>
              Create &amp; start collecting{sendTo.length ? ` (${sendTo.length} vendor${sendTo.length === 1 ? "" : "s"})` : ""}
            </button>
            <button className="btn btn-sm" disabled={!title.trim() || !tradeId} onClick={() => create(false)}>Save as draft</button>
            <button className="btn btn-sm" onClick={() => { setOpenForm(false); setOrigin(null); }}>Cancel</button>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>{toItems(scope).length} line item{toItems(scope).length === 1 ? "" : "s"}</span>
          </div>
        </>
      )}
      {!origin && <div style={{ display: "flex", gap: 8 }}><button className="btn btn-sm" onClick={() => setOpenForm(false)}>Cancel</button></div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
function PackageCard({ p, ro }: { p: BidPackage; ro: boolean }) {
  const store = useStore();
  const db = store.db;
  const [addingBid, setAddingBid] = useState(false);
  const [vendorSel, setVendorSel] = useState("");
  const [vendorFree, setVendorFree] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState("");
  const [showScope, setShowScope] = useState(false);

  const awardedTo = p.bids.find((b) => b.id === p.awardedBidId);
  const roomNames = p.roomIds.map((r) => db.rooms.find((x) => x.id === r)?.name ?? r);
  const vendorContacts = db.contacts.filter((c) => c.party === "vendor");
  const trade = tradeName(db, p.tradeId);
  const items = p.scopeItems ?? toItems(p.scopeDetails);

  // Price spread — who's high, who's low.
  const priced = p.bids.filter((b) => typeof b.amount === "number" && b.amount > 0);
  const low = priced.length ? Math.min(...priced.map((b) => b.amount!)) : null;
  const high = priced.length ? Math.max(...priced.map((b) => b.amount!)) : null;

  const requestPdf = (rfp: boolean) => downloadBidRequestPdf({ projectName: db.project.name, title: p.title, trade, rooms: roomNames, scope: p.scopeDetails, items, rfp, requirements: p.requirements ?? BID_REQ_DEFAULT, materialsBasis: p.materialsBasis });
  const mailtoFor = (b?: VendorBid) => {
    const contact = b?.contactId ? db.contacts.find((c) => c.id === b.contactId) : undefined;
    const subject = encodeURIComponent(`Bid request — ${p.title} (${db.project.name})`);
    const list = items.length ? items.map((i) => `• ${i}`).join("\n") : p.scopeDetails;
    const body = encodeURIComponent(`Hi${b ? ` ${b.vendorName}` : ""},\n\nWe're collecting bids for the following scope at ${db.project.name}. Please price each line and note anything you're excluding.\n\nSCOPE — ${p.title} (${trade})\nRooms: ${roomNames.join(", ") || "see below"}\n\n${list}\n\nThanks!`);
    return `mailto:${contact?.email ?? ""}?subject=${subject}&body=${body}`;
  };

  const addBid = () => {
    const contact = vendorContacts.find((c) => c.id === vendorSel);
    const name = contact ? contact.company : vendorFree.trim();
    if (!name) return;
    store.addBid(p.id, { vendorName: name, contactId: contact?.id });
    setVendorSel(""); setVendorFree(""); setAddingBid(false);
  };

  const runCompare = async () => {
    setAiBusy(true); setAiMsg("");
    try {
      const res = await fetch("/api/compare-bids", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: p.title, trade, scopeItems: items, scopeDetails: p.scopeDetails,
          bids: p.bids.map((b) => ({ id: b.id, vendorName: b.vendorName, amount: b.amount, scopeText: b.scopeText })),
        }),
      });
      const j = await res.json();
      if (!j.ok) { setAiMsg(j.error ?? "Comparison failed."); return; }
      const at = new Date().toISOString();
      for (const r of j.data?.bids ?? []) {
        store.updateBid(p.id, r.id, { comparison: { comparable: !!r.comparable, missing: r.missing ?? [], extra: r.extra ?? [], note: r.note, at } as BidComparison });
      }
      setAiMsg(j.data?.summary ?? "Compared.");
    } catch { setAiMsg("Couldn't reach the comparison service."); }
    finally { setAiBusy(false); }
  };

  const canCompare = !ro && p.status !== "awarded" && p.bids.some((b) => (b.scopeText ?? "").trim().length > 3);

  return (
    <div className="card" style={{ padding: 16, borderLeft: p.status === "awarded" ? "3px solid var(--ok)" : p.status === "draft" ? "3px solid var(--sc-unset)" : "3px solid var(--brass)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h3 className="serif" style={{ fontSize: 16.5, fontWeight: 700, color: "var(--walnut)" }}>{p.title}</h3>
        <Pill bg="var(--cream-2)">{trade}</Pill>
        <TradeRatingChip tradeId={p.tradeId} compact />
        {p.status === "draft" && <Pill bg="var(--cream-2)">draft</Pill>}
        {p.status === "awarded"
          ? <Pill color="#fff" bg="var(--ok)">🏆 {awardedTo?.vendorName} · {awardedTo?.amount != null ? fmt(awardedTo.amount) : ""}</Pill>
          : p.status === "collecting" && <Pill color="#fff" bg="var(--brass)">{p.bids.length} bid{p.bids.length === 1 ? "" : "s"}</Pill>}
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}>{fmtD(p.createdAt)}</span>
        {!ro && p.status !== "awarded" && <button className="btn btn-sm" style={{ color: "var(--rust)" }} onClick={() => { if (confirm(`Remove bid package "${p.title}"?`)) store.removeBidPackage(p.id); }}>✕</button>}
      </div>
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>
        {p.origin ? BID_ORIGIN_LABEL[p.origin] : "Scope"} · {items.length} line item{items.length === 1 ? "" : "s"}
        {roomNames.length ? ` · ${roomNames.join(", ")}` : ""}
        {p.materialsBasis && <> · {MATERIALS_BASIS_LABEL[p.materialsBasis]}</>}
        {p.targetBudget ? <> · target <strong style={{ color: "var(--ink)" }}>{fmt(p.targetBudget)}</strong></> : null}
        {priced.length > 1 && low != null && high != null && <> · spread <strong style={{ color: "var(--ink)" }}>{fmt(low)}–{fmt(high)}</strong></>}
        {" · "}<button className="btn btn-sm" style={{ padding: "0 6px", fontSize: 11 }} onClick={() => setShowScope((v) => !v)}>{showScope ? "hide scope" : "view scope"}</button>
        {p.sourceDoc && <> · <a href={p.sourceDoc.url} target="_blank" rel="noreferrer" style={{ color: "var(--sage-2)", fontWeight: 600 }}>👁 scanned original</a></>}
      </div>

      {showScope && (
        <textarea value={p.scopeDetails} disabled={ro || p.status === "awarded"}
          onChange={(e) => { store.updateBidPackage(p.id, { scopeDetails: e.target.value }); store.setBidScopeItems(p.id, toItems(e.target.value)); }}
          style={{ width: "100%", minHeight: 92, fontSize: 12.5, marginTop: 8, resize: "vertical", background: "var(--paper)" }} />
      )}

      {!ro && p.status === "draft" && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
          <button className="btn btn-sm btn-primary" onClick={() => store.issueBidPackage(p.id)}>▶ Start collecting bids</button>
          <span style={{ fontSize: 11.5, color: "var(--muted)", alignSelf: "center" }}>Finish the scope, then send it out.</span>
        </div>
      )}

      {!ro && p.status === "collecting" && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
          <a className="btn btn-sm" href={mailtoFor()} title="Open a prefilled bid-request email">📧 Email bid request</a>
          <button className="btn btn-sm" onClick={() => requestPdf(false)}>🖨 Bid request PDF</button>
          <button className="btn btn-sm" onClick={() => requestPdf(true)}>📄 RFP form PDF</button>
          {canCompare && <button className="btn btn-sm" disabled={aiBusy} onClick={runCompare} title="AI: are these bids apples-to-apples with the scope?">{aiBusy ? "✨ Comparing…" : "✨ Check apples-to-apples"}</button>}
        </div>
      )}
      {aiMsg && <div style={{ fontSize: 12, color: "var(--brass-2)", marginTop: 8, background: "#f7f1e2", border: "1px solid var(--line)", borderRadius: 8, padding: "7px 10px" }}>✨ {aiMsg}</div>}

      {p.status !== "draft" && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {[...p.bids].sort((a, b) => (a.amount ?? Infinity) - (b.amount ?? Infinity)).map((b) => (
            <BidRow key={b.id} p={p} b={b} ro={ro} mailto={mailtoFor(b)} low={low} high={high} />
          ))}
          {!p.bids.length && <div style={{ fontSize: 12, color: "var(--muted)" }}>No vendors added yet.</div>}
        </div>
      )}

      {!ro && p.status === "collecting" && (
        addingBid ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
            <select value={vendorSel} onChange={(e) => { setVendorSel(e.target.value); setVendorFree(""); }} style={{ fontSize: 12 }}>
              <option value="">— from vendor contacts —</option>
              {vendorContacts.map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}
            </select>
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>or</span>
            <input placeholder="New vendor name" value={vendorFree} onChange={(e) => { setVendorFree(e.target.value); setVendorSel(""); }} style={{ fontSize: 12, width: 170 }} onKeyDown={(e) => e.key === "Enter" && addBid()} />
            <button className="btn btn-sm btn-primary" disabled={!vendorSel && !vendorFree.trim()} onClick={addBid}>Add</button>
            <button className="btn btn-sm" onClick={() => setAddingBid(false)}>Cancel</button>
          </div>
        ) : (
          <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => setAddingBid(true)}>＋ Add vendor to bid</button>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function BidRow({ p, b, ro, mailto, low, high }: { p: BidPackage; b: VendorBid; ro: boolean; mailto: string; low: number | null; high: number | null }) {
  const store = useStore();
  const db = store.db;
  const [expand, setExpand] = useState(false);
  const isWinner = b.status === "awarded";
  const locked = ro || p.status === "awarded";
  const canAward = !ro && p.status !== "awarded" && b.amount != null && b.amount > 0;
  // Which trade is this vendor? (for their rating) — their contact's trade, else the package's.
  const vendorTradeId = db.contacts.find((c) => c.id === b.contactId)?.tradeId ?? p.tradeId;
  const isLow = b.amount != null && low != null && b.amount === low && (high ?? low) !== low;
  const isHigh = b.amount != null && high != null && b.amount === high && (low ?? high) !== high;
  const delta = b.amount != null && low != null && b.amount > low ? b.amount - low : 0;
  const cmp = b.comparison;
  const comp = bidCompleteness(p, b);

  const upload = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    const { fileUrl, fileName } = await storeFile(f);
    store.addBidAttachment(p.id, b.id, { name: fileName, url: fileUrl });
    store.updateBid(p.id, b.id, { status: b.status === "requested" ? "received" : b.status });
  };

  return (
    <div style={{ border: isWinner ? "2px solid var(--ok)" : "1px solid var(--line)", borderRadius: 9, padding: "9px 11px", background: isWinner ? "var(--sage-tint)" : undefined, opacity: p.status === "awarded" && !isWinner ? 0.55 : 1 }}>
      {/* truncated overview */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => setExpand((v) => !v)} style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0, fontSize: 12, color: "var(--muted)" }}>{expand ? "▾" : "▸"}</button>
        <strong style={{ fontSize: 13 }}>{b.vendorName}</strong>
        <TradeRatingChip tradeId={vendorTradeId} compact />
        {isWinner && <Pill color="#fff" bg="var(--ok)">🏆 awarded</Pill>}
        {!isWinner && isLow && <Pill color="#fff" bg="var(--ok)">lowest</Pill>}
        {!isWinner && isHigh && <Pill color="var(--brass-2)" bg="#f0e6cd">highest</Pill>}
        {cmp && (cmp.comparable
          ? <Pill color="#fff" bg="var(--sage)" >✓ apples-to-apples</Pill>
          : <Pill color="#fff" bg="var(--rust)">⚠ scope differs</Pill>)}
        {b.status !== "requested" && comp.total > 0 && (
          <span title={comp.missing.length ? `Still missing: ${comp.missing.map((k) => BID_REQ_LABEL[k]).join(", ")}` : "All required answers received"}
            style={{ fontSize: 10.5, fontWeight: 700, borderRadius: 99, padding: "1px 7px", background: comp.answered === comp.total ? "var(--sage-tint)" : "#f0e6cd", color: comp.answered === comp.total ? "var(--sage-2)" : "var(--brass-2)" }}>
            {comp.answered}/{comp.total} answered
          </span>
        )}
        {b.sourceDoc && <a href={b.sourceDoc.url} target="_blank" rel="noreferrer" title="View the original quote" style={{ fontSize: 11, color: "var(--sage-2)" }}>👁 original</a>}
        {!isWinner && !locked && (
          <select value={b.status} onChange={(e) => store.updateBid(p.id, b.id, { status: e.target.value as VendorBid["status"] })} style={{ fontSize: 10.5, padding: "1px 4px" }}>
            {(["requested", "received", "declined"] as const).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
          {delta > 0 && <span style={{ fontSize: 10.5, color: "var(--muted)" }}>+{fmt(delta)}</span>}
          {locked
            ? <strong style={{ fontSize: 14 }}>{b.amount != null ? fmt(b.amount) : "—"}</strong>
            : <NumInput value={b.amount ?? 0} onCommit={(v) => store.updateBid(p.id, b.id, { amount: v > 0 ? v : undefined, status: v > 0 && b.status === "requested" ? "received" : b.status })} width={82} money />}
        </span>
        {canAward && <button className="btn btn-sm btn-primary" title="Award — promotes the price into Project Budget" onClick={() => { if (confirm(`Award "${p.title}" to ${b.vendorName} at ${fmt(b.amount!)}? This locks it into Project Budget.`)) store.awardBid(p.id, b.id); }}>🏆 Award</button>}
        {!locked && <button className="btn btn-sm" style={{ color: "var(--rust)" }} onClick={() => store.removeBid(p.id, b.id)}>✕</button>}
      </div>

      {/* AI scope findings — always visible when there's a problem */}
      {cmp && !cmp.comparable && !expand && (
        <div style={{ fontSize: 11.5, color: "var(--rust)", marginTop: 5, paddingLeft: 22 }}>
          {cmp.missing.length ? `Missing: ${cmp.missing.slice(0, 2).join("; ")}${cmp.missing.length > 2 ? ` +${cmp.missing.length - 2} more` : ""}` : cmp.note}
        </div>
      )}

      {expand && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 7, paddingLeft: 22 }}>
          {cmp && (
            <div style={{ fontSize: 11.5, background: cmp.comparable ? "var(--sage-tint)" : "#f7e6e0", border: "1px solid var(--line)", borderRadius: 8, padding: "7px 9px", display: "flex", flexDirection: "column", gap: 3 }}>
              <strong style={{ color: cmp.comparable ? "var(--sage-2)" : "var(--rust)" }}>✨ {cmp.comparable ? "Comparable with the package scope" : "Scope differs materially"}</strong>
              {!!cmp.missing.length && <span>Missing: {cmp.missing.join("; ")}</span>}
              {!!cmp.extra.length && <span>Extra: {cmp.extra.join("; ")}</span>}
              {cmp.note && <span style={{ color: "var(--muted)" }}>{cmp.note}</span>}
            </div>
          )}
          <label style={{ fontSize: 10.5, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 3 }}>Vendor-submitted scope (paste their email / notes from the call)
            <textarea value={b.scopeText ?? ""} disabled={locked} onChange={(e) => store.updateBid(p.id, b.id, { scopeText: e.target.value, scopeItems: toItems(e.target.value) })} placeholder="What did they actually quote?" style={{ minHeight: 60, fontSize: 12 }} />
          </label>

          {/* Required answers — what's still unanswered is the risk */}
          <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 8 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 5 }}>
              Required answers · {comp.answered}/{comp.total}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "5px 10px" }}>
              {(p.requirements ?? BID_REQ_DEFAULT).map((k) => (
                <label key={k} title={BID_REQ_HINT[k]} style={{ fontSize: 10.5, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ color: (b.responses?.[k] ?? "").trim() ? "var(--sage-2)" : "var(--rust)" }}>
                    {(b.responses?.[k] ?? "").trim() ? "✓" : "•"} {BID_REQ_LABEL[k]}
                  </span>
                  <TextInput value={b.responses?.[k] ?? ""} disabled={locked}
                    placeholder={k === "materialsIncluded" ? "included / labor only / partial" : k === "permits" ? "included / billed at cost" : ""}
                    onCommit={(v) => store.updateBid(p.id, b.id, { responses: { ...(b.responses ?? {}), [k]: v } })}
                    style={{ fontSize: 12, width: "100%" }} />
                </label>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ fontSize: 10.5, color: "var(--muted)", display: "inline-flex", alignItems: "center", gap: 5 }}>Received via
              <select value={b.receivedVia ?? ""} disabled={locked} onChange={(e) => store.updateBid(p.id, b.id, { receivedVia: (e.target.value || undefined) as VendorBid["receivedVia"] })} style={{ fontSize: 11 }}>
                <option value="">—</option>
                {VIA.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <TextInput value={b.notes ?? ""} disabled={locked} placeholder="Notes" onCommit={(v) => store.updateBid(p.id, b.id, { notes: v || undefined })} style={{ fontSize: 12, flex: 1, minWidth: 150 }} />
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {(b.attachments ?? []).map((a, i) => (
              a.url.startsWith("data:image") || /\.(png|jpe?g|webp)$/i.test(a.name)
                // eslint-disable-next-line @next/next/no-img-element
                ? <a key={i} href={a.url} target="_blank" rel="noreferrer" title={a.name}><img src={a.url} alt={a.name} style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 7, border: "1px solid var(--line)" }} /></a>
                : <a key={i} className="btn btn-sm" href={a.url} target="_blank" rel="noreferrer" download={a.name}>📎 {a.name.slice(0, 22)}</a>
            ))}
            {!locked && (
              <label className="btn btn-sm" style={{ cursor: "pointer" }}>
                📷 Upload photo / email
                <input type="file" accept="image/*,.pdf,.eml,.msg,.txt" style={{ display: "none" }} onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
              </label>
            )}
            {!locked && <a className="btn btn-sm" href={mailto}>📧 Email this vendor</a>}
          </div>
          {isWinner && p.lineId && <Link href={`/costs?line=${p.lineId}`} style={{ fontSize: 12, color: "var(--sage-2)", fontWeight: 600 }}>→ View in Project Budget</Link>}
        </div>
      )}
    </div>
  );
}

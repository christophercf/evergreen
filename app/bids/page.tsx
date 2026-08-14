"use client";

import { useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/data/hooks";
import { PageHeader, NoAccess, Pill } from "../ui/bits";
import { TradeRatingChip } from "../ui/rating";
import {
  accessFor, BID_REQ_DEFAULT, BID_REQ_HINT, BID_REQ_KEYS, BID_REQ_LABEL, BID_ROUTE_HINT, BID_ROUTE_LABEL,
  MATERIALS_BASIS_LABEL, PRICING_BASIS_HINT, PRICING_BASIS_LABEL,
  bidIntakeComplete, packageReadiness, vendorCovers, vendorTrades,
  type BidPackage, type BidReqKey, type BidRoute, type MaterialsBasis, type PricingBasis, type ScopeDoc,
} from "@/lib/data/types";
import { tradeName, MACRO_ORDER, fmt } from "@/lib/data/money";
import { storeFile, fileToBase64Payload } from "../ui/upload";
import { downloadBidRequestPdf } from "./pdf";
import { Kicker, ScreenHead, Tile, Check, OptionBtn, money } from "./kit";
import { IntakeScreen, CompareScreen, AwardScreen } from "./screens";

// ---------------------------------------------------------------------------
// Bid Management — competitive bidding before the budget exists.
//
// Six steps, one package: pick the trades, pick who bids, set how each of them
// submits, read what came back, compare it like-for-like, award. The award
// promotes the price into Project Budget as a locked line.
//
// The through-line is that bids arrive three different ways — the vendor fills
// our form, we key it off a phone call, or they send their own quote — and all
// three have to land on the same five fields or the comparison is a fiction.
// ---------------------------------------------------------------------------

const STEPS = ["Trades", "Contacts", "How they bid", "Bids in", "Compare", "Award"] as const;
const toItems = (s: string) => s.split(/\r?\n/).map((x) => x.replace(/^[\s•\-*]+/, "").trim()).filter(Boolean);
const fmtD = (s: string) => new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default function BidsPage() {
  const store = useStore();
  const role = store.session.role;
  const access = accessFor(store.currentUser, role, "bids");
  const [pkgId, setPkgId] = useState<string | null>(null);
  const [wizard, setWizard] = useState(false);
  const [step, setStep] = useState(0);

  if (access === "none") return <NoAccess module="Bid Management" />;
  const ro = access !== "edit";
  const pkg = store.db.bidPackages?.find((p) => p.id === pkgId);

  const openPackage = (p: BidPackage) => {
    setPkgId(p.id);
    setStep(p.status === "awarded" ? 5 : p.status === "collecting" ? 3 : 1);
    setWizard(true);
  };

  return (
    <>
      <PageHeader
        title="Bid Management"
        subtitle="Get comparable bids before a number goes in the budget: scope it, send it to several vendors, and hold every bid to the same five fields — total, materials, labor, working days, crew. Mismatches are flagged, never quietly corrected."
        right={
          <div style={{ display: "flex", gap: 6 }}>
            {wizard && <button className="btn btn-sm" onClick={() => { setWizard(false); setPkgId(null); }}>← All packages</button>}
            <Link href="/costs" className="btn btn-sm">Project Budget →</Link>
          </div>
        }
      />
      {wizard
        ? <Wizard pkg={pkg} ro={ro} step={step} setStep={setStep} onCreated={(id) => { setPkgId(id); setStep(1); }} />
        : <Board ro={ro} onOpen={openPackage} onNew={() => { setPkgId(null); setStep(0); setWizard(true); }} />}
    </>
  );
}

// ---------------------------------------------------------------------------
function Board({ ro, onOpen, onNew }: { ro: boolean; onOpen: (p: BidPackage) => void; onNew: () => void }) {
  const store = useStore();
  const db = store.db;
  const packages = db.bidPackages ?? [];
  const groups = [
    { key: "collecting", label: "Out to vendors", items: packages.filter((p) => p.status === "collecting") },
    { key: "draft", label: "Drafts", items: packages.filter((p) => p.status === "draft") },
    { key: "awarded", label: "Awarded", items: packages.filter((p) => p.status === "awarded") },
  ].filter((g) => g.items.length);

  return (
    <>
      {!ro && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
          <button className="btn btn-primary btn-sm" onClick={onNew}>+ New bid package</button>
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Pick one or several trades — you get a package for each.</span>
        </div>
      )}
      {!packages.length && <div className="card" style={{ padding: 16, fontSize: 12.5, color: "var(--muted)" }}>No bid packages yet.</div>}
      {groups.map((g) => (
        <div key={g.key} style={{ marginBottom: 16 }}>
          <Kicker style={{ marginBottom: 7 }}>{g.label} ({g.items.length})</Kicker>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
            {g.items.map((p) => {
              const priced = p.bids.filter((b) => typeof b.amount === "number");
              const low = priced.length ? Math.min(...priced.map((b) => b.amount!)) : null;
              const high = priced.length ? Math.max(...priced.map((b) => b.amount!)) : null;
              const ready = p.bids.filter(bidIntakeComplete).length;
              return (
                <Tile key={p.id} on={false} onClick={() => onOpen(p)} style={{ gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap", width: "100%" }}>
                    <span className="serif" style={{ fontSize: 15.5, fontWeight: 700, color: "var(--walnut)" }}>{p.title}</span>
                    <Pill bg="var(--cream-2)">{tradeName(db, p.tradeId)}</Pill>
                    <TradeRatingChip tradeId={p.tradeId} compact />
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.45 }}>
                    {(p.scopeItems ?? toItems(p.scopeDetails)).length} scope lines
                    {p.pricingBasis ? ` · ${PRICING_BASIS_LABEL[p.pricingBasis]}` : ""}
                    {p.targetBudget ? ` · target ${fmt(p.targetBudget)}` : ""}
                    {" · "}{fmtD(p.createdAt)}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {p.status === "awarded"
                      ? <Pill color="#fff" bg="var(--ok)">🏆 {p.bids.find((b) => b.id === p.awardedBidId)?.vendorName}</Pill>
                      : <Pill color="#fff" bg={p.status === "draft" ? "var(--sc-unset)" : "var(--brass)"}>{p.bids.length} bid{p.bids.length === 1 ? "" : "s"}{p.bids.length ? ` · ${ready} complete` : ""}</Pill>}
                    {low != null && high != null && priced.length > 1 && <Pill bg="var(--cream-2)">{money(low)}–{money(high)}</Pill>}
                  </div>
                </Tile>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
function Wizard({ pkg, ro, step, setStep, onCreated }: {
  pkg?: BidPackage; ro: boolean; step: number; setStep: (n: number) => void; onCreated: (id: string) => void;
}) {
  const store = useStore();
  const db = store.db;
  return (
    <div className="ever-bidshell">
      <div style={{ minWidth: 0 }}>
        <div className="ever-bidnav" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {STEPS.map((label, i) => {
            const locked = i > 0 && !pkg;
            return (
              <button key={label} disabled={locked} onClick={() => setStep(i)}
                title={locked ? "Pick a trade first" : undefined}
                style={{
                  display: "flex", gap: 8, alignItems: "baseline", textAlign: "left", cursor: locked ? "not-allowed" : "pointer",
                  border: 0, borderRadius: 7, padding: "6px 8px", font: "inherit", fontSize: 12.5,
                  background: i === step ? "var(--sage-tint)" : "transparent",
                  color: locked ? "var(--line)" : i === step ? "var(--ink)" : "var(--muted)",
                }}>
                <span className="serif" style={{ fontSize: 11, fontWeight: 700, color: "var(--brass-2)" }}>{String(i + 1).padStart(2, "0")}</span>
                <span>{label}</span>
              </button>
            );
          })}
        </div>
        {pkg && (
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--line)", fontSize: 11, lineHeight: 1.5, color: "var(--muted)" }}>
            <Kicker>Package</Kicker>
            <div style={{ color: "var(--ink)", fontSize: 12, marginTop: 3 }}>{pkg.title}</div>
            <div>{tradeName(db, pkg.tradeId)} · {pkg.bids.length} invited</div>
          </div>
        )}
      </div>

      <div style={{ minWidth: 0 }}>
        {step === 0 && <TradesScreen onCreated={onCreated} ro={ro} />}
        {step > 0 && !pkg && <div className="card" style={{ padding: 16, fontSize: 12.5, color: "var(--muted)" }}>Pick a trade first.</div>}
        {pkg && step === 1 && <ContactsScreen p={pkg} ro={ro} onNext={() => setStep(2)} />}
        {pkg && step === 2 && <RoutesScreen p={pkg} ro={ro} onNext={() => setStep(3)} />}
        {pkg && step === 3 && <IntakeScreen p={pkg} ro={ro} onNext={() => setStep(4)} />}
        {pkg && step === 4 && <CompareScreen p={pkg} ro={ro} onNext={() => setStep(5)} />}
        {pkg && step === 5 && <AwardScreen p={pkg} ro={ro} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 01 — which trades. Picking several creates a package for each, because bids
// only ever compare inside one trade.
function TradesScreen({ onCreated, ro }: { onCreated: (id: string) => void; ro: boolean }) {
  const store = useStore();
  const db = store.db;
  const [picked, setPicked] = useState<string[]>([]);
  const vendorCount = (tid: string) => db.contacts.filter((c) => c.party === "vendor" && vendorCovers(c, tid)).length;

  // Seed each new package from the trade's own template, falling back to the
  // scope matrix — so nobody starts from a blank page.
  const create = () => {
    let first = "";
    for (const tid of picked) {
      const cells = db.scope.filter((c) => c.tradeId === tid && c.status === "in");
      const template = db.scopeTemplates.find((t) => t.tradeId === tid)?.items ?? [];
      const fromMatrix = Array.from(new Set(cells.flatMap((c) => c.items.filter((i) => i.included).map((i) => i.label))));
      const items = template.length ? template : fromMatrix;
      const id = store.addBidPackage({
        title: `${tradeName(db, tid)} — ${db.project.name}`,
        tradeId: tid, roomIds: cells.map((c) => c.roomId),
        scopeDetails: items.join("\n"), scopeItems: items,
        origin: "trade_template", requirements: BID_REQ_DEFAULT,
      });
      if (!first) first = id;
    }
    if (first) onCreated(first);
  };

  return (
    <>
      <ScreenHead
        title="Which trades is this package for?"
        sub="Pick one or several. Bids only ever compare inside a trade, so each one gets its own package and its own column set."
        right={!ro && <button className="btn btn-primary btn-sm" disabled={!picked.length} onClick={create}>
          {picked.length > 1 ? `Create ${picked.length} packages →` : "Continue →"}
        </button>}
      />
      {MACRO_ORDER.map((cat) => {
        const trades = db.trades.filter((t) => t.category === cat);
        if (!trades.length) return null;
        return (
          <div key={cat} style={{ marginBottom: 14 }}>
            <Kicker tone="muted" style={{ marginBottom: 6 }}>{cat}</Kicker>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 10 }}>
              {trades.map((t) => {
                const on = picked.includes(t.id);
                return (
                  <Tile key={t.id} on={on} onClick={() => setPicked((p) => on ? p.filter((x) => x !== t.id) : [...p, t.id])}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, width: "100%" }}>
                      <span className="serif" style={{ fontSize: 15, fontWeight: 700, color: "var(--walnut)", lineHeight: 1.2 }}>{t.name}</span>
                      <Check on={on} />
                    </div>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>{vendorCount(t.id)} saved contact{vendorCount(t.id) === 1 ? "" : "s"}</span>
                  </Tile>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// 02 — who bids. The whole directory is here; the ones who cover this trade
// sort to the top rather than the others being hidden.
function ContactsScreen({ p, ro, onNext }: { p: BidPackage; ro: boolean; onNext: () => void }) {
  const store = useStore();
  const db = store.db;
  const vendors = db.contacts.filter((c) => c.party === "vendor");
  // Matched on everything they can work on, not just what they're contracted
  // for here — a mason who also does concrete belongs in both packages.
  const matched = vendors.filter((c) => vendorCovers(c, p.tradeId));
  const others = vendors.filter((c) => !vendorCovers(c, p.tradeId));
  const bidFor = (cid: string) => p.bids.find((b) => b.contactId === cid);

  const toggle = (cid: string) => {
    const existing = bidFor(cid);
    if (existing) store.removeBid(p.id, existing.id);
    else store.addBidsForContacts(p.id, [cid], "app");
  };

  const Card = (c: (typeof vendors)[number]) => {
    const on = !!bidFor(c.id);
    return (
      <Tile key={c.id} on={on} onClick={ro ? undefined : () => toggle(c.id)} style={{ flexDirection: "row", alignItems: "center", gap: 11 }}>
        <Check on={on} />
        <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span className="serif" style={{ fontSize: 15, fontWeight: 700, color: "var(--walnut)", lineHeight: 1.2 }}>{c.company}</span>
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{[c.contactName, c.phone].filter(Boolean).join(" · ") || "No contact details"}</span>
          <Kicker>{vendorTrades(c).map((t) => tradeName(db, t)).join(" · ") || "Vendor"}</Kicker>
        </span>
      </Tile>
    );
  };

  return (
    <>
      <ScreenHead
        title="Who should bid this?"
        sub="Everyone in the vendor directory is here. The ones who cover this trade sit on top."
        right={<button className="btn btn-primary btn-sm" disabled={!p.bids.length} onClick={onNext}>
          {p.bids.length ? `Continue with ${p.bids.length} →` : "Pick at least one"}
        </button>}
      />
      {!vendors.length && (
        <div className="card" style={{ padding: 16, fontSize: 12.5, color: "var(--muted)" }}>
          No vendor contacts yet — add them in <Link href="/admin" style={{ color: "var(--sage-2)" }}>Admin → Team</Link>.
        </div>
      )}
      {matched.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Kicker style={{ marginBottom: 6 }}>{matched.length} cover {tradeName(db, p.tradeId)}</Kicker>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 10 }}>{matched.map(Card)}</div>
        </div>
      )}
      {others.length > 0 && (
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          <Kicker tone="muted" style={{ marginBottom: 6 }}>{others.length} other contacts — outside this trade</Kicker>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 10 }}>{others.map(Card)}</div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// 03 — the basis everyone prices on, the route each vendor submits through,
// and a last look at the scope before it goes out.
function RoutesScreen({ p, ro, onNext }: { p: BidPackage; ro: boolean; onNext: () => void }) {
  const store = useStore();
  const db = store.db;
  const [scopeOpen, setScopeOpen] = useState(false);
  const check = packageReadiness(p);
  const items = p.scopeItems ?? toItems(p.scopeDetails);
  const roomNames = p.roomIds.map((r) => db.rooms.find((x) => x.id === r)?.name ?? r);

  const issue = () => {
    if (!check.ready) return;
    store.issueBidPackage(p.id);
    onNext();
  };

  return (
    <>
      <ScreenHead
        title="How does each one submit?"
        sub="Three routes in, one set of fields out. Pick the route each vendor actually works in — the one they'll really use, not the one you'd prefer."
        right={!ro && <button className="btn btn-primary btn-sm" disabled={!check.ready} title={check.ready ? undefined : check.blocking.join(" · ")} onClick={issue}>
          {p.status === "draft" ? "Issue request →" : "Continue →"}
        </button>}
      />

      {/* Pricing basis — package level, decided before anything goes out. */}
      <div className="card" style={{ padding: 13, marginBottom: 12, display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.3fr)", gap: 16, alignItems: "center" }}>
        <div>
          <Kicker>Pricing basis — set before the request goes out</Kicker>
          <div style={{ fontSize: 11.5, lineHeight: 1.45, color: "var(--muted)", marginTop: 4 }}>
            {p.pricingBasis === "tm"
              ? "Every vendor prices a crew rate and a not-to-exceed. The comparison ranks on rate and cap, not one figure."
              : "Every vendor returns one fixed figure against this scope. A bid that comes back the other way gets flagged, never converted."}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
          {(["lump", "tm"] as PricingBasis[]).map((k) => (
            <OptionBtn key={k} on={p.pricingBasis === k} disabled={ro} label={PRICING_BASIS_LABEL[k]} hint={PRICING_BASIS_HINT[k]}
              onClick={() => store.updateBidPackage(p.id, { pricingBasis: k })} />
          ))}
        </div>
      </div>

      {/* Materials basis + required answers — Evergreen's existing guard rails. */}
      <div className="card" style={{ padding: 13, marginBottom: 12 }}>
        <Kicker>Guard rails</Kicker>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "7px 0 9px" }}>
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Who supplies materials?</span>
          <select disabled={ro} value={p.materialsBasis ?? ""} onChange={(e) => store.updateBidPackage(p.id, { materialsBasis: (e.target.value || undefined) as MaterialsBasis })} style={{ fontSize: 12 }}>
            <option value="">Choose…</option>
            {(Object.keys(MATERIALS_BASIS_LABEL) as MaterialsBasis[]).map((k) => <option key={k} value={k}>{MATERIALS_BASIS_LABEL[k]}</option>)}
          </select>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 4 }}>
          {BID_REQ_KEYS.map((k) => {
            const on = (p.requirements ?? BID_REQ_DEFAULT).includes(k);
            return (
              <label key={k} title={BID_REQ_HINT[k]} style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 6, cursor: ro ? "default" : "pointer" }}>
                <input type="checkbox" disabled={ro} checked={on}
                  onChange={() => store.updateBidPackage(p.id, { requirements: on ? (p.requirements ?? BID_REQ_DEFAULT).filter((x) => x !== k) : [...(p.requirements ?? BID_REQ_DEFAULT), k] })} />
                {BID_REQ_LABEL[k]}
              </label>
            );
          })}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 7 }}>These print on the bid request as required blanks, alongside the five comparable fields.</div>
      </div>

      {/* What they're pricing */}
      <div className="card" style={{ padding: 13, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <Kicker>What they&apos;re pricing — {items.length} line{items.length === 1 ? "" : "s"}{roomNames.length ? ` · ${roomNames.join(", ")}` : ""}</Kicker>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className="btn btn-sm" onClick={() => setScopeOpen((v) => !v)}>{scopeOpen ? "Hide" : "Edit scope"}</button>
            <button className="btn btn-sm" onClick={() => downloadBidRequestPdf({
              projectName: db.project.name, title: p.title, trade: tradeName(db, p.tradeId), rooms: roomNames,
              scope: p.scopeDetails, items, rfp: false, requirements: p.requirements ?? BID_REQ_DEFAULT,
              materialsBasis: p.materialsBasis, pricingBasis: p.pricingBasis,
            })}>📄 Bid request PDF</button>
          </div>
        </div>
        {scopeOpen
          ? <ScopeEditor p={p} ro={ro} />
          : <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, lineHeight: 1.6, color: "var(--ink)" }}>
              {items.slice(0, 8).map((i, n) => <li key={n}>{i}</li>)}
              {items.length > 8 && <li style={{ color: "var(--muted)" }}>…and {items.length - 8} more</li>}
              {!items.length && <li style={{ color: "var(--rust)", listStyle: "none", marginLeft: -18 }}>No scope lines yet — vendors can&apos;t price a one-liner.</li>}
            </ul>}
      </div>

      {/* Route per vendor */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {p.bids.map((b) => (
          <div key={b.id} className="card" style={{ padding: 12, display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.5fr)", gap: 14, alignItems: "center" }}>
            <div style={{ minWidth: 0 }}>
              <div className="serif" style={{ fontSize: 15, fontWeight: 700, color: "var(--walnut)" }}>{b.vendorName}</div>
              <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                {(() => { const c = db.contacts.find((x) => x.id === b.contactId); return [c?.contactName, c?.phone].filter(Boolean).join(" · ") || "No contact details"; })()}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 6 }}>
              {(["app", "gc", "upload"] as BidRoute[]).map((r) => (
                <OptionBtn key={r} on={(b.route ?? "app") === r} disabled={ro} label={BID_ROUTE_LABEL[r]} hint={BID_ROUTE_HINT[r]}
                  onClick={() => store.updateBid(p.id, b.id, { route: r })} />
              ))}
            </div>
          </div>
        ))}
        {!p.bids.length && <div className="card" style={{ padding: 16, fontSize: 12.5, color: "var(--muted)" }}>Nobody invited yet — go back to <strong>Contacts</strong>.</div>}
      </div>

      {(check.blocking.length > 0 || check.warnings.length > 0) && (
        <div style={{ fontSize: 11.5, background: check.blocking.length ? "#f7e6e0" : "#f7f1e2", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px", marginTop: 12, lineHeight: 1.6 }}>
          {check.blocking.map((b) => <div key={b} style={{ color: "var(--rust)" }}>✕ {b}</div>)}
          {check.warnings.map((w) => <div key={w} style={{ color: "var(--brass-2)" }}>⚠ {w}</div>)}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
/** Scope authoring: type it, or scan a vendor's own quote into line items. */
function ScopeEditor({ p, ro }: { p: BidPackage; ro: boolean }) {
  const store = useStore();
  const db = store.db;
  const [text, setText] = useState((p.scopeItems ?? toItems(p.scopeDetails)).join("\n"));
  const [scan, setScan] = useState({ busy: false, msg: "" });

  const scanFile = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setScan({ busy: true, msg: `Reading ${f.name}…` });
    try {
      const [{ fileUrl, fileName }, payload] = await Promise.all([storeFile(f), fileToBase64Payload(f)]);
      const doc: ScopeDoc = { name: fileName, url: fileUrl, scannedAt: new Date().toISOString() };
      const res = await fetch("/api/scan-scope", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: payload.data, mediaType: payload.mediaType, fileName, trade: tradeName(db, p.tradeId), templateItems: db.scopeTemplates.find((t) => t.tradeId === p.tradeId)?.items ?? [] }),
      });
      const j = await res.json();
      if (!j.ok) { setScan({ busy: false, msg: j.error ?? "Scan failed." }); return; }
      const d = j.data ?? {};
      if (Array.isArray(d.items) && d.items.length) setText(d.items.join("\n"));
      store.updateBidPackage(p.id, { sourceDoc: doc, origin: "vendor_import", ...(d.price > 0 ? { targetBudget: Number(d.price) } : {}) });
      setScan({ busy: false, msg: `Read ${(d.items ?? []).length} line item${(d.items ?? []).length === 1 ? "" : "s"}${d.confidence ? ` · ${d.confidence} confidence` : ""}. Check them before saving.` });
    } catch { setScan({ busy: false, msg: "Couldn't read that document." }); }
  };

  return (
    <div style={{ marginTop: 9 }}>
      <textarea className="input" disabled={ro} value={text} onChange={(e) => setText(e.target.value)}
        placeholder={"One line item per line — the more specific, the fewer change orders.\ne.g. Rebuild retaining wall, 18 lf, salvaged brick"}
        style={{ minHeight: 120, fontSize: 12.5, lineHeight: 1.55 }} />
      {!ro && (
        <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap", marginTop: 7 }}>
          <button className="btn btn-primary btn-sm" onClick={() => store.setBidScopeItems(p.id, toItems(text))}>Save scope</button>
          <label className="btn btn-sm" style={{ cursor: "pointer" }}>
            {scan.busy ? "Reading…" : "📄 Import a vendor's own scope"}
            <input type="file" accept="application/pdf,image/*" hidden disabled={scan.busy} onChange={(e) => void scanFile(e.target.files)} />
          </label>
          {p.sourceDoc && <a href={p.sourceDoc.url} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: "var(--sage-2)", fontWeight: 600 }}>👁 {p.sourceDoc.name}</a>}
          <span style={{ fontSize: 11, color: "var(--muted)" }}>{toItems(text).length} lines</span>
        </div>
      )}
      {scan.msg && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 5, lineHeight: 1.4 }}>{scan.msg}</div>}
    </div>
  );
}

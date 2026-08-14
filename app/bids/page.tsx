"use client";

import { useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/data/hooks";
import { PageHeader, NoAccess } from "../ui/bits";
import {
  accessFor, BID_ROUTE_HINT, BID_ROUTE_LABEL, PRICING_BASIS_HINT, PRICING_BASIS_LABEL,
  vendorCovers, vendorTrades,
  type BidPackage, type BidRoute, type ContactSheet, type PricingBasis,
} from "@/lib/data/types";
import { tradeName, MACRO_ORDER } from "@/lib/data/money";
import {
  Check, Kicker, OptionBtn, ScreenHead, Tag, Tile, Triage, contactLine, contactOf, useNarrow, type TriageRow,
} from "./kit";
import { IntakeScreen, CompareScreen, AwardScreen } from "./screens";

// ---------------------------------------------------------------------------
// Bid Management — competitive bidding before the budget exists.
//
// Six steps against one package: pick the trades, pick who bids, set how each
// one submits, read what came back, compare it like-for-like, award. The award
// promotes the price into Project Budget as a locked line.
//
// The through-line is that bids arrive three different ways — the vendor fills
// our form, we key it off a phone call, or they send their own quote — and all
// three have to land on the same five fields or the comparison is a fiction.
// ---------------------------------------------------------------------------

const NAV = ["Trades", "Contacts", "How they bid", "Bids in", "Compare", "Award"] as const;
const NEW = "__new";
const ROUTES: BidRoute[] = ["app", "gc", "upload"];

/** A bid is "in" when a figure actually arrived — derived from the bid itself,
 *  never from a status somebody forgot to flip. */
const bidsIn = (p: BidPackage) => p.bids.filter((b) => b.amount != null).length;

export default function BidsPage() {
  const store = useStore();
  const db = store.db;
  const access = accessFor(store.currentUser, store.session.role, "bids");
  const narrow = useNarrow();
  const [pkgId, setPkgId] = useState<string | null>(null);
  const [step, setStep] = useState(0);

  if (access === "none") return <NoAccess module="Bid Management" />;
  const ro = access !== "edit";
  const packages = db.bidPackages ?? [];
  const pkg = packages.find((p) => p.id === pkgId);

  // The handoff shows a single package because it is a prototype. Real projects
  // run several at once, so the rail carries a switcher; "+ New package" drops
  // back to step 01, which is the only place a package gets created.
  const openNew = () => { setPkgId(null); setStep(0); };
  const openPkg = (id: string) => { setPkgId(id); setStep((s) => (s === 0 ? 1 : s)); };

  return (
    <>
      <PageHeader
        title="Bid Management"
        subtitle="Competitive bids gathered and compared before a number goes into the budget."
        right={<Link href="/costs" className="btn btn-sm">Project Budget →</Link>}
      />

      <div className="ever-bidshell" style={{ marginTop: 16 }}>
        {/* Left rail: which package you're in, and where you are in it. */}
        <aside style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0, minHeight: narrow ? undefined : 420 }}>
          <div>
            <Kicker>Package</Kicker>
            <div className="serif" style={{ fontSize: 15.5, fontWeight: 700, color: "var(--walnut)", lineHeight: 1.2, marginTop: 3 }}>
              {pkg ? tradeName(db, pkg.tradeId) : "New package"}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
              {pkg ? `${pkg.bids.length} invited · ${bidsIn(pkg)} bid${bidsIn(pkg) === 1 ? "" : "s"} in` : "Nothing invited yet"}
            </div>
          </div>

          {packages.length > 0 && (
            <select
              value={pkg?.id ?? NEW}
              onChange={(e) => (e.target.value === NEW ? openNew() : openPkg(e.target.value))}
              style={{ fontSize: 12, width: "100%", padding: "5px 7px" }}
            >
              {packages.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              <option value={NEW}>+ New package</option>
            </select>
          )}

          <nav className="ever-bidnav" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {NAV.map((label, i) => {
              const locked = i > 0 && !pkg;
              const on = i === step;
              return (
                <button key={label} disabled={locked} onClick={() => setStep(i)}
                  title={locked ? "Pick a trade first — that's what creates the package." : undefined}
                  style={{
                    display: "flex", gap: 8, alignItems: "baseline", textAlign: "left", border: 0, borderRadius: 7,
                    padding: "6px 8px", font: "inherit", fontSize: 12.5, cursor: locked ? "not-allowed" : "pointer",
                    background: on ? "var(--sage-tint)" : "transparent",
                    color: locked ? "var(--line)" : on ? "var(--ink)" : "var(--muted)",
                  }}>
                  <span className="serif" style={{ fontSize: 11, fontWeight: 700, color: "var(--brass-2)" }}>{String(i + 1).padStart(2, "0")}</span>
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>

          {/* The promise the whole module is built on. Desktop only — on a phone
              the rail is already competing with the work for the screen. */}
          {!narrow && (
            <div style={{ marginTop: "auto", paddingTop: 10, borderTop: "1px solid var(--line)", fontSize: 11, lineHeight: 1.5, color: "var(--muted)" }}>
              Every bid lands on the same five fields, whichever way it arrives. Mismatches are flagged, never silently corrected.
            </div>
          )}
        </aside>

        <div style={{ minWidth: 0 }}>
          {step === 0 && <TradesScreen ro={ro} onCreated={(id) => { setPkgId(id); setStep(1); }} />}
          {pkg && step === 1 && <ContactsScreen p={pkg} ro={ro} onBack={() => setStep(0)} onNext={() => setStep(2)} />}
          {pkg && step === 2 && <RoutesScreen p={pkg} ro={ro} onBack={() => setStep(1)} onNext={() => setStep(3)} />}
          {pkg && step === 3 && <IntakeScreen p={pkg} ro={ro} onBack={() => setStep(2)} onNext={() => setStep(4)} />}
          {pkg && step === 4 && <CompareScreen p={pkg} onBack={() => setStep(3)} onNext={() => setStep(5)} />}
          {pkg && step === 5 && <AwardScreen p={pkg} ro={ro} onBack={() => setStep(4)} />}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// 01 — which trades. Picking several creates a package for each, because bids
// only ever compare inside one trade.
function TradesScreen({ ro, onCreated }: { ro: boolean; onCreated: (id: string) => void }) {
  const store = useStore();
  const db = store.db;
  const narrow = useNarrow();
  const [picked, setPicked] = useState<string[]>([]);

  // vendorCovers, not the engagement trade: a mason who also pours concrete
  // counts towards both trades' contact numbers.
  const saved = (tid: string) => db.contacts.filter((c) => c.party === "vendor" && vendorCovers(c, tid)).length;
  const toggle = (tid: string) => setPicked((p) => (p.includes(tid) ? p.filter((x) => x !== tid) : [...p, tid]));

  const create = () => {
    let first = "";
    for (const tid of picked) {
      const id = store.addBidPackage({
        title: `${tradeName(db, tid)} — ${db.project.name}`,
        tradeId: tid,
        // The rooms this trade is already scoped into ride along invisibly, so an
        // award lands on a budget line that knows where the work is.
        roomIds: db.scope.filter((c) => c.tradeId === tid && c.status === "in").map((c) => c.roomId),
        scopeDetails: "",
        pricingBasis: "lump",
      });
      if (!first) first = id;
    }
    if (first) onCreated(first);
  };

  const label = `Continue with ${picked.length} trade${picked.length === 1 ? "" : "s"}`;
  const head = (
    <ScreenHead
      title="Which trades is this package for?"
      sub="Pick one or several. Bids still only compare inside a trade — each one gets its own column set."
      right={!ro && !narrow && (
        <button className="btn btn-primary btn-sm" disabled={!picked.length} onClick={create}>{label} →</button>
      )}
    />
  );

  if (narrow) {
    const rows: TriageRow[] = MACRO_ORDER.flatMap((cat) =>
      db.trades.filter((t) => t.category === cat).map((t) => ({
        id: t.id,
        title: t.name,
        value: picked.includes(t.id) ? "Picked" : undefined,
        meta: `${cat} · ${saved(t.id)} saved contact${saved(t.id) === 1 ? "" : "s"}`,
        on: picked.includes(t.id),
        onClick: ro ? undefined : () => toggle(t.id),
      })));
    return <>{head}<Triage rows={rows} empty="No trades on this project yet." next={ro ? undefined : { label, disabled: !picked.length, onClick: create }} /></>;
  }

  return (
    <>
      {head}
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
                  <Tile key={t.id} on={on} onClick={ro ? undefined : () => toggle(t.id)}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, width: "100%" }}>
                      <span className="serif" style={{ fontSize: 15, fontWeight: 700, color: "var(--walnut)", lineHeight: 1.2 }}>{t.name}</span>
                      <Check on={on} />
                    </div>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>{saved(t.id)} saved contact{saved(t.id) === 1 ? "" : "s"}</span>
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
// 02 — who bids. The whole directory is here; the ones who cover this package
// sort to the top rather than the others being hidden.
function ContactsScreen({ p, ro, onBack, onNext }: { p: BidPackage; ro: boolean; onBack: () => void; onNext: () => void }) {
  const store = useStore();
  const db = store.db;
  const narrow = useNarrow();
  const trade = tradeName(db, p.tradeId);
  const vendors = db.contacts.filter((c) => c.party === "vendor");
  const covers = vendors.filter((c) => vendorCovers(c, p.tradeId));
  const others = vendors.filter((c) => !vendorCovers(c, p.tradeId));
  const bidFor = (cid: string) => p.bids.find((b) => b.contactId === cid);

  const toggle = (cid: string) => {
    const existing = bidFor(cid);
    if (existing) store.removeBid(p.id, existing.id);
    else store.addBidsForContacts(p.id, [cid], "app");
  };

  const label = p.bids.length ? `Continue with ${p.bids.length}` : "Pick at least one";
  const head = (
    <ScreenHead
      title="Who should bid this?"
      sub="Everyone in the directory is here. The ones who cover this package sit on top."
      right={!narrow && <button className="btn btn-primary btn-sm" disabled={!p.bids.length} onClick={onNext}>{label} →</button>}
    />
  );

  if (narrow) {
    const row = (c: ContactSheet): TriageRow => ({
      id: c.id,
      title: c.company,
      value: bidFor(c.id) ? "Invited" : undefined,
      meta: `${contactLine(c)} · ${vendorTrades(c).map((t) => tradeName(db, t)).join(" · ") || "Vendor"}`,
      flag: vendorCovers(c, p.tradeId) ? undefined : "Outside this package",
      on: !!bidFor(c.id),
      onClick: ro ? undefined : () => toggle(c.id),
    });
    return (
      <>
        {head}
        <Triage rows={[...covers, ...others].map(row)} empty="No vendor contacts yet."
          back={onBack} next={{ label, disabled: !p.bids.length, onClick: onNext }} />
      </>
    );
  }

  const card = (c: ContactSheet) => {
    const on = !!bidFor(c.id);
    const trades = vendorTrades(c);
    return (
      <Tile key={c.id} on={on} onClick={ro ? undefined : () => toggle(c.id)} style={{ flexDirection: "row", alignItems: "flex-start", gap: 11 }}>
        <Check on={on} />
        <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          <span className="serif" style={{ fontSize: 15, fontWeight: 700, color: "var(--walnut)", lineHeight: 1.2 }}>{c.company}</span>
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{contactLine(c)}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <Kicker>{trades.map((t) => tradeName(db, t)).join(" · ") || "Vendor"}</Kicker>
            {trades.length > 1 && <Tag>{trades.length} trades</Tag>}
          </span>
        </span>
      </Tile>
    );
  };
  const grid = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 } as const;

  return (
    <>
      {head}
      {!vendors.length && (
        <div className="card" style={{ padding: 16, fontSize: 12.5, color: "var(--muted)" }}>
          No vendor contacts yet — add them in <Link href="/admin" style={{ color: "var(--sage-2)" }}>Admin → Team</Link>.
        </div>
      )}
      {covers.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Kicker style={{ marginBottom: 6 }}>{covers.length} cover {trade}</Kicker>
          <div style={grid}>{covers.map(card)}</div>
        </div>
      )}
      {others.length > 0 && (
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          <Kicker tone="muted" style={{ marginBottom: 6 }}>{others.length} other contacts — outside this package</Kicker>
          <div style={grid}>{others.map(card)}</div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// 03 — the basis everyone prices on, and the route each vendor submits through.
function RoutesScreen({ p, ro, onBack, onNext }: { p: BidPackage; ro: boolean; onBack: () => void; onNext: () => void }) {
  const store = useStore();
  const db = store.db;
  const narrow = useNarrow();
  const basis = p.pricingBasis ?? "lump";
  const invited = p.bids.length > 0;

  const issue = () => {
    if (!invited) return;
    store.issueBidPackage(p.id);
    onNext();
  };

  // Re-issuing a request that is already out would be a lie; after the first
  // send the same button just moves you along.
  const label = p.status === "draft" ? "Issue request" : "Continue";
  const blocked = invited ? undefined : "Nobody invited yet — pick contacts on step 02.";
  const head = (
    <ScreenHead
      title="How does each one submit?"
      sub="Three routes in, one set of fields out. Pick the route each contact actually works in."
      right={!ro && !narrow && (
        <span title={blocked}>
          <button className="btn btn-primary btn-sm" disabled={!invited} onClick={issue}>{label} →</button>
        </span>
      )}
    />
  );

  if (narrow) {
    const rows: TriageRow[] = p.bids.map((b) => {
      const r = b.route ?? "app";
      return {
        id: b.id,
        title: b.vendorName,
        value: BID_ROUTE_LABEL[r],
        meta: `${contactLine(contactOf(db, b))}${ro ? "" : " · tap to change route"}`,
        onClick: ro ? undefined : () => store.updateBid(p.id, b.id, { route: ROUTES[(ROUTES.indexOf(r) + 1) % ROUTES.length] }),
      };
    });
    return (
      <>
        {head}
        <Triage rows={rows} empty="Nobody invited yet — go back to Contacts."
          back={onBack} next={ro ? undefined : { label, disabled: !invited, onClick: issue }} />
      </>
    );
  }

  return (
    <>
      {head}

      {/* Pricing basis — a package-level decision, taken before anything goes out. */}
      <div className="card" style={{ padding: 13, marginBottom: 12, display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.3fr)", gap: 16, alignItems: "center" }}>
        <div>
          <Kicker>Pricing basis — set before the request goes out</Kicker>
          <div style={{ fontSize: 11.5, lineHeight: 1.45, color: "var(--muted)", marginTop: 4 }}>
            {basis === "tm"
              ? "Every vendor prices a crew rate and a not-to-exceed. The comparison ranks on rate and cap, not one figure."
              : "Every vendor returns one fixed figure against this scope. A bid that comes back the other way gets flagged, never converted."}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
          {(["lump", "tm"] as PricingBasis[]).map((k) => (
            <OptionBtn key={k} on={basis === k} disabled={ro} label={PRICING_BASIS_LABEL[k]} hint={PRICING_BASIS_HINT[k]}
              onClick={() => store.updateBidPackage(p.id, { pricingBasis: k })} />
          ))}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {p.bids.map((b) => (
          <div key={b.id} className="card" style={{ padding: 12, display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.5fr)", gap: 14, alignItems: "center" }}>
            <div style={{ minWidth: 0 }}>
              <div className="serif" style={{ fontSize: 15, fontWeight: 700, color: "var(--walnut)" }}>{b.vendorName}</div>
              <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{contactLine(contactOf(db, b))}</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 6 }}>
              {ROUTES.map((r) => (
                <OptionBtn key={r} on={(b.route ?? "app") === r} disabled={ro} label={BID_ROUTE_LABEL[r]} hint={BID_ROUTE_HINT[r]}
                  onClick={() => store.updateBid(p.id, b.id, { route: r })} />
              ))}
            </div>
          </div>
        ))}
        {!invited && <div className="card" style={{ padding: 16, fontSize: 12.5, color: "var(--muted)" }}>Nobody invited yet — go back to <strong>Contacts</strong>.</div>}
      </div>
    </>
  );
}

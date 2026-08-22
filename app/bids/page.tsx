"use client";

import { useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/data/hooks";
import { PageHeader, NoAccess, Pill, StatCard } from "../ui/bits";
import {
  accessFor, BID_ROUTE_HINT, BID_ROUTE_LABEL, PRICING_BASIS_HINT, PRICING_BASIS_LABEL,
  vendorCovers, vendorTrades,
  type BidPackage, type BidRoute, type ContactSheet, type CostLine, type PricingBasis,
} from "@/lib/data/types";
import { tradeName, macroOrder, fmt, romRows, lineBase, lineTotal, linePaid, lineDrawn, approvedNetChange, allocationAmount } from "@/lib/data/money";
import {
  Check, Kicker, OptionBtn, ScreenHead, Tag, Tile, Triage, contactLine, contactOf, useNarrow, type TriageRow,
} from "./kit";
import { IntakeScreen, CompareScreen, AwardScreen } from "./screens";
import { ScopeScreen } from "./scope";
import { downloadRequestDoc } from "./request-doc";
import { PackageList } from "./package-list";
import { BundlePicker } from "./bundle";
import { useConfirm } from "../ui/confirm";
import { DocIcon } from "../ui/icons";

// ---------------------------------------------------------------------------
// Bid Management — competitive bidding before the budget exists.
//
// Six steps against one package: pick the trades, pick who bids, set how each
// one submits, read what came back, compare it like-for-like, award. The award
// promotes the price into Budget Management as a locked line.
//
// The through-line is that bids arrive three different ways — the vendor fills
// our form, we key it off a phone call, or they send their own quote — and all
// three have to land on the same five fields or the comparison is a fiction.
// ---------------------------------------------------------------------------

const NEW = "__new";
const ROUTES: BidRoute[] = ["app", "gc", "upload"];

/** A bid is "in" when a figure actually arrived — derived from the bid itself,
 *  never from a status somebody forgot to flip. */
const bidsIn = (p: BidPackage) => p.bids.filter((b) => b.amount != null).length;

// Two tabs. The contract, the budget line, the draws and the schedule are all
// modules of their own — showing them again here was a second place for the
// same thing to be read, and a second place for it to be wrong.
type Tab = "scope" | "bids";
// "Add New Vendors to Bid" described the first step of a tab that runs all the
// way to the award. The tab is named for what it contains.
const TABS: [Tab, string][] = [["scope", "Scope"], ["bids", "Bids & award"]];

export default function BidsPage() {
  const store = useStore();
  const ask = useConfirm();
  const db = store.db;
  const access = accessFor(store.currentUser, store.session.role, "bids");
  const [pkgId, setPkgId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("scope");
  const [creating, setCreating] = useState(false);

  if (access === "none") return <NoAccess module="Bid and Package Management" />;
  const ro = access !== "edit";
  const packages = db.bidPackages ?? [];
  const pkg = packages.find((p) => p.id === pkgId);

  // ---- the list ----------------------------------------------------------
  if (!pkg && !creating) {
    return (
      <>
        <PageHeader
          title="Bid and Package Management"
          subtitle="One package is one scope of work put out to bid, awarded to one vendor, at one price. Open a package for its scope, its bids, the contract, and the money and dates that follow."
          right={<Link href="/costs" className="btn btn-sm">Budget Management →</Link>}
        />
        <PackageList canEdit={!ro} onNew={() => setCreating(true)}
          onOpen={(id: string) => {
            const p = packages.find((x) => x.id === id);
            // Land where the work is: an unawarded package opens on its bids,
            // an awarded one on the money it became.
            setTab("bids");
            setPkgId(id);
          }} />
      </>
    );
  }

  // ---- creating a package ------------------------------------------------
  if (creating) {
    return (
      <>
        <button className="btn btn-sm" style={{ marginBottom: 10 }} onClick={() => setCreating(false)}>← All packages</button>
        <PageHeader
          title="New package"
          subtitle="The GC bundles the bid: pick the budget lines going out together, and the app says whether anyone can actually price the bundle."
        />
        <div style={{ marginTop: 14 }}>
          <BundlePicker ro={ro} onCreated={(id) => { setCreating(false); setPkgId(id); setTab("scope"); }} />
        </div>
      </>
    );
  }

  // ---- one package, six tabs ---------------------------------------------
  const no = packages.findIndex((x) => x.id === pkg!.id) + 1;
  const won = pkg!.bids?.find((b) => b.id === pkg!.awardedBidId);
  const line = pkg!.lineId ? db.costLines.find((l) => l.id === pkg!.lineId) : undefined;
  const recommended = pkg!.bids?.find((b) => b.shortlisted && !pkg!.awardedBidId);
  const statusChip = pkg!.awardedBidId
    ? (line ? "Awarded · in progress" : "Awarded")
    : recommended ? "Award pending"
    : pkg!.status === "draft" ? "Drafting" : "Bidding";

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <button className="btn btn-sm" onClick={() => { setPkgId(null); }}>← All packages</button>
        {/* Deleting is refused once awarded — that award created a contract and
            a budget line, and the money would be left with nothing explaining it. */}
        {!ro && !pkg!.awardedBidId ? (
          <button className="btn btn-sm" style={{ color: "var(--rust)" }}
            onClick={async () => {
              if (await ask({
                title: `Delete "${pkg!.title}"?`,
                body: "Nothing has been awarded on it, so no money or contract depends on it. The scope you wrote goes with it.",
                danger: "Delete the package",
              })) { store.removeBidPackage(pkg!.id); setPkgId(null); }
            }}>Delete package</button>
        ) : null}
      </div>
      <PageHeader
        title={pkg!.title}
        subtitle={won
          ? `${won.vendorName} · awarded${won.amount != null ? ` at ${fmt(won.amount)}` : ""}`
          : `Package ${String(no).padStart(2, "0")} · ${tradeName(db, pkg!.tradeId)} · ${(pkg!.bids ?? []).length} invited`}
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {ro ? <Pill color="var(--muted)">View only</Pill> : null}
            <Pill color="#fff" bg={pkg!.awardedBidId ? "var(--sage)" : "var(--brass)"}>{statusChip}</Pill>
          </div>
        }
      />

      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", borderBottom: "1px solid var(--line)", marginTop: 14 }}>
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{
              padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer",
              background: "transparent", border: "none",
              color: tab === k ? "var(--walnut)" : "var(--muted)",
              borderBottom: `2px solid ${tab === k ? "var(--sage)" : "transparent"}`,
              marginBottom: -1,
            }}>{label}</button>
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        {tab === "scope" && <ScopeScreen p={pkg!} ro={ro} onNext={() => setTab("bids")} />}
        {tab === "bids" && <BidsTab p={pkg!} ro={ro} />}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Bids — everything from inviting to awarding, on one tab. The five-step card
// says what happens next and why, so the tab is navigable without a wizard.
// ---------------------------------------------------------------------------
function BidsTab({ p, ro }: { p: BidPackage; ro: boolean }) {
  const [phase, setPhase] = useState<"invite" | "routes" | "intake" | "compare" | "award">(
    p.awardedBidId ? "award" : !p.bids?.length ? "invite" : p.bids.some((b) => typeof b.amount === "number") ? "compare" : "intake",
  );
  const bidsIn = (p.bids ?? []).filter((b) => typeof b.amount === "number").length;
  const next = !p.scopeItems?.length
    ? { what: "Write the scope, then issue the request.", why: "Nothing can be sent until the scope exists.", go: null as null | (() => void), label: "" }
    : !p.bids?.length
      ? { what: "Invite the vendors who should bid.", why: "Pick from the directory below.", go: () => setPhase("invite"), label: "Invite vendors" }
      : !bidsIn
        ? { what: `${p.bids.length} invited, nothing back yet.`, why: "Uploaded bids are scanned; confirm the fields when they land.", go: () => setPhase("intake"), label: "Open bids in" }
        : !p.awardedBidId
          ? { what: "Compare the bids and award one.", why: `All ${bidsIn} carry the five fields, so they compare like for like.`, go: () => setPhase("compare"), label: "Compare" }
          : { what: "Contract signed — the package is live.", why: "Draws and QC run from the Draws and Schedule tabs.", go: null, label: "" };

  return (
    <>
      <div className="card" style={{ padding: 14, marginBottom: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", borderLeft: "3px solid var(--brass)" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 10, letterSpacing: ".09em", textTransform: "uppercase", color: "var(--muted)" }}>Next</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--walnut)", marginTop: 2 }}>{next.what}</div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{next.why}</div>
        </div>
        {next.go && !ro ? <button className="btn btn-sm btn-primary" onClick={next.go}>{next.label} →</button> : null}
      </div>

      {/* A stepper, not five equal buttons: numbered, with the steps already
          behind you tinted so the sequence reads at a glance. */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        {([["invite", "Who bids"], ["routes", "How they submit"], ["intake", "Bids in"], ["compare", "Compare"], ["award", "Award"]] as const).map(([k, l], i, arr) => {
          const at = arr.findIndex(([x]) => x === phase);
          const done = i < at;
          const now = phase === k;
          return (
            <button key={k} className="btn btn-sm" onClick={() => setPhase(k)}
              style={{
                background: now ? "var(--sage-tint)" : done ? "var(--cream-2)" : undefined,
                borderColor: now ? "var(--sage)" : undefined,
                fontWeight: now ? 700 : 400,
                color: done ? "var(--muted)" : undefined,
                display: "inline-flex", alignItems: "center", gap: 6,
              }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: now ? "var(--sage-2)" : "var(--muted)" }}>
                {done ? "✓" : String(i + 1).padStart(2, "0")}
              </span>
              {l}
            </button>
          );
        })}
      </div>

      {phase === "invite" && <ContactsScreen p={p} ro={ro} onBack={() => undefined} onNext={() => setPhase("routes")} />}
      {phase === "routes" && <RoutesScreen p={p} ro={ro} onBack={() => setPhase("invite")} onNext={() => setPhase("intake")} />}
      {phase === "intake" && <IntakeScreen p={p} ro={ro} onBack={() => setPhase("routes")} onNext={() => setPhase("compare")} />}
      {phase === "compare" && <CompareScreen p={p} onBack={() => setPhase("intake")} onNext={() => setPhase("award")} />}
      {phase === "award" && <AwardScreen p={p} ro={ro} onBack={() => setPhase("compare")} />}
    </>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: ".09em", textTransform: "uppercase", color: "var(--muted)" }}>{k}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--walnut)", marginTop: 2 }}>{v}</div>
    </div>
  );
}


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
      right={!narrow && (
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          {/* The thing you actually send them. Everything on step 02 lands here. */}
          <button className="btn btn-sm" onClick={() => downloadRequestDoc(db, p)}><DocIcon width={14} height={14} /> Request document</button>
          {!ro && (
            <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
              <button className="btn btn-primary btn-sm" disabled={!invited} onClick={issue}>{label} →</button>
              {/* The reason is on the screen for everyone, not in a tooltip for
                  whoever happens to have a mouse. */}
              {blocked ? <span style={{ fontSize: 11, color: "var(--muted)", maxWidth: 240, textAlign: "right", lineHeight: 1.35 }}>{blocked}</span> : null}
            </span>
          )}
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

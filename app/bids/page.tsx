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

const NAV = ["Trades", "Scope", "Contacts", "How they bid", "Bids in", "Compare", "Award"] as const;
const NEW = "__new";
const ROUTES: BidRoute[] = ["app", "gc", "upload"];

/** A bid is "in" when a figure actually arrived — derived from the bid itself,
 *  never from a status somebody forgot to flip. */
const bidsIn = (p: BidPackage) => p.bids.filter((b) => b.amount != null).length;

type Tab = "scope" | "bids" | "contract" | "budget" | "draws" | "schedule";
const TABS: [Tab, string][] = [
  ["scope", "Scope"], ["bids", "Bids"], ["contract", "Contract"],
  ["budget", "Budget line"], ["draws", "Draws"], ["schedule", "Schedule"],
];

export default function BidsPage() {
  const store = useStore();
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
            setTab(p?.awardedBidId ? "budget" : "bids");
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
        <PageHeader title="New package" subtitle="Pick the trades this package covers. Bids still only compare inside a trade — each one gets its own column set." />
        <div style={{ marginTop: 14 }}>
          <TradesScreen ro={ro} onCreated={(id) => { setCreating(false); setPkgId(id); setTab("scope"); }} />
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
      <button className="btn btn-sm" style={{ marginBottom: 10 }} onClick={() => { setPkgId(null); }}>← All packages</button>
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
        {tab === "scope" && <ScopeScreen p={pkg!} ro={ro} onBack={() => setPkgId(null)} onNext={() => setTab("bids")} />}
        {tab === "bids" && <BidsTab p={pkg!} ro={ro} />}
        {tab === "contract" && <ContractTab p={pkg!} line={line} />}
        {tab === "budget" && <BudgetTab p={pkg!} line={line} />}
        {tab === "draws" && <DrawsTab p={pkg!} line={line} />}
        {tab === "schedule" && <ScheduleTab p={pkg!} />}
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

      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 14 }}>
        {([["invite", "Who bids"], ["routes", "How they submit"], ["intake", "Bids in"], ["compare", "Compare"], ["award", "Award"]] as const).map(([k, l]) => (
          <button key={k} className="btn btn-sm" onClick={() => setPhase(k)}
            style={{ background: phase === k ? "var(--sage-tint)" : undefined, fontWeight: phase === k ? 700 : 400 }}>{l}</button>
        ))}
      </div>

      {phase === "invite" && <ContactsScreen p={p} ro={ro} onBack={() => undefined} onNext={() => setPhase("routes")} />}
      {phase === "routes" && <RoutesScreen p={p} ro={ro} onBack={() => setPhase("invite")} onNext={() => setPhase("intake")} />}
      {phase === "intake" && <IntakeScreen p={p} ro={ro} onBack={() => setPhase("routes")} onNext={() => setPhase("compare")} />}
      {phase === "compare" && <CompareScreen p={p} onBack={() => setPhase("intake")} onNext={() => setPhase("award")} />}
      {phase === "award" && <AwardScreen p={p} ro={ro} onBack={() => setPhase("compare")} />}
    </>
  );
}

// ---------------------------------------------------------------------------
function ContractTab({ p, line }: { p: BidPackage; line?: CostLine }) {
  const store = useStore();
  const db = store.db;
  const won = p.bids?.find((b) => b.id === p.awardedBidId);
  if (!won) {
    return (
      <div className="card" style={{ padding: 18, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6, maxWidth: "70ch" }}>
        <strong style={{ color: "var(--walnut)" }}>No contract yet.</strong><br />
        {p.bids?.some((b) => b.shortlisted)
          ? "A bid is shortlisted but not awarded. Awarding it opens the budget line and puts the bar on the schedule."
          : "No bid awarded yet. Award one on the Bids tab and the contract follows."}
      </div>
    );
  }
  const agreement = db.vendorAgreements?.find((a) => a.tradeId === p.tradeId);
  return (
    <>
      <div className="card" style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
        <Field k="Vendor" v={won.vendorName} />
        <Field k="Awarded" v={won.amount != null ? fmt(won.amount) : "—"} />
        <Field k="Basis" v={won.pricingBasis === "tm" ? "Time & materials" : "Lump sum"} />
        <Field k="Signed" v={agreement?.round1?.length ? `Round 1 · ${agreement.round1.length} signature${agreement.round1.length === 1 ? "" : "s"}` : "Not signed"} />
      </div>
      <div style={{ fontSize: 11.5, lineHeight: 1.6, color: "var(--muted)", marginTop: 12, maxWidth: "76ch" }}>
        One vendor awarded one package at one price. &ldquo;Trade&rdquo; is only the category that decided who was
        invited — it is not a container, and it never holds a contract.
        {" "}<Link href="/vendors" style={{ color: "var(--sage-2)", fontWeight: 600 }}>Open the contract →</Link>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
function BudgetTab({ p, line }: { p: BidPackage; line?: CostLine }) {
  const store = useStore();
  const db = store.db;
  if (!line) {
    return (
      <div className="card" style={{ padding: 18, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6, maxWidth: "70ch" }}>
        <strong style={{ color: "var(--walnut)" }}>No budget line yet.</strong><br />
        A line exists once a contract does. Award a bid on the Bids tab and the price lands on the
        trade&rsquo;s budget line as contracted.
      </div>
    );
  }
  const row = romRows(db).find((r) => r.lines.some((l: CostLine) => l.id === line.id));
  const paid = linePaid(db, line);
  const base = lineBase(line);
  const fee = lineTotal(line) - base;
  const co = approvedNetChange(line);
  const total = base + co + fee;
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(165px, 1fr))", gap: 10 }}>
        <StatCard label="Contracted" value={fmt(base)} sub="the work, before fee" />
        <StatCard label="Change orders" value={co ? fmt(co) : "—"} sub={co ? "approved" : "none approved"} accent={co ? "var(--rust)" : undefined} />
        <StatCard label="Builder fee" value={fee ? fmt(fee) : "—"} sub={fee ? "on the contracted work" : "owner managed — no fee"} />
        <StatCard label="Total" value={fmt(total)} accent="var(--walnut)" sub="contracted + change orders + fee" />
        <StatCard label="Drawn / Paid" value={fmt(paid)} accent="var(--ok)" sub={`${fmt(Math.max(0, total - paid))} outstanding`} />
      </div>
      {row ? (
        <div className="card" style={{ padding: 14, marginTop: 14, fontSize: 12.5, lineHeight: 1.6, maxWidth: "76ch" }}>
          <div style={{ fontSize: 10, letterSpacing: ".09em", textTransform: "uppercase", color: "var(--muted)" }}>Against the ROM</div>
          <div style={{ marginTop: 4 }}>
            {row.committed
              ? <>The owner agreed <strong>{fmt(row.romFigure)}</strong> for {row.label}. This package totals <strong>{fmt(total)}</strong>
                {total > row.romFigure
                  ? <> — <span style={{ color: "var(--rust)", fontWeight: 700 }}>{fmt(total - row.romFigure)} above the agreed figure.</span></>
                  : <> — inside the agreed figure.</>}
                {row.lines.length > 1 ? <> This trade carries {row.lines.length} lines, so read it against the trade total, not this package alone.</> : null}
              </>
              : <>This trade&rsquo;s ROM line is still a draft, so there is nothing agreed to measure against yet.</>}
          </div>
          <Link href="/costs" className="btn btn-sm" style={{ marginTop: 10 }}>Open Budget Management →</Link>
        </div>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
function DrawsTab({ p, line }: { p: BidPackage; line?: CostLine }) {
  const store = useStore();
  const db = store.db;
  if (!line) {
    return <div className="card" style={{ padding: 18, fontSize: 12.5, color: "var(--muted)" }}>
      No draws yet — a draw needs an awarded contract to pay against.
    </div>;
  }
  const rows = (db.draws ?? []).flatMap((d) =>
    (d.allocations ?? []).filter((a) => a.lineId === line.id).map((a) => ({ d, a })));
  const total = lineBase(line) + approvedNetChange(line) + (lineTotal(line) - lineBase(line));
  const paid = linePaid(db, line);
  return (
    <>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>
        {fmt(paid)} of {fmt(total)} released · {fmt(Math.max(0, total - paid))} still to draw
      </div>
      {!rows.length ? (
        <div className="card" style={{ padding: 18, fontSize: 12.5, color: "var(--muted)" }}>
          Nothing drawn against this line yet.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 520, fontSize: 12.5 }}>
            <thead><tr>{["Draw", "Amount", "Status"].map((h, i) => (
              <th key={h} style={{ textAlign: i === 1 ? "right" : "left", padding: "7px 10px", fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)", borderBottom: "1px solid var(--line)" }}>{h}</th>
            ))}</tr></thead>
            <tbody>
              {rows.map(({ d, a }) => (
                <tr key={`${d.id}-${a.lineId}`} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ padding: "8px 10px" }}>{d.name}{d.paidDate ? <span style={{ color: "var(--muted)" }}> · {d.paidDate}</span> : null}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(allocationAmount(line, a))}</td>
                  <td style={{ padding: "8px 10px" }}>
                    <Pill color="#fff" bg={d.status === "paid" ? "var(--sage)" : d.status === "pushed" ? "var(--brass)" : "var(--cream-2)"}>
                      {d.status === "paid" ? "Paid" : d.status === "pushed" ? "Issued" : "Planned"}
                    </Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 10, maxWidth: "72ch", lineHeight: 1.55 }}>
        Draws are built and released in <Link href="/payments" style={{ color: "var(--sage-2)", fontWeight: 600 }}>Draw Management</Link>.
        This is the view from the package: what has been paid against its line.
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
function ScheduleTab({ p }: { p: BidPackage }) {
  const store = useStore();
  const db = store.db;
  const bars = (db.schedule ?? []).filter((x) => x.tradeId === p.tradeId);
  const mats = (db.materials ?? []).filter((m) => m.tradeId === p.tradeId);
  const won = p.bids?.find((b) => b.id === p.awardedBidId);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
      <div>
        <div style={{ fontSize: 10, letterSpacing: ".09em", textTransform: "uppercase", color: "var(--muted)" }}>On site</div>
        {won ? (
          <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 8px" }}>
            The bid promised {won.workingDays ?? "—"} working days with {won.crewSize ?? "—"} on site.
          </div>
        ) : null}
        {!bars.length ? (
          <div className="card" style={{ padding: 16, fontSize: 12.5, color: "var(--muted)" }}>
            Nothing on the schedule for this trade yet.
          </div>
        ) : bars.map((b) => (
          <div key={b.id} className="card" style={{ padding: 11, marginBottom: 7, fontSize: 12.5 }}>
            <div style={{ fontWeight: 600 }}>{b.label}</div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
              {b.start} → {b.end}
              {b.confirm === "confirmed" ? " · trade-confirmed" : b.confirm === "pending" ? " · awaiting trade confirm" : ""}
            </div>
          </div>
        ))}
        <Link href="/timing" className="btn btn-sm" style={{ marginTop: 4 }}>Open the schedule →</Link>
      </div>
      <div>
        <div style={{ fontSize: 10, letterSpacing: ".09em", textTransform: "uppercase", color: "var(--muted)" }}>
          Materials on this package — {mats.length}
        </div>
        {!mats.length ? (
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 5 }}>None tied to this trade.</div>
        ) : (
          <div style={{ marginTop: 5 }}>
            {mats.slice(0, 10).map((m) => (
              <div key={m.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "4px 0", borderBottom: "1px solid var(--line)", fontSize: 12 }}>
                <span>{m.item}</span>
                <span style={{ color: "var(--muted)" }}>{m.status}</span>
              </div>
            ))}
            {mats.length > 10 ? <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 5 }}>+{mats.length - 10} more</div> : null}
          </div>
        )}
        <Link href="/materials" className="btn btn-sm" style={{ marginTop: 8 }}>Open materials →</Link>
      </div>
    </div>
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
    const rows: TriageRow[] = macroOrder(db).flatMap((cat) =>
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
      {macroOrder(db).map((cat) => {
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
      right={!narrow && (
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          {/* The thing you actually send them. Everything on step 02 lands here. */}
          <button className="btn btn-sm" onClick={() => downloadRequestDoc(db, p)}>📄 Request document</button>
          {!ro && (
            <span title={blocked}>
              <button className="btn btn-primary btn-sm" disabled={!invited} onClick={issue}>{label} →</button>
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

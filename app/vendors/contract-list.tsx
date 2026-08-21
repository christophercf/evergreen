"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/data/hooks";
import type { DB } from "@/lib/data/types";
import { fmt, tradeName, lineCurrent, lineDrawn, linePaid } from "@/lib/data/money";
import { contractOf, contractState, contractMissingSigs, contractAmount, type ContractState } from "@/lib/data/contract";
import type { Draw } from "@/lib/data/types";
import { Pill, StatCard, PaceBar } from "../ui/bits";

// ---------------------------------------------------------------------------
// Contracts, one line each.
//
// A contract belongs to the package it came out of — that is the unit the GC
// actually bid, awarded and signed — so the summary is a list of packages, not
// a wall of open cards. Anything contracted before the app issued contracts
// still appears, under its own band, because it is money owed either way.
//
// The row is the whole contract at a glance: who, what state, what sum. Open
// one and the full document, signatures and terms are underneath it.
// ---------------------------------------------------------------------------

const MUTED = "var(--muted)";

const STATE_BG: Record<ContractState, string> = {
  none: "var(--cream-2)",
  issued: "var(--brass)",
  signed: "var(--ok)",
};

export type ContractRow = {
  key: string;
  /** Package title, or the trade's name for work contracted outside a package. */
  title: string;
  tradeIds: string[];
  vendor: string | null;
  state: ContractState;
  /** Contract sum incl. amendments, before the builder's fee. */
  amount: number;
  /** Amendments pushed onto the contract by approved change orders. */
  revisions: number;
  signed: number;
  needed: number;
  /** Paid and drawn against this contract's budget lines, for the pacing bar. */
  paid: number;
  drawn: number;
  /** No package behind it — contracted on paper before the app. */
  legacy: boolean;
  /** No contract was ever issued through the app: the locked cost line is the
   *  only record. The app has no signatures for these and must not pretend it
   *  is waiting for any. */
  paper: boolean;
};

/** The worst state across a bundle: a package is only signed when every trade
 *  in it is. One unsigned trade means the package is not done. */
function worst(states: ContractState[]): ContractState {
  if (!states.length) return "none";
  if (states.includes("none")) return "none";
  return states.includes("issued") ? "issued" : "signed";
}

export function contractRows(db: DB, tradeIds: string[]): ContractRow[] {
  const allowed = new Set(tradeIds);
  const rows: ContractRow[] = [];
  const claimed = new Set<string>();
  // Money moves on budget lines, not on contracts, so a contract's pacing is
  // its trades' lines added up — read, never stored.
  const spend = (trades: string[]) => {
    const lines = db.costLines.filter((l) => trades.includes(l.tradeId));
    return {
      paid: lines.reduce((a, l) => a + linePaid(db, l), 0),
      drawn: lines.reduce((a, l) => a + lineDrawn(db, l.id), 0),
      lineTotal: lines.reduce((a, l) => a + lineCurrent(l), 0),
    };
  };

  for (const p of db.bidPackages ?? []) {
    const trades = [...new Set([p.tradeId, ...(p.tradeIds ?? [])])].filter((t) => allowed.has(t));
    if (!trades.length) continue;
    trades.forEach((t) => claimed.add(t));
    const contracts = trades.map((t) => contractOf(db, t)).filter(Boolean);
    const won = p.bids?.find((b) => b.id === p.awardedBidId);
    const states = trades.map((t) => contractState(db, t));
    rows.push({
      key: p.id,
      title: p.title,
      tradeIds: trades,
      vendor: contracts[0]?.vendorName ?? won?.vendorName ?? null,
      state: worst(states),
      // Before a contract exists the awarded price is the best figure there is;
      // after it, the contract's own sum is the only one that counts.
      amount: contracts.length
        ? contracts.reduce((a, c) => a + contractAmount(c!), 0)
        : (won?.amount ?? 0),
      revisions: contracts.reduce((a, c) => a + (c!.revisions?.length ?? 0), 0),
      signed: trades.reduce((a, t) => a + (2 - contractMissingSigs(db, t).length), 0),
      needed: contracts.length * 2,
      ...(({ paid, drawn }) => ({ paid, drawn }))(spend(trades)),
      legacy: false,
      paper: !contracts.length,
    });
  }

  // Work that is under contract without a package behind it: the trades signed
  // on paper before any of this existed. Their cost line is the record.
  for (const t of tradeIds) {
    if (claimed.has(t)) continue;
    const c = contractOf(db, t);
    const lines = db.costLines.filter((l) => l.tradeId === t);
    const locked = lines.filter((l) => l.locked);
    if (!c && !locked.length) continue;
    const vendor = db.contacts.find((x) => x.party === "vendor" && (x.tradeId === t || x.tradeIds?.includes(t)));
    rows.push({
      key: `trade:${t}`,
      title: tradeName(db, t),
      tradeIds: [t],
      vendor: c?.vendorName ?? vendor?.company ?? null,
      state: contractState(db, t),
      amount: c ? contractAmount(c) : locked.reduce((a, l) => a + (l.lockedCost ?? 0), 0),
      revisions: c?.revisions?.length ?? 0,
      signed: c ? 2 - contractMissingSigs(db, t).length : 0,
      needed: c ? 2 : 0,
      ...(({ paid, drawn }) => ({ paid, drawn }))(spend([t])),
      legacy: true,
      paper: !c,
    });
  }

  return rows.sort((a, b) => Number(a.legacy) - Number(b.legacy) || b.amount - a.amount);
}

// ---------------------------------------------------------------------------
// Draw requests. A signed draw request is a contract in every sense that
// matters — an owner agreeing, in writing, to release a specific sum for
// specific work — so it is filed here rather than living only in the module
// that produced it.
// ---------------------------------------------------------------------------
function DrawRequests() {
  const store = useStore();
  const db = store.db;
  const [open, setOpen] = useState<string | null>(null);
  const me = store.session.userId;
  const role = store.session.role;
  // You see the ones addressed to you, and an admin or builder sees them all.
  const rows = db.draws.filter((d) => d.request && (
    ["full_admin", "builder"].includes(role) || d.request!.toUserId === me
  ));
  if (!rows.length) return null;

  const signed = rows.filter((d) => d.request!.signedBy);
  const total = rows.reduce((a, d) => a + (d.request!.total ?? 0), 0);

  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: MUTED }}>
          Draw requests — {rows.length}
        </span>
        <span style={{ fontSize: 11, color: MUTED }}>
          {signed.length} signed · {fmt(total)} requested in total
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((d) => <DrawRequestRow key={d.id} draw={d} open={open === d.id} onToggle={() => setOpen(open === d.id ? null : d.id)} />)}
      </div>
    </div>
  );
}

function DrawRequestRow({ draw, open, onToggle }: { draw: Draw; open: boolean; onToggle: () => void }) {
  const store = useStore();
  const r = draw.request!;
  const isSigned = !!r.signedBy;
  const canSign = !isSigned && (r.toUserId === store.session.userId || store.session.role === "full_admin");

  return (
    <div className="card" style={{ padding: "10px 12px", borderLeft: `3px solid ${isSigned ? "var(--ok)" : "var(--brass)"}` }}>
      <div onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", flexWrap: "wrap" }}>
        <span style={{ color: MUTED, fontSize: 12 }}>{open ? "▾" : "▸"}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 12.5 }}>{draw.name}</div>
          <div style={{ fontSize: 10.5, color: MUTED, marginTop: 2 }}>
            {isSigned
              ? `Signed by ${r.signedBy} on ${r.signedAt?.slice(0, 10)}`
              : `Issued to ${r.toName} on ${r.issuedAt.slice(0, 10)} — unsigned`}
            {draw.status === "paid" ? " · paid" : ""}
          </div>
        </div>
        <Pill color={isSigned ? "#fff" : MUTED} bg={isSigned ? "var(--ok)" : "var(--cream-2)"}>
          {isSigned ? "Signed" : "Awaiting signature"}
        </Pill>
        <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(r.total)}</span>
      </div>
      {open ? (
        <>
          <pre style={{
            margin: "8px 0 0", maxHeight: 320, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word",
            fontSize: 11, lineHeight: 1.5, background: "var(--paper)", border: "1px solid var(--line)",
            borderRadius: 8, padding: 10, fontFamily: "var(--font-sans)",
          }}>{r.body}</pre>
          {canSign ? (
            <div style={{ fontSize: 11.5, color: "var(--brass-2)", marginTop: 8, fontWeight: 600 }}>
              Sign it in Draw Management — the signature belongs with the draw it releases.
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function ContractList({ tradeIds, renderDetail }: {
  tradeIds: string[];
  renderDetail: (tradeIds: string[]) => React.ReactNode;
}) {
  const store = useStore();
  const db = store.db;
  const rows = useMemo(() => contractRows(db, tradeIds), [db, tradeIds]);
  const [open, setOpen] = useState<string | null>(null);

  const packages = rows.filter((r) => !r.legacy);
  const legacy = rows.filter((r) => r.legacy);
  const total = rows.reduce((a, r) => a + r.amount, 0);
  const pkgTotal = packages.reduce((a, r) => a + r.amount, 0);
  const revisions = rows.reduce((a, r) => a + r.revisions, 0);
  // Only contracts this app issued can be signed in it. Counting the paper ones
  // as unsigned would be the app inventing an outstanding signature.
  const inApp = rows.filter((r) => !r.paper);
  const signedCount = inApp.filter((r) => r.state === "signed").length;
  const unsigned = inApp.filter((r) => r.state !== "signed").reduce((a, r) => a + r.amount, 0);
  const paperTotal = rows.filter((r) => r.paper).reduce((a, r) => a + r.amount, 0);

  if (!rows.length) {
    return (
      <>
        <div className="card" style={{ padding: 20, textAlign: "center", color: MUTED, fontSize: 13 }}>
          Nothing is under contract yet. A contract is created when a bid is awarded in Bid and Package Management.
        </div>
        <DrawRequests />
      </>
    );
  }

  const band = (label: string, list: ContractRow[], note?: string) => list.length ? (
    <>
      <tr>
        <td colSpan={6} style={{ padding: "12px 10px 4px" }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: MUTED }}>
            {label} — {list.length}
          </span>
          {note ? <span style={{ fontSize: 11, color: MUTED, marginLeft: 8 }}>{note}</span> : null}
        </td>
      </tr>
      {list.map((r) => (
        <Row key={r.key} r={r} open={open === r.key} onToggle={() => setOpen(open === r.key ? null : r.key)} renderDetail={renderDetail} />
      ))}
    </>
  ) : null;

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(165px, 1fr))", gap: 10, marginBottom: 14 }}>
        <StatCard label="Under contract" value={fmt(total)} sub="every contract, before builder fee" accent="var(--walnut)" />
        <StatCard label="From packages" value={fmt(pkgTotal)}
          sub={`${packages.length} package${packages.length === 1 ? "" : "s"}${paperTotal ? ` · ${fmt(paperTotal)} on paper` : ""}`} />
        <StatCard label="Fully signed" value={inApp.length ? `${signedCount} of ${inApp.length}` : "—"}
          accent={inApp.length && signedCount === inApp.length ? "var(--ok)" : undefined}
          sub={!inApp.length ? "no contract issued in the app yet"
            : unsigned > 0 ? `${fmt(unsigned)} not signed yet` : "nothing outstanding"} />
        <StatCard label="Amendments" value={revisions ? String(revisions) : "—"} accent={revisions ? "var(--rust)" : undefined}
          sub={revisions ? "change orders on live contracts" : "no contract has been revised"} />
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 760, fontSize: 12.5 }}>
          <thead>
            <tr>
              {["Contract", "Vendor", "State", "Signatures", "Sum"].map((h, i) => (
                <th key={h} colSpan={i === 0 ? 2 : 1} style={{
                  textAlign: i >= 3 ? "right" : "left", padding: "7px 10px", whiteSpace: "nowrap",
                  fontSize: 10, letterSpacing: ".09em", textTransform: "uppercase", color: MUTED,
                  borderBottom: "1px solid var(--line)",
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {band("Packages", packages)}
            {band("Contracted outside a package", legacy, "signed on paper before the app issued contracts")}
            <tr style={{ borderTop: "2px solid var(--line)", fontWeight: 700 }}>
              <td colSpan={4} style={{ padding: "9px 10px" }}>Total — {rows.length} contract{rows.length === 1 ? "" : "s"}</td>
              <td style={{ padding: "9px 10px", textAlign: "right", color: MUTED, fontWeight: 400 }}>
                {rows.reduce((a, r) => a + r.needed, 0)
                  ? `${rows.reduce((a, r) => a + r.signed, 0)} of ${rows.reduce((a, r) => a + r.needed, 0)}`
                  : "—"}
              </td>
              <td style={{ padding: "9px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <DrawRequests />

      <div style={{ fontSize: 11.5, lineHeight: 1.55, color: MUTED, marginTop: 10, maxWidth: "80ch" }}>
        Every sum here is the contract&rsquo;s own, amendments included, and is the cost of the work before
        the builder&rsquo;s fee — which is why it does not match Budget Management&rsquo;s Total column. Work marked
        <em> on paper</em> was contracted before the app issued contracts: its locked cost is the record, and
        the app holds no signatures for it.
      </div>
    </>
  );
}

function Row({ r, open, onToggle, renderDetail }: {
  r: ContractRow; open: boolean; onToggle: () => void; renderDetail: (tradeIds: string[]) => React.ReactNode;
}) {
  const store = useStore();
  const db = store.db;
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer", background: open ? "var(--cream-2)" : undefined }}>
        <td style={{ padding: "9px 4px 9px 10px", width: 22, color: MUTED }}>{open ? "▾" : "▸"}</td>
        <td style={{ padding: "9px 10px", minWidth: 200 }}>
          <div style={{ fontWeight: 600 }}>{r.title}</div>
          <div style={{ fontSize: 10.5, color: MUTED, marginTop: 2 }}>
            {r.tradeIds.map((t) => tradeName(db, t)).join(" + ")}
            {r.revisions ? ` · ${r.revisions} amendment${r.revisions === 1 ? "" : "s"}` : ""}
          </div>
        </td>
        <td style={{ padding: "9px 10px" }}>
          {r.vendor ?? <span style={{ color: MUTED }}>{r.legacy ? "not recorded" : "Not awarded"}</span>}
        </td>
        <td style={{ padding: "9px 10px" }}>
          <Pill color={r.paper && r.legacy ? MUTED : r.state === "none" ? MUTED : "#fff"}
            bg={r.paper && r.legacy ? "var(--cream-2)" : STATE_BG[r.state]}>
            {r.paper && r.legacy ? "On paper" : r.state === "signed" ? "Signed" : r.state === "issued" ? "Issued" : "No contract"}
          </Pill>
        </td>
        <td style={{ padding: "9px 10px", textAlign: "right", color: r.needed && r.signed === r.needed ? "var(--ok)" : MUTED, whiteSpace: "nowrap" }}>
          {r.needed ? `${r.signed} of ${r.needed}` : "—"}
        </td>
        <td style={{ padding: "9px 10px", textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
          {r.amount ? fmt(r.amount) : "—"}
        </td>
      </tr>
      {/* How far this contract has been paid down — the same bar Draw
          Management draws, from the same three figures. */}
      <tr style={{ borderBottom: open ? "none" : "1px solid var(--line)" }}>
        <td colSpan={6} style={{ padding: "0 10px 8px 36px", background: open ? "var(--cream-2)" : undefined }}>
          <PaceBar paid={r.paid} drawn={r.drawn} total={r.amount || r.paid} legend />
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={6} style={{ padding: "0 0 14px", background: "var(--cream-2)" }}>
            <div style={{ padding: "4px 10px 0" }}>{renderDetail(r.tradeIds)}</div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

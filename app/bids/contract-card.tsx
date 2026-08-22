"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/data/hooks";
import type { BidPackage } from "@/lib/data/types";
import { fmt, tradeName } from "@/lib/data/money";
import { contractOf, contractState, contractMissingSigs, contractAmount, contractFromAward, renderContract, CONTRACT_STATE_LABEL } from "@/lib/data/contract";
import type { DB } from "@/lib/data/types";
import { Kicker } from "./kit";

// ---------------------------------------------------------------------------
// What an award becomes: a contract.
//
// The award decided who and how much. This turns that into the document the two
// parties actually sign — the bid summary plus the terms in force — and then
// reports where the signatures stand, because nothing can be drawn against a
// budget line until they are in.
// ---------------------------------------------------------------------------

const MUTED = "var(--muted)";
const PARTY_LABEL = { builder: "Builder / GC", owner: "Homeowner (direct)", trade: "Vendor" } as const;

export function ContractCard({ p, ro, highlight }: { p: BidPackage; ro: boolean; highlight?: boolean }) {
  const store = useStore();
  const db = store.db;
  const [preview, setPreview] = useState(false);
  const won = p.bids.find((b) => b.id === p.awardedBidId);
  const tradeIds = useMemo(
    () => [...new Set([p.tradeId, ...(p.tradeIds ?? [])])].filter(Boolean),
    [p.tradeId, p.tradeIds],
  );
  // Default the counterparty the way the trade is already managed — an
  // owner-managed trade contracts with the homeowner, everything else the GC.
  const defaultParty = db.trades.find((t) => t.id === p.tradeId)?.managedBy === "owner" ? "owner" : "builder";
  const existing = contractOf(db, p.tradeId);
  const [party, setParty] = useState<"builder" | "owner">(existing?.counterparty ?? defaultParty);

  if (!won) return null;
  const issued = tradeIds.filter((t) => contractState(db, t) !== "none");
  const anyIssued = issued.length > 0;

  return (
    <div className="card" style={{
      padding: 14, display: "flex", flexDirection: "column", gap: 10,
      borderColor: highlight && !anyIssued ? "var(--brass)" : undefined,
      background: highlight && !anyIssued ? "var(--cream-2)" : undefined,
    }}>
      <Kicker>{anyIssued ? "Contract" : "Next — create the contract"}</Kicker>

      {!anyIssued ? (
        <>
          <div style={{ fontSize: 12.5, lineHeight: 1.55, color: MUTED }}>
            {won.vendorName} is awarded at <strong style={{ color: "var(--ink)" }}>{fmt(won.amount ?? 0)}</strong>.
            The contract is that bid written out in full — sum, scope, rooms, exclusions and the
            terms in force — for {tradeIds.length === 1 ? "this trade" : `all ${tradeIds.length} trades`} in the package.
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: MUTED, marginBottom: 5 }}>
              Contracting with the vendor
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(["builder", "owner"] as const).map((k) => (
                <button key={k} className={`btn btn-sm ${party === k ? "btn-primary" : ""}`} disabled={ro}
                  onClick={() => setParty(k)}>{PARTY_LABEL[k]}</button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: MUTED, marginTop: 5 }}>
              Whoever signs here is the party the vendor invoices and takes direction from.
            </div>
          </div>

          <button className="btn btn-sm" onClick={() => setPreview((v) => !v)} style={{ alignSelf: "flex-start" }}>
            {preview ? "Hide the document" : "Preview the document"}
          </button>
          {preview ? <Preview text={draftText(db, p, party)} /> : null}

          {!ro ? (
            <button className="btn btn-primary" onClick={() => store.issueContract(p.id, party)}>
              Create contract for signature
            </button>
          ) : null}
        </>
      ) : (
        <>
          {tradeIds.length > 1 && existing ? (
            <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.5 }}>
              One contract with <strong style={{ color: "var(--ink)" }}>{existing.vendorName}</strong> at{" "}
              <strong style={{ color: "var(--ink)" }}>{fmt(contractAmount(existing))}</strong>, covering all {tradeIds.length} trades.
              Each trade signs it.
            </div>
          ) : null}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {tradeIds.map((t) => {
              const st = contractState(db, t);
              const c = contractOf(db, t);
              const missing = contractMissingSigs(db, t);
              return (
                <div key={t} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12.5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 99, background: st === "signed" ? "var(--ok)" : "var(--brass)" }} />
                  <strong style={{ minWidth: 0 }}>{tradeName(db, t)}</strong>
                  <span style={{ color: MUTED }}>{CONTRACT_STATE_LABEL[st]}</span>
                  {/* The sum is the package's, said once above — repeating it on
                      every trade in a bundle reads as one sum per trade. */}
                  {c && tradeIds.length === 1 ? <span style={{ marginLeft: "auto", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(contractAmount(c))}</span> : null}
                  {st === "issued" ? (
                    <div style={{ flexBasis: "100%", fontSize: 11.5, color: "var(--brass-2)" }}>
                      Waiting on {missing.map((m) => PARTY_LABEL[m]).join(" and ")} to sign.
                    </div>
                  ) : (
                    <div style={{ flexBasis: "100%", fontSize: 11.5, color: "var(--ok)" }}>
                      Signed — this trade&rsquo;s budget lines can now be drawn against.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <Link href="/vendors" className="btn btn-sm btn-primary" style={{ textAlign: "center" }}>
            Open in Vendor Management to sign →
          </Link>
          {!ro ? (
            <button className="btn btn-sm" style={{ color: "var(--rust)" }}
              onClick={() => {
                if (confirm("Re-issue the contract from the awarded bid?\n\nThe scope and sum are re-frozen from the bid as it stands now, and BOTH parties have to sign again — any signature already given is cleared.")) {
                  store.issueContract(p.id, party);
                }
              }}>Re-issue from the bid</button>
          ) : null}
        </>
      )}
    </div>
  );
}

/** The document as it would read if issued now — built the same way the real
 *  one is, so the preview cannot promise something the contract doesn't say. */
function draftText(db: DB, p: BidPackage, party: "builder" | "owner"): string {
  const b = p.bids.find((x) => x.id === p.awardedBidId);
  if (!b) return "";
  // Built by the same two functions the issued contract goes through, so the
  // preview cannot promise something the signed document doesn't say.
  return renderContract(db, p.tradeId, contractFromAward(db, p, b, p.tradeId, party, "—"));
}

function Preview({ text }: { text: string }) {
  return (
    <pre style={{
      margin: 0, maxHeight: 260, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word",
      fontSize: 11, lineHeight: 1.5, color: "var(--ink)", background: "var(--paper)",
      border: "1px solid var(--line)", borderRadius: 8, padding: 10, fontFamily: "var(--font-sans)",
    }}>{text}</pre>
  );
}

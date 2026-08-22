"use client";

// Shared pieces of a budget line, lifted out of the old Cost Lines screen so
// the budget line itself can carry them.

import { useState } from "react";
import { useStore } from "@/lib/data/hooks";
import type { ChangeOrder, CostLine } from "@/lib/data/types";
import { fmt } from "@/lib/data/money";
import { contractOf, contractAmount, contractState } from "@/lib/data/contract";
import { Pill } from "../ui/bits";

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: "var(--muted)" }}>
      {children}
    </div>
  );
}

export function ChangeOrders({ line, ro }: { line: CostLine; ro: boolean }) {
  const store = useStore();
  const [adding, setAdding] = useState<null | "change" | "savings">(null);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  // A change order that has been written but not yet filed: the writer still has
  // to say what should happen to the contract and the draws behind it.
  const [pending, setPending] = useState<null | { kind: "change" | "savings"; title: string; amount: number; desc: string }>(null);
  // An already-filed change order the writer has come back to approve.
  const [deciding, setDeciding] = useState<ChangeOrder | null>(null);

  const save = () => {
    if (!title.trim() || !amount) return;
    setPending({ kind: adding!, title: title.trim(), amount: Number(amount), desc: desc.trim() });
  };
  const clear = () => { setTitle(""); setAmount(""); setDesc(""); setAdding(null); setPending(null); };

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Label>Change orders &amp; savings (contract exhibits)</Label>
        {!ro && <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button className="btn btn-sm" onClick={() => setAdding(adding === "change" ? null : "change")}>+ Change order</button>
          <button className="btn btn-sm" onClick={() => setAdding(adding === "savings" ? null : "savings")} style={{ color: "var(--ok)" }}>+ Saving</button>
        </div>}
      </div>

      {line.changeOrders.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
          {line.changeOrders.map((co) => (
            <div key={co.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12.5, background: "var(--paper)" }}>
              <Pill color="var(--brass-2)" bg="#f0e6cd">{co.exhibit}</Pill>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{co.title}</div>
                {co.desc && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{co.desc}</div>}
              </div>
              <span style={{ fontWeight: 700, color: co.kind === "savings" ? "var(--ok)" : "var(--rust)" }}>{co.kind === "savings" ? "−" : "+"}{fmt(co.amount)}</span>
              {co.status === "approved" ? <Pill color="#fff" bg="var(--ok)">approved</Pill>
                : !ro ? (
                  <button className="btn btn-sm btn-primary" onClick={() => setDeciding(co)}
                    title={`${co.kind === "savings" ? "Takes" : "Adds"} ${fmt(co.amount)} ${co.kind === "savings" ? "off" : "to"} the contract`}>
                    Approve · {co.kind === "savings" ? "−" : "+"}{fmt(co.amount)}
                  </button>
                )
                : <Pill color="var(--muted)">proposed</Pill>}
              {!ro && <button className="btn btn-sm" style={{ color: "var(--rust)" }} onClick={() => store.removeChangeOrder(line.id, co.id)}>✕</button>}
            </div>
          ))}
        </div>
      )}

      {adding && !ro && !pending && (
        <div className="card" style={{ padding: 10, marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", background: "var(--paper)" }}>
          <strong style={{ fontSize: 12.5, color: adding === "savings" ? "var(--ok)" : "var(--rust)" }}>{adding === "savings" ? "New saving" : "New change order"}</strong>
          <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
          <input placeholder="$ amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 110 }} />
          <input placeholder="Detail (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
          <button className="btn btn-primary" onClick={save}>Save</button>
        </div>
      )}

      {pending && !ro ? (
        <WhatNext
          line={line}
          heading={`${pending.kind === "savings" ? "Saving" : "Change order"} — ${pending.title} · ${pending.kind === "savings" ? "−" : "+"}${fmt(pending.amount)}`}
          onCancel={clear}
          onChoose={(push, alsoDraw) => {
            const id = store.addChangeOrder(line.id, {
              kind: pending.kind, title: pending.title, desc: pending.desc, amount: pending.amount,
              date: new Date().toISOString().slice(0, 10), status: push ? "approved" : "proposed",
            });
            if (push && id) applyPush(store, line, id, alsoDraw);
            clear();
          }}
        />
      ) : null}

      {deciding && !ro ? (
        <WhatNext
          line={line}
          heading={`${deciding.exhibit} — ${deciding.title} · ${deciding.kind === "savings" ? "−" : "+"}${fmt(deciding.amount)}`}
          onCancel={() => setDeciding(null)}
          onChoose={(push, alsoDraw) => {
            if (push) applyPush(store, line, deciding.id, alsoDraw);
            else store.updateChangeOrder(line.id, deciding.id, { status: "approved" });
            setDeciding(null);
          }}
          approveLabel="Approve only"
        />
      ) : null}
    </div>
  );
}

/** Push the change order onto the live contract, and optionally send the draws
 *  that already carry this line back for fresh client approval. */
function applyPush(store: ReturnType<typeof useStore>, line: CostLine, coId: string, alsoDraw: boolean) {
  store.reviseContract(line.id, coId);
  if (!alsoDraw) return;
  const r = store.reopenDrawsForLine(line.id);
  if (r.paid.length) {
    alert(`Reopened ${r.reopened.length ? r.reopened.join(", ") : "no draws"}.\n\n${r.paid.join(", ")} ${r.paid.length === 1 ? "has" : "have"} already been paid, so ${r.paid.length === 1 ? "it was" : "they were"} left alone. Money that has gone out is not revised — carry the difference into the next draw.`);
  }
}

// ---------------------------------------------------------------------------
// Saving a change order is a decision, not a filing. It can sit as a proposal,
// or it can go through to the contract — and if a draw has already been built
// on this line, that draw is out of date the moment it does. Asking is the only
// honest option: the app cannot know which of those the writer meant.
// ---------------------------------------------------------------------------
function WhatNext({ line, heading, onChoose, onCancel, approveLabel = "Save for later" }: {
  line: CostLine;
  heading: string;
  onChoose: (pushContract: boolean, alsoDraw: boolean) => void;
  onCancel: () => void;
  approveLabel?: string;
}) {
  const store = useStore();
  const db = store.db;
  const [alsoDraw, setAlsoDraw] = useState(true);
  const contract = contractOf(db, line.tradeId);
  const state = contractState(db, line.tradeId);
  const drawsWithLine = db.draws.filter((d) => d.allocations.some((a) => a.lineId === line.id));
  const reopenable = drawsWithLine.filter((d) => d.status === "pushed");
  const paidAlready = drawsWithLine.filter((d) => d.status === "paid");

  return (
    <div className="card" style={{ padding: 12, marginTop: 8, background: "var(--cream-2)", borderColor: "var(--brass)", display: "flex", flexDirection: "column", gap: 10 }}>
      <div>
        <Label>What should happen to this?</Label>
        <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 3 }}>{heading}</div>
      </div>

      {contract ? (
        <div style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.5 }}>
          {line.name} is under a {state === "signed" ? "signed" : "issued"} contract with{" "}
          <strong style={{ color: "var(--ink)" }}>{contract.vendorName}</strong> at {fmt(contractAmount(contract))}.
          Pushing a revision amends that contract, and both parties sign it again.
        </div>
      ) : (
        <div style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.5 }}>
          There is no issued contract on {line.name} yet, so there is nothing to revise — this can
          only be recorded for now.
        </div>
      )}

      {contract && reopenable.length > 0 ? (
        <label style={{ display: "flex", gap: 7, alignItems: "flex-start", fontSize: 12, lineHeight: 1.45, cursor: "pointer" }}>
          <input type="checkbox" checked={alsoDraw} onChange={(e) => setAlsoDraw(e.target.checked)} style={{ marginTop: 2 }} />
          <span>
            {`Also update ${reopenable.map((d) => d.name).join(", ")} and send ${reopenable.length === 1 ? "it" : "them"} back for the client's approval — ${reopenable.length === 1 ? "that draw was" : "those draws were"} approved against the old contract sum.`}
          </span>
        </label>
      ) : null}

      {contract && paidAlready.length > 0 ? (
        <div style={{ fontSize: 11.5, color: "var(--brass-2)" }}>
          {paidAlready.map((d) => d.name).join(", ")} {paidAlready.length === 1 ? "has" : "have"} already been paid and
          {paidAlready.length === 1 ? " is" : " are"} left untouched. Carry the difference into the next draw.
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button className="btn btn-sm" onClick={() => onChoose(false, false)}>{approveLabel}</button>
        {contract ? (
          <button className="btn btn-sm btn-primary" onClick={() => onChoose(true, alsoDraw && reopenable.length > 0)}>
            Push a revised contract
          </button>
        ) : null}
        <button className="btn btn-sm" style={{ marginLeft: "auto", color: "var(--muted)" }} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

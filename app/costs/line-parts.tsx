"use client";

// Shared pieces of a budget line, lifted out of the old Cost Lines screen so
// the budget line itself can carry them.

import { useState } from "react";
import { useStore } from "@/lib/data/hooks";
import type { CostLine } from "@/lib/data/types";
import { fmt } from "@/lib/data/money";
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
  const submit = () => {
    if (!title.trim() || !amount) return;
    store.addChangeOrder(line.id, { kind: adding!, title: title.trim(), desc: desc.trim(), amount: Number(amount), date: new Date().toISOString().slice(0, 10), status: "proposed" });
    setTitle(""); setAmount(""); setDesc(""); setAdding(null);
  };
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
                : !ro ? <button className="btn btn-sm" onClick={() => store.updateChangeOrder(line.id, co.id, { status: "approved" })}>Approve</button>
                : <Pill color="var(--muted)">proposed</Pill>}
              {!ro && <button className="btn btn-sm" style={{ color: "var(--rust)" }} onClick={() => store.removeChangeOrder(line.id, co.id)}>✕</button>}
            </div>
          ))}
        </div>
      )}
      {adding && !ro && (
        <div className="card" style={{ padding: 10, marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", background: "var(--paper)" }}>
          <strong style={{ fontSize: 12.5, color: adding === "savings" ? "var(--ok)" : "var(--rust)" }}>{adding === "savings" ? "New saving" : "New change order"}</strong>
          <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
          <input placeholder="$ amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 110 }} />
          <input placeholder="Detail (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
          <button className="btn btn-primary" onClick={submit}>Add</button>
        </div>
      )}
    </div>
  );
}

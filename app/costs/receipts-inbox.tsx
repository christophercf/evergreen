"use client";

// ---------------------------------------------------------------------------
// The receipts inbox: bills forwarded to the project's email alias land here
// as suggestions — parsed vendor/date/amount and a guessed budget line — for
// the OWNER to review. Every field is editable, the original sits beside the
// form, and nothing moves a dollar until Confirm. The AI suggests; a person
// decides.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { useStore } from "@/lib/data/hooks";
import { Pill, NumInput, TextInput } from "../ui/bits";
import { fmt } from "@/lib/data/money";
import type { ReceiptSuggestion } from "@/lib/data/types";

const MUTED = "var(--muted)";

export function ReceiptsInbox() {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  if (role !== "owner" && role !== "full_admin") return null;
  const pending = (db.receipts ?? []).filter((r) => r.status === "pending");
  if (!pending.length) return null;

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <h2 className="serif" style={{ fontSize: 19, fontWeight: 700, color: "var(--walnut)", margin: 0 }}>Receipts to review</h2>
        <Pill color="#fff" bg="var(--brass)">{pending.length}</Pill>
      </div>
      <div style={{ fontSize: 12.5, color: MUTED, marginTop: 3, lineHeight: 1.5, maxWidth: "72ch" }}>
        Forwarded to the project&apos;s receipts address and read automatically. Check the figures against
        the original, pick the budget line, and confirm — nothing counts until you do.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
        {pending.map((r) => <ReceiptCard key={r.id} r={r} />)}
      </div>
    </div>
  );
}

function ReceiptCard({ r }: { r: ReceiptSuggestion }) {
  const store = useStore();
  const db = store.db;
  const [vendor, setVendor] = useState(r.vendor ?? "");
  const [date, setDate] = useState(r.date ?? "");
  const [amount, setAmount] = useState(r.amount ?? 0);
  const [summary, setSummary] = useState(r.summary ?? "");
  const [lineId, setLineId] = useState(r.suggestedLineId ?? "");
  const [appliedAs, setAppliedAs] = useState<"direct" | "draw">("direct");
  const [drawId, setDrawId] = useState("");

  const line = db.costLines.find((l) => l.id === lineId);
  const openDraws = db.draws.filter((d) => d.status !== "paid");
  const parsedNothing = !r.vendor && !r.amount;
  const isImage = !!r.fileUrl && !/\.pdf($|\?)/i.test(r.fileUrl);

  const ready = !!vendor.trim() && amount > 0 && !!lineId && (appliedAs === "direct" || !!drawId);
  const why = !vendor.trim() ? "Name the vendor."
    : !(amount > 0) ? "Enter the amount."
    : !lineId ? "Pick the budget line it counts against."
    : appliedAs === "draw" && !drawId ? "Pick the draw to file it against."
    : "";

  const confirm = () => {
    if (!ready) return;
    store.confirmReceipt(r.id, {
      lineId, appliedAs, drawId: appliedAs === "draw" ? drawId : undefined,
      vendor: vendor.trim(), date: date || undefined, amount, summary: summary.trim() || undefined,
    });
  };

  return (
    <div className="card" style={{ padding: 12, borderLeft: "3px solid var(--brass)", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {/* the evidence */}
        <div style={{ flex: "0 0 150px", minWidth: 120 }}>
          {r.fileUrl ? (
            <a href={r.fileUrl} target="_blank" rel="noreferrer" title="Open the original">
              {isImage
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={r.fileUrl} alt="Receipt" style={{ width: "100%", maxHeight: 190, objectFit: "contain", borderRadius: 8, border: "1px solid var(--line)", background: "#fff", display: "block" }} />
                : <div style={{ width: "100%", height: 110, borderRadius: 8, border: "1px solid var(--line)", background: "var(--paper)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, fontSize: 12, color: "var(--sage-2)", fontWeight: 600 }}>📄 {r.fileName ?? "PDF"}<span style={{ fontSize: 10.5, color: MUTED }}>open ↗</span></div>}
            </a>
          ) : (
            <div style={{ width: "100%", height: 110, borderRadius: 8, border: "1px dashed var(--line)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, color: MUTED, textAlign: "center", padding: 8 }}>No attachment — the bill was in the email text.</div>
          )}
          <div style={{ fontSize: 10.5, color: MUTED, marginTop: 4, lineHeight: 1.4 }}>
            from {r.fromEmail}<br />{new Date(r.receivedAt).toLocaleDateString()}{r.subject ? <><br />“{r.subject}”</> : null}
          </div>
        </div>

        {/* the review */}
        <div style={{ flex: 1, minWidth: 220, display: "flex", flexDirection: "column", gap: 8 }}>
          {parsedNothing && <div style={{ fontSize: 12, color: "var(--brass-2)", fontWeight: 600 }}>Couldn&apos;t read this one automatically — fill it in from the original.</div>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <label style={{ fontSize: 11, color: MUTED, flex: 2, minWidth: 140 }}>Vendor
              <TextInput value={vendor} onCommit={setVendor} placeholder="Who was paid" style={{ width: "100%", fontSize: 13, fontWeight: 600 }} />
            </label>
            <label style={{ fontSize: 11, color: MUTED }}>Date
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ display: "block", fontSize: 12.5 }} />
            </label>
            <label style={{ fontSize: 11, color: MUTED }}>Amount
              <span style={{ display: "block" }}><NumInput value={amount} onCommit={setAmount} money width={90} /></span>
            </label>
          </div>
          <label style={{ fontSize: 11, color: MUTED }}>What it was
            <TextInput value={summary} onCommit={setSummary} placeholder="e.g. lumber and fasteners" style={{ width: "100%", fontSize: 12.5 }} />
          </label>

          {r.suggestedLineId && r.suggestedReason && (
            <div style={{ fontSize: 11.5, color: "var(--sage-2)", lineHeight: 1.45 }}>
              ✨ Suggested: <strong>{db.costLines.find((l) => l.id === r.suggestedLineId)?.name ?? "—"}</strong> — {r.suggestedReason}{r.confidence ? ` (${r.confidence} confidence)` : ""}
            </div>
          )}
          <label style={{ fontSize: 11, color: MUTED }}>Budget line
            <select value={lineId} onChange={(e) => setLineId(e.target.value)} style={{ display: "block", fontSize: 12.5, maxWidth: 320, borderColor: lineId ? undefined : "var(--rust)" }}>
              <option value="">— pick the line —</option>
              {db.costLines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", fontSize: 12.5 }}>
            <label style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
              <input type="radio" name={`rcpt-${r.id}`} checked={appliedAs === "direct"} onChange={() => setAppliedAs("direct")} /> Count as paid on this line
            </label>
            <label style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
              <input type="radio" name={`rcpt-${r.id}`} checked={appliedAs === "draw"} onChange={() => setAppliedAs("draw")} /> File as evidence on a draw
            </label>
            {appliedAs === "draw" && (
              <select value={drawId} onChange={(e) => setDrawId(e.target.value)} style={{ fontSize: 12 }}>
                <option value="">— pick the draw —</option>
                {openDraws.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn btn-primary" disabled={!ready} onClick={confirm}>
              {appliedAs === "direct" && amount > 0 && line
                ? `Confirm — adds ${fmt(amount)} to ${line.name}'s paid`
                : "Confirm receipt"}
            </button>
            <button className="btn" style={{ color: "var(--rust)" }} onClick={() => store.dismissReceipt(r.id)}>Dismiss</button>
            {!ready && <span style={{ fontSize: 11.5, color: MUTED }}>{why}</span>}
          </div>
          <div style={{ fontSize: 11, color: MUTED }}>Confirming files the original into Artifacts against the line, with your name on the confirmation.</div>
        </div>
      </div>
    </div>
  );
}

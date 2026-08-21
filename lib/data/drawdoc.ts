// ----------------------------------------------------------------------------
// The draw request, written out.
//
// One renderer, used by the preview, the issued document and the email. What
// the GC reads before sending is the same string the client signs — a preview
// built separately is a preview that can lie.
// ----------------------------------------------------------------------------

import type { DB, Draw } from "./types";
import { allocationAmount, drawAmount, fmt, lineCurrent, lineDrawn, tradeName } from "./money";
import { contractOf } from "./contract";
import { lineHeadroom } from "./drawscope";

export function renderDrawRequest(db: DB, draw: Draw): string {
  const L: string[] = [];
  const total = drawAmount(db, draw);

  L.push(`DRAW REQUEST — ${draw.name}`);
  L.push(`${db.project.name}`);
  L.push("");
  const builder = db.contacts.find((c) => c.party === "builder");
  const owner = db.contacts.find((c) => c.party === "owner");
  L.push(`From: ${builder?.company ?? "Builder / GC"}`);
  L.push(`To:   ${owner?.company ?? "Owner"}`);
  L.push(`Amount requested: ${fmt(total)}`);
  L.push("");
  L.push("WHAT THIS DRAW COVERS");
  L.push("");

  for (const a of draw.allocations) {
    const line = db.costLines.find((l) => l.id === a.lineId);
    if (!line) continue;
    const amt = allocationAmount(line, a);
    const head = lineHeadroom(db, line, draw.id);
    const c = contractOf(db, line.tradeId);
    L.push(`${line.name} — ${fmt(amt)}`);
    L.push(`  Trade: ${tradeName(db, line.tradeId)}${c ? ` · ${c.vendorName}` : ""}`);
    L.push(`  Basis: ${a.mode === "pct" ? `${a.value}% of the line` : "flat amount"}`);
    // The part that makes this a claim rather than an invoice line.
    if (a.includedScope?.length) {
      L.push("  Work claimed as complete:");
      a.includedScope.forEach((s) => L.push(`    • ${s}`));
    } else {
      L.push("  Work claimed as complete: not itemised");
    }
    if (a.note?.trim()) L.push(`  Note: ${a.note.trim()}`);
    L.push(`  Line total ${fmt(head.total)} · already drawn ${fmt(head.drawnElsewhere)} · after this draw ${fmt(Math.max(0, head.remaining - amt))} remains`);
    L.push("");
  }

  L.push("---");
  L.push(`TOTAL REQUESTED: ${fmt(total)}`);
  L.push("");
  if (draw.note?.trim()) {
    L.push("CONDITIONS FOR RELEASE");
    L.push(draw.note.trim());
    L.push("");
  }
  L.push("By signing, the owner approves the amounts above for payment and accepts the");
  L.push("work listed as complete. Approving does not waive any claim on work not listed.");
  L.push("");
  L.push("Signed: ______________________   Date: ____________");
  return L.join("\n");
}

/** A one-line summary for the email subject and the Contracts row. */
export function drawRequestSummary(db: DB, draw: Draw): string {
  const parts = draw.allocations.length;
  return `${draw.name} — ${fmt(drawAmount(db, draw))} across ${parts} budget line${parts === 1 ? "" : "s"}`;
}

/** Everything a line still owes, for the roll-up above the draw list. */
export function projectHeadroom(db: DB): { contracted: number; drawn: number; remaining: number } {
  const drawable = db.costLines.filter((l) => l.locked);
  const contracted = drawable.reduce((a, l) => a + lineCurrent(l), 0);
  const drawn = drawable.reduce((a, l) => a + lineDrawn(db, l.id), 0);
  return { contracted, drawn, remaining: Math.max(0, contracted - drawn) };
}

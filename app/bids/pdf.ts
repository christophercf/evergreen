import { jsPDF } from "jspdf";
import { BID_REQ_LABEL, MATERIALS_BASIS_LABEL, PRICING_BASIS_HINT, PRICING_BASIS_LABEL, type BidReqKey, type MaterialsBasis, type PricingBasis } from "@/lib/data/types";

/** The bid request that goes out to a vendor: the scope as priceable lines, then
 *  ruled blanks for every answer we need back. The blanks are the point — a
 *  vendor who returns only a lump sum can't be compared with one who didn't. */
export function downloadBidRequestPdf(opts: {
  projectName: string; title: string; trade: string; rooms: string[]; scope: string; items: string[];
  rfp: boolean; requirements?: BidReqKey[]; materialsBasis?: MaterialsBasis; pricingBasis?: PricingBasis;
}) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const M = 48, W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  let y = M;
  const ensure = (h = 14) => { if (y + h > H - M) { doc.addPage(); y = M; } };
  const text = (s: string, o: { size?: number; bold?: boolean; color?: [number, number, number]; gap?: number; indent?: number } = {}) => {
    const size = o.size ?? 10, color = o.color ?? [44, 36, 28], gap = o.gap ?? 4, indent = o.indent ?? 0;
    doc.setFont("helvetica", o.bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(...color);
    for (const ln of doc.splitTextToSize(s, W - 2 * M - indent)) { ensure(size + gap); doc.text(ln, M + indent, y); y += size + gap; }
  };
  const rule = () => { ensure(16); doc.setDrawColor(221, 210, 189); doc.line(M, y, W - M, y); y += 12; };
  const blank = (label: string, lines = 1) => {
    text(label, { size: 10, bold: true, color: [58, 47, 37] });
    for (let i = 0; i < lines; i++) { ensure(22); doc.setDrawColor(150, 140, 120); doc.line(M, y + 12, W - M, y + 12); y += 22; }
    y += 4;
  };

  text("EVERGREEN AI", { size: 9, bold: true, color: [176, 138, 62] });
  text(`${opts.rfp ? "Request for Proposal" : "Bid Request"} — ${opts.title}`, { size: 18, bold: true, color: [58, 47, 37], gap: 2 });
  text(`${opts.projectName} · Trade: ${opts.trade}${opts.rooms.length ? ` · Rooms: ${opts.rooms.join(", ")}` : ""}`, { size: 10, color: [122, 111, 96] });
  if (opts.pricingBasis) text(`Price this as: ${PRICING_BASIS_LABEL[opts.pricingBasis]} — ${PRICING_BASIS_HINT[opts.pricingBasis]}`, { size: 10, bold: true, color: [176, 138, 62] });
  if (opts.materialsBasis) text(`Materials: ${MATERIALS_BASIS_LABEL[opts.materialsBasis]}`, { size: 10, bold: true, color: [176, 138, 62] });
  rule();
  if (opts.items.length) {
    text("Price each line below. Leave blank anything you are not including.", { size: 10, bold: true });
    y += 2;
    for (const it of opts.items) {
      ensure(26);
      text(`• ${it}`, { size: 10, gap: 2 });
      doc.setDrawColor(150, 140, 120); doc.line(W - M - 130, y + 9, W - M, y + 9);
      doc.setFontSize(8); doc.setTextColor(122, 111, 96); doc.text("$", W - M - 138, y + 9);
      y += 18;
    }
    y += 6;
  } else {
    text(opts.rfp ? "Brief description of work:" : "Scope of work:", { size: 11, bold: true });
    text(opts.scope || "(to be discussed)", { size: 10, color: [80, 72, 60] });
    y += 8;
  }
  if (opts.rfp) {
    text("VENDOR: please detail your proposed scope of work below.", { size: 10, bold: true, color: [176, 138, 62] });
    blank("Proposed scope of work", 8);
  }
  // The five comparable fields, asked for explicitly.
  text("REQUIRED — every bid is compared on these five:", { size: 10, bold: true, color: [176, 138, 62] });
  blank("Total price (USD)", 1);
  blank("Of which materials (USD) — write NONE if labor only", 1);
  blank("Of which labor, plant and everything else (USD)", 1);
  blank("Working days on site", 1);
  blank("Crew on site", 1);
  if (opts.pricingBasis === "tm") {
    blank("Crew rate ($/hr)", 1);
    blank("Not-to-exceed (USD)", 1);
  }
  const reqs = (opts.requirements ?? []).filter((k) => k !== "lineItemPricing");
  if (reqs.length) {
    y += 2;
    text("Also required — a bid without these can't be evaluated:", { size: 10, bold: true, color: [176, 138, 62] });
    for (const k of reqs) blank(BID_REQ_LABEL[k], k === "exclusions" || k === "ownerSupplied" ? 2 : 1);
  }
  blank("Company · Contact · Phone · Email", 2);
  blank("Signature & date", 1);
  text("Return by email, text or phone — your bid is logged on the project's Bid Management board.", { size: 8.5, color: [122, 111, 96] });
  doc.save(`${opts.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${opts.rfp ? "rfp" : "bid-request"}.pdf`);
}

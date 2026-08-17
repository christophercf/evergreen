import { jsPDF } from "jspdf";
import {
  MATERIALS_BASIS_LABEL, PRICING_BASIS_HINT, PRICING_BASIS_LABEL, addWorkingDays,
  type BidPackage, type DB,
} from "@/lib/data/types";
import { tradeName } from "@/lib/data/money";

// The one page a vendor actually receives. It carries the scope, the materials
// and who buys them, and then ruled blanks for the five fields every bid is
// compared on. The blanks are the point: a vendor who returns only a lump sum
// can't be compared with one who answered, and the comparison screen will say so.

const fmt = (iso?: string) =>
  iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

export function downloadRequestDoc(db: DB, p: BidPackage) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const M = 48, W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  let y = M;
  const ensure = (h = 14) => { if (y + h > H - M) { doc.addPage(); y = M; } };
  const text = (s: string, o: { size?: number; bold?: boolean; color?: [number, number, number]; gap?: number; indent?: number } = {}) => {
    const size = o.size ?? 10, color = o.color ?? [44, 36, 28], gap = o.gap ?? 4, indent = o.indent ?? 0;
    doc.setFont("helvetica", o.bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(...color);
    for (const ln of doc.splitTextToSize(s, W - 2 * M - indent)) { ensure(size + gap); doc.text(ln, M + indent, y); y += size + gap; }
  };
  const rule = () => { ensure(16); doc.setDrawColor(221, 210, 189); doc.line(M, y, W - M, y); y += 11; };
  const blank = (label: string, lines = 1) => {
    text(label, { size: 10, bold: true, color: [58, 47, 37], gap: 2 });
    for (let i = 0; i < lines; i++) { ensure(22); doc.setDrawColor(150, 140, 120); doc.line(M, y + 12, W - M, y + 12); y += 22; }
    y += 3;
  };
  const section = (n: string, label: string) => {
    ensure(20);
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(176, 138, 62);
    doc.text(`${n}  ${label.toUpperCase()}`, M, y); y += 14;
  };

  const trade = tradeName(db, p.tradeId);
  const items = p.scopeItems ?? [];
  const mats = p.materialsList ?? [];

  // Header
  text("EVERGREEN AI", { size: 9, bold: true, color: [176, 138, 62], gap: 2 });
  text(`Request for Bid — ${p.title}`, { size: 18, bold: true, color: [58, 47, 37], gap: 2 });
  text(`${db.project.name} · ${trade}${p.returnBy ? ` · Bid due ${fmt(p.returnBy)}` : ""}`, { size: 10, color: [122, 111, 96] });
  if (p.pricingBasis) {
    text(`Price this as ${PRICING_BASIS_LABEL[p.pricingBasis]} — ${PRICING_BASIS_HINT[p.pricingBasis]}`, { size: 10, bold: true, color: [176, 138, 62] });
  }
  rule();

  if (p.overview?.trim()) { section("01", "The work"); text(p.overview.trim(), { size: 10, color: [80, 72, 60] }); y += 4; }

  if (items.length) {
    section("02", "Price each line");
    for (const it of items) {
      ensure(24);
      text(`• ${it}`, { size: 10, gap: 2 });
      doc.setDrawColor(150, 140, 120); doc.line(W - M - 120, y + 8, W - M, y + 8);
      doc.setFontSize(8); doc.setTextColor(122, 111, 96); doc.text("$", W - M - 128, y + 8);
      y += 17;
    }
    y += 5;
  }

  section("03", "Materials");
  if (p.materialsBasis) text(MATERIALS_BASIS_LABEL[p.materialsBasis], { size: 11, bold: true, color: [58, 47, 37], gap: 2 });
  if (p.supplyNote?.trim()) text(p.supplyNote.trim(), { size: 9.5, color: [110, 100, 86] });
  for (const m of mats) {
    text(`${[m.qty, m.unit].filter(Boolean).join(" ") || "—"}   ${m.item}   (${m.suppliedBy === "vendor" ? "you supply" : "we supply"})`, { size: 9.5, gap: 2, color: [80, 72, 60] });
  }
  if (!mats.length) text("No materials schedule issued — take off your own quantities.", { size: 9.5, color: [122, 111, 96] });
  y += 5;

  if (p.exclusions?.trim()) { section("04", "Not in this scope"); text(p.exclusions.trim(), { size: 9.5, color: [80, 72, 60] }); y += 5; }

  // The five fields. Everything above is context; this is what gets compared.
  section("05", "Required — every bid is compared on these five");
  blank("Total price (USD)");
  blank("Of which materials (USD) — write NONE if labor only");
  blank("Of which labor, plant and everything else (USD)");
  blank("Working days on site");
  blank("Crew on site");
  if (p.pricingBasis === "tm") { blank("Crew rate ($/hr)"); blank("Not-to-exceed (USD)"); }
  if (p.expectedStart) {
    const eg = addWorkingDays(p.expectedStart, 10);
    text(`We expect to be on site from ${fmt(p.expectedStart)}. For reference, 10 working days from that date finishes ${fmt(eg)} (weekends skipped).`, { size: 9, color: [122, 111, 96] });
    y += 3;
  }

  section("06", "Your details");
  blank("Company · Contact · Phone · Email", 2);
  blank("Signature & date");
  text("Return by email, text or phone — your bid is logged on the project's Bid Management board and compared line for line against the others.", { size: 8.5, color: [122, 111, 96] });

  doc.save(`${p.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-bid-request.pdf`);
}

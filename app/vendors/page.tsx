"use client";

import { useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/data/hooks";
import { PageHeader, NoAccess, Pill, SectionTitle, Money } from "../ui/bits";
import { accessFor, isOwnerManaged, type ContactSheet, type DB, type VendorAgreement } from "@/lib/data/types";
import { tradeCost, tradeName, allocationAmount, fmt } from "@/lib/data/money";
import { renderTerms } from "@/lib/data/terms";
import { SignaturePad, SignatureMark } from "../ui/signature-pad";
import { jsPDF } from "jspdf";

// Build a downloadable "trade packet" PDF: header, scope/rooms, materials, terms.
function downloadTradePdf(db: DB, tradeId: string) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const M = 48, W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  let y = M;
  const ensure = (h = 14) => { if (y + h > H - M) { doc.addPage(); y = M; } };
  const text = (s: string, o: { size?: number; bold?: boolean; color?: [number, number, number]; indent?: number; gap?: number } = {}) => {
    const size = o.size ?? 10, color = o.color ?? [44, 36, 28], indent = o.indent ?? 0, gap = o.gap ?? 4;
    doc.setFont("helvetica", o.bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(color[0], color[1], color[2]);
    for (const ln of doc.splitTextToSize(s, W - 2 * M - indent)) { ensure(size + gap); doc.text(ln, M + indent, y); y += size + gap; }
  };
  const heading = (s: string) => { y += 10; ensure(20); doc.setDrawColor(221, 210, 189); doc.line(M, y - 6, W - M, y - 6); text(s, { size: 12, bold: true, color: [58, 47, 37] }); };

  text("EVERGREEN AI", { size: 9, bold: true, color: [176, 138, 62] });
  text(`${tradeName(db, tradeId)} — Trade Packet`, { size: 18, bold: true, color: [58, 47, 37], gap: 2 });
  text(`${db.project.name} · ${db.project.built}`, { size: 10, color: [122, 111, 96] });
  const vendor = db.users.find((u) => u.tradeIds?.includes(tradeId));
  if (vendor) text(`Vendor: ${vendor.name}${vendor.email ? ` · ${vendor.email}` : ""}${vendor.phone ? ` · ${vendor.phone}` : ""}`, { size: 10 });
  text(`Contract value: ${fmt(tradeCost(db, tradeId))}`, { size: 11, bold: true });

  heading("Scope of Work");
  const cells = db.scope.filter((c) => c.tradeId === tradeId && c.status === "in");
  const rooms = cells.map((c) => db.rooms.find((r) => r.id === c.roomId)?.name ?? c.roomId);
  text(`Rooms: ${rooms.length ? rooms.join(", ") : "—"}`, { size: 10 });
  const items = Array.from(new Set(cells.flatMap((c) => c.items.filter((i) => i.included).map((i) => i.label))));
  if (items.length) items.forEach((it) => text(`• ${it}`, { size: 10, indent: 8 }));
  else text("No scope items defined.", { size: 10, color: [122, 111, 96], indent: 8 });

  heading("Materials");
  const mats = db.materials.filter((m) => m.tradeId === tradeId);
  if (!mats.length) text("None assigned.", { size: 10, color: [122, 111, 96], indent: 8 });
  mats.forEach((m) => {
    const room = m.roomId ? (db.rooms.find((r) => r.id === m.roomId)?.name ?? m.roomLabel) : m.roomLabel;
    const parts = [m.item];
    if (m.qty) parts.push(`qty ${m.qty}`);
    if (room) parts.push(room);
    parts.push(m.status);
    parts.push(`buyer: ${m.purchaser}`);
    if (m.dueDate) parts.push(`due ${m.dueDate}`);
    text(`• ${parts.join(" · ")}`, { size: 10, indent: 8 });
    if (m.specLink) text(m.specLink, { size: 8, color: [74, 122, 140], indent: 16 });
  });

  heading("Contacts & Billing");
  const vC = db.contacts.find((c) => c.party === "vendor" && c.tradeId === tradeId);
  const bC = db.contacts.find((c) => c.party === "builder");
  const oC = db.contacts.find((c) => c.party === "owner");
  const ownerMgd = db.trades.find((t) => t.id === tradeId)?.managedBy === "owner";
  const contactLine = (label: string, c?: typeof vC) => {
    if (!c) { text(`${label}: —`, { size: 9, color: [122, 111, 96] }); return; }
    text(`${label}: ${c.company}${c.contactName ? ` · ${c.contactName}` : ""}`, { size: 9.5, bold: true });
    const sub = [c.email, c.phone, c.address].filter(Boolean).join(" · ");
    if (sub) text(sub, { size: 9, color: [122, 111, 96], indent: 8 });
    if (c.billing && (c.billing.payableTo || c.billing.paymentTerms || c.billing.remittance || c.billing.taxId)) {
      const bill = [c.billing.payableTo && `Pay to ${c.billing.payableTo}`, c.billing.taxId && `Tax ID ${c.billing.taxId}`, c.billing.paymentTerms, c.billing.remittance].filter(Boolean).join(" · ");
      text(`Billing: ${bill}`, { size: 9, color: [80, 72, 60], indent: 8 });
    }
  };
  // Only the contract's two parties appear: vendor + whoever manages them.
  contactLine(ownerMgd ? "Vendor (Owner Managed)" : "Vendor", vC);
  if (ownerMgd) contactLine("Owner", oC);
  else contactLine("Builder / GC", bC);

  const ag0 = db.vendorAgreements.find((a) => a.tradeId === tradeId);
  if (ag0?.scopeDrawingId) {
    const sd = db.artifacts.find((a) => a.id === ag0.scopeDrawingId);
    if (sd) { heading("Scope Drawing"); text(`Appended scope drawing: ${sd.name}${sd.source ? ` (${sd.source})` : ""}. Shaded rooms and scope are viewable in the Evergreen app.`, { size: 9, color: [80, 72, 60] }); }
  }

  heading("Terms & Conditions");
  text(renderTerms(db, tradeId), { size: 9, color: [80, 72, 60], gap: 3 });

  heading("Signatures");
  const ag = db.vendorAgreements.find((a) => a.tradeId === tradeId);
  const fmtDt = (s: string) => new Date(s).toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  // Signature blocks: the managing party + the vendor only.
  const pdfMgr: "builder" | "owner" = ownerMgd ? "owner" : "builder";
  ([pdfMgr, "trade"] as const).forEach((party) => {
    const label = party === "builder" ? "Builder / GC" : party === "trade" ? "Trade / Vendor" : "Owner / Client";
    const sig = ag?.round1.find((s) => s.party === party);
    ensure(54);
    if (sig?.signatureImg) { try { doc.addImage(sig.signatureImg, "PNG", M, y, 120, 36); } catch { /* skip bad image */ } y += 40; }
    text(`${label}: ${sig ? sig.name : "_______________________"}`, { size: 10, bold: true });
    text(sig ? `Signed ${fmtDt(sig.at)}` : "Date: ____________", { size: 9, color: [122, 111, 96] });
    y += 4;
  });

  doc.save(`${tradeName(db, tradeId).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-packet.pdf`);
}

export default function VendorsPage() {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const user = store.currentUser;
  const access = accessFor(user, role, "vendors");
  if (access === "none") return <NoAccess module="Vendor Management" />;

  // Trades and designers/viewers are scoped to their own assigned trades —
  // they only see contracts for work assigned to them, never the whole roster.
  const scopedToOwn = role === "trade" || role === "viewer";
  const myTrades = scopedToOwn ? new Set(user?.tradeIds ?? []) : null;
  // Trades with a cost line OR a managed vendor contact (so owner-managed vendors show too).
  const contactTradeIds = db.contacts.filter((c) => c.party === "vendor" && c.tradeId).map((c) => c.tradeId!);
  const activeTradeIds = Array.from(new Set([...db.costLines.map((l) => l.tradeId), ...contactTradeIds]))
    .filter((id) => !myTrades || myTrades.has(id))
    // Contracts are private to whoever manages the trade: the builder never sees
    // owner-managed contracts, and the owner never sees builder-managed ones.
    // Full Admin sees all; trades/viewers were already scoped above.
    .filter((id) => {
      const ownerMgd = isOwnerManaged(db.trades.find((t) => t.id === id));
      if (role === "builder") return !ownerMgd;
      if (role === "owner") return ownerMgd;
      return true;
    })
    .sort((a, b) => tradeCost(db, b) - tradeCost(db, a));

  return (
    <>
      <PageHeader
        title={role === "trade" ? "Current Contract" : "Vendor Management"}
        subtitle={role === "trade"
          ? "Your contract with the project: scope, terms, your requested draw parameters, and two rounds of digital signature — first on scope & cost, then on draw schedule & timeline."
          : "Each trade's roll-up: scope pulled from the Admin matrix, terms applied, the vendor's requested draw parameters, and two rounds of digitally-signed contract — first on scope & cost, then on draw schedule & timeline."}
        right={accessFor(user, role, "costs") !== "none" ? <Link href="/costs" className="btn btn-sm">Building Costs →</Link> : undefined}
      />
      <SectionTitle>{role === "trade" ? "Your Contract" : "Vendors & Contracts"}</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {activeTradeIds.length === 0 ? (
          <div className="card" style={{ padding: 20, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            {scopedToOwn ? "No vendor contracts are assigned to you." : "No vendors or contracts yet."}
          </div>
        ) : activeTradeIds.map((tid) => <VendorCard key={tid} tradeId={tid} />)}
      </div>
    </>
  );
}

function VendorCard({ tradeId }: { tradeId: string }) {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const me = store.currentUser;
  const name = store.session.displayName;
  const access = accessFor(me, role, "vendors");
  const ro = access !== "edit";
  // The Designer can review vendor scope/materials/contacts but never money.
  const canSeeCosts = accessFor(me, role, "costs") !== "none";

  const agreement: VendorAgreement = db.vendorAgreements.find((a) => a.tradeId === tradeId) ?? { tradeId, round1: [], round2: [] };
  const vendorUser = db.users.find((u) => u.tradeIds?.includes(tradeId));
  const isAssignedTrade = role === "trade" && !!vendorUser && vendorUser.id === me?.id;

  // Each contract is between the vendor and whoever MANAGES the trade —
  // builder-managed contracts sign builder↔trade, owner-managed sign owner↔trade.
  // The other party isn't an approver and doesn't co-sign.
  const ownerManaged = isOwnerManaged(db.trades.find((t) => t.id === tradeId));
  const manager: "builder" | "owner" = ownerManaged ? "owner" : "builder";
  const canManagerSign = role === manager || role === "full_admin";
  const canTradeSign = isAssignedTrade || role === "full_admin";
  const canEditRequest = !ro || isAssignedTrade;

  const cost = tradeCost(db, tradeId);
  const cells = db.scope.filter((c) => c.tradeId === tradeId && c.status === "in");
  const rooms = cells.map((c) => db.rooms.find((r) => r.id === c.roomId)?.name ?? c.roomId);
  const items = Array.from(new Set(cells.flatMap((c) => c.items.filter((i) => i.included).map((i) => i.label))));
  const mats = db.materials.filter((m) => m.tradeId === tradeId);
  const terms = renderTerms(db, tradeId);

  const r1Done = agreement.round1.some((s) => s.party === manager) && agreement.round1.some((s) => s.party === "trade");
  const r2Done = agreement.round2.some((s) => s.party === manager) && agreement.round2.some((s) => s.party === "trade");

  // This trade's draw allocations (for round 2 schedule).
  const myLineIds = new Set(db.costLines.filter((l) => l.tradeId === tradeId).map((l) => l.id));
  const drawRows = db.draws.flatMap((d) => d.allocations.filter((a) => myLineIds.has(a.lineId)).map((a) => {
    const l = db.costLines.find((x) => x.id === a.lineId)!;
    return { d, l, amt: allocationAmount(l, a) };
  }));

  const [start, setStart] = useState(agreement.startDate ?? "");
  const [finish, setFinish] = useState(agreement.finishDate ?? "");

  const vendorContact = db.contacts.find((c) => c.party === "vendor" && c.tradeId === tradeId);
  const builderContact = db.contacts.find((c) => c.party === "builder");
  const ownerContact = db.contacts.find((c) => c.party === "owner");

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h3 className="serif" style={{ fontSize: 17, fontWeight: 700, color: "var(--walnut)" }}>{tradeName(db, tradeId)}</h3>
        {ownerManaged && <Pill color="#fff" bg="var(--brass)">⌂ Owner Managed</Pill>}
        {vendorUser && <Pill bg="var(--cream-2)">{vendorUser.name}</Pill>}
        <Pill color="#fff" bg={r1Done ? "var(--ok)" : "var(--sc-unset)"}>R1 {r1Done ? "executed" : "draft"}</Pill>
        <Pill color="#fff" bg={r2Done ? "var(--ok)" : "var(--sc-unset)"}>R2 {r2Done ? "executed" : "draft"}</Pill>
        {canSeeCosts && <>
          <span style={{ marginLeft: "auto", fontWeight: 700, fontSize: 16 }}><Money value={cost} /></span>
          <button className="btn btn-sm" title="Download trade packet (terms, rooms, materials)" onClick={() => downloadTradePdf(db, tradeId)}>⬇ PDF</button>
        </>}
      </div>

      <ContactsBilling vendor={vendorContact} builder={builderContact} owner={ownerContact} ownerManaged={ownerManaged} />

      {/* Scope from admin */}
      <div style={{ marginTop: 10 }}>
        <Lbl>Scope &amp; rooms (from Admin matrix)</Lbl>
        <div style={{ fontSize: 12.5, marginTop: 4 }}>
          {rooms.length ? <><strong>Rooms:</strong> {rooms.join(", ")}</> : <span style={{ color: "var(--muted)" }}>No rooms marked in-scope yet.</span>}
        </div>
        {items.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>{items.map((it) => <Pill key={it} bg="var(--sage-tint)">{it}</Pill>)}</div>}
        {agreement.scopeDrawingId && db.artifacts.some((a) => a.id === agreement.scopeDrawingId) && (
          <div style={{ fontSize: 12, marginTop: 6 }}>📐 Scope drawing appended: <Link href={`/artifacts?artifact=${agreement.scopeDrawingId}&view=scope&trade=${tradeId}`} style={{ color: "var(--sage-2)", fontWeight: 600 }}>{db.artifacts.find((a) => a.id === agreement.scopeDrawingId)?.name} — open ↗</Link></div>
        )}
      </div>

      {/* Materials for this trade */}
      <div style={{ marginTop: 12 }}>
        <Lbl>Materials ({mats.length})</Lbl>
        {mats.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 4 }}>
            {mats.slice(0, 8).map((m) => {
              const room = m.roomId ? (db.rooms.find((r) => r.id === m.roomId)?.name ?? m.roomLabel) : m.roomLabel;
              return (
                <div key={m.id} style={{ display: "flex", gap: 8, fontSize: 12, alignItems: "center" }}>
                  <span style={{ flex: 1 }}>{m.item}{m.qty ? ` ×${m.qty}` : ""} {room && <span style={{ color: "var(--muted)" }}>· {room}</span>}</span>
                  <span style={{ color: "var(--muted)" }}>{m.status}</span>
                  {m.specLink && <a href={m.specLink} target="_blank" rel="noreferrer" style={{ color: "var(--sage-2)" }}>spec ↗</a>}
                </div>
              );
            })}
            {mats.length > 8 && <Link href="/materials" style={{ fontSize: 11.5, color: "var(--sage-2)" }}>+{mats.length - 8} more in Materials →</Link>}
          </div>
        ) : <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>No materials assigned to this trade yet.</div>}
      </div>

      {/* Terms & conditions (also in the PDF) */}
      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: "pointer", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)" }}>Terms &amp; conditions</summary>
        <p style={{ whiteSpace: "pre-wrap", marginTop: 6, fontSize: 12, color: "var(--muted)" }}>{terms}</p>
      </details>

      {/* Draw parameter request */}
      <div style={{ marginTop: 12 }}>
        <Lbl>Vendor draw-parameter request</Lbl>
        <textarea value={agreement.drawRequest ?? ""} disabled={!canEditRequest} placeholder="Vendor: request your preferred draw terms (deposit %, milestones, net terms)…"
          onChange={(e) => store.setVendorDrawRequest(tradeId, e.target.value)} style={{ width: "100%", marginTop: 4, minHeight: 44, fontSize: 12.5, resize: "vertical" }} />
        <div style={{ fontSize: 11.5, color: "var(--muted)" }}>Advises the builder’s <Link href="/payments" style={{ color: "var(--sage-2)", fontWeight: 600 }}>draw schedule</Link>.</div>
      </div>

      {/* Round 1 — scope & cost */}
      <div className="card" style={{ padding: 12, marginTop: 12, background: "var(--paper)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <strong style={{ fontSize: 13 }}>Round 1 — Scope &amp; Total Cost</strong>
          {r1Done && <Pill color="#fff" bg="var(--ok)">executed</Pill>}
        </div>
        <p style={{ fontSize: 12.5, margin: "6px 0", color: "var(--muted)" }}>
          Vendor agrees to the scope above{canSeeCosts ? <> for a total of <strong style={{ color: "var(--ink)" }}>{fmt(cost)}</strong></> : null}. Terms &amp; conditions apply.
        </p>
        <details style={{ fontSize: 12, color: "var(--muted)" }}><summary style={{ cursor: "pointer" }}>Full terms &amp; conditions</summary><pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", marginTop: 6 }}>{terms}</pre></details>
        <BindingBlock canEdit={canManagerSign && !ro} />
        <SignRow round={1} agreement={agreement} parties={[manager, "trade"]} canManager={canManagerSign && !ro} canTrade={canTradeSign} signerSig={me?.signature} onSign={(party, img) => store.signVendorRound(tradeId, 1, party, name, img)} onAdopt={(img) => me && store.setUserSignature(me.id, img)} />
      </div>

      {/* Round 2 — draw schedule & timeline */}
      <div className="card" style={{ padding: 12, marginTop: 10, background: "var(--paper)", opacity: r1Done ? 1 : 0.6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <strong style={{ fontSize: 13 }}>Round 2 — Draw Schedule &amp; Timeline</strong>
          {r2Done && <Pill color="#fff" bg="var(--ok)">executed</Pill>}
          {!r1Done && <span style={{ fontSize: 11.5, color: "var(--muted)" }}>locked until Round 1 is executed</span>}
        </div>
        {r1Done && <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", margin: "8px 0" }}>
            <label style={{ fontSize: 11.5, color: "var(--muted)" }}>Start<br /><input type="date" value={start} disabled={!canManagerSign || ro} onChange={(e) => setStart(e.target.value)} /></label>
            <label style={{ fontSize: 11.5, color: "var(--muted)" }}>Finish<br /><input type="date" value={finish} disabled={!canManagerSign || ro} onChange={(e) => setFinish(e.target.value)} /></label>
            {(canManagerSign && !ro) && <button className="btn btn-sm" disabled={!start || !finish} onClick={() => store.setVendorDates(tradeId, start, finish)}>Save dates</button>}
            {agreement.startDate && <span style={{ fontSize: 12, color: "var(--muted)" }}>Saved: {agreement.startDate} → {agreement.finishDate}</span>}
          </div>
          <Lbl>Draw schedule (from Payments)</Lbl>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, margin: "4px 0 8px" }}>
            {drawRows.length ? drawRows.map(({ d, l, amt }, i) => (
              <div key={i} style={{ display: "flex", gap: 8, fontSize: 12.5 }}>
                <span style={{ flex: 1 }}>{d.name} · {l.name}</span>
                {canSeeCosts && <span style={{ fontWeight: 600 }}>{fmt(amt)}</span>}
                <span style={{ minWidth: 92, textAlign: "right", color: d.status === "paid" ? "var(--ok)" : d.status === "pushed" ? "var(--brass-2)" : "var(--muted)" }}>{d.status}</span>
              </div>
            )) : <span style={{ fontSize: 12, color: "var(--muted)" }}>Not allocated to any draw yet (set in Payment &amp; Draw Management).</span>}
          </div>
          <SignRow round={2} agreement={agreement} parties={[manager, "trade"]} canManager={canManagerSign && !ro} canTrade={canTradeSign} signerSig={me?.signature} onSign={(party, img) => store.signVendorRound(tradeId, 2, party, name, img)} onAdopt={(img) => me && store.setUserSignature(me.id, img)} />
        </>}
      </div>
    </div>
  );
}

// Editable "intent to be legally bound" language, shown above the signatures.
function BindingBlock({ canEdit }: { canEdit: boolean }) {
  const store = useStore();
  const [edit, setEdit] = useState(false);
  const text = store.db.terms.bindingLanguage;
  return (
    <div style={{ marginTop: 10, padding: "8px 10px", background: "var(--paper)", borderRadius: 8, border: "1px solid var(--line)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)" }}>Binding agreement</span>
        {canEdit && <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => setEdit((v) => !v)}>{edit ? "Done" : "Edit"}</button>}
      </div>
      {edit ? (
        <textarea value={text} onChange={(e) => store.setTermsField({ bindingLanguage: e.target.value })} style={{ width: "100%", minHeight: 84, fontSize: 12, marginTop: 6, resize: "vertical" }} />
      ) : (
        <p style={{ fontSize: 12, color: "var(--ink)", margin: "6px 0 0", lineHeight: 1.45 }}>{text}</p>
      )}
    </div>
  );
}

const PARTY_LABEL: Record<"builder" | "trade" | "owner", string> = { builder: "Builder / GC", trade: "Trade / Vendor", owner: "Owner / Client" };

function SignRow({ round, agreement, parties, canManager, canTrade, signerSig, onSign, onAdopt }: { round: 1 | 2; agreement: VendorAgreement; parties: ("builder" | "trade" | "owner")[]; canManager: boolean; canTrade: boolean; signerSig?: string; onSign: (party: "builder" | "trade" | "owner", img?: string) => void; onAdopt: (img: string) => void }) {
  const [pad, setPad] = useState<null | "builder" | "trade" | "owner">(null);
  const sigs = round === 1 ? agreement.round1 : agreement.round2;
  const sig = (party: "builder" | "trade" | "owner") => sigs.find((s) => s.party === party);
  const fmtTs = (s?: string) => (s ? new Date(s).toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
      {parties.map((party) => {
        const s = sig(party);
        const can = party === "trade" ? canTrade : canManager;
        return (
          <div key={party} style={{ flex: 1, minWidth: 200, border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700 }}>{PARTY_LABEL[party]}</div>
            {s ? (
              <div style={{ marginTop: 4 }}>
                <SignatureMark img={s.signatureImg} name={s.name} />
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>signed {fmtTs(s.at)}</div>
                {can && <button className="btn btn-sm" style={{ marginTop: 4, color: "var(--rust)" }} onClick={() => onSign(party)}>Revoke</button>}
              </div>
            ) : !can ? (
              <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)" }}>Awaiting signature</div>
            ) : pad === party ? (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Draw your signature, then adopt &amp; sign:</div>
                <SignaturePad onAdopt={(img) => { onAdopt(img); onSign(party, img); setPad(null); }} onCancel={() => setPad(null)} />
              </div>
            ) : (
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                {signerSig && <button className="btn btn-sm btn-primary" onClick={() => onSign(party, signerSig)}>✒ Sign with adopted signature</button>}
                <button className="btn btn-sm" onClick={() => setPad(party)}>{signerSig ? "Draw a new signature" : "✒ Adopt signature & sign"}</button>
                {signerSig && <div style={{ fontSize: 10.5, color: "var(--muted)" }}>Your saved signature: <SignatureMark img={signerSig} name="" /></div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ContactBlock({ title, c, accent }: { title: string; c?: ContactSheet; accent: string }) {
  return (
    <div style={{ flex: 1, minWidth: 200, border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px", borderTop: `2px solid ${accent}` }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)" }}>{title}</div>
      {c ? (
        <div style={{ fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>
          <div style={{ fontWeight: 700 }}>{c.company}</div>
          {c.contactName && <div>{c.contactName}</div>}
          {c.email && <div style={{ color: "var(--muted)" }}>{c.email}</div>}
          {c.phone && <div style={{ color: "var(--muted)" }}>{c.phone}</div>}
          {c.billing && (c.billing.payableTo || c.billing.paymentTerms || c.billing.remittance) && (
            <div style={{ marginTop: 4, paddingTop: 4, borderTop: "1px dashed var(--line)", color: "var(--ink)" }}>
              {c.billing.payableTo && <div>💳 Pay to: <strong>{c.billing.payableTo}</strong></div>}
              {c.billing.paymentTerms && <div style={{ color: "var(--muted)" }}>Terms: {c.billing.paymentTerms}</div>}
              {c.billing.taxId && <div style={{ color: "var(--muted)" }}>Tax ID: {c.billing.taxId}</div>}
              {c.billing.remittance && <div style={{ color: "var(--muted)" }}>{c.billing.remittance}</div>}
            </div>
          )}
        </div>
      ) : <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>Add in <Link href="/admin" style={{ color: "var(--sage-2)" }}>Admin → Contacts</Link>.</div>}
    </div>
  );
}

function ContactsBilling({ vendor, builder, owner, ownerManaged }: { vendor?: ContactSheet; builder?: ContactSheet; owner?: ContactSheet; ownerManaged: boolean }) {
  // A contract shows only its two parties: the vendor and whoever manages them.
  // Owner-managed contracts never show the builder (and vice versa).
  return (
    <div style={{ marginTop: 12 }}>
      <Lbl>Contacts &amp; billing (on contract &amp; draws)</Lbl>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
        <ContactBlock title={ownerManaged ? "Vendor · Owner Managed" : "Vendor"} c={vendor} accent={ownerManaged ? "var(--brass)" : "var(--sage)"} />
        {ownerManaged
          ? <ContactBlock title="Owner" c={owner} accent="var(--brass)" />
          : <ContactBlock title="Builder / GC" c={builder} accent="var(--walnut)" />}
      </div>
    </div>
  );
}

function Lbl({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)" }}>{children}</div>;
}

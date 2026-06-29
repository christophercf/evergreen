"use client";

import { useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/data/hooks";
import { PageHeader, NoAccess, Pill, SectionTitle, Money } from "../ui/bits";
import { accessFor, type DB, type VendorAgreement } from "@/lib/data/types";
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
  (["builder", "trade"] as const).forEach((party) => {
    const label = party === "builder" ? "Builder / GC" : "Trade / Vendor";
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

  const myTrades = role === "trade" ? new Set(user?.tradeIds ?? []) : null;
  const activeTradeIds = Array.from(new Set(db.costLines.map((l) => l.tradeId)))
    .filter((id) => !myTrades || myTrades.has(id))
    .sort((a, b) => tradeCost(db, b) - tradeCost(db, a));

  return (
    <>
      <PageHeader
        title="Vendor Management"
        subtitle="Each trade's roll-up: scope pulled from the Admin matrix, terms applied, the vendor's requested draw parameters, and two rounds of digitally-signed contract — first on scope & cost, then on draw schedule & timeline."
        right={<Link href="/costs" className="btn btn-sm">Building Costs →</Link>}
      />
      <SectionTitle>Vendors &amp; Contracts</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {activeTradeIds.map((tid) => <VendorCard key={tid} tradeId={tid} />)}
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

  const agreement: VendorAgreement = db.vendorAgreements.find((a) => a.tradeId === tradeId) ?? { tradeId, round1: [], round2: [] };
  const vendorUser = db.users.find((u) => u.tradeIds?.includes(tradeId));
  const isAssignedTrade = role === "trade" && !!vendorUser && vendorUser.id === me?.id;
  const canBuilderSign = role === "builder" || role === "full_admin";
  const canTradeSign = isAssignedTrade || role === "full_admin";
  const canEditRequest = !ro || isAssignedTrade;

  const cost = tradeCost(db, tradeId);
  const cells = db.scope.filter((c) => c.tradeId === tradeId && c.status === "in");
  const rooms = cells.map((c) => db.rooms.find((r) => r.id === c.roomId)?.name ?? c.roomId);
  const items = Array.from(new Set(cells.flatMap((c) => c.items.filter((i) => i.included).map((i) => i.label))));
  const mats = db.materials.filter((m) => m.tradeId === tradeId);
  const terms = renderTerms(db, tradeId);

  const r1Done = agreement.round1.some((s) => s.party === "builder") && agreement.round1.some((s) => s.party === "trade");
  const r2Done = agreement.round2.some((s) => s.party === "builder") && agreement.round2.some((s) => s.party === "trade");

  // This trade's draw allocations (for round 2 schedule).
  const myLineIds = new Set(db.costLines.filter((l) => l.tradeId === tradeId).map((l) => l.id));
  const drawRows = db.draws.flatMap((d) => d.allocations.filter((a) => myLineIds.has(a.lineId)).map((a) => {
    const l = db.costLines.find((x) => x.id === a.lineId)!;
    return { d, l, amt: allocationAmount(l, a) };
  }));

  const [start, setStart] = useState(agreement.startDate ?? "");
  const [finish, setFinish] = useState(agreement.finishDate ?? "");

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h3 className="serif" style={{ fontSize: 17, fontWeight: 700, color: "var(--walnut)" }}>{tradeName(db, tradeId)}</h3>
        {vendorUser && <Pill bg="var(--cream-2)">{vendorUser.name}</Pill>}
        <Pill color="#fff" bg={r1Done ? "var(--ok)" : "var(--sc-unset)"}>R1 {r1Done ? "executed" : "draft"}</Pill>
        <Pill color="#fff" bg={r2Done ? "var(--ok)" : "var(--sc-unset)"}>R2 {r2Done ? "executed" : "draft"}</Pill>
        <span style={{ marginLeft: "auto", fontWeight: 700, fontSize: 16 }}><Money value={cost} /></span>
        <button className="btn btn-sm" title="Download trade packet (terms, rooms, materials)" onClick={() => downloadTradePdf(db, tradeId)}>⬇ PDF</button>
      </div>

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
          Vendor agrees to the scope above for a total of <strong style={{ color: "var(--ink)" }}>{fmt(cost)}</strong>. Terms &amp; conditions apply.
        </p>
        <details style={{ fontSize: 12, color: "var(--muted)" }}><summary style={{ cursor: "pointer" }}>Full terms &amp; conditions</summary><pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", marginTop: 6 }}>{terms}</pre></details>
        <BindingBlock canEdit={canBuilderSign && !ro} />
        <SignRow round={1} agreement={agreement} canBuilder={canBuilderSign && !ro} canTrade={canTradeSign} signerSig={me?.signature} onSign={(party, img) => store.signVendorRound(tradeId, 1, party, name, img)} onAdopt={(img) => me && store.setUserSignature(me.id, img)} />
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
            <label style={{ fontSize: 11.5, color: "var(--muted)" }}>Start<br /><input type="date" value={start} disabled={!canBuilderSign || ro} onChange={(e) => setStart(e.target.value)} /></label>
            <label style={{ fontSize: 11.5, color: "var(--muted)" }}>Finish<br /><input type="date" value={finish} disabled={!canBuilderSign || ro} onChange={(e) => setFinish(e.target.value)} /></label>
            {(canBuilderSign && !ro) && <button className="btn btn-sm" disabled={!start || !finish} onClick={() => store.setVendorDates(tradeId, start, finish)}>Save dates</button>}
            {agreement.startDate && <span style={{ fontSize: 12, color: "var(--muted)" }}>Saved: {agreement.startDate} → {agreement.finishDate}</span>}
          </div>
          <Lbl>Draw schedule (from Payments)</Lbl>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, margin: "4px 0 8px" }}>
            {drawRows.length ? drawRows.map(({ d, l, amt }, i) => (
              <div key={i} style={{ display: "flex", gap: 8, fontSize: 12.5 }}>
                <span style={{ flex: 1 }}>{d.name} · {l.name}</span>
                <span style={{ fontWeight: 600 }}>{fmt(amt)}</span>
                <span style={{ minWidth: 92, textAlign: "right", color: d.status === "paid" ? "var(--ok)" : d.status === "pushed" ? "var(--brass-2)" : "var(--muted)" }}>{d.status}</span>
              </div>
            )) : <span style={{ fontSize: 12, color: "var(--muted)" }}>Not allocated to any draw yet (set in Payment &amp; Draw Management).</span>}
          </div>
          <SignRow round={2} agreement={agreement} canBuilder={canBuilderSign && !ro} canTrade={canTradeSign} signerSig={me?.signature} onSign={(party, img) => store.signVendorRound(tradeId, 2, party, name, img)} onAdopt={(img) => me && store.setUserSignature(me.id, img)} />
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

function SignRow({ round, agreement, canBuilder, canTrade, signerSig, onSign, onAdopt }: { round: 1 | 2; agreement: VendorAgreement; canBuilder: boolean; canTrade: boolean; signerSig?: string; onSign: (party: "builder" | "trade", img?: string) => void; onAdopt: (img: string) => void }) {
  const [pad, setPad] = useState<null | "builder" | "trade">(null);
  const sigs = round === 1 ? agreement.round1 : agreement.round2;
  const sig = (party: "builder" | "trade") => sigs.find((s) => s.party === party);
  const fmtTs = (s?: string) => (s ? new Date(s).toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
      {(["builder", "trade"] as const).map((party) => {
        const s = sig(party);
        const can = party === "builder" ? canBuilder : canTrade;
        return (
          <div key={party} style={{ flex: 1, minWidth: 210, border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700 }}>{party === "builder" ? "Builder / GC" : "Trade / Vendor"}</div>
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

function Lbl({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)" }}>{children}</div>;
}

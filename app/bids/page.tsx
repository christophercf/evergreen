"use client";

import { useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/data/hooks";
import { PageHeader, NoAccess, Pill, SectionTitle, NumInput, TextInput } from "../ui/bits";
import { accessFor, type BidPackage, type VendorBid } from "@/lib/data/types";
import { tradeName, MACRO_ORDER, fmt } from "@/lib/data/money";
import { storeFile } from "../ui/upload";
import { jsPDF } from "jspdf";

// ---------------------------------------------------------------------------
// Scope Support — pre-budget bidding. Define a scope of work (from the scope
// matrix or from scratch), send it to multiple vendors (email or printable
// PDF / RFP form), log each bid as it comes back (email / text / phone, with
// photo or document uploads), and award the winner — which promotes the price
// into a Project Budget line (ROM → BUDGET).
// ---------------------------------------------------------------------------

const fmtD = (s: string) => new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const VIA: VendorBid["receivedVia"][] = ["email", "text", "phone", "form", "pdf"];

/** Printable bid-request / RFP PDF: the scope + blanks the vendor fills in. */
function downloadBidRequestPdf(opts: { projectName: string; title: string; trade: string; rooms: string[]; scope: string; rfp: boolean }) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const M = 48, W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  let y = M;
  const ensure = (h = 14) => { if (y + h > H - M) { doc.addPage(); y = M; } };
  const text = (s: string, o: { size?: number; bold?: boolean; color?: [number, number, number]; gap?: number } = {}) => {
    const size = o.size ?? 10, color = o.color ?? [44, 36, 28], gap = o.gap ?? 4;
    doc.setFont("helvetica", o.bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(...color);
    for (const ln of doc.splitTextToSize(s, W - 2 * M)) { ensure(size + gap); doc.text(ln, M, y); y += size + gap; }
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
  rule();
  if (opts.rfp) {
    text("Brief description of work:", { size: 11, bold: true });
    text(opts.scope || "(see rooms above)", { size: 10, color: [80, 72, 60] });
    y += 8;
    text("VENDOR: please detail your proposed scope of work below.", { size: 10, bold: true, color: [176, 138, 62] });
    blank("Proposed scope of work", 10);
  } else {
    text("Scope of work:", { size: 11, bold: true });
    text(opts.scope || "(to be discussed)", { size: 10, color: [80, 72, 60] });
    y += 8;
  }
  blank("Total price (materials + labor, USD)", 1);
  blank("Estimated schedule / lead time", 1);
  blank("Exclusions / assumptions", 3);
  blank("Company · Contact · Phone · Email", 2);
  blank("Signature & date", 1);
  text("Return by email, text or phone — your bid will be logged in the project's Scope Support board.", { size: 8.5, color: [122, 111, 96] });
  doc.save(`${opts.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${opts.rfp ? "rfp" : "bid-request"}.pdf`);
}

export default function BidsPage() {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const user = store.currentUser;
  const access = accessFor(user, role, "bids");
  if (access === "none") return <NoAccess module="Scope Support" />;
  const ro = access !== "edit";

  const open = db.bidPackages.filter((p) => p.status === "collecting");
  const awarded = db.bidPackages.filter((p) => p.status === "awarded");

  return (
    <>
      <PageHeader
        title="Scope Support"
        subtitle="Competitive bidding before the budget: define a scope of work, send it to multiple vendors, log every bid that comes back, and award the winner — the price promotes straight into Project Budget."
        right={<Link href="/costs" className="btn btn-sm">Project Budget →</Link>}
      />

      {!ro && <NewPackage />}

      <SectionTitle>Collecting bids ({open.length})</SectionTitle>
      {!open.length && <div className="card" style={{ padding: 16, fontSize: 12.5, color: "var(--muted)" }}>No open bid packages — create one above to start collecting vendor bids.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {open.map((p) => <PackageCard key={p.id} p={p} ro={ro} />)}
      </div>

      {awarded.length > 0 && (
        <>
          <SectionTitle>Awarded ({awarded.length})</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {awarded.map((p) => <PackageCard key={p.id} p={p} ro={ro} />)}
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
function NewPackage() {
  const store = useStore();
  const db = store.db;
  const [openForm, setOpenForm] = useState(false);
  const [title, setTitle] = useState("");
  const [tradeId, setTradeId] = useState("");
  const [rooms, setRooms] = useState<string[]>([]);
  const [scope, setScope] = useState("");

  // Pull the in-scope rooms + checklist for this trade straight from the Admin
  // scope matrix — the "template" starting point.
  const pullFromMatrix = () => {
    if (!tradeId) return;
    const cells = db.scope.filter((c) => c.tradeId === tradeId && c.status === "in");
    const roomIds = cells.map((c) => c.roomId);
    const items = Array.from(new Set(cells.flatMap((c) => c.items.filter((i) => i.included).map((i) => i.label))));
    setRooms(roomIds);
    setScope(items.length ? items.map((i) => `• ${i}`).join("\n") : "");
  };

  const create = () => {
    if (!title.trim() || !tradeId) return;
    store.addBidPackage({ title, tradeId, roomIds: rooms, scopeDetails: scope });
    setTitle(""); setTradeId(""); setRooms([]); setScope(""); setOpenForm(false);
  };

  if (!openForm) return <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => setOpenForm(true)}>＋ New bid package</button>;
  return (
    <div className="card" style={{ padding: 14, marginTop: 14, borderLeft: "3px solid var(--sage)", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input autoFocus placeholder="Package title — e.g. Basement windows supply & install" value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: 1, minWidth: 220, fontSize: 13.5 }} />
        <select value={tradeId} onChange={(e) => setTradeId(e.target.value)} style={{ fontSize: 12.5 }}>
          <option value="">— trade —</option>
          {MACRO_ORDER.map((c) => <optgroup key={c} label={c}>{db.trades.filter((t) => t.category === c).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>)}
        </select>
        <button className="btn btn-sm" disabled={!tradeId} title="Prefill rooms + scope checklist from the Admin scope matrix" onClick={pullFromMatrix}>⤵ Pull from scope matrix</button>
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        {db.rooms.map((r) => {
          const on = rooms.includes(r.id);
          return <button key={r.id} className="btn btn-sm" onClick={() => setRooms((p) => on ? p.filter((x) => x !== r.id) : [...p, r.id])}
            style={{ fontSize: 11, padding: "2px 8px", background: on ? "var(--sage)" : undefined, color: on ? "#fff" : undefined, borderColor: on ? "var(--sage)" : undefined }}>{r.name}</button>;
        })}
      </div>
      <textarea value={scope} onChange={(e) => setScope(e.target.value)} placeholder={"Scope of work — what needs to happen, room by room. (Builder-led: write it here. RFP: keep it a brief description and let the vendor fill out the details on the form.)"} style={{ minHeight: 100, fontSize: 12.5 }} />
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-primary btn-sm" disabled={!title.trim() || !tradeId} onClick={create}>Create package</button>
        <button className="btn btn-sm" onClick={() => setOpenForm(false)}>Cancel</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function PackageCard({ p, ro }: { p: BidPackage; ro: boolean }) {
  const store = useStore();
  const db = store.db;
  const [addingBid, setAddingBid] = useState(false);
  const [vendorSel, setVendorSel] = useState("");
  const [vendorFree, setVendorFree] = useState("");
  const awardedTo = p.bids.find((b) => b.id === p.awardedBidId);
  const roomNames = p.roomIds.map((r) => db.rooms.find((x) => x.id === r)?.name ?? r);
  const vendorContacts = db.contacts.filter((c) => c.party === "vendor");
  const trade = tradeName(db, p.tradeId);

  const requestPdf = (rfp: boolean) => downloadBidRequestPdf({ projectName: db.project.name, title: p.title, trade, rooms: roomNames, scope: p.scopeDetails, rfp });
  const mailtoFor = (b?: VendorBid) => {
    const contact = b?.contactId ? db.contacts.find((c) => c.id === b.contactId) : undefined;
    const subject = encodeURIComponent(`Bid request — ${p.title} (${db.project.name})`);
    const body = encodeURIComponent(`Hi${b ? ` ${b.vendorName}` : ""},\n\nWe're collecting bids for the following scope of work at ${db.project.name}. Please reply with your total price, lead time, and any exclusions.\n\nSCOPE — ${p.title} (${trade})\nRooms: ${roomNames.join(", ") || "see description"}\n\n${p.scopeDetails}\n\nThanks!`);
    return `mailto:${contact?.email ?? ""}?subject=${subject}&body=${body}`;
  };

  const addBid = () => {
    const contact = vendorContacts.find((c) => c.id === vendorSel);
    const name = contact ? contact.company : vendorFree.trim();
    if (!name) return;
    store.addBid(p.id, { vendorName: name, contactId: contact?.id });
    setVendorSel(""); setVendorFree(""); setAddingBid(false);
  };

  return (
    <div className="card" style={{ padding: 16, borderLeft: p.status === "awarded" ? "3px solid var(--ok)" : "3px solid var(--brass)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h3 className="serif" style={{ fontSize: 16.5, fontWeight: 700, color: "var(--walnut)" }}>{p.title}</h3>
        <Pill bg="var(--cream-2)">{trade}</Pill>
        {p.status === "awarded"
          ? <Pill color="#fff" bg="var(--ok)">🏆 {awardedTo?.vendorName} · {awardedTo?.amount != null ? fmt(awardedTo.amount) : ""}</Pill>
          : <Pill color="#fff" bg="var(--brass)">{p.bids.length} bid{p.bids.length === 1 ? "" : "s"}</Pill>}
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}>{fmtD(p.createdAt)}</span>
        {!ro && p.status !== "awarded" && <button className="btn btn-sm" style={{ color: "var(--rust)" }} onClick={() => { if (confirm(`Remove bid package "${p.title}"?`)) store.removeBidPackage(p.id); }}>✕</button>}
      </div>
      {roomNames.length > 0 && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>Rooms: {roomNames.join(", ")}</div>}

      {/* the scope of work (editable until awarded) */}
      <textarea value={p.scopeDetails} disabled={ro || p.status === "awarded"} onChange={(e) => store.updateBidPackage(p.id, { scopeDetails: e.target.value })}
        style={{ width: "100%", minHeight: 64, fontSize: 12.5, marginTop: 8, resize: "vertical", background: "var(--paper)" }} />

      {/* send-out actions */}
      {!ro && p.status !== "awarded" && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          <a className="btn btn-sm" href={mailtoFor()} title="Open a prefilled bid-request email">📧 Email bid request</a>
          <button className="btn btn-sm" onClick={() => requestPdf(false)} title="Printable bid request with the scope + blanks for pricing">🖨 Bid request PDF</button>
          <button className="btn btn-sm" onClick={() => requestPdf(true)} title="RFP: brief description + blank scope form the vendor fills out">📄 RFP form PDF</button>
        </div>
      )}

      {/* bids */}
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {p.bids.map((b) => <BidRow key={b.id} p={p} b={b} ro={ro} mailto={mailtoFor(b)} />)}
        {!p.bids.length && <div style={{ fontSize: 12, color: "var(--muted)" }}>No vendors added yet.</div>}
      </div>

      {!ro && p.status !== "awarded" && (
        addingBid ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
            <select value={vendorSel} onChange={(e) => { setVendorSel(e.target.value); setVendorFree(""); }} style={{ fontSize: 12 }}>
              <option value="">— from vendor contacts —</option>
              {vendorContacts.map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}
            </select>
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>or</span>
            <input placeholder="New vendor name" value={vendorFree} onChange={(e) => { setVendorFree(e.target.value); setVendorSel(""); }} style={{ fontSize: 12, width: 170 }} onKeyDown={(e) => e.key === "Enter" && addBid()} />
            <button className="btn btn-sm btn-primary" disabled={!vendorSel && !vendorFree.trim()} onClick={addBid}>Add</button>
            <button className="btn btn-sm" onClick={() => setAddingBid(false)}>Cancel</button>
          </div>
        ) : (
          <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => setAddingBid(true)}>＋ Add vendor to bid</button>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function BidRow({ p, b, ro, mailto }: { p: BidPackage; b: VendorBid; ro: boolean; mailto: string }) {
  const store = useStore();
  const [expand, setExpand] = useState(false);
  const isWinner = b.status === "awarded";
  const locked = ro || p.status === "awarded";
  const canAward = !ro && p.status !== "awarded" && b.amount != null && b.amount > 0;

  const upload = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    const { fileUrl, fileName } = await storeFile(f);
    store.addBidAttachment(p.id, b.id, { name: fileName, url: fileUrl });
    store.updateBid(p.id, b.id, { status: b.status === "requested" ? "received" : b.status });
  };

  return (
    <div style={{ border: isWinner ? "2px solid var(--ok)" : "1px solid var(--line)", borderRadius: 9, padding: "9px 11px", background: isWinner ? "var(--sage-tint)" : undefined, opacity: p.status === "awarded" && !isWinner ? 0.55 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13 }}>{b.vendorName}</strong>
        {isWinner && <Pill color="#fff" bg="var(--ok)">🏆 awarded</Pill>}
        {!isWinner && (
          locked ? <Pill bg="var(--cream-2)">{b.status}</Pill> : (
            <select value={b.status} onChange={(e) => store.updateBid(p.id, b.id, { status: e.target.value as VendorBid["status"] })} style={{ fontSize: 10.5, padding: "1px 4px" }}>
              {(["requested", "received", "declined"] as const).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )
        )}
        {!locked && (
          <select value={b.receivedVia ?? ""} onChange={(e) => store.updateBid(p.id, b.id, { receivedVia: (e.target.value || undefined) as VendorBid["receivedVia"] })} title="How the bid came in" style={{ fontSize: 10.5, padding: "1px 4px" }}>
            <option value="">via…</option>
            {VIA.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        )}
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10.5, color: "var(--muted)" }}>Total</span>
          {locked
            ? <strong style={{ fontSize: 14 }}>{b.amount != null ? fmt(b.amount) : "—"}</strong>
            : <NumInput value={b.amount ?? 0} onCommit={(v) => store.updateBid(p.id, b.id, { amount: v > 0 ? v : undefined, status: v > 0 && b.status === "requested" ? "received" : b.status })} width={82} money />}
        </span>
        {canAward && <button className="btn btn-sm btn-primary" title="Award this bid — promotes the price into Project Budget (ROM → BUDGET)" onClick={() => { if (confirm(`Award "${p.title}" to ${b.vendorName} at ${fmt(b.amount!)}? This locks it into Project Budget.`)) store.awardBid(p.id, b.id); }}>🏆 Award</button>}
        <button className="btn btn-sm" onClick={() => setExpand((v) => !v)}>{expand ? "▾" : "▸"}</button>
        {!locked && <button className="btn btn-sm" style={{ color: "var(--rust)" }} onClick={() => store.removeBid(p.id, b.id)}>✕</button>}
      </div>

      {expand && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 7 }}>
          <label style={{ fontSize: 10.5, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 3 }}>Vendor-submitted scope (from their email / call / RFP return)
            <textarea value={b.scopeText ?? ""} disabled={locked} onChange={(e) => store.updateBid(p.id, b.id, { scopeText: e.target.value })} placeholder="Paste or summarize what the vendor proposed…" style={{ minHeight: 56, fontSize: 12 }} />
          </label>
          <label style={{ fontSize: 10.5, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 3 }}>Notes
            <TextInput value={b.notes ?? ""} disabled={locked} onCommit={(v) => store.updateBid(p.id, b.id, { notes: v || undefined })} style={{ fontSize: 12 }} />
          </label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {(b.attachments ?? []).map((a, i) => (
              a.url.startsWith("data:image") || /\.(png|jpe?g|webp)$/i.test(a.name)
                // eslint-disable-next-line @next/next/no-img-element
                ? <a key={i} href={a.url} target="_blank" rel="noreferrer" title={a.name}><img src={a.url} alt={a.name} style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 7, border: "1px solid var(--line)" }} /></a>
                : <a key={i} className="btn btn-sm" href={a.url} target="_blank" rel="noreferrer" download={a.name}>📎 {a.name.slice(0, 22)}</a>
            ))}
            {!locked && (
              <label className="btn btn-sm" style={{ cursor: "pointer" }}>
                📷 Upload photo / email
                <input type="file" accept="image/*,.pdf,.eml,.msg,.txt" style={{ display: "none" }} onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
              </label>
            )}
            {!locked && <a className="btn btn-sm" href={mailto}>📧 Email this vendor</a>}
          </div>
          {isWinner && p.lineId && <Link href={`/costs?line=${p.lineId}`} style={{ fontSize: 12, color: "var(--sage-2)", fontWeight: 600 }}>→ View in Project Budget</Link>}
        </div>
      )}
    </div>
  );
}

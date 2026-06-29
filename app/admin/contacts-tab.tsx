"use client";

import { useState } from "react";
import { useStore } from "@/lib/data/hooks";
import { Pill, SectionTitle } from "../ui/bits";
import { MACRO_ORDER, tradeName } from "@/lib/data/money";
import { isOwnerManaged, ROLE_LABEL, type ContactSheet, type MacroCategory } from "@/lib/data/types";

const Lbl = ({ children }: { children: React.ReactNode }) =>
  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)" }}>{children}</div>;

function Field({ label, value, onChange, disabled, placeholder, w }: { label: string; value?: string; onChange: (v: string) => void; disabled?: boolean; placeholder?: string; w?: number }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 2, flex: w ? undefined : 1, width: w, minWidth: 120 }}>
      <Lbl>{label}</Lbl>
      <input value={value ?? ""} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={{ fontSize: 12.5 }} />
    </label>
  );
}

export default function ContactsTab({ ro }: { ro: boolean }) {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const isOwner = role === "owner";
  const canEditAll = !ro && (role === "full_admin" || role === "builder");

  const builderCard = db.contacts.find((c) => c.party === "builder");
  const ownerCard = db.contacts.find((c) => c.party === "owner");
  const vendors = db.contacts.filter((c) => c.party === "vendor");

  const canEditSheet = (c: ContactSheet) =>
    canEditAll || (isOwner && (c.party === "owner" || (c.party === "vendor" && db.trades.find((t) => t.id === c.tradeId)?.managedBy === "owner")));

  return (
    <>
      <div style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 10px" }}>
        The contact sheet sits on top of <strong>Users &amp; Access</strong>: company &amp; billing details live here, while the <em>people with app access</em> are the same accounts you manage there — inviting someone here adds them to Users &amp; Access (and vice-versa). The owner keeps their own card and can add owner-managed vendors; trades only see contacts the builder shares.
      </div>

      <SectionTitle>Your team</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px,1fr))", gap: 12 }}>
        {builderCard ? <ContactCard c={builderCard} canEdit={canEditAll} /> : canEditAll && <CreateOrg party="builder" />}
        {ownerCard ? <ContactCard c={ownerCard} canEdit={canEditSheet(ownerCard)} /> : (canEditAll || isOwner) && <CreateOrg party="owner" />}
      </div>

      <SectionTitle right={canEditAll ? <AddVendor /> : undefined}>Vendor contacts</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px,1fr))", gap: 12 }}>
        {vendors.map((c) => <ContactCard key={c.id} c={c} canEdit={canEditSheet(c)} />)}
        {!vendors.length && <div className="card" style={{ padding: 16, color: "var(--muted)", fontSize: 13 }}>No vendor contacts yet.</div>}
      </div>

      {(canEditAll || isOwner) && <AddTrade owner={isOwner && !canEditAll} />}
    </>
  );
}

function ContactCard({ c, canEdit }: { c: ContactSheet; canEdit: boolean }) {
  const store = useStore();
  const db = store.db;
  const [showBilling, setShowBilling] = useState(false);
  const trade = c.tradeId ? db.trades.find((t) => t.id === c.tradeId) : undefined;
  const ownerManaged = isOwnerManaged(trade);
  const up = (patch: Partial<ContactSheet>) => store.updateContactSheet(c.id, patch);

  return (
    <div className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8, borderTop: `3px solid ${c.party === "builder" ? "var(--walnut)" : c.party === "owner" ? "var(--brass)" : ownerManaged ? "var(--brass)" : "var(--sage)"}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <input value={c.company} disabled={!canEdit} onChange={(e) => up({ company: e.target.value })} style={{ border: "none", background: "transparent", fontWeight: 700, fontSize: 15, fontFamily: "var(--font-serif)", color: "var(--walnut)", flex: 1, minWidth: 140 }} />
        {c.party === "builder" && <Pill color="#fff" bg="var(--walnut)">Builder / GC</Pill>}
        {c.party === "owner" && <Pill color="#fff" bg="var(--brass)">Owner</Pill>}
        {ownerManaged && <Pill color="#fff" bg="var(--brass)">⌂ Owner Managed</Pill>}
        {c.shareAll && <Pill bg="var(--sage-tint)">shared</Pill>}
      </div>
      {trade && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>Trade: {tradeName(db, trade.id)}</div>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Field label="Primary contact" value={c.contactName} disabled={!canEdit} onChange={(v) => up({ contactName: v })} />
        <Field label="Phone" value={c.phone} disabled={!canEdit} onChange={(v) => up({ phone: v })} />
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Field label="Email" value={c.email} disabled={!canEdit} onChange={(v) => up({ email: v })} />
        <Field label="Address" value={c.address} disabled={!canEdit} onChange={(v) => up({ address: v })} />
      </div>

      {/* Billing */}
      <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setShowBilling((v) => !v)}>💳 Billing details {showBilling ? "▾" : "▸"}</button>
      {showBilling && (
        <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 8, background: "var(--paper)" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Field label="Payable to / invoice from" value={c.billing?.payableTo} disabled={!canEdit} onChange={(v) => store.updateBilling(c.id, { payableTo: v })} />
            <Field label="Billing email" value={c.billing?.email} disabled={!canEdit} onChange={(v) => store.updateBilling(c.id, { email: v })} />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Field label="Tax ID / EIN" value={c.billing?.taxId} disabled={!canEdit} onChange={(v) => store.updateBilling(c.id, { taxId: v })} />
            <Field label="Payment terms" value={c.billing?.paymentTerms} disabled={!canEdit} onChange={(v) => store.updateBilling(c.id, { paymentTerms: v })} />
          </div>
          <Field label="Remittance (ACH / check-to / acct)" value={c.billing?.remittance} disabled={!canEdit} onChange={(v) => store.updateBilling(c.id, { remittance: v })} />
          <div style={{ fontSize: 11, color: "var(--muted)" }}>These flow onto this vendor’s contract, invoices and draw remittance.</div>
        </div>
      )}

      {/* People with app access — the same accounts as Users & Access */}
      <Crew c={c} canEdit={canEdit} ownerManaged={ownerManaged} />

      {/* footer: share / managedBy / remove */}
      {canEdit && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", borderTop: "1px solid var(--line)", paddingTop: 8 }}>
          {c.party === "vendor" && <button className="btn btn-sm" title="Share this contact with the whole team" onClick={() => store.toggleContactShare(c.id)} style={{ color: c.shareAll ? "var(--sage-2)" : "var(--muted)" }}>{c.shareAll ? "✓ Shared with team" : "Share with team"}</button>}
          {c.party === "vendor" && trade && (
            <label style={{ fontSize: 11.5, color: "var(--muted)", display: "inline-flex", gap: 4, alignItems: "center" }}>
              <input type="checkbox" checked={ownerManaged} onChange={(e) => store.updateTrade(trade.id, { managedBy: e.target.checked ? "owner" : "builder" })} /> Owner-managed
            </label>
          )}
          {c.party === "vendor" && <button className="btn btn-sm" style={{ color: "var(--rust)", marginLeft: "auto" }} onClick={() => { if (confirm(`Remove contact "${c.company}"?`)) store.removeContactSheet(c.id); }}>Delete</button>}
        </div>
      )}
    </div>
  );
}

// People with app access — sourced from Users & Access, kept in sync.
function Crew({ c, canEdit, ownerManaged }: { c: ContactSheet; canEdit: boolean; ownerManaged: boolean }) {
  const store = useStore();
  const db = store.db;
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const people = c.party === "vendor" && c.tradeId
    ? db.users.filter((u) => u.role === "trade" && u.tradeIds?.includes(c.tradeId!))
    : c.party === "builder"
      ? db.users.filter((u) => u.role === "builder" || u.role === "full_admin")
      : db.users.filter((u) => u.role === "owner");

  const invite = () => {
    if (!name.trim() || !email.trim() || !c.tradeId) return;
    store.inviteUser({ name: name.trim(), email: email.trim(), role: "trade", tradeIds: [c.tradeId], managedBy: ownerManaged ? "owner" : "builder" });
    setName(""); setEmail(""); setAdding(false);
  };

  return (
    <div>
      <Lbl>People with app access <span style={{ textTransform: "none", fontWeight: 400 }}>· managed in Users &amp; Access</span></Lbl>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
        {people.map((u) => (
          <div key={u.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5 }}>
            <span style={{ flex: 1 }}><strong>{u.name || u.email}</strong> <span style={{ color: "var(--muted)" }}>· {ROLE_LABEL[u.role]}{u.email ? ` · ${u.email}` : ""}</span></span>
            {u.status === "invited" ? <Pill bg="#f0e6cd" color="var(--brass-2)">invited</Pill> : u.status === "pending" ? <Pill bg="#f3d9cf" color="var(--rust)">pending</Pill> : <Pill bg="var(--sage-tint)">active</Pill>}
          </div>
        ))}
        {!people.length && <div style={{ fontSize: 12, color: "var(--muted)" }}>No app accounts yet{c.party === "vendor" ? " — invite the people who need access." : "."}</div>}
      </div>
      {canEdit && c.party === "vendor" && (adding ? (
        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 130, fontSize: 12 }} />
          <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: 170, fontSize: 12 }} />
          <button className="btn btn-sm btn-primary" disabled={!name.trim() || !email.trim()} onClick={invite}>Invite to app</button>
          <button className="btn btn-sm" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      ) : <button className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => setAdding(true)}>＋ Invite person to app</button>)}
    </div>
  );
}

function CreateOrg({ party }: { party: "builder" | "owner" }) {
  const store = useStore();
  return (
    <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8, border: "1px dashed var(--line)" }}>
      <strong style={{ fontSize: 14, color: "var(--walnut)" }}>Add {party === "builder" ? "Builder / GC" : "Owner"} contact</strong>
      <p style={{ fontSize: 12, color: "var(--muted)" }}>The {party}&apos;s contact &amp; billing details are required — they appear on every contract and draw.</p>
      <button className="btn btn-primary btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => store.addContactSheet({ party, company: party === "builder" ? "Our company (GC)" : "Owner" })}>＋ Add my contact info</button>
    </div>
  );
}

function AddVendor() {
  const store = useStore();
  const db = store.db;
  const [open, setOpen] = useState(false);
  const [tradeId, setTradeId] = useState("");
  const taken = new Set(db.contacts.filter((c) => c.party === "vendor").map((c) => c.tradeId));
  const trades = db.trades.filter((t) => !taken.has(t.id));
  if (!open) return <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>＋ Add vendor</button>;
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <select value={tradeId} onChange={(e) => setTradeId(e.target.value)} style={{ fontSize: 12 }}>
        <option value="">— trade —</option>
        {MACRO_ORDER.map((cat) => <optgroup key={cat} label={cat}>{trades.filter((t) => t.category === cat).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>)}
      </select>
      <button className="btn btn-sm btn-primary" disabled={!tradeId} onClick={() => { const t = db.trades.find((x) => x.id === tradeId); store.addContactSheet({ party: "vendor", tradeId, company: t ? `${t.name} vendor` : "Vendor" }); setTradeId(""); setOpen(false); }}>Add</button>
      <button className="btn btn-sm" onClick={() => setOpen(false)}>Cancel</button>
    </span>
  );
}

function AddTrade({ owner }: { owner: boolean }) {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [cat, setCat] = useState<MacroCategory>("Exterior");
  if (!open) return <button className="btn btn-sm" style={{ marginTop: 14 }} onClick={() => setOpen(true)}>＋ Add a {owner ? "trade I'm managing" : "trade"}</button>;
  return (
    <div className="card" style={{ padding: 12, marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <input placeholder="Trade name (e.g. Driveway & Paving)" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 180, fontSize: 12.5 }} />
      <select value={cat} onChange={(e) => setCat(e.target.value as MacroCategory)} style={{ fontSize: 12 }}>
        {MACRO_ORDER.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      {owner && <Pill color="#fff" bg="var(--brass)">⌂ Owner Managed</Pill>}
      <button className="btn btn-sm btn-primary" disabled={!name.trim()} onClick={() => {
        const id = store.addTrade({ name: name.trim(), category: cat, managedBy: owner ? "owner" : "builder" });
        store.addContactSheet({ party: "vendor", tradeId: id, company: `${name.trim()} vendor` });
        setName(""); setOpen(false);
      }}>Add trade</button>
      <button className="btn btn-sm" onClick={() => setOpen(false)}>Cancel</button>
    </div>
  );
}

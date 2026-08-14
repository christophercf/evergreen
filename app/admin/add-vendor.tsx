"use client";

import { useState } from "react";
import { useStore } from "@/lib/data/hooks";
import {
  DOC_ROUTE_HINT, DOC_ROUTE_LABEL, VENDOR_DOC_LABEL,
  type DocRoute, type VendorDoc,
} from "@/lib/data/types";
import { MACRO_ORDER } from "@/lib/data/money";

// ---------------------------------------------------------------------------
// Add a vendor to the roster.
//
// Replaces the old flow, which created a placeholder named "<Trade> vendor" with
// nothing in it and one trade. Two things changed:
//
//  1. A vendor covers MANY trades. That list is the directory index — it decides
//     which bid packages they appear in. The old single-trade model forced you to
//     invent a duplicate trade per vendor just to have two masons.
//  2. Insurance and license dates are recorded exactly as supplied. Nothing here
//     computes "expiring" or "expired", nothing warns, and nothing blocks a
//     vendor from bidding. The builder reads the dates and judges them.
// ---------------------------------------------------------------------------

const BLANK = { company: "", city: "", contactName: "", phone: "", email: "", paymentTerms: "", gl: "", wc: "", licNo: "", notes: "" };

export function AddVendor({ onDone }: { onDone: (id: string) => void }) {
  const store = useStore();
  const db = store.db;
  const [f, setF] = useState({ ...BLANK });
  const [trades, setTrades] = useState<string[]>([]);
  const [route, setRoute] = useState<DocRoute>("ask_vendor");
  const set = (k: keyof typeof BLANK) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  // The gate: without a company, a person to call and at least one trade, the
  // record can't do its job — it would never surface in a bid package.
  const missing = [
    !f.company.trim() && "company",
    !f.contactName.trim() && "contact",
    !trades.length && "one trade",
  ].filter(Boolean) as string[];
  const ready = !missing.length;

  const save = () => {
    if (!ready) return;
    const docs: VendorDoc[] = [
      { kind: "gl", expires: f.gl || undefined },
      { kind: "wc", expires: f.wc || undefined },
      { kind: "license", number: f.licNo.trim() || undefined },
    ];
    const id = store.addVendor({
      company: f.company, contactName: f.contactName, tradeIds: trades,
      city: f.city, phone: f.phone, email: f.email, paymentTerms: f.paymentTerms,
      docs, docRoute: route, notes: f.notes,
    });
    onDone(id);
  };

  return (
    <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14, maxWidth: 840 }}>
      <div>
        <h3 className="serif" style={{ fontSize: 18, fontWeight: 700, color: "var(--walnut)" }}>Add a vendor</h3>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3, lineHeight: 1.5 }}>
          Enter what you know now. Insurance and license dates can come later, from you or from them.
        </div>
      </div>

      <Section label="Company & contact">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          <Field label="Company" required value={f.company} onChange={set("company")} placeholder="Legal or trading name" />
          <Field label="City" value={f.city} onChange={set("city")} placeholder="Beverly Hills, MI" />
          <Field label="Primary contact" required value={f.contactName} onChange={set("contactName")} placeholder="Name" />
          <Field label="Phone" value={f.phone} onChange={set("phone")} placeholder="(248) 555-0000" />
          <Field label="Email" value={f.email} onChange={set("email")} placeholder="name@company.com" />
          <Field label="Payment terms" value={f.paymentTerms} onChange={set("paymentTerms")} placeholder="Net 30" />
        </div>
      </Section>

      <Section label="What can they work on?">
        {MACRO_ORDER.map((cat) => {
          const inCat = db.trades.filter((t) => t.category === cat);
          if (!inCat.length) return null;
          return (
            <div key={cat} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 4 }}>{cat}</div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {inCat.map((t) => {
                  const on = trades.includes(t.id);
                  return (
                    <button key={t.id} onClick={() => setTrades((p) => on ? p.filter((x) => x !== t.id) : [...p, t.id])}
                      style={{
                        minHeight: 30, padding: "0 10px", borderRadius: 99, fontSize: 12, cursor: "pointer",
                        background: on ? "var(--sage)" : "var(--paper)", color: on ? "#fff" : "var(--ink)",
                        border: `1px solid ${on ? "var(--sage)" : "var(--line)"}`,
                      }}>{t.name}</button>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div style={{ fontSize: 11.5, color: trades.length ? "var(--muted)" : "var(--brass-2)", marginTop: 2, lineHeight: 1.45 }}>
          {trades.length
            ? `${trades.length} selected — they'll appear in every one of those trade lists when a bid package goes out.`
            : "Pick at least one. This is what decides which packages they show up for."}
        </div>
      </Section>

      <Section label="Insurance & license" aside="Optional now">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(165px, 1fr))", gap: 10 }}>
          <Field label="General liability expires" type="date" value={f.gl} onChange={set("gl")} />
          <Field label="Workers' comp expires" type="date" value={f.wc} onChange={set("wc")} />
          <Field label="License number" value={f.licNo} onChange={set("licNo")} placeholder="MI-000000" />
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 7, lineHeight: 1.45 }}>
          Dates are stored as supplied. Nothing here flags or blocks a vendor — you read the dates and judge them.
        </div>
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 5 }}>How do the documents arrive?</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 7 }}>
            {(["we_hold", "ask_vendor"] as DocRoute[]).map((k) => (
              <button key={k} onClick={() => setRoute(k)}
                style={{
                  minHeight: 50, padding: "7px 10px", display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start",
                  textAlign: "left", cursor: "pointer", borderRadius: 8,
                  background: route === k ? "var(--sage)" : "var(--paper)", color: route === k ? "#fff" : "var(--ink)",
                  border: `1px solid ${route === k ? "var(--sage)" : "var(--line)"}`,
                }}>
                <span className="serif" style={{ fontSize: 13.5, fontWeight: 700 }}>{DOC_ROUTE_LABEL[k]}</span>
                <span style={{ fontSize: 10.5, lineHeight: 1.3, opacity: 0.8 }}>{DOC_ROUTE_HINT[k]}</span>
              </button>
            ))}
          </div>
        </div>
      </Section>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.45, maxWidth: 440 }}>
          {route === "ask_vendor"
            ? "Marked as the vendor's to send. Enter any dates you already have — they can be replaced when the certificates turn up."
            : "You hold the documents. Enter the dates you have; anything blank stays blank until someone fills it."}
        </span>
        <div style={{ display: "flex", gap: 7 }}>
          <button className="btn btn-sm" onClick={() => onDone("")}>Cancel</button>
          <button className={`btn btn-sm ${ready ? "btn-primary" : ""}`} disabled={!ready} onClick={save} style={{ minHeight: 36 }}>
            {ready ? "Add to roster" : `Needs ${missing.join(", ")}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ label, aside, children }: { label: string; aside?: string; children: React.ReactNode }) {
  return (
    <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".11em", textTransform: "uppercase", color: "var(--brass-2)" }}>{label}</div>
        {aside && <span style={{ fontSize: 11, color: "var(--muted)" }}>{aside}</span>}
      </div>
      {children}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type, required }: {
  label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string; type?: string; required?: boolean;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
      <span style={{ fontSize: 11, color: "var(--muted)" }}>
        {label}{required && <span style={{ color: "var(--brass-2)" }}> ·&nbsp;required</span>}
      </span>
      <input className="input" type={type} value={value} onChange={onChange} placeholder={placeholder} style={{ minHeight: 36, fontSize: 13 }} />
    </label>
  );
}

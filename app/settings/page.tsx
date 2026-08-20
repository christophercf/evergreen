"use client";

import { useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/data/hooks";
import { PageHeader, Pill, SectionTitle, TextInput } from "../ui/bits";
import { MACRO_ORDER, tradeUsage } from "@/lib/data/money";
import { accessFor, ROLE_LABEL, type MacroCategory, type Trade } from "@/lib/data/types";
import { authUpdatePassword } from "@/lib/data/auth";
import { IS_SUPABASE } from "@/lib/data/config";
import { tradeName } from "@/lib/data/money";

// ---------------------------------------------------------------------------
// My Preferences — every user's personal settings: profile, email
// notifications, and password. Project-wide administration stays on /admin
// (reachable from the same ⚙ menu for roles that have it).
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const me = store.currentUser;
  const canAdmin = accessFor(me, role, "admin") !== "none";

  if (!me) return <PageHeader title="My Preferences" subtitle="No user profile found for this session." />;

  const emailsOn = !me.emailOptOut;

  return (
    <>
      <PageHeader
        title="My Preferences"
        subtitle="Your personal settings — profile, notifications, and password. These only affect your own account."
        right={<Pill bg="var(--cream-2)">{ROLE_LABEL[role]}</Pill>}
      />

      <div style={{ maxWidth: 640, display: "flex", flexDirection: "column", gap: 4 }}>
        {/* profile */}
        <SectionTitle>Profile</SectionTitle>
        <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <Field label="Name">
            <TextInput value={me.name} onCommit={(v) => v.trim() && store.updateUser(me.id, { name: v.trim() })} style={{ width: "100%", fontSize: 13.5 }} />
          </Field>
          <Field label="Phone">
            <TextInput value={me.phone ?? ""} placeholder="e.g. 248-555-0123" onCommit={(v) => store.updateUser(me.id, { phone: v.trim() || undefined })} style={{ width: "100%", fontSize: 13.5 }} />
          </Field>
          <Field label="Login email">
            <div style={{ fontSize: 13.5, padding: "6px 0", color: "var(--muted)" }}>{me.email} <span style={{ fontSize: 11 }}>· linked to your sign-in — ask an admin to change it</span></div>
          </Field>
          {me.role === "trade" && !!me.tradeIds?.length && (
            <Field label="Your trade(s)">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "4px 0" }}>{me.tradeIds.map((t) => <Pill key={t} bg="var(--sage-tint)">{tradeName(db, t)}</Pill>)}</div>
            </Field>
          )}
        </div>

        {/* notifications */}
        <SectionTitle>Notifications</SectionTitle>
        <div className="card" style={{ padding: 16 }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={emailsOn} onChange={(e) => store.updateUser(me.id, { emailOptOut: !e.target.checked || undefined })} style={{ marginTop: 3 }} />
            <span>
              <span style={{ display: "block", fontSize: 13.5, fontWeight: 700 }}>Email me about new messages</span>
              <span style={{ display: "block", fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                Get an email when someone sends you a Messenger message or update. In-app notifications stay on either way.
              </span>
            </span>
          </label>
        </div>

        {/* password */}
        <SectionTitle>Password</SectionTitle>
        <PasswordCard />

        {/* the trades the project runs on */}
        {canAdmin && (
          <>
            <SectionTitle>Trades</SectionTitle>
            <TradesCard />
          </>
        )}

        {/* admin pointer */}
        {canAdmin && (
          <>
            <SectionTitle>Project</SectionTitle>
            <div className="card" style={{ padding: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, color: "var(--muted)", flex: 1, minWidth: 220 }}>
                Rooms & scope matrix, trade scope templates, team access, companies & billing.
              </span>
              <Link href="/admin" className="btn btn-sm btn-primary">🛠 Open Administrative →</Link>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// The trades the app manages. Everything else hangs off these: a budget line is
// a trade, a Gantt bar is a trade, a vendor covers trades. So one can be added
// freely, and removed only once nothing points at it.
// ---------------------------------------------------------------------------
function TradesCard() {
  const store = useStore();
  const db = store.db;
  const [name, setName] = useState("");
  const [cat, setCat] = useState<MacroCategory>(MACRO_ORDER[0]);
  const [managed, setManaged] = useState<"builder" | "owner">("builder");
  const [open, setOpen] = useState(false);

  const dupe = db.trades.some((t) => t.name.trim().toLowerCase() === name.trim().toLowerCase());
  const ready = !!name.trim() && !dupe;

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5, marginBottom: 10 }}>
        {db.trades.length} trades. Everything hangs off these — a budget line is a trade, a schedule
        bar is a trade, and a vendor covers trades. A trade can only be removed once nothing uses it.
      </div>

      {MACRO_ORDER.map((c: MacroCategory) => {
        const inCat = db.trades.filter((t) => t.category === c);
        if (!inCat.length) return null;
        return (
          <div key={c} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 4 }}>{c}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {inCat.map((t) => <TradeRow key={t.id} trade={t} />)}
            </div>
          </div>
        );
      })}

      {!open ? (
        <button className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => setOpen(true)}>＋ Add a trade</button>
      ) : (
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12, marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 170 }}>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>Trade name</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Solar" style={{ fontSize: 12.5 }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>Category</span>
              <select className="input" value={cat} onChange={(e) => setCat(e.target.value as MacroCategory)} style={{ fontSize: 12.5 }}>
                {MACRO_ORDER.map((c: MacroCategory) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>Managed by</span>
              <select className="input" value={managed} onChange={(e) => setManaged(e.target.value as "builder" | "owner")} style={{ fontSize: 12.5 }}>
                <option value="builder">The GC</option>
                <option value="owner">The owner</option>
              </select>
            </label>
          </div>
          {dupe ? <div style={{ fontSize: 11.5, color: "var(--rust)" }}>There is already a trade with that name.</div> : null}
          <div style={{ display: "flex", gap: 7, justifyContent: "flex-end" }}>
            <button className="btn btn-sm" onClick={() => { setOpen(false); setName(""); }}>Cancel</button>
            <button className={`btn btn-sm ${ready ? "btn-primary" : ""}`} disabled={!ready}
              onClick={() => {
                store.addTrade({ name: name.trim(), category: cat, managedBy: managed });
                setName(""); setOpen(false);
              }}>{dupe ? "Name already used" : "Add trade"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function TradeRow({ trade }: { trade: Trade }) {
  const store = useStore();
  const use = tradeUsage(store.db, trade.id);
  const [arm, setArm] = useState(false);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 12.5, flexWrap: "wrap" }}>
      <span style={{ flex: 1, minWidth: 140 }}>{trade.name}</span>
      {trade.managedBy === "owner" ? <Pill bg="var(--cream-2)">Owner managed</Pill> : null}
      {use.total > 0 ? (
        <span title={`Used by ${use.summary}`} style={{ fontSize: 11, color: "var(--muted)" }}>
          in use · {use.summary}
        </span>
      ) : arm ? (
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>Remove it?</span>
          <button className="btn btn-sm" onClick={() => setArm(false)}>No</button>
          <button className="btn btn-sm" style={{ background: "var(--rust)", color: "#fff", fontWeight: 700 }}
            onClick={() => store.removeTrade(trade.id)}>Remove</button>
        </span>
      ) : (
        <button className="btn btn-sm" style={{ color: "var(--rust)" }} onClick={() => setArm(true)}>Remove</button>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)" }}>{label}</span>
      {children}
    </label>
  );
}

function PasswordCard() {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const ready = pw.length >= 8 && pw === pw2 && !busy;

  const change = async () => {
    if (!ready) return;
    setBusy(true); setMsg(null);
    const r = await authUpdatePassword(pw);
    setBusy(false);
    if (r.ok) { setMsg({ ok: true, text: "✓ Password updated." }); setPw(""); setPw2(""); }
    else setMsg({ ok: false, text: r.error ?? "Couldn't update the password." });
  };

  if (!IS_SUPABASE) {
    return (
      <div className="card" style={{ padding: 16, fontSize: 12.5, color: "var(--muted)" }}>
        Password changes apply to real accounts only — this preview runs on demo data without sign-in.
      </div>
    );
  }
  return (
    <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <Field label="New password">
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" placeholder="at least 8 characters" style={{ fontSize: 13.5 }} />
      </Field>
      <Field label="Confirm new password">
        <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" onKeyDown={(e) => e.key === "Enter" && change()} style={{ fontSize: 13.5 }} />
      </Field>
      {pw && pw.length < 8 && <div style={{ fontSize: 11.5, color: "var(--rust)" }}>Use at least 8 characters.</div>}
      {pw2 && pw !== pw2 && <div style={{ fontSize: 11.5, color: "var(--rust)" }}>Passwords don’t match yet.</div>}
      {msg && <div style={{ fontSize: 12.5, color: msg.ok ? "var(--ok)" : "var(--rust)", fontWeight: 600 }}>{msg.text}</div>}
      <div>
        <button className="btn btn-primary btn-sm" disabled={!ready} onClick={change}>{busy ? "Updating…" : "Change password"}</button>
      </div>
    </div>
  );
}

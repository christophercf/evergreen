"use client";

import { useState } from "react";
import { useStore } from "@/lib/data/hooks";
import { LeafIcon } from "./icons";

export function Landing() {
  const store = useStore();
  const [email, setEmail] = useState("");
  const [err, setErr] = useState("");

  const submit = () => {
    setErr("");
    const r = store.login(email);
    if (!r.ok) setErr(r.error ?? "Login failed.");
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "linear-gradient(160deg, #3a2f25 0%, #2c241c 55%, #1c1610 100%)", color: "#e9e1d2" }}>
      {/* hero */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 48, maxWidth: 980, width: "100%", alignItems: "center" }} className="ever-landing">
          {/* left: brand + pitch */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
              <span style={{ color: "var(--brass)" }}><LeafIcon width={34} height={34} /></span>
              <div>
                <div className="serif" style={{ fontSize: 30, fontWeight: 700, color: "#fdf8ee", lineHeight: 1 }}>Evergreen</div>
                <div style={{ fontSize: 12, letterSpacing: ".14em", color: "#b7ab97", marginTop: 4 }}>31810 EVERGREEN RD · EST. 1822</div>
              </div>
            </div>
            <h1 className="serif" style={{ fontSize: 40, lineHeight: 1.1, color: "#fdf8ee", fontWeight: 700, maxWidth: 520 }}>
              One home for your whole renovation.
            </h1>
            <p style={{ fontSize: 16, color: "#cabda7", marginTop: 16, maxWidth: 460, lineHeight: 1.5 }}>
              Scope, schedule, building costs, draws, and trades — owner and builder on the same page, in real time. The spreadsheets, finally retired.
            </p>
            <div style={{ display: "flex", gap: 20, marginTop: 28, flexWrap: "wrap" }}>
              {[["Scope matrix", "room × trade"], ["Live Gantt", "with QC sign-off"], ["Budget → draws", "no surprises"]].map(([a, b]) => (
                <div key={a}>
                  <div className="serif" style={{ fontSize: 16, color: "var(--brass)", fontWeight: 700 }}>{a}</div>
                  <div style={{ fontSize: 12, color: "#9a8e79" }}>{b}</div>
                </div>
              ))}
            </div>
          </div>

          {/* right: auth card */}
          <div style={{ background: "var(--paper)", color: "var(--ink)", borderRadius: 16, padding: 26, boxShadow: "0 20px 50px rgba(0,0,0,.35)" }}>
            <div className="serif" style={{ fontSize: 20, fontWeight: 700, color: "var(--walnut)", marginBottom: 4 }}>Log in</div>
            <p style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 16 }}>Use the email your project admin invited.</p>

            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" onKeyDown={(e) => e.key === "Enter" && submit()} style={{ width: "100%", marginTop: 4 }} />
            </label>

            {err && <div style={{ fontSize: 12.5, color: "var(--rust)", marginTop: 10 }}>{err}</div>}

            <button className="btn btn-primary" style={{ width: "100%", marginTop: 16, justifyContent: "center", padding: "10px" }} onClick={submit}>Log in →</button>

            <div style={{ borderTop: "1px solid var(--line)", margin: "18px 0 12px" }} />
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              <strong>Invited?</strong> Open the invite link your admin sent — it sets up your account automatically.
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
              <strong>Need access?</strong> Ask the project’s Full Admin to invite you. Accounts are invite-only.
            </div>
          </div>
        </div>
      </div>
      <div style={{ textAlign: "center", padding: "14px", fontSize: 11.5, color: "#9a8e79" }}>
        Evergreen · a private renovation workspace. App-level sign-in (Supabase Auth/SSO is the next step).
      </div>
      <style>{`@media (max-width: 760px){ .ever-landing{ grid-template-columns: 1fr !important; gap: 28px !important; } }`}</style>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useStore } from "@/lib/data/hooks";
import { LeafIcon } from "./icons";

export function Landing() {
  const store = useStore();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");

  const demos = store.db.users.filter((u) => ["u-owner", "u-builder", "u-plumb", "u-owner2"].includes(u.id));

  const submit = () => {
    setErr(""); setInfo("");
    if (mode === "login") {
      const r = store.login(email);
      if (!r.ok) setErr(r.error ?? "Login failed.");
    } else {
      const r = store.signup(name, email);
      if (!r.ok) setErr(r.error ?? "Sign-up failed.");
      else setInfo("Welcome! Your account is pending admin approval — you have viewer access for now.");
    }
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
            <div style={{ display: "flex", gap: 6, marginBottom: 18, background: "var(--cream-2)", borderRadius: 10, padding: 4 }}>
              {(["login", "signup"] as const).map((m) => (
                <button key={m} onClick={() => { setMode(m); setErr(""); setInfo(""); }} className="btn"
                  style={{ flex: 1, border: "none", background: mode === m ? "var(--paper)" : "transparent", fontWeight: 700, boxShadow: mode === m ? "0 1px 2px rgba(0,0,0,.1)" : "none" }}>
                  {m === "login" ? "Log in" : "New here"}
                </button>
              ))}
            </div>

            {mode === "signup" && (
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>Full name
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Contractor" style={{ width: "100%", marginTop: 4, marginBottom: 12 }} />
              </label>
            )}
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" onKeyDown={(e) => e.key === "Enter" && submit()} style={{ width: "100%", marginTop: 4 }} />
            </label>

            {err && <div style={{ fontSize: 12.5, color: "var(--rust)", marginTop: 10 }}>{err}</div>}
            {info && <div style={{ fontSize: 12.5, color: "var(--sage-2)", marginTop: 10 }}>{info}</div>}

            <button className="btn btn-primary" style={{ width: "100%", marginTop: 16, justifyContent: "center", padding: "10px" }} onClick={submit}>
              {mode === "login" ? "Log in →" : "Create account →"}
            </button>

            <div style={{ borderTop: "1px solid var(--line)", margin: "18px 0 12px" }} />
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 8 }}>Quick demo sign-in</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {demos.map((u) => (
                <button key={u.id} className="btn btn-sm" onClick={() => store.loginAs(u.id)} style={{ justifyContent: "flex-start" }}>
                  <span style={{ width: 7, height: 7, borderRadius: 99, background: "var(--sage)", flexShrink: 0 }} />
                  <span style={{ textAlign: "left", lineHeight: 1.1 }}>
                    <span style={{ display: "block", fontSize: 12 }}>{u.name.split(" — ")[0]}</span>
                    <span style={{ display: "block", fontSize: 10, color: "var(--muted)" }}>{u.role.replace("_", " ")}</span>
                  </span>
                </button>
              ))}
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

"use client";

import { useState } from "react";
import { useStore } from "@/lib/data/hooks";
import { authEnabled, authSignIn, authSignUp, authResendVerification, authSendReset, authSignOut, authUrlError } from "@/lib/data/auth";
import { LeafIcon } from "./icons";

export function Landing() {
  const store = useStore();
  const realAuth = authEnabled();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [needVerify, setNeedVerify] = useState(false);

  const reset = () => { setErr(""); setInfo(""); setNeedVerify(false); };

  // Password-recovery: user arrived from a reset link. Set a new password.
  const submitReset = async () => {
    reset();
    if (password.length < 8) { setErr("Choose a password of at least 8 characters."); return; }
    if (password !== confirm) { setErr("Passwords don’t match."); return; }
    setBusy(true);
    try {
      const r = await store.completePasswordReset(password);
      if (!r.ok) setErr(r.error ?? "Couldn’t set your password. The reset link may have expired — request a new one.");
      // on success the store binds the session and the app renders automatically
    } finally { setBusy(false); }
  };

  // Mock mode (no Supabase): email-only sign-in.
  const submitMock = () => { reset(); const r = store.login(email); if (!r.ok) setErr(r.error ?? "Login failed."); };

  const submitAuth = async () => {
    reset(); setBusy(true);
    try {
      if (mode === "signup") {
        if (!store.isKnownEmail(email)) { setErr("This email hasn’t been invited. Ask the project’s admin to invite you."); return; }
        if (password.length < 8) { setErr("Choose a password of at least 8 characters."); return; }
        const r = await authSignUp(email, password);
        if (!r.ok) { setErr(r.error ?? "Sign-up failed."); return; }
        setInfo("Account created. Check your email for a verification link, then log in.");
        setMode("login"); setPassword("");
      } else {
        const r = await authSignIn(email, password);
        if (!r.ok) {
          if (/confirm/i.test(r.error ?? "")) { setErr("Please verify your email first."); setNeedVerify(true); }
          else setErr(r.error ?? "Login failed.");
          return;
        }
        const bound = store.bindAuthEmail(r.email ?? email);
        if (!bound) { await authSignOut(); setErr("Signed in, but this email isn’t on the project. Ask the admin to invite you."); }
      }
    } finally { setBusy(false); }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "linear-gradient(160deg, #3a2f25 0%, #2c241c 55%, #1c1610 100%)", color: "#e9e1d2" }}>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 48, maxWidth: 980, width: "100%", alignItems: "center" }} className="ever-landing">
          {/* left: brand + pitch */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
              <span style={{ color: "var(--brass)" }}><LeafIcon width={34} height={34} /></span>
              <div>
                <div className="serif" style={{ fontSize: 30, fontWeight: 700, color: "#fdf8ee", lineHeight: 1 }}>Evergreen <span style={{ color: "var(--brass)" }}>AI</span></div>
                <div style={{ fontSize: 11.5, letterSpacing: ".1em", color: "#b7ab97", marginTop: 4 }}>AI-ASSISTED RENOVATION PROJECT MANAGEMENT</div>
              </div>
            </div>
            <h1 className="serif" style={{ fontSize: 38, lineHeight: 1.12, color: "#fdf8ee", fontWeight: 700, maxWidth: 540 }}>End-to-end renovation management for builders &amp; their clients.</h1>
            <p style={{ fontSize: 16, color: "#cabda7", marginTop: 16, maxWidth: 470, lineHeight: 1.5 }}>Scope, schedule, building costs, draws, and trades — builder and client on the same page, in real time, with AI assistance throughout.</p>
            <div style={{ marginTop: 18, display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(176,138,62,.14)", border: "1px solid rgba(176,138,62,.35)", borderRadius: 999, padding: "5px 12px" }}>
              <span style={{ fontSize: 10.5, letterSpacing: ".08em", color: "#b7ab97" }}>ACTIVE PROJECT</span>
              <span className="serif" style={{ fontSize: 13, color: "#fdf8ee", fontWeight: 700 }}>31810 Evergreen Rd · Est. 1822</span>
            </div>
            <div style={{ display: "flex", gap: 20, marginTop: 28, flexWrap: "wrap" }}>
              {[["Scope matrix", "room × trade"], ["Live Gantt", "with QC sign-off"], ["Budget → draws", "no surprises"]].map(([a, b]) => (
                <div key={a}><div className="serif" style={{ fontSize: 16, color: "var(--brass)", fontWeight: 700 }}>{a}</div><div style={{ fontSize: 12, color: "#9a8e79" }}>{b}</div></div>
              ))}
            </div>
          </div>

          {/* right: auth card */}
          <div style={{ background: "var(--paper)", color: "var(--ink)", borderRadius: 16, padding: 26, boxShadow: "0 20px 50px rgba(0,0,0,.35)" }}>
            {realAuth && store.recoveryPending ? (
              <>
                <div className="serif" style={{ fontSize: 20, fontWeight: 700, color: "var(--walnut)", marginBottom: 4 }}>Set a new password</div>
                <p style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 16 }}>You followed a password-reset link. Choose a new password to finish.</p>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>New password
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="at least 8 characters" style={{ width: "100%", marginTop: 4, marginBottom: 12 }} />
                </label>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>Confirm password
                  <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" onKeyDown={(e) => e.key === "Enter" && submitReset()} style={{ width: "100%", marginTop: 4 }} />
                </label>
                {err && <div style={{ fontSize: 12.5, color: "var(--rust)", marginTop: 10 }}>{err}</div>}
                {info && <div style={{ fontSize: 12.5, color: "var(--sage-2)", marginTop: 10 }}>{info}</div>}
                <button className="btn btn-primary" disabled={busy || !password || !confirm} style={{ width: "100%", marginTop: 16, justifyContent: "center", padding: 10 }} onClick={submitReset}>
                  {busy ? "…" : "Set password →"}
                </button>
              </>
            ) : realAuth && authUrlError() ? (
              <>
                <div className="serif" style={{ fontSize: 20, fontWeight: 700, color: "var(--walnut)", marginBottom: 4 }}>That link didn’t work</div>
                <div style={{ padding: "10px 12px", background: "#f7e6e0", borderRadius: 8, fontSize: 12.5, color: "var(--rust)", marginBottom: 12 }}>
                  ⚠ {authUrlError()}. Reset links are single-use and expire after about an hour — and requesting a new one cancels the older emails.
                </div>
                <p style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 14 }}>Enter your email and we’ll send a fresh link. Click only the <strong>newest</strong> email you receive.</p>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>Email
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" style={{ width: "100%", marginTop: 4 }} />
                </label>
                {info && <div style={{ fontSize: 12.5, color: "var(--sage-2)", marginTop: 10 }}>{info}</div>}
                {err && <div style={{ fontSize: 12.5, color: "var(--rust)", marginTop: 10 }}>{err}</div>}
                <button className="btn btn-primary" disabled={!email} style={{ width: "100%", marginTop: 14, justifyContent: "center", padding: 10 }}
                  onClick={async () => { reset(); await authSendReset(email); setInfo("Fresh reset link sent — check your inbox (and spam)."); }}>
                  Send a fresh reset link →
                </button>
                <button className="btn btn-sm" style={{ width: "100%", marginTop: 8, border: "none", background: "transparent", color: "var(--muted)" }}
                  onClick={() => { try { window.history.replaceState(null, "", window.location.pathname); } catch { /* ignore */ } window.location.reload(); }}>
                  ← Back to log in
                </button>
              </>
            ) : !realAuth ? (
              <>
                <div className="serif" style={{ fontSize: 20, fontWeight: 700, color: "var(--walnut)", marginBottom: 4 }}>Log in</div>
                <p style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 16 }}>Use the email your project admin invited.</p>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>Email
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" onKeyDown={(e) => e.key === "Enter" && submitMock()} style={{ width: "100%", marginTop: 4 }} />
                </label>
                {err && <div style={{ fontSize: 12.5, color: "var(--rust)", marginTop: 10 }}>{err}</div>}
                <button className="btn btn-primary" style={{ width: "100%", marginTop: 16, justifyContent: "center", padding: 10 }} onClick={submitMock}>Log in →</button>
              </>
            ) : (
              <>
                <div style={{ display: "flex", gap: 6, marginBottom: 18, background: "var(--cream-2)", borderRadius: 10, padding: 4 }}>
                  {(["login", "signup"] as const).map((m) => (
                    <button key={m} onClick={() => { setMode(m); reset(); }} className="btn" style={{ flex: 1, border: "none", background: mode === m ? "var(--paper)" : "transparent", fontWeight: 700, boxShadow: mode === m ? "0 1px 2px rgba(0,0,0,.1)" : "none" }}>
                      {m === "login" ? "Log in" : "Set up account"}
                    </button>
                  ))}
                </div>
                {mode === "signup" && <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>Invited? Create your password here — you’ll get a verification email to confirm.</p>}
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>Email
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" style={{ width: "100%", marginTop: 4, marginBottom: 12 }} />
                </label>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>Password
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === "signup" ? "at least 8 characters" : "••••••••"} onKeyDown={(e) => e.key === "Enter" && submitAuth()} style={{ width: "100%", marginTop: 4 }} />
                </label>
                {err && <div style={{ fontSize: 12.5, color: "var(--rust)", marginTop: 10 }}>{err}</div>}
                {info && <div style={{ fontSize: 12.5, color: "var(--sage-2)", marginTop: 10 }}>{info}</div>}
                {needVerify && <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={async () => { await authResendVerification(email); setInfo("Verification email re-sent."); setNeedVerify(false); }}>Resend verification email</button>}
                <button className="btn btn-primary" disabled={busy || !email || !password} style={{ width: "100%", marginTop: 16, justifyContent: "center", padding: 10 }} onClick={submitAuth}>
                  {busy ? "…" : mode === "login" ? "Log in →" : "Create account →"}
                </button>
                {mode === "login" && <button className="btn btn-sm" style={{ width: "100%", marginTop: 8, border: "none", background: "transparent", color: "var(--muted)" }} onClick={async () => { if (!email) { setErr("Enter your email first."); return; } await authSendReset(email); setInfo("Password reset link sent."); }}>Forgot password?</button>}
                <div style={{ borderTop: "1px solid var(--line)", margin: "16px 0 10px" }} />
                <div style={{ fontSize: 12, color: "var(--muted)" }}><strong>Need access?</strong> Accounts are invite-only — ask the project’s Full Admin to invite your email.</div>
              </>
            )}
          </div>
        </div>
      </div>
      <div style={{ textAlign: "center", padding: 14, fontSize: 11.5, color: "#9a8e79" }}>Evergreen AI · end-to-end renovation project management. Secured by Supabase Auth.</div>
      <style>{`@media (max-width: 760px){ .ever-landing{ grid-template-columns: 1fr !important; gap: 28px !important; } }`}</style>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useStore } from "@/lib/data/hooks";
import {
  authEnabled, authSignIn, authSignUp, authResendVerification, authSendReset, authSignOut,
  authUrlError, checkAccount, loginErrorHelp, type AccountState,
} from "@/lib/data/auth";
import { LeafIcon } from "./icons";

// ---------------------------------------------------------------------------
// Sign-in is EMAIL-FIRST: the person types their address, the app looks up what
// state that account is really in, and shows the one action that will work.
// This kills the old trap where an invited-but-never-activated user could
// neither "Log in" (no password yet) nor "Set up account" (already registered).
// ---------------------------------------------------------------------------

type Step = "email" | "password" | "setup" | "create" | "sent";

export function Landing() {
  const store = useStore();
  const realAuth = authEnabled();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [needVerify, setNeedVerify] = useState(false);
  const [who, setWho] = useState<string | undefined>();

  const reset = () => { setErr(""); setInfo(""); setNeedVerify(false); };
  const backToEmail = () => { reset(); setPassword(""); setConfirm(""); setStep("email"); };

  // Password-recovery: user arrived from a reset / set-up link.
  const submitReset = async () => {
    reset();
    if (password.length < 8) { setErr("Choose a password of at least 8 characters."); return; }
    if (password !== confirm) { setErr("Passwords don't match."); return; }
    setBusy(true);
    try {
      const r = await store.completePasswordReset(password);
      if (!r.ok) setErr(r.error ?? "Couldn't set your password. The link may have expired — request a new one.");
    } finally { setBusy(false); }
  };

  // Mock mode (no Supabase): email-only sign-in.
  const submitMock = () => { reset(); const r = store.login(email); if (!r.ok) setErr(r.error ?? "Login failed."); };

  // Step 1 — look up what this email needs.
  const continueEmail = async () => {
    reset();
    if (!email.includes("@")) { setErr("Enter a valid email address."); return; }
    setBusy(true);
    try {
      const a = await checkAccount(email);
      setWho(a.name);
      const s: AccountState = a.state;
      if (s === "not_invited") {
        setErr("That email isn't on this project yet. Ask the project admin to invite you — access is invite-only.");
        return;
      }
      if (s === "needs_setup") { setStep(a.authExists ? "setup" : "create"); return; }
      setStep("password");
    } finally { setBusy(false); }
  };

  const submitPassword = async () => {
    reset(); setBusy(true);
    try {
      const r = await authSignIn(email, password);
      if (!r.ok) {
        setErr(loginErrorHelp(r.error ?? "Login failed."));
        if (/confirm/i.test(r.error ?? "")) setNeedVerify(true);
        return;
      }
      const bound = store.bindAuthEmail(r.email ?? email);
      if (!bound) { await authSignOut(); setErr("Signed in, but this email isn't on the project. Ask the admin to invite you."); }
    } finally { setBusy(false); }
  };

  // Create a password for someone who has no auth account yet.
  const submitCreate = async () => {
    reset();
    if (password.length < 8) { setErr("Choose a password of at least 8 characters."); return; }
    if (password !== confirm) { setErr("Passwords don't match."); return; }
    setBusy(true);
    try {
      const r = await authSignUp(email, password);
      if (!r.ok) {
        // Already registered → the set-up-link path is the one that works.
        if (/already registered|already exists/i.test(r.error ?? "")) { setStep("setup"); setErr(""); return; }
        setErr(r.error ?? "Sign-up failed.");
        return;
      }
      if (r.needsVerify) { setInfo("Account created. Check your email for the verification link, then come back and log in."); setStep("sent"); }
      else { const bound = store.bindAuthEmail(email); if (!bound) setErr("Account created, but this email isn't on the project."); }
    } finally { setBusy(false); }
  };

  // Email a set-up / reset link (the only flow that works for a half-finished account).
  const sendSetupLink = async () => {
    reset(); setBusy(true);
    try {
      const r = await authSendReset(email);
      if (!r.ok) { setErr(r.error ?? "Couldn't send the email."); return; }
      setInfo("Link sent — check your inbox (and spam). It's single-use and expires in about an hour, so click the newest one.");
      setStep("sent");
    } finally { setBusy(false); }
  };

  const L = { fontSize: 12, fontWeight: 600, color: "var(--muted)" } as const;
  const emailRow = (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, background: "var(--cream-2)", borderRadius: 8, padding: "7px 10px" }}>
      <span style={{ fontSize: 12.5, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {who ? <strong>{who}</strong> : null} <span style={{ color: "var(--muted)" }}>{email}</span>
      </span>
      <button className="btn btn-sm" onClick={backToEmail} style={{ flexShrink: 0 }}>Change</button>
    </div>
  );

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
            <p style={{ fontSize: 16, color: "#cabda7", marginTop: 16, maxWidth: 470, lineHeight: 1.5 }}>Scope, schedule, project budget, draws, and trades — builder and client on the same page, in real time, with AI assistance throughout.</p>
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
                <div className="serif" style={{ fontSize: 20, fontWeight: 700, color: "var(--walnut)", marginBottom: 4 }}>Set your password</div>
                <p style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 16 }}>You followed a set-up link. Choose a password to finish — you&apos;ll use it to log in from now on.</p>
                <label style={L}>New password
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="at least 8 characters" autoComplete="new-password" style={{ width: "100%", marginTop: 4, marginBottom: 12 }} />
                </label>
                <label style={L}>Confirm password
                  <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" autoComplete="new-password" onKeyDown={(e) => e.key === "Enter" && submitReset()} style={{ width: "100%", marginTop: 4 }} />
                </label>
                {err && <Msg tone="err">{err}</Msg>}
                <button className="btn btn-primary" disabled={busy || !password || !confirm} style={btn} onClick={submitReset}>{busy ? "…" : "Set password →"}</button>
              </>
            ) : realAuth && authUrlError() ? (
              <>
                <div className="serif" style={{ fontSize: 20, fontWeight: 700, color: "var(--walnut)", marginBottom: 4 }}>That link didn&apos;t work</div>
                <div style={{ padding: "10px 12px", background: "#f7e6e0", borderRadius: 8, fontSize: 12.5, color: "var(--rust)", marginBottom: 12 }}>
                  ⚠ {authUrlError()}. Set-up links are single-use and expire after about an hour — and requesting a new one cancels the older emails.
                </div>
                <p style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 14 }}>Enter your email and we&apos;ll send a fresh link. Click only the <strong>newest</strong> email you receive.</p>
                <label style={L}>Email
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="username" style={{ width: "100%", marginTop: 4 }} />
                </label>
                {info && <Msg tone="ok">{info}</Msg>}
                {err && <Msg tone="err">{err}</Msg>}
                <button className="btn btn-primary" disabled={!email || busy} style={btn} onClick={sendSetupLink}>Send a fresh link →</button>
                <button className="btn btn-sm" style={ghost} onClick={() => { try { window.history.replaceState(null, "", window.location.pathname); } catch { /* ignore */ } window.location.reload(); }}>← Back to log in</button>
              </>
            ) : !realAuth ? (
              <>
                <div className="serif" style={{ fontSize: 20, fontWeight: 700, color: "var(--walnut)", marginBottom: 4 }}>Log in</div>
                <p style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 16 }}>Use the email your project admin invited.</p>
                <label style={L}>Email
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" onKeyDown={(e) => e.key === "Enter" && submitMock()} style={{ width: "100%", marginTop: 4 }} />
                </label>
                {err && <Msg tone="err">{err}</Msg>}
                <button className="btn btn-primary" style={btn} onClick={submitMock}>Log in →</button>
              </>
            ) : step === "email" ? (
              <>
                <div className="serif" style={{ fontSize: 20, fontWeight: 700, color: "var(--walnut)", marginBottom: 4 }}>Log in</div>
                <p style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 16 }}>Enter your email — we&apos;ll take it from there, whether you&apos;re new or coming back.</p>
                <label style={L}>Email
                  <input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="username"
                    onKeyDown={(e) => e.key === "Enter" && continueEmail()} style={{ width: "100%", marginTop: 4 }} />
                </label>
                {err && <Msg tone="err">{err}</Msg>}
                <button className="btn btn-primary" disabled={busy || !email} style={btn} onClick={continueEmail}>{busy ? "Checking…" : "Continue →"}</button>
                <div style={{ borderTop: "1px solid var(--line)", margin: "16px 0 10px" }} />
                <div style={{ fontSize: 12, color: "var(--muted)" }}><strong>Need access?</strong> Accounts are invite-only — ask the project&apos;s admin to invite your email.</div>
              </>
            ) : step === "password" ? (
              <>
                <div className="serif" style={{ fontSize: 20, fontWeight: 700, color: "var(--walnut)", marginBottom: 4 }}>Welcome back{who ? `, ${who.split(" ")[0]}` : ""}</div>
                <p style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 14 }}>Enter your password to continue.</p>
                {emailRow}
                <label style={L}>Password
                  <input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password"
                    onKeyDown={(e) => e.key === "Enter" && submitPassword()} style={{ width: "100%", marginTop: 4 }} />
                </label>
                {err && <Msg tone="err">{err}</Msg>}
                {info && <Msg tone="ok">{info}</Msg>}
                {needVerify && <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={async () => { const r = await authResendVerification(email); setInfo(r.ok ? "Verification email re-sent." : ""); setErr(r.ok ? "" : r.error ?? ""); setNeedVerify(false); }}>Resend verification email</button>}
                <button className="btn btn-primary" disabled={busy || !password} style={btn} onClick={submitPassword}>{busy ? "…" : "Log in →"}</button>
                <button className="btn btn-sm" style={ghost} disabled={busy} onClick={sendSetupLink}>Forgot password — email me a set-up link</button>
              </>
            ) : step === "setup" ? (
              <>
                <div className="serif" style={{ fontSize: 20, fontWeight: 700, color: "var(--walnut)", marginBottom: 4 }}>Finish setting up</div>
                <p style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 14 }}>
                  You&apos;re on the project{who ? ` as ${who}` : ""}, but this account doesn&apos;t have a password yet. We&apos;ll email you a link to set one — that&apos;s all it takes.
                </p>
                {emailRow}
                {err && <Msg tone="err">{err}</Msg>}
                {info && <Msg tone="ok">{info}</Msg>}
                <button className="btn btn-primary" disabled={busy} style={btn} onClick={sendSetupLink}>{busy ? "Sending…" : "Email me a set-up link →"}</button>
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 10, lineHeight: 1.45 }}>
                  Not arriving? Check spam, then ask your project admin — they can send you a direct link that bypasses email entirely.
                </div>
              </>
            ) : step === "create" ? (
              <>
                <div className="serif" style={{ fontSize: 20, fontWeight: 700, color: "var(--walnut)", marginBottom: 4 }}>Create your password</div>
                <p style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 14 }}>You&apos;re invited{who ? ` as ${who}` : ""} — pick a password and you&apos;re in.</p>
                {emailRow}
                <label style={L}>Password
                  <input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="at least 8 characters" autoComplete="new-password" style={{ width: "100%", marginTop: 4, marginBottom: 12 }} />
                </label>
                <label style={L}>Confirm password
                  <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" autoComplete="new-password" onKeyDown={(e) => e.key === "Enter" && submitCreate()} style={{ width: "100%", marginTop: 4 }} />
                </label>
                {err && <Msg tone="err">{err}</Msg>}
                {info && <Msg tone="ok">{info}</Msg>}
                <button className="btn btn-primary" disabled={busy || !password || !confirm} style={btn} onClick={submitCreate}>{busy ? "…" : "Create account →"}</button>
                <button className="btn btn-sm" style={ghost} disabled={busy} onClick={sendSetupLink}>Email me a set-up link instead</button>
              </>
            ) : (
              <>
                <div className="serif" style={{ fontSize: 20, fontWeight: 700, color: "var(--walnut)", marginBottom: 4 }}>Check your email</div>
                {info && <Msg tone="ok">{info}</Msg>}
                {err && <Msg tone="err">{err}</Msg>}
                <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "12px 0" }}>Open the link on <strong>this device</strong> if you can — it signs you straight in.</p>
                {emailRow}
                <button className="btn btn-sm" style={{ ...ghost, marginTop: 0 }} disabled={busy} onClick={sendSetupLink}>{busy ? "Sending…" : "Send it again"}</button>
                <button className="btn btn-sm" style={ghost} onClick={backToEmail}>← Back to log in</button>
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

const btn: React.CSSProperties = { width: "100%", marginTop: 16, justifyContent: "center", padding: 10 };
const ghost: React.CSSProperties = { width: "100%", marginTop: 8, border: "none", background: "transparent", color: "var(--muted)" };

function Msg({ tone, children }: { tone: "err" | "ok"; children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12.5, marginTop: 10, lineHeight: 1.45, color: tone === "err" ? "var(--rust)" : "var(--sage-2)" }}>{children}</div>
  );
}

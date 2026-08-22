"use client";

import { useState } from "react";
import { useStore } from "@/lib/data/hooks";
import {
  authEnabled, authSignIn, authSignUp, authResendVerification, authSendReset, authSignOut,
  authUrlError, checkAccount, loginErrorHelp, authSendCode, authVerifyCode, type AccountState,
} from "@/lib/data/auth";
import { LeafIcon } from "./icons";

// ---------------------------------------------------------------------------
// Sign-in is EMAIL-FIRST: the person types their address, the app looks up what
// state that account is really in, and shows the one action that will work.
// This kills the old trap where an invited-but-never-activated user could
// neither "Log in" (no password yet) nor "Set up account" (already registered).
// ---------------------------------------------------------------------------

type Step = "email" | "password" | "setup" | "create" | "sent" | "code";

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
  const [code, setCode] = useState("");
  // The account check could not run. We do not know what this person needs, so
  // the screen stops pretending it does.
  const [degraded, setDegraded] = useState(false);
  // Typing a password blind on a phone is a leading cause of "it won't let me
  // in". One control, and the guessing stops.
  const [showPw, setShowPw] = useState(false);

  const reset = () => { setErr(""); setInfo(""); setNeedVerify(false); };
  const backToEmail = () => { reset(); setPassword(""); setConfirm(""); setCode(""); setStep("email"); };

  // Passwordless: email a one-time code, then verify it. Nothing to remember,
  // and it activates an invited account that never finished setting up.
  const sendCode = async () => {
    reset(); setBusy(true);
    try {
      const r = await authSendCode(email);
      if (!r.ok) { setErr(r.error ?? "Couldn't send the code."); return; }
      setInfo("Sent. Check your email for a 6-digit code — or just click the link in it.");
      setCode(""); setStep("code");
    } finally { setBusy(false); }
  };
  const submitCode = async () => {
    reset();
    const clean = code.replace(/\D/g, "");
    if (clean.length < 6) { setErr("Enter the 6-digit code from your email."); return; }
    setBusy(true);
    try {
      const r = await authVerifyCode(email, clean);
      if (!r.ok) { setErr(r.error ?? "That code didn't work."); return; }
      const bound = store.bindAuthEmail(r.email ?? email);
      if (!bound) { await authSignOut(); setErr("Signed in, but this email isn't on the project. Ask the admin to invite you."); }
    } finally { setBusy(false); }
  };

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

  // Mock mode (no Supabase): email-only sign-in — no email is ever sent, the
  // address is just looked up in the sample data.
  const submitMock = () => { reset(); const r = store.login(email); if (!r.ok) setErr(r.error ?? "Login failed."); };
  // The demo's front door: one click, no typing, no email. Signs in as the
  // reviewer (full admin), from which the persona switcher reaches every role.
  const enterDemo = () => { reset(); const r = store.login("reviewer@evergreen.demo"); if (!r.ok) setErr(r.error ?? "Couldn't open the demo."); };

  // Step 1 — look up what this email needs.
  const continueEmail = async () => {
    reset();
    if (!email.includes("@")) { setErr("Enter a valid email address."); return; }
    setBusy(true);
    try {
      const a = await checkAccount(email);
      setWho(a.name);
      setDegraded(!!a.degraded);
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
                  <PwInput value={password} onChange={setPassword} show={showPw} onToggle={() => setShowPw((v) => !v)}
                    autoComplete="new-password" placeholder="at least 8 characters" />
                </label>
                <div style={{ height: 12 }} />
                <label style={L}>Confirm password
                  <PwInput value={confirm} onChange={setConfirm} show={showPw} onToggle={() => setShowPw((v) => !v)}
                    autoComplete="new-password" placeholder="type it again" onEnter={submitReset} />
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
                <div className="serif" style={{ fontSize: 20, fontWeight: 700, color: "var(--walnut)", marginBottom: 4 }}>Explore the demo</div>
                <p style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 16 }}>Sample data, every screen. No sign-up, no email — nothing here touches a real project.</p>
                {err && <Msg tone="err">{err}</Msg>}
                <button className="btn btn-primary" style={btn} onClick={enterDemo}>Enter the demo →</button>
                <div style={{ borderTop: "1px solid var(--line)", margin: "18px 0 12px" }} />
                <label style={{ ...L, fontSize: 12, color: "var(--muted)" }}>Or sign in as a specific person
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" onKeyDown={(e) => e.key === "Enter" && submitMock()} style={{ width: "100%", marginTop: 4 }} />
                </label>
                <button className="btn btn-sm" style={ghost} onClick={submitMock}>Sign in as this person →</button>
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
                <p style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 14 }}>
                  {degraded
                    ? "We couldn't check your account just now, so here are all the ways in. Any of them works."
                    : "Enter your password to continue."}
                </p>
                {emailRow}
                <label style={L}>Password
                  <PwInput value={password} onChange={setPassword} show={showPw} onToggle={() => setShowPw((v) => !v)}
                    autoFocus autoComplete="current-password" placeholder="••••••••" onEnter={submitPassword} />
                </label>
                {err && <Msg tone="err">{err}</Msg>}
                {info && <Msg tone="ok">{info}</Msg>}
                {needVerify && <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={async () => { const r = await authResendVerification(email); setInfo(r.ok ? "Verification email re-sent." : ""); setErr(r.ok ? "" : r.error ?? ""); setNeedVerify(false); }}>Resend verification email</button>}
                <button className="btn btn-primary" disabled={busy || !password} style={btn} onClick={submitPassword}>{busy ? "…" : "Log in →"}</button>
                <button className="btn btn-sm" style={ghost} disabled={busy} onClick={sendCode}>Email me a 6-digit code instead</button>
                <button className="btn btn-sm" style={{ ...ghost, marginTop: 2 }} disabled={busy} onClick={sendSetupLink}>Forgot password — email me a reset link</button>
              </>
            ) : step === "setup" ? (
              <>
                <div className="serif" style={{ fontSize: 20, fontWeight: 700, color: "var(--walnut)", marginBottom: 4 }}>Finish setting up</div>
                <p style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 14 }}>
                  You&apos;re on the project{who ? ` as ${who}` : ""}, but this account doesn&apos;t have a password yet. Easiest way in: we email you a 6-digit code — no password to create or remember.
                </p>
                {emailRow}
                {err && <Msg tone="err">{err}</Msg>}
                {info && <Msg tone="ok">{info}</Msg>}
                <button className="btn btn-primary" disabled={busy} style={btn} onClick={sendCode}>{busy ? "Sending…" : "Email me a 6-digit code →"}</button>
                <button className="btn btn-sm" style={ghost} disabled={busy} onClick={sendSetupLink}>I&apos;d rather set a password</button>
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 10, lineHeight: 1.45 }}>
                  Not arriving? Check spam, then ask your project admin — they can send you a direct link that bypasses email entirely.
                </div>
              </>
            ) : step === "code" ? (
              <>
                <div className="serif" style={{ fontSize: 20, fontWeight: 700, color: "var(--walnut)", marginBottom: 4 }}>Enter your code</div>
                <p style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 14 }}>We emailed a 6-digit code. Type it below — or just click the link in that email and you&apos;re in.</p>
                {emailRow}
                <input inputMode="numeric" autoComplete="one-time-code" autoFocus value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  onKeyDown={(e) => e.key === "Enter" && submitCode()}
                  placeholder="123456"
                  style={{ width: "100%", fontSize: 26, letterSpacing: ".35em", textAlign: "center", padding: "10px 12px", fontFamily: "var(--font-serif)" }} />
                {err && <Msg tone="err">{err}</Msg>}
                {info && <Msg tone="ok">{info}</Msg>}
                <button className="btn btn-primary" disabled={busy || code.length < 6} style={btn} onClick={submitCode}>{busy ? "…" : "Log in →"}</button>
                <button className="btn btn-sm" style={ghost} disabled={busy} onClick={sendCode}>Send a new code</button>
                <button className="btn btn-sm" style={{ ...ghost, marginTop: 2 }} onClick={backToEmail}>← Back</button>
              </>
            ) : step === "create" ? (
              <>
                <div className="serif" style={{ fontSize: 20, fontWeight: 700, color: "var(--walnut)", marginBottom: 4 }}>Create your password</div>
                <p style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 14 }}>You&apos;re invited{who ? ` as ${who}` : ""} — pick a password and you&apos;re in.</p>
                {emailRow}
                <label style={L}>Password
                  <PwInput value={password} onChange={setPassword} show={showPw} onToggle={() => setShowPw((v) => !v)}
                    autoFocus autoComplete="new-password" placeholder="at least 8 characters" />
                </label>
                <div style={{ height: 12 }} />
                <label style={L}>Confirm password
                  <PwInput value={confirm} onChange={setConfirm} show={showPw} onToggle={() => setShowPw((v) => !v)}
                    autoComplete="new-password" placeholder="type it again" onEnter={submitCreate} />
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
      <div style={{ textAlign: "center", padding: 14, fontSize: 11.5, color: "#9a8e79" }}>Evergreen AI · end-to-end renovation project management.{realAuth ? " Secured by Supabase Auth." : " Demo — sample data, saved in this browser."}</div>
      {/* On a phone the form comes first. Everyone who reaches this screen is
          one of five people signing in again, not a visitor being pitched. */}
      <style>{`@media (max-width: 760px){
        .ever-landing{ grid-template-columns: 1fr !important; gap: 28px !important; }
        .ever-landing > :first-child{ order: 2; }
        .ever-landing > :last-child{ order: 1; }
      }`}</style>
    </div>
  );
}

const btn: React.CSSProperties = { width: "100%", marginTop: 16, justifyContent: "center", padding: 10 };
const ghost: React.CSSProperties = { width: "100%", marginTop: 8, border: "none", background: "transparent", color: "var(--muted)" };

/** A password field you can read back. Same field, one toggle — the reveal is
 *  never on by default, and it never survives to another screen. */
function PwInput({ value, onChange, show, onToggle, onEnter, autoFocus, autoComplete, placeholder }: {
  value: string; onChange: (v: string) => void; show: boolean; onToggle: () => void;
  onEnter?: () => void; autoFocus?: boolean; autoComplete?: string; placeholder?: string;
}) {
  return (
    <div style={{ position: "relative", marginTop: 4 }}>
      <input
        type={show ? "text" : "password"}
        value={value}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && onEnter) onEnter(); }}
        style={{ width: "100%", paddingRight: 62 }}
      />
      <button
        type="button"
        onClick={onToggle}
        aria-label={show ? "Hide password" : "Show password"}
        style={{
          position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
          border: "none", background: "transparent", color: "var(--muted)",
          fontSize: 11.5, fontWeight: 700, cursor: "pointer", padding: "6px 8px",
        }}
      >{show ? "Hide" : "Show"}</button>
    </div>
  );
}

function Msg({ tone, children }: { tone: "err" | "ok"; children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12.5, marginTop: 10, lineHeight: 1.45, color: tone === "err" ? "var(--rust)" : "var(--sage-2)" }}>{children}</div>
  );
}

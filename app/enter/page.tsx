"use client";

import { useEffect, useState } from "react";
import { LeafIcon } from "../ui/icons";

// ---------------------------------------------------------------------------
// Where a hand-over sign-in link lands.
//
// The whole point is that this page cannot be a dead end. A link that has
// expired, been superseded, or belongs to someone no longer on the project has
// to say so AND offer the way forward, because the person holding it has no
// other support to call on.
// ---------------------------------------------------------------------------

type State =
  | { k: "checking" }
  | { k: "ready"; email: string; name: string | null; purpose: "signin" | "password"; expiresIn: string }
  | { k: "working" }
  | { k: "bad"; message: string; email?: string };

export default function EnterPage() {
  const [s, setS] = useState<State>({ k: "checking" });
  const [token, setToken] = useState("");

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t") ?? "";
    setToken(t);
    if (!t) { setS({ k: "bad", message: "This link is missing its code. Ask for a fresh one, or sign in with your email below." }); return; }
    void (async () => {
      try {
        const r = await fetch("/api/signin-redeem", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: t, mode: "check" }),
        });
        const j = await r.json();
        if (!j?.ok) { setS({ k: "bad", message: j?.error ?? "That link didn't work." }); return; }
        setS({ k: "ready", email: j.email, name: j.name ?? null, purpose: j.purpose, expiresIn: j.expiresIn });
      } catch {
        setS({ k: "bad", message: "Couldn't reach the server. Check your signal and try the link again." });
      }
    })();
  }, []);

  const go = async (purpose: "signin" | "password") => {
    setS({ k: "working" });
    try {
      const r = await fetch("/api/signin-redeem", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, mode: "redeem", purpose, origin: window.location.origin }),
      });
      const j = await r.json();
      if (!j?.ok || !j.action) { setS({ k: "bad", message: j?.error ?? "Couldn't sign you in just now." }); return; }
      // Straight through to Supabase, which sets the session and returns to the app.
      window.location.href = j.action;
    } catch {
      setS({ k: "bad", message: "Couldn't reach the server. Try the link again in a moment." });
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "32px 18px",
      background: "linear-gradient(160deg, #3a2f25 0%, #2c241c 55%, #1c1610 100%)", color: "#e9e1d2" }}>
      <div style={{ width: "100%", maxWidth: 440 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <span style={{ color: "var(--brass)" }}><LeafIcon width={28} height={28} /></span>
          <div>
            <div className="serif" style={{ fontSize: 22, fontWeight: 700, color: "#fdf8ee", lineHeight: 1 }}>Evergreen <span style={{ color: "var(--brass)" }}>AI</span></div>
            <div style={{ fontSize: 10.5, letterSpacing: ".09em", color: "#b7ab97", marginTop: 3 }}>31810 EVERGREEN RD</div>
          </div>
        </div>

        <div className="card" style={{ padding: 22 }}>
          {s.k === "checking" ? (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>Checking your link…</div>
          ) : s.k === "working" ? (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>Signing you in…</div>
          ) : s.k === "ready" ? (
            <>
              <div className="serif" style={{ fontSize: 21, fontWeight: 700, color: "var(--walnut)" }}>
                Welcome{s.name ? `, ${s.name.split(" ")[0]}` : ""}
              </div>
              <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "8px 0 4px", lineHeight: 1.55 }}>
                This link signs you in as <strong style={{ color: "var(--ink)" }}>{s.email}</strong>. No password needed.
              </p>
              <p style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 16 }}>
                It works for another {s.expiresIn}, as many times as you need.
              </p>

              <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} onClick={() => go("signin")}>
                Sign me in →
              </button>

              {/* The reason this exists: someone who cannot remember a password
                  should not need a second link from the admin to fix that. */}
              <div style={{ borderTop: "1px solid var(--line)", margin: "16px 0 12px" }} />
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--walnut)", marginBottom: 4 }}>Want a password too?</div>
              <p style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 10, lineHeight: 1.5 }}>
                Set one and you can sign in normally from any device, without waiting for a link.
              </p>
              <button className="btn" style={{ width: "100%", justifyContent: "center" }} onClick={() => go("password")}>
                Set a password instead
              </button>
            </>
          ) : (
            <>
              <div className="serif" style={{ fontSize: 21, fontWeight: 700, color: "var(--walnut)" }}>That link didn&rsquo;t work</div>
              <div style={{ padding: "10px 12px", background: "#f7e6e0", borderRadius: 8, fontSize: 12.5, color: "var(--rust)", margin: "10px 0 14px", lineHeight: 1.5 }}>
                {s.message}
              </div>
              {/* Never a dead end: the ordinary login screen can send a code or a
                  reset without anyone's help. */}
              <p style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 12, lineHeight: 1.55 }}>
                You can still get in on your own. The login screen will email you a code, or a fresh
                link — you do not need a new one from anyone.
              </p>
              <a className="btn btn-primary" href="/" style={{ width: "100%", justifyContent: "center", textDecoration: "none" }}>
                Go to the login screen →
              </a>
            </>
          )}
        </div>

        <div style={{ fontSize: 11, color: "#9a8e79", marginTop: 14, lineHeight: 1.5, textAlign: "center" }}>
          Evergreen AI · if none of this works, reply to the message that sent you here.
        </div>
      </div>
    </div>
  );
}

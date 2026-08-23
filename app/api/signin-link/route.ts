import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { signToken, SEVEN_DAYS_MS } from "@/lib/data/signin-token";

// Mint a seven-day hand-over link for a project member.
//
// The admin sends this by text/WhatsApp. It is not a Supabase link — it is
// ours, and redeeming it mints a fresh Supabase one at that moment (see
// /api/signin-redeem). That is what lets it last a week without weakening the
// expiry on password resets and one-time codes.
//
// Callers must be a signed-in project admin/builder/owner, verified against
// project_state — the same gate /api/invite uses.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Deliberately plain: one button, one sentence about how long it lasts, and
 *  no talk of expiry panic — the point of this link is that there is none. */
function renderLinkEmail(o: { first: string; link: string; sentBy: string }) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4efe3;font-family:Georgia,'Times New Roman',serif;">
  <div style="max-width:560px;margin:0 auto;padding:28px 16px;">
    <div style="font-size:13px;letter-spacing:.08em;color:#b08a3e;font-weight:bold;margin-bottom:10px;">EVERGREEN <span style="color:#3a2f25;">AI</span> · 31810 Evergreen</div>
    <div style="background:#fdf8ee;border:1px solid #ddd2bd;border-radius:12px;padding:22px;">
      <div style="font-size:19px;font-weight:bold;color:#3a2f25;margin-bottom:12px;">${o.first ? `${esc(o.first)}, here's your way in` : "Here's your way in"}</div>
      <div style="font-size:14px;line-height:1.6;color:#2c241c;">${esc(o.sentBy)} sent you a sign-in link. No password needed \u2014 tap the button and you're in.</div>
      <div style="margin-top:22px;">
        <a href="${o.link}" style="display:inline-block;background:#6b7f5b;color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;padding:12px 26px;border-radius:99px;">Sign in to Evergreen</a>
      </div>
      <div style="font-size:13px;line-height:1.6;color:#2c241c;margin-top:18px;">
        This link works for <strong>7 days</strong>, as many times as you need. When you open it you can sign
        straight in \u2014 or set a password, so you never need a link again.
      </div>
      <div style="font-size:12px;color:#7a6f60;margin-top:18px;word-break:break-all;">If the button doesn't work, paste this into your browser:<br>${esc(o.link)}</div>
    </div>
    <div style="font-size:11px;color:#9a8e79;margin-top:14px;line-height:1.5;">Evergreen AI \u00b7 end-to-end renovation project management for 31810 Evergreen Rd.</div>
  </div>
</body></html>`;
}

export async function POST(req: Request) {
  let body: { email?: string; purpose?: "signin" | "password"; origin?: string; deliver?: "copy" | "email" } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const email = body.email?.trim().toLowerCase();
  const purpose = body.purpose === "password" ? "password" : "signin";
  const deliver = body.deliver === "email" ? "email" : "copy";
  if (!email || !email.includes("@")) return NextResponse.json({ ok: false, error: "Email required." }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) return NextResponse.json({ ok: false, error: "Auth isn't configured on the server." }, { status: 500 });

  const admin = createClient(url, svc, { auth: { persistSession: false, autoRefreshToken: false } });

  // 1) Who is asking?
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 401 });
  const { data: caller, error: callerErr } = await admin.auth.getUser(token);
  if (callerErr || !caller?.user?.email) return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 401 });

  // 2) Are they allowed to hand out access, and is the target on the project?
  try {
    const res = await fetch(`${url}/rest/v1/project_state?id=eq.evergreen&select=db`, {
      headers: { apikey: svc, Authorization: `Bearer ${svc}` }, cache: "no-store",
    });
    const rows = await res.json();
    const users = (rows?.[0]?.db?.users ?? []) as { email: string; name?: string; role: string; disabled?: boolean }[];
    const me = users.find((u) => u.email?.trim().toLowerCase() === caller.user.email!.toLowerCase()) as
      { email: string; name?: string; role: string; disabled?: boolean } | undefined;
    if (!me || me.disabled || !["full_admin", "builder", "owner"].includes(me.role)) {
      return NextResponse.json({ ok: false, error: "Only project admins can hand out sign-in links." }, { status: 403 });
    }
    const target = users.find((u) => u.email?.trim().toLowerCase() === email);
    if (!target) return NextResponse.json({ ok: false, error: "That email isn't on the project — add them to the team first." }, { status: 400 });
    if (target.disabled) return NextResponse.json({ ok: false, error: "That account is suspended. Restore it before sending a link." }, { status: 400 });

    const t = signToken(email, purpose, SEVEN_DAYS_MS);
    if (!t) return NextResponse.json({ ok: false, error: "Link signing isn't configured on the server." }, { status: 500 });

    const origin = body.origin || `https://${req.headers.get("host") ?? "app.evergreenreno.net"}`;
    const link = `${origin}/enter?t=${encodeURIComponent(t)}`;

    let emailed = false;
    let emailError: string | null = null;
    if (deliver === "email") {
      const key = process.env.RESEND_API_KEY;
      if (!key) {
        emailError = "Email isn't configured on the server — copy the link and send it yourself.";
      } else {
        const first = (target.name ?? "").split(" ")[0];
        const from = process.env.EMAIL_FROM_AUTH || "Evergreen AI <no-reply@evergreenreno.net>";
        const sentBy = me.name ?? "your project admin";
        try {
          const r = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from, to: [target.email],
              subject: "Your Evergreen sign-in link (good for 7 days)",
              text: [
                `${first ? first + "," : "Hello,"}`,
                "",
                `${sentBy} sent you a way back into Evergreen. No password needed:`,
                "",
                link,
                "",
                "This link works for 7 days, as many times as you need. When you open it you can",
                "sign straight in, or set a password so you never need a link again.",
              ].join("\n"),
              html: renderLinkEmail({ first, link, sentBy }),
            }),
          });
          if (r.ok) emailed = true;
          else {
            const j = await r.json().catch(() => ({}));
            emailError = j?.message ?? `The mail service returned ${r.status}.`;
          }
        } catch {
          emailError = "Couldn't reach the mail service — copy the link and send it yourself.";
        }
      }
    }

    return NextResponse.json({
      ok: true,
      link,
      emailed,
      emailError,
      sentTo: emailed ? target.email : null,
      expiresAt: new Date(Date.now() + SEVEN_DAYS_MS).toISOString(),
      name: target.name ?? null,
      purpose,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Couldn't verify permissions." }, { status: 502 });
  }
}

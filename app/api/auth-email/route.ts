import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";

// Supabase "Send Email" auth hook.
//
// Instead of Supabase posting auth mail through an SMTP server, it calls this
// endpoint and we send through Resend's HTTP API — the same path the Messenger
// already uses successfully. That takes the SMTP credential form out of the
// loop entirely (it blanks its password field on every page load, which is how
// it kept silently breaking) and lets these emails carry the app's branding.
//
// Configure at: Authentication → Auth Hooks → Send Email Hook
//   URL    https://app.evergreenreno.net/api/auth-email
//   Secret the v1,whsec_… value Supabase generates → AUTH_HOOK_SECRET in Vercel

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ActionType = "signup" | "invite" | "magiclink" | "recovery" | "email_change" | "email_change_current" | "reauthentication";

interface HookPayload {
  user?: { email?: string; new_email?: string };
  email_data?: {
    token?: string;
    token_hash?: string;
    redirect_to?: string;
    email_action_type?: ActionType;
    site_url?: string;
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Standard Webhooks: HMAC-SHA256 over `{id}.{timestamp}.{body}`, base64. */
function verify(secret: string, id: string, ts: string, body: string, header: string): boolean {
  // Supabase hands over `v1,whsec_<base64>`; tolerate either prefix being absent.
  const raw = secret.replace(/^v1,/, "").replace(/^whsec_/, "");
  const expected = createHmac("sha256", Buffer.from(raw, "base64")).update(`${id}.${ts}.${body}`).digest();
  // The header can carry several space-separated `v1,<sig>` versions.
  return header.split(" ").some((part) => {
    const sig = part.includes(",") ? part.split(",")[1] : part;
    const got = Buffer.from(sig, "base64");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

const COPY: Record<ActionType, { subject: string; heading: string; blurb: string; cta: string }> = {
  signup: { subject: "Confirm your email", heading: "Confirm your email", blurb: "Tap below to confirm this address and finish setting up your account.", cta: "Confirm email" },
  invite: { subject: "You're invited to Evergreen AI", heading: "You're invited", blurb: "You've been added to the 31810 Evergreen renovation. Tap below to choose a password and get in.", cta: "Accept invitation" },
  magiclink: { subject: "Your sign-in link", heading: "Sign in to Evergreen AI", blurb: "Tap below to sign in. No password needed.", cta: "Sign in" },
  recovery: { subject: "Reset your password", heading: "Reset your password", blurb: "We received a request to reset your password. Tap below to choose a new one. If this wasn't you, you can safely ignore this email.", cta: "Set a new password" },
  email_change: { subject: "Confirm your new email address", heading: "Confirm your new address", blurb: "Tap below to confirm this as the email on your account.", cta: "Confirm address" },
  email_change_current: { subject: "Confirm your email change", heading: "Confirm your email change", blurb: "Tap below to approve changing the email on your account.", cta: "Confirm change" },
  reauthentication: { subject: "Confirm it's you", heading: "Confirm it's you", blurb: "Enter this code in the app to continue.", cta: "" },
};

function render(o: { heading: string; blurb: string; cta: string; url: string; code?: string }) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4efe3;font-family:Georgia,'Times New Roman',serif;">
  <div style="max-width:560px;margin:0 auto;padding:28px 16px;">
    <div style="font-size:13px;letter-spacing:.08em;color:#b08a3e;font-weight:bold;margin-bottom:10px;">EVERGREEN <span style="color:#3a2f25;">AI</span> · 31810 Evergreen</div>
    <div style="background:#fdf8ee;border:1px solid #ddd2bd;border-radius:12px;padding:22px;">
      <div style="font-size:19px;font-weight:bold;color:#3a2f25;margin-bottom:12px;">${esc(o.heading)}</div>
      <div style="font-size:14px;line-height:1.6;color:#2c241c;">${esc(o.blurb)}</div>
      ${o.cta && o.url ? `<div style="margin-top:22px;">
        <a href="${o.url}" style="display:inline-block;background:#6b7f5b;color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;padding:12px 26px;border-radius:99px;">${esc(o.cta)}</a>
      </div>` : ""}
      ${o.code ? `<div style="margin-top:20px;padding-top:16px;border-top:1px solid #ece2cf;">
        <div style="font-size:12px;color:#7a6f60;margin-bottom:6px;">Or enter this code in the app:</div>
        <div style="font-family:Arial,sans-serif;font-size:26px;letter-spacing:.22em;font-weight:bold;color:#3a2f25;">${esc(o.code)}</div>
      </div>` : ""}
      <div style="font-size:12px;color:#7a6f60;margin-top:20px;">This link is single-use and expires in about an hour. If you get more than one, use the newest.</div>
    </div>
    <div style="font-size:11px;color:#9a8e79;margin-top:14px;line-height:1.5;">Evergreen AI · end-to-end renovation project management for 31810 Evergreen Rd.</div>
  </div>
</body></html>`;
}

const fail = (message: string, http_code: number) =>
  NextResponse.json({ error: { http_code, message } }, { status: http_code });

export async function POST(req: NextRequest) {
  const secret = process.env.AUTH_HOOK_SECRET;
  const key = process.env.RESEND_API_KEY;
  // Fail closed: without the secret anyone could make us send mail.
  if (!secret) return fail("Auth email hook is not configured.", 500);
  if (!key) return fail("Email service is not configured.", 500);

  const body = await req.text();
  const id = req.headers.get("webhook-id") ?? "";
  const ts = req.headers.get("webhook-timestamp") ?? "";
  const sig = req.headers.get("webhook-signature") ?? "";
  if (!id || !ts || !sig) return fail("Missing webhook signature.", 401);
  // Reject stale deliveries so a captured request can't be replayed later.
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return fail("Signature timestamp out of range.", 401);
  if (!verify(secret, id, ts, body, sig)) return fail("Bad webhook signature.", 401);

  let payload: HookPayload;
  try { payload = JSON.parse(body); } catch { return fail("Bad body.", 400); }

  const d = payload.email_data ?? {};
  const action = (d.email_action_type ?? "magiclink") as ActionType;
  const copy = COPY[action] ?? COPY.magiclink;
  // email_change confirms the *new* address; everything else goes to the user.
  const to = (action === "email_change" ? payload.user?.new_email : payload.user?.email) ?? payload.user?.email;
  if (!to) return fail("No recipient on payload.", 400);

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const url = d.token_hash && base
    ? `${base}/auth/v1/verify?token=${encodeURIComponent(d.token_hash)}&type=${encodeURIComponent(action)}${d.redirect_to ? `&redirect_to=${encodeURIComponent(d.redirect_to)}` : ""}`
    : "";

  const from = process.env.EMAIL_FROM_AUTH || "Evergreen AI <no-reply@evergreenreno.net>";
  const text = [copy.heading, "", copy.blurb, url ? `\n${url}` : "", d.token ? `\nCode: ${d.token}` : ""].filter(Boolean).join("\n");

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to: [to], subject: copy.subject, text,
        html: render({ ...copy, url, code: d.token }),
      }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      // Surfacing Resend's own wording here is what made the last round of this
      // debuggable — it shows up verbatim in the Supabase auth log.
      return fail(j?.message ?? `Resend returned ${r.status}`, 500);
    }
    return NextResponse.json({});
  } catch {
    return fail("Email service unreachable.", 500);
  }
}

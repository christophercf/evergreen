import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Email push for Messenger. Uses Resend (https://resend.com) when a
// RESEND_API_KEY env var is configured in Vercel — otherwise it no-ops so the
// in-app flow keeps working. EMAIL_FROM optionally overrides the sender.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Branded HTML: the message body + a button that opens the conversation. */
function renderHtml(o: { senderName?: string; subject: string; text: string; replyUrl: string; photoCount?: number }) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4efe3;font-family:Georgia,'Times New Roman',serif;">
  <div style="max-width:560px;margin:0 auto;padding:28px 16px;">
    <div style="font-size:13px;letter-spacing:.08em;color:#b08a3e;font-weight:bold;margin-bottom:10px;">EVERGREEN <span style="color:#3a2f25;">AI</span> · 31810 Evergreen</div>
    <div style="background:#fdf8ee;border:1px solid #ddd2bd;border-radius:12px;padding:22px;">
      ${o.senderName ? `<div style="font-size:13px;color:#7a6f60;margin-bottom:6px;">Message from <strong style="color:#3a2f25;">${esc(o.senderName)}</strong></div>` : ""}
      <div style="font-size:17px;font-weight:bold;color:#3a2f25;margin-bottom:12px;">${esc(o.subject)}</div>
      <div style="font-size:14px;line-height:1.6;color:#2c241c;white-space:pre-wrap;">${esc(o.text)}</div>
      ${o.photoCount ? `<div style="font-size:13px;color:#7a6f60;margin-top:12px;">&#128247; ${o.photoCount} photo${o.photoCount === 1 ? "" : "s"} attached &mdash; view them in the app.</div>` : ""}
      <div style="margin-top:22px;">
        <a href="${o.replyUrl}" style="display:inline-block;background:#6b7f5b;color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;padding:12px 26px;border-radius:99px;">&#128172;&nbsp; Reply in the app</a>
      </div>
    </div>
    <div style="font-size:11px;color:#9a8e79;margin-top:14px;line-height:1.5;">
      You're receiving this because you're on the 31810 Evergreen renovation team.
      Turn email notifications off any time in the app under &#9881; &rarr; My Preferences.
    </div>
  </div>
</body></html>`;
}

export async function POST(req: NextRequest) {
  const key = process.env.RESEND_API_KEY;
  let payload: { to?: string[]; subject?: string; text?: string; appUrl?: string; replyUrl?: string; senderName?: string; photoCount?: number };
  try { payload = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Bad body" }, { status: 400 }); }
  const to = (payload.to ?? []).filter((e) => typeof e === "string" && e.includes("@")).slice(0, 20);
  if (!to.length || !payload.subject) return NextResponse.json({ ok: false, error: "Missing to/subject" }, { status: 400 });
  if (!key) return NextResponse.json({ ok: true, sent: false, skipped: "RESEND_API_KEY not configured" });

  const from = process.env.EMAIL_FROM || "Evergreen AI <onboarding@resend.dev>";
  const appUrl = payload.appUrl || "https://evergreen-rust-five.vercel.app";
  const replyUrl = payload.replyUrl || `${appUrl}/updates`;
  const text = `${payload.text ?? ""}\n\n—\nReply in the app: ${replyUrl}`;
  const html = renderHtml({ senderName: payload.senderName, subject: payload.subject, text: payload.text ?? "", replyUrl, photoCount: payload.photoCount });
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject: payload.subject, text, html }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return NextResponse.json({ ok: false, error: j?.message ?? `Resend ${r.status}` });
    return NextResponse.json({ ok: true, sent: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Email service unreachable" });
  }
}

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Email push for site updates. Uses Resend (https://resend.com) when a
// RESEND_API_KEY env var is configured in Vercel — otherwise it no-ops so the
// in-app flow keeps working. EMAIL_FROM optionally overrides the sender.
export async function POST(req: NextRequest) {
  const key = process.env.RESEND_API_KEY;
  let payload: { to?: string[]; subject?: string; text?: string; appUrl?: string };
  try { payload = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Bad body" }, { status: 400 }); }
  const to = (payload.to ?? []).filter((e) => typeof e === "string" && e.includes("@")).slice(0, 20);
  if (!to.length || !payload.subject) return NextResponse.json({ ok: false, error: "Missing to/subject" }, { status: 400 });
  if (!key) return NextResponse.json({ ok: true, sent: false, skipped: "RESEND_API_KEY not configured" });

  const from = process.env.EMAIL_FROM || "Evergreen AI <onboarding@resend.dev>";
  const appUrl = payload.appUrl || "https://evergreen-rust-five.vercel.app";
  const text = `${payload.text ?? ""}\n\n—\nReply in the app: ${appUrl}/updates`;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject: payload.subject, text }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return NextResponse.json({ ok: false, error: j?.message ?? `Resend ${r.status}` });
    return NextResponse.json({ ok: true, sent: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Email service unreachable" });
  }
}

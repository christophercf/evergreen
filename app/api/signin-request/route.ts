import { NextResponse } from "next/server";
import { signToken, SEVEN_DAYS_MS } from "@/lib/data/signin-token";

// Self-service: "email me a way back in".
//
// The admin's hand-over link lasts seven days; this is the same link, asked for
// by the person who needs it instead of by an admin. That matters because the
// one-hour reset was the whole problem: ask for it, get pulled onto something
// else, come back after lunch, "this link has expired", text the admin.
//
// It goes ONLY to the address on file for a project member, so the trust model
// is the same as any password reset — possession of the mailbox. The window is
// longer, which is the deliberate trade: an hour is a good default for a
// consumer app with a support desk, and this project's support desk is one
// person who would rather be building.
//
// The response NEVER says whether the address is on the project. A login box
// that answers that question is a membership oracle.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rate = new Map<string, { at: number; hits: number }>();
const WINDOW = 60_000;
const MAX_PER_MIN = 6;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function render(o: { first: string; link: string }) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4efe3;font-family:Georgia,'Times New Roman',serif;">
  <div style="max-width:560px;margin:0 auto;padding:28px 16px;">
    <div style="font-size:13px;letter-spacing:.08em;color:#b08a3e;font-weight:bold;margin-bottom:10px;">EVERGREEN <span style="color:#3a2f25;">AI</span> · 31810 Evergreen</div>
    <div style="background:#fdf8ee;border:1px solid #ddd2bd;border-radius:12px;padding:22px;">
      <div style="font-size:19px;font-weight:bold;color:#3a2f25;margin-bottom:12px;">${o.first ? `${esc(o.first)}, here's your way back in` : "Here's your way back in"}</div>
      <div style="font-size:14px;line-height:1.6;color:#2c241c;">You asked for a link to get into Evergreen. No password needed — tap the button.</div>
      <div style="margin-top:22px;">
        <a href="${o.link}" style="display:inline-block;background:#6b7f5b;color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;padding:12px 26px;border-radius:99px;">Sign in to Evergreen</a>
      </div>
      <div style="font-size:13px;line-height:1.6;color:#2c241c;margin-top:18px;">
        No rush — this one works for <strong>7 days</strong>, as many times as you need. When you open it you can
        sign straight in, or set a password so you never need a link again.
      </div>
      <div style="font-size:12px;color:#7a6f60;margin-top:18px;word-break:break-all;">If the button doesn't work, paste this into your browser:<br>${esc(o.link)}</div>
      <div style="font-size:12px;color:#7a6f60;margin-top:14px;">If you didn't ask for this, you can ignore it — nothing changes until the link is opened.</div>
    </div>
  </div>
</body></html>`;
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
  const now = Date.now();
  const r = rate.get(ip);
  if (r && now - r.at < WINDOW) {
    if (r.hits >= MAX_PER_MIN) return NextResponse.json({ ok: false, error: "Too many requests — wait a minute." }, { status: 429 });
    r.hits++;
  } else rate.set(ip, { at: now, hits: 1 });

  let body: { email?: string; origin?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const email = body.email?.trim().toLowerCase();

  // One response for every outcome below, so this cannot be used to find out
  // who is on the project.
  const same = NextResponse.json({
    ok: true,
    message: "If that address is on the project, a sign-in link is on its way. It's good for 7 days.",
  });
  if (!email || !email.includes("@")) return same;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const key = process.env.RESEND_API_KEY;
  if (!url || !svc || !key) return same;

  try {
    const res = await fetch(`${url}/rest/v1/project_state?id=eq.evergreen&select=db`, {
      headers: { apikey: svc, Authorization: `Bearer ${svc}` }, cache: "no-store",
    });
    const rows = await res.json();
    const users = (rows?.[0]?.db?.users ?? []) as { email: string; name?: string; disabled?: boolean }[];
    const target = users.find((u) => u.email?.trim().toLowerCase() === email);
    if (!target || target.disabled) return same;

    const t = signToken(email, "signin", SEVEN_DAYS_MS);
    if (!t) return same;
    const origin = body.origin || `https://${req.headers.get("host") ?? "app.evergreenreno.net"}`;
    const link = `${origin}/enter?t=${encodeURIComponent(t)}`;
    const first = (target.name ?? "").split(" ")[0];

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM_AUTH || "Evergreen AI <no-reply@evergreenreno.net>",
        to: [target.email],
        subject: "Your Evergreen sign-in link (good for 7 days)",
        text: `${first ? first + "," : "Hello,"}\n\nHere's your way back into Evergreen — no password needed:\n\n${link}\n\nIt works for 7 days, as many times as you need. When you open it you can sign straight in, or set a password.\n\nIf you didn't ask for this, ignore it.`,
        html: render({ first, link }),
      }),
    });
  } catch { /* the caller is told the same thing either way */ }

  return same;
}

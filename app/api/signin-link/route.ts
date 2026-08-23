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

export async function POST(req: Request) {
  let body: { email?: string; purpose?: "signin" | "password"; origin?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const email = body.email?.trim().toLowerCase();
  const purpose = body.purpose === "password" ? "password" : "signin";
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
    const me = users.find((u) => u.email?.trim().toLowerCase() === caller.user.email!.toLowerCase());
    if (!me || me.disabled || !["full_admin", "builder", "owner"].includes(me.role)) {
      return NextResponse.json({ ok: false, error: "Only project admins can hand out sign-in links." }, { status: 403 });
    }
    const target = users.find((u) => u.email?.trim().toLowerCase() === email);
    if (!target) return NextResponse.json({ ok: false, error: "That email isn't on the project — add them to the team first." }, { status: 400 });
    if (target.disabled) return NextResponse.json({ ok: false, error: "That account is suspended. Restore it before sending a link." }, { status: 400 });

    const t = signToken(email, purpose, SEVEN_DAYS_MS);
    if (!t) return NextResponse.json({ ok: false, error: "Link signing isn't configured on the server." }, { status: 500 });

    const origin = body.origin || `https://${req.headers.get("host") ?? "app.evergreenreno.net"}`;
    return NextResponse.json({
      ok: true,
      link: `${origin}/enter?t=${encodeURIComponent(t)}`,
      expiresAt: new Date(Date.now() + SEVEN_DAYS_MS).toISOString(),
      name: target.name ?? null,
      purpose,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Couldn't verify permissions." }, { status: 502 });
  }
}

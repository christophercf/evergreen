import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyToken, remaining } from "@/lib/data/signin-token";

// Redeem a seven-day hand-over link.
//
// The token proves an admin issued this link for this address. It carries no
// session of its own: we check it, re-check that the person is still on the
// project, and only then ask Supabase for a link — which is therefore always
// freshly minted, whatever day of the week the link is finally clicked.
//
// Two shapes:
//   check   — is this token good, and who is it for? (no link minted)
//   redeem  — mint the Supabase link and return it for the browser to follow
//
// `purpose` decides what kind: "signin" sends them straight in, "password"
// sends them to set one. A link issued for signing in can still be redeemed as
// a password reset, because someone who cannot remember their password should
// not need a second link from the admin to fix that.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { token?: string; mode?: "check" | "redeem"; purpose?: "signin" | "password"; origin?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const mode = body.mode === "redeem" ? "redeem" : "check";

  const v = verifyToken(body.token ?? "");
  if (!v.ok) {
    const why = {
      unconfigured: "Sign-in links aren't configured on the server.",
      malformed: "That link is incomplete — it may have been cut short by the message it arrived in.",
      bad_signature: "That link isn't valid. It may have been altered, or it was issued before the last security change.",
      expired: "That link has expired. They last seven days.",
    }[v.reason];
    return NextResponse.json({ ok: false, reason: v.reason, error: why }, { status: 400 });
  }

  const email = v.payload.e;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) return NextResponse.json({ ok: false, error: "Auth isn't configured on the server." }, { status: 500 });

  const admin = createClient(url, svc, { auth: { persistSession: false, autoRefreshToken: false } });

  // Membership is re-checked at CLICK time, not issue time: removing someone
  // from the project has to kill any link already in their pocket.
  let name: string | null = null;
  try {
    const res = await fetch(`${url}/rest/v1/project_state?id=eq.evergreen&select=db`, {
      headers: { apikey: svc, Authorization: `Bearer ${svc}` }, cache: "no-store",
    });
    const rows = await res.json();
    const users = (rows?.[0]?.db?.users ?? []) as { email: string; name?: string; disabled?: boolean }[];
    const target = users.find((u) => u.email?.trim().toLowerCase() === email);
    if (!target) return NextResponse.json({ ok: false, reason: "not_member", error: "That address is no longer on this project." }, { status: 403 });
    if (target.disabled) return NextResponse.json({ ok: false, reason: "disabled", error: "That account is suspended. Ask the project admin to restore it." }, { status: 403 });
    name = target.name ?? null;
  } catch {
    return NextResponse.json({ ok: false, error: "Couldn't check the project roster just now." }, { status: 502 });
  }

  if (mode === "check") {
    return NextResponse.json({ ok: true, email, name, purpose: v.payload.p, expiresIn: remaining(v.payload.x) });
  }

  // What the person chose on the page wins over what the link was issued for.
  const purpose = body.purpose ?? v.payload.p;
  const origin = body.origin || `https://${req.headers.get("host") ?? "app.evergreenreno.net"}`;

  // Does an auth account exist? A member who has never had one needs "invite",
  // which both creates it and lets them set a password.
  let exists = false;
  try {
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    exists = !!list?.users?.find((u) => u.email?.toLowerCase() === email);
  } catch { /* fall through to magiclink; generateLink will tell us */ }

  const type: "magiclink" | "recovery" | "invite" =
    !exists ? "invite" : purpose === "password" ? "recovery" : "magiclink";

  const { data: gl, error } = await admin.auth.admin.generateLink({
    type, email, options: { redirectTo: origin },
  });
  if (error || !gl?.properties?.action_link) {
    return NextResponse.json({ ok: false, error: error?.message ?? "Couldn't create a sign-in link just now." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, action: gl.properties.action_link, type, email, name });
}

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Invite / re-invite a project member.
//
//   mode "email" (default) — send Supabase's invite email to a brand-new account.
//   mode "link"            — generate a direct sign-in link the admin can hand
//                            over by text/WhatsApp. This bypasses email entirely,
//                            which is the fix when the mailer is throttled or a
//                            vendor's inbox is eating the messages.
//
// Because "link" returns a working sign-in URL, the caller must be an
// authenticated project admin/builder — verified against project_state, not
// just "any signed-in Supabase user".

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { email?: string; redirectTo?: string; mode?: "email" | "link" } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const email = body.email?.trim();
  const redirectTo = body.redirectTo;
  const mode = body.mode === "link" ? "link" : "email";
  if (!email) return NextResponse.json({ ok: false, error: "Email required." });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) {
    return NextResponse.json({ ok: false, error: "Email invites aren't configured yet — add SUPABASE_SERVICE_ROLE_KEY to send emails." });
  }

  const admin = createClient(url, svc, { auth: { persistSession: false, autoRefreshToken: false } });

  // 1) Who is calling?
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 401 });
  const { data: caller, error: callerErr } = await admin.auth.getUser(token);
  if (callerErr || !caller?.user?.email) return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 401 });

  // 2) Are they allowed to hand out access? (admin / builder / owner)
  try {
    const res = await fetch(`${url}/rest/v1/project_state?id=eq.evergreen&select=db`, {
      headers: { apikey: svc, Authorization: `Bearer ${svc}` }, cache: "no-store",
    });
    const rows = await res.json();
    const users = (rows?.[0]?.db?.users ?? []) as { email: string; role: string; disabled?: boolean }[];
    const me = users.find((u) => u.email?.trim().toLowerCase() === caller.user.email!.toLowerCase());
    if (!me || me.disabled || !["full_admin", "builder", "owner"].includes(me.role)) {
      return NextResponse.json({ ok: false, error: "Only project admins can send invites." }, { status: 403 });
    }
    // The target must already be on the project — this never creates access.
    if (!users.some((u) => u.email?.trim().toLowerCase() === email.toLowerCase())) {
      return NextResponse.json({ ok: false, error: "That email isn't on the project — add them to the team first." }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ ok: false, error: "Couldn't verify permissions." }, { status: 502 });
  }

  // 3) What state is the target account in?
  const review = { userExists: false, confirmed: false, lastSignInAt: null as string | null };
  try {
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existing = list?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (existing) {
      review.userExists = true;
      review.confirmed = !!existing.email_confirmed_at;
      review.lastSignInAt = existing.last_sign_in_at ?? null;
    }
  } catch { /* review is best-effort */ }

  // 4) A direct hand-over link — magiclink signs an existing account straight in;
  //    invite is the equivalent for someone with no account yet.
  if (mode === "link") {
    const type = review.userExists ? "magiclink" : "invite";
    const { data: gl, error: gerr } = await admin.auth.admin.generateLink({
      type: type as "magiclink" | "invite",
      email,
      options: redirectTo ? { redirectTo } : undefined,
    });
    if (gerr || !gl?.properties?.action_link) {
      return NextResponse.json({ ok: false, error: gerr?.message ?? "Couldn't generate a link.", review });
    }
    return NextResponse.json({ ok: true, emailed: false, link: gl.properties.action_link, linkType: type, review });
  }

  // 5) Email path. A brand-new account gets the invite email; an existing one
  //    can't be re-invited, so the caller should send a set-up link instead.
  if (review.userExists) {
    return NextResponse.json({ ok: false, alreadyRegistered: true, review, error: "This account already exists — send a set-up link instead of an invite." });
  }
  const { error } = await admin.auth.admin.inviteUserByEmail(email, redirectTo ? { redirectTo } : undefined);
  if (!error) return NextResponse.json({ ok: true, emailed: true, review });

  const { data: gl, error: gerr } = await admin.auth.admin.generateLink({
    type: "invite", email, options: redirectTo ? { redirectTo } : undefined,
  });
  if (gerr || !gl?.properties?.action_link) return NextResponse.json({ ok: false, error: error.message, review });
  return NextResponse.json({ ok: true, emailed: false, link: gl.properties.action_link, linkType: "invite", review });
}

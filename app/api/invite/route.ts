import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Sends a Supabase invite email to a newly-invited user. Requires the
// service_role key in server env (SUPABASE_SERVICE_ROLE_KEY). The invitee gets
// an email with a link back to the app; on first sign-in the store matches their
// email to the pre-assigned app user (role/trade). Falls back gracefully (the
// admin can still copy the invite link) when the key isn't configured.

export async function POST(req: Request) {
  let body: { email?: string; redirectTo?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const email = body.email?.trim();
  const redirectTo = body.redirectTo;
  if (!email) return NextResponse.json({ ok: false, error: "Email required." });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) {
    return NextResponse.json({ ok: false, error: "Email invites aren't configured yet — add SUPABASE_SERVICE_ROLE_KEY to send emails." });
  }

  const admin = createClient(url, svc, { auth: { persistSession: false, autoRefreshToken: false } });

  // Only a signed-in user may trigger invite emails (prevents anonymous spam).
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 401 });
  const { data: caller, error: callerErr } = await admin.auth.getUser(token);
  if (callerErr || !caller?.user) return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 401 });

  // First try to invite + email. If the user already exists (e.g. a re-invite),
  // generate a FRESH invite link with the current redirect so the admin can share it.
  const { error } = await admin.auth.admin.inviteUserByEmail(email, redirectTo ? { redirectTo } : undefined);
  if (!error) return NextResponse.json({ ok: true, emailed: true });

  const { data: gl, error: gerr } = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: redirectTo ? { redirectTo } : undefined,
  });
  if (gerr || !gl?.properties?.action_link) return NextResponse.json({ ok: false, error: error.message });
  return NextResponse.json({ ok: true, emailed: false, link: gl.properties.action_link });
}

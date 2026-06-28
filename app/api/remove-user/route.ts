import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Deletes a user's Supabase Auth account (so they can no longer sign in). The
// app-side record (role/permissions in project_state) is removed by the client.
// Requires the service_role key; guarded to signed-in callers.

export async function POST(req: Request) {
  let body: { email?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const email = body.email?.trim().toLowerCase();
  if (!email) return NextResponse.json({ ok: false, error: "Email required." });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) return NextResponse.json({ ok: false, error: "Auth deletion not configured (missing service role key)." });

  const admin = createClient(url, svc, { auth: { persistSession: false, autoRefreshToken: false } });

  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 401 });
  const { data: caller, error: callerErr } = await admin.auth.getUser(token);
  if (callerErr || !caller?.user) return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 401 });

  // Find the auth user by email, then delete.
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) return NextResponse.json({ ok: false, error: error.message });
  const target = data.users.find((u) => u.email?.toLowerCase() === email);
  if (!target) return NextResponse.json({ ok: true, deleted: false }); // no auth account (e.g. never signed up)
  const { error: delErr } = await admin.auth.admin.deleteUser(target.id);
  if (delErr) return NextResponse.json({ ok: false, error: delErr.message });
  return NextResponse.json({ ok: true, deleted: true });
}

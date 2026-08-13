import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tells the login screen what state an email is really in, so it can route the
// person to the ONE action that will work for them instead of making them guess
// between "Log in" and "Set up account".
//
// States:
//   not_invited   — no app user with that email (invite-only project)
//   needs_setup   — on the project, but no usable Supabase Auth password yet
//                   (never invited to Auth, invite never opened, or never signed in)
//   active        — real account that has signed in before → ask for password
//
// Only emails that are already project members get detail; anything else gets a
// flat "not_invited" so this can't be used to probe unrelated addresses.

type Cache = { at: number; hits: number };
const rate = new Map<string, Cache>();
const WINDOW = 60_000;
const MAX_PER_MIN = 20;

export async function POST(req: Request) {
  // Light abuse guard — a login box needs a handful of calls, not hundreds.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
  const now = Date.now();
  const r = rate.get(ip);
  if (r && now - r.at < WINDOW) {
    if (r.hits >= MAX_PER_MIN) return NextResponse.json({ ok: false, error: "Too many attempts — wait a minute." }, { status: 429 });
    r.hits++;
  } else rate.set(ip, { at: now, hits: 1 });

  let body: { email?: string; emails?: string[] } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const email = body.email?.trim().toLowerCase();
  const bulk = Array.isArray(body.emails) ? body.emails : null;
  if (!bulk && (!email || !email.includes("@"))) return NextResponse.json({ ok: false, error: "Enter a valid email." }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) return NextResponse.json({ ok: true, state: "active", degraded: true });

  const admin = createClient(url, svc, { auth: { persistSession: false, autoRefreshToken: false } });

  // Bulk mode (Admin → Team health column) — signed-in callers only, since it
  // reports last-sign-in times for the whole roster.
  if (bulk) {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 401 });
    const { data: caller, error: callerErr } = await admin.auth.getUser(token);
    if (callerErr || !caller?.user) return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 401 });

    const out: Record<string, { state: string; confirmed: boolean; lastSignInAt: string | null }> = {};
    try {
      const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const byEmail = new Map((data?.users ?? []).map((u) => [u.email?.toLowerCase() ?? "", u]));
      for (const raw of bulk.slice(0, 200)) {
        const e = String(raw).trim().toLowerCase();
        const a = byEmail.get(e);
        out[e] = {
          state: !a || !a.email_confirmed_at || !a.last_sign_in_at ? "needs_setup" : "active",
          confirmed: !!a?.email_confirmed_at,
          lastSignInAt: a?.last_sign_in_at ?? null,
        };
        if (!a) out[e].state = "no_account";
      }
    } catch { return NextResponse.json({ ok: false, error: "Lookup failed." }, { status: 502 }); }
    return NextResponse.json({ ok: true, accounts: out });
  }

  // 1) Is this email on the project at all?
  let onProject = false;
  let name: string | undefined;
  try {
    const res = await fetch(`${url}/rest/v1/project_state?id=eq.evergreen&select=db`, {
      headers: { apikey: svc, Authorization: `Bearer ${svc}` },
      cache: "no-store",
    });
    const rows = await res.json();
    const users = (rows?.[0]?.db?.users ?? []) as { name: string; email: string; status?: string }[];
    const u = users.find((x) => x.email?.trim().toLowerCase() === email);
    onProject = !!u;
    name = u?.name;
  } catch { /* fall through */ }

  if (!onProject) return NextResponse.json({ ok: true, state: "not_invited" });

  // 2) What does Supabase Auth know about them?
  let authExists = false, confirmed = false, lastSignInAt: string | null = null;
  try {
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const a = data?.users?.find((x) => x.email?.toLowerCase() === email);
    if (a) {
      authExists = true;
      confirmed = !!a.email_confirmed_at;
      lastSignInAt = a.last_sign_in_at ?? null;
    }
  } catch { /* best effort — fall back to asking for a password */ }

  const state = !authExists || !confirmed || !lastSignInAt ? "needs_setup" : "active";
  return NextResponse.json({ ok: true, state, name, authExists, confirmed, lastSignInAt });
}

// ----------------------------------------------------------------------------
// Real authentication via Supabase Auth (email verification + passwords).
// Active only when running against Supabase (IS_SUPABASE + keys present). The
// app's user records (roles/permissions) still live in project_state and are
// matched to the signed-in email by the store (invite-only access).
// ----------------------------------------------------------------------------

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { IS_SUPABASE } from "./config";

let client: SupabaseClient | null = null;
function c(): SupabaseClient | null {
  if (!IS_SUPABASE || typeof window === "undefined") return null;
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return null;
    client = createClient(url, key);
  }
  return client;
}

export const authEnabled = () => !!c();

type Res = { ok: boolean; error?: string; needsVerify?: boolean; email?: string };

export async function authSignUp(email: string, password: string): Promise<Res> {
  const s = c();
  if (!s) return { ok: false, error: "Auth not configured." };
  const { data, error } = await s.auth.signUp({
    email: email.trim(),
    password,
    options: { emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined },
  });
  if (error) return { ok: false, error: error.message };
  // With email confirmation on, there's no session until the email is verified.
  return { ok: true, needsVerify: !data.session };
}

export async function authSignIn(email: string, password: string): Promise<Res> {
  const s = c();
  if (!s) return { ok: false, error: "Auth not configured." };
  const { data, error } = await s.auth.signInWithPassword({ email: email.trim(), password });
  if (error) return { ok: false, error: error.message };
  return { ok: true, email: data.user?.email ?? undefined };
}

export async function authSignOut() {
  await c()?.auth.signOut();
}

export async function authResendVerification(email: string) {
  await c()?.auth.resend({ type: "signup", email: email.trim() });
}

export async function authSendReset(email: string) {
  await c()?.auth.resetPasswordForEmail(email.trim(), { redirectTo: typeof window !== "undefined" ? window.location.origin : undefined });
}

/** Send an invite email to the address (server route uses the service_role key). */
export async function sendInviteEmail(email: string): Promise<{ ok: boolean; error?: string; emailed?: boolean; link?: string }> {
  let token: string | null = null;
  const s = c();
  if (s) { const { data } = await s.auth.getSession(); token = data.session?.access_token ?? null; }
  try {
    const res = await fetch("/api/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ email, redirectTo: typeof window !== "undefined" ? window.location.origin : undefined }),
    });
    return await res.json();
  } catch {
    return { ok: false, error: "Couldn’t reach the invite service." };
  }
}

/** Delete a user's Supabase Auth account (server route, service_role). */
export async function removeAuthUser(email: string): Promise<{ ok: boolean; error?: string; deleted?: boolean }> {
  let token: string | null = null;
  const s = c();
  if (s) { const { data } = await s.auth.getSession(); token = data.session?.access_token ?? null; }
  try {
    const res = await fetch("/api/remove-user", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ email }),
    });
    return await res.json();
  } catch {
    return { ok: false, error: "Couldn’t reach the server." };
  }
}

/** Subscribe to auth changes; cb receives the signed-in email (or null). Fires immediately with current session. */
export function authOnChange(cb: (email: string | null) => void): () => void {
  const s = c();
  if (!s) return () => {};
  const { data } = s.auth.onAuthStateChange((_e, session) => cb(session?.user?.email ?? null));
  return () => data.subscription.unsubscribe();
}

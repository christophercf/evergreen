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

// Captured the moment this module loads — BEFORE the Supabase client initializes
// and strips the tokens out of the URL. Reading location later is unreliable.
const urlAtLoad = typeof window !== "undefined" ? window.location.hash + window.location.search : "";
const recoveryAtLoad = /type=(recovery|invite)/.test(urlAtLoad);
const urlErrorAtLoad = (() => {
  const m = urlAtLoad.match(/error_description=([^&]+)/);
  return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : null;
})();

/** True when the user arrived via a Supabase password-recovery or invite link —
 *  either way they need to set a password before entering the app. */
export function isRecoveryUrl(): boolean {
  if (typeof window === "undefined") return false;
  return recoveryAtLoad || /type=(recovery|invite)/.test(window.location.hash + window.location.search);
}

/** Error carried on an auth redirect (e.g. “Email link is invalid or has expired”). */
export function authUrlError(): string | null {
  return urlErrorAtLoad;
}

/** Set a new password for the user in the active (recovery) session. */
export async function authUpdatePassword(password: string): Promise<{ ok: boolean; error?: string }> {
  const s = c();
  if (!s) return { ok: false, error: "Auth not configured." };
  const { error } = await s.auth.updateUser({ password });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Email of the currently signed-in (or recovery) session, if any. */
export async function authCurrentEmail(): Promise<string | null> {
  const s = c();
  if (!s) return null;
  const { data } = await s.auth.getSession();
  return data.session?.user?.email ?? null;
}

/** Send an invite email to the address (server route uses the service_role key). */
export type InviteReview = { userExists: boolean; confirmed: boolean; lastSignInAt: string | null };
export async function sendInviteEmail(email: string): Promise<{ ok: boolean; error?: string; emailed?: boolean; link?: string; review?: InviteReview }> {
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

/** Subscribe to auth changes; cb receives the signed-in email (or null) and the
 *  Supabase event name (e.g. "SIGNED_IN", "PASSWORD_RECOVERY", "USER_UPDATED"). */
export function authOnChange(cb: (email: string | null, event: string) => void): () => void {
  const s = c();
  if (!s) return () => {};
  const { data } = s.auth.onAuthStateChange((event, session) => cb(session?.user?.email ?? null, event));
  return () => data.subscription.unsubscribe();
}

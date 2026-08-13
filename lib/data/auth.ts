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

/** Supabase's built-in mailer is rate-limited project-wide (~2/hour). Turn the
 *  raw error into something a person can act on instead of silently failing. */
function mailError(msg: string): string {
  if (/rate limit|too many|only request this after/i.test(msg)) {
    return "Email limit reached (the project can send a couple of auth emails an hour). Wait a few minutes and try again, or ask your project admin to send you a direct setup link.";
  }
  return msg;
}

export async function authResendVerification(email: string): Promise<Res> {
  const s = c();
  if (!s) return { ok: false, error: "Auth not configured." };
  const { error } = await s.auth.resend({ type: "signup", email: email.trim() });
  if (error) return { ok: false, error: mailError(error.message) };
  return { ok: true };
}

/** Sends the set-a-password email. Used for both "forgot password" and
 *  "finish setting up" — for an invited-but-never-activated account this is
 *  the only flow that actually works. */
export async function authSendReset(email: string): Promise<Res> {
  const s = c();
  if (!s) return { ok: false, error: "Auth not configured." };
  const { error } = await s.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
  });
  if (error) return { ok: false, error: mailError(error.message) };
  return { ok: true };
}

/** Passwordless sign-in: email a one-time code (and/or magic link). The best
 *  path for trades — nothing to remember, and it also confirms an invited
 *  account that never finished setting up. `shouldCreateUser: false` keeps the
 *  project invite-only. */
export async function authSendCode(email: string): Promise<Res> {
  const s = c();
  if (!s) return { ok: false, error: "Auth not configured." };
  const { error } = await s.auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: false, emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined },
  });
  if (error) return { ok: false, error: mailError(error.message) };
  return { ok: true };
}

/** Verify the emailed code and sign in. */
export async function authVerifyCode(email: string, code: string): Promise<Res> {
  const s = c();
  if (!s) return { ok: false, error: "Auth not configured." };
  const { data, error } = await s.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
  if (error) {
    if (/expired|invalid/i.test(error.message)) return { ok: false, error: "That code didn't work — it may have expired. Send a new one." };
    return { ok: false, error: error.message };
  }
  return { ok: true, email: data.user?.email ?? undefined };
}

/** What state is this email in? Drives the email-first login flow. */
export type AccountState = "not_invited" | "needs_setup" | "active";
export async function checkAccount(email: string): Promise<{ state: AccountState; name?: string; authExists?: boolean; lastSignInAt?: string | null; degraded?: boolean }> {
  try {
    const res = await fetch("/api/account-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const j = await res.json();
    if (!j?.ok) return { state: "active", degraded: true };
    return j;
  } catch {
    // If the check fails, fall back to the plain password screen.
    return { state: "active", degraded: true };
  }
}

/** Account health for the whole roster (Admin → Team). Signed-in callers only. */
export type AccountHealth = { state: "no_account" | "needs_setup" | "active"; confirmed: boolean; lastSignInAt: string | null };
export async function accountHealth(emails: string[]): Promise<Record<string, AccountHealth>> {
  const s = c();
  if (!s) return {};
  const { data } = await s.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return {};
  try {
    const res = await fetch("/api/account-status", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ emails }),
    });
    const j = await res.json();
    return j?.ok ? (j.accounts ?? {}) : {};
  } catch { return {}; }
}

/** Friendlier wording for Supabase's terse sign-in errors. */
export function loginErrorHelp(msg: string): string {
  if (/invalid login credentials/i.test(msg)) {
    return "That password doesn't match — or you may never have set one. Use “Email me a set-up link” below.";
  }
  if (/email not confirmed|confirm/i.test(msg)) return "Your email isn't verified yet — check your inbox for the verification link.";
  return msg;
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
export type InviteResult = { ok: boolean; error?: string; emailed?: boolean; link?: string; linkType?: "invite" | "magiclink"; alreadyRegistered?: boolean; review?: InviteReview };

async function callInvite(email: string, mode: "email" | "link"): Promise<InviteResult> {
  let token: string | null = null;
  const s = c();
  if (s) { const { data } = await s.auth.getSession(); token = data.session?.access_token ?? null; }
  if (!token) return { ok: false, error: "Sign in with your real account to send invites (not available in demo mode)." };
  try {
    const res = await fetch("/api/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ email, mode, redirectTo: typeof window !== "undefined" ? window.location.origin : undefined }),
    });
    return await res.json();
  } catch {
    return { ok: false, error: "Couldn’t reach the invite service." };
  }
}

export const sendInviteEmail = (email: string) => callInvite(email, "email");

/** A one-click sign-in link to hand over by text/WhatsApp — bypasses email entirely.
 *  Existing accounts get a magic link; brand-new ones get an invite link. */
export const inviteLink = (email: string) => callInvite(email, "link");

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

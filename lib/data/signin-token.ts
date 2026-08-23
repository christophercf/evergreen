import { createHmac, timingSafeEqual } from "node:crypto";

// ----------------------------------------------------------------------------
// The hand-over sign-in link.
//
// Supabase's own email tokens are short-lived by design, and they should stay
// that way — raising the project's OTP expiry to a week would apply to every
// password reset and every 6-digit code, which is a bad trade for one feature.
//
// So the link an admin hands over is OURS: a signed, stateless token that lasts
// seven days. Redeeming it mints a FRESH Supabase link at that moment, server
// side, and bounces the browser straight through. The Supabase token is always
// seconds old, and the link in the text message cannot go stale.
//
// Stateless on purpose: project_state is readable by anyone holding the public
// key, so a token stored there would be a token handed out. Nothing is stored.
// ----------------------------------------------------------------------------

export type LinkPurpose = "signin" | "password";

export type TokenPayload = {
  /** Lowercased email the link is for. */
  e: string;
  /** Expiry, epoch ms. */
  x: number;
  /** What the link should do when redeemed. */
  p: LinkPurpose;
  /** Format version, so this can change shape later without ambiguity. */
  v: 1;
};

export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** Server-only signing key. A dedicated SIGNIN_LINK_SECRET is preferred; the
 *  service-role key is the fallback so this works without new configuration.
 *  Domain-separated so a signature here can never be mistaken for anything
 *  else signed with the same key. */
function secret(): string | null {
  const s = process.env.SIGNIN_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return s ? `evergreen.signin.v1:${s}` : null;
}

export function signToken(email: string, purpose: LinkPurpose, ttlMs = SEVEN_DAYS_MS): string | null {
  const key = secret();
  if (!key) return null;
  const payload: TokenPayload = { e: email.trim().toLowerCase(), x: Date.now() + ttlMs, p: purpose, v: 1 };
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = b64url(createHmac("sha256", key).update(body).digest());
  return `${body}.${sig}`;
}

export type VerifyResult =
  | { ok: true; payload: TokenPayload }
  | { ok: false; reason: "unconfigured" | "malformed" | "bad_signature" | "expired" };

export function verifyToken(token: string): VerifyResult {
  const key = secret();
  if (!key) return { ok: false, reason: "unconfigured" };
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return { ok: false, reason: "malformed" };

  const expected = createHmac("sha256", key).update(body).digest();
  const got = unb64url(sig);
  // Length check first: timingSafeEqual throws on a mismatch rather than
  // returning false, and a wrong-length signature is not a timing signal.
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return { ok: false, reason: "bad_signature" };

  let payload: TokenPayload;
  try { payload = JSON.parse(unb64url(body).toString("utf8")); } catch { return { ok: false, reason: "malformed" }; }
  if (!payload?.e || !payload?.x || payload.v !== 1) return { ok: false, reason: "malformed" };
  // Expiry is checked AFTER the signature, so an expired token is only ever
  // reported for something we actually issued.
  if (Date.now() > payload.x) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}

/** "6 days" / "4 hours" / "in a moment" — for telling someone how long a link
 *  they are holding has left. */
export function remaining(expiryMs: number): string {
  const ms = expiryMs - Date.now();
  if (ms <= 0) return "expired";
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const mins = Math.max(1, Math.floor(ms / 60_000));
  return `${mins} minute${mins === 1 ? "" : "s"}`;
}

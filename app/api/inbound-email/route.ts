import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Inbound email → Messenger reply.
//
// Outgoing notification emails carry a Reply-To of  reply+<token>@<domain>
// where <token> is the base64url-encoded conversation key (the sorted
// participant-id set). When the recipient replies from their inbox, the mail
// provider (Resend Inbound, CloudMailin, Mailgun routes, …) POSTs the parsed
// message here; we authenticate via a shared secret, map the sender's email
// to a project user, verify they're a participant, and append the reply to
// the conversation's latest update — exactly as if they'd replied in the app.
//
// Accepted payload shapes (tolerant): Resend's { type, data: {from, to,
// subject, text} } or a flat { from, to, subject, text }.

type Inbound = { from?: unknown; to?: unknown; subject?: unknown; text?: unknown; html?: unknown };

const firstEmail = (v: unknown): string | undefined => {
  const pick = (s: string) => (s.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) ?? [])[0];
  if (typeof v === "string") return pick(v);
  if (Array.isArray(v)) { for (const x of v) { const e = firstEmail(x); if (e) return e; } return undefined; }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return firstEmail(o.address ?? o.email ?? o.value ?? o.text);
  }
  return undefined;
};

/** Strip quoted history / signatures from an email reply body. */
function stripReply(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const ln of lines) {
    if (/^On .{5,80} wrote:\s*$/.test(ln)) break;              // Gmail-style
    if (/^-{3,}\s*Original Message\s*-{3,}/i.test(ln)) break;  // Outlook-style
    if (/^From:\s.+@.+/i.test(ln) && out.length) break;        // forwarded header
    if (/^>{1}/.test(ln)) continue;                            // quoted lines
    if (/^—$/.test(ln.trim()) || ln.includes("Reply in the app:")) break; // our own footer
    out.push(ln);
  }
  return out.join("\n").trim().slice(0, 4000);
}

export async function POST(req: NextRequest) {
  const secret = process.env.INBOUND_WEBHOOK_SECRET;
  if (!secret || req.nextUrl.searchParams.get("key") !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) return NextResponse.json({ ok: false, error: "Server not configured" }, { status: 500 });

  let raw: Record<string, unknown>;
  try { raw = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Bad body" }, { status: 400 }); }
  const p = ((raw.data ?? raw) as Inbound);

  const fromEmail = firstEmail(p.from)?.toLowerCase();
  const toEmail = firstEmail(p.to);
  const bodyText = typeof p.text === "string" && p.text.trim() ? p.text : typeof p.html === "string" ? p.html.replace(/<[^>]+>/g, " ") : "";
  const body = stripReply(bodyText);
  if (!fromEmail || !toEmail) return NextResponse.json({ ok: false, error: "Missing from/to" }, { status: 400 });
  if (!body) return NextResponse.json({ ok: false, error: "Empty reply body" }, { status: 400 });

  // Conversation token from  reply+<token>@domain
  const m = toEmail.match(/^reply\+([A-Za-z0-9_-]+)@/i);
  if (!m) return NextResponse.json({ ok: false, error: "No conversation token in address" }, { status: 400 });
  let convKey: string;
  try { convKey = Buffer.from(m[1], "base64url").toString("utf8"); } catch { return NextResponse.json({ ok: false, error: "Bad token" }, { status: 400 }); }
  const participantIds = convKey.split("+").filter(Boolean);
  if (participantIds.length < 2) return NextResponse.json({ ok: false, error: "Bad conversation key" }, { status: 400 });

  // Load the project state server-side.
  const H = { apikey: svc, Authorization: `Bearer ${svc}` };
  const res = await fetch(`${url}/rest/v1/project_state?id=eq.evergreen&select=db`, { headers: H, cache: "no-store" });
  if (!res.ok) return NextResponse.json({ ok: false, error: "DB read failed" }, { status: 502 });
  const rows = await res.json();
  const db = rows[0]?.db;
  if (!db) return NextResponse.json({ ok: false, error: "No project state" }, { status: 502 });

  // Sender must be a project user AND a participant of this conversation.
  const sender = (db.users as { id: string; name: string; email: string }[]).find((u) => u.email?.toLowerCase() === fromEmail);
  if (!sender) return NextResponse.json({ ok: false, error: "Sender not a project member" }, { status: 403 });
  if (!participantIds.includes(sender.id)) return NextResponse.json({ ok: false, error: "Sender not in this conversation" }, { status: 403 });

  // Append to the conversation's latest update (or start one if none exists).
  type Upd = { id: string; authorId: string; toUserIds: string[]; at: string; replies: unknown[]; title: string };
  const convOf = (u: Upd) => [...new Set([u.authorId, ...u.toUserIds])].sort().join("+");
  const updates = (db.updates as Upd[]).filter((u) => convOf(u) === convKey);
  const now = new Date().toISOString();
  const rid = () => `${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`;
  if (updates.length) {
    const latest = updates.reduce((a, b) => (a.at > b.at ? a : b));
    latest.replies.push({ id: `rep-${rid()}`, authorId: sender.id, authorName: sender.name, at: now, body });
  } else {
    (db.updates as unknown[]).unshift({
      id: `upd-${rid()}`, title: body.split("\n")[0].slice(0, 60), body,
      authorId: sender.id, authorName: sender.name, at: now,
      toUserIds: participantIds.filter((id) => id !== sender.id), replies: [],
    });
  }
  // In-app notification for the other participants.
  for (const uid of participantIds.filter((id) => id !== sender.id)) {
    (db.notifications as unknown[]).unshift({ id: `n-${rid()}`, toUserId: uid, kind: "info", message: `📧 ${sender.name} replied by email: "${body.slice(0, 60)}"`, createdAt: now, read: false });
  }

  const put = await fetch(`${url}/rest/v1/project_state?id=eq.evergreen`, {
    method: "PATCH",
    headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ db }),
  });
  if (!put.ok) return NextResponse.json({ ok: false, error: "DB write failed" }, { status: 502 });
  return NextResponse.json({ ok: true, threaded: true, conversation: convKey, from: sender.name });
}

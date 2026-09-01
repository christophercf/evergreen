import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Inbound email → Receipts inbox.
//
// Bills and receipts forwarded to the project's receipts alias arrive here as
// a webhook POST from the inbound-mail provider (CloudMailin JSON format, or
// anything shaped like it). We authenticate with the shared secret, require
// the SENDER to be a project member (a stranger who finds the alias cannot
// inject bills into the review queue), keep the original attachment in
// Storage as evidence, have Claude read it into structured fields with a
// suggested budget line — and file the whole thing as a PENDING suggestion.
// Nothing touches the money here: the owner reviews and confirms in the app.

const BUCKET = "artifacts";

type Attachment = { content?: string; file_name?: string; fileName?: string; filename?: string; content_type?: string; contentType?: string; type?: string };

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

const rid = () => `${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`;

function extractJSON(text: string): Record<string, unknown> {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no json");
  return JSON.parse(m[0]) as Record<string, unknown>;
}

/** The attachment types Claude vision can read directly. */
const IMG_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

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

  // CloudMailin: { envelope: {from,to}, headers: {subject,...}, plain, html, attachments: [...] }
  // Tolerant of flat shapes too.
  const envelope = (raw.envelope ?? {}) as Record<string, unknown>;
  const headers = (raw.headers ?? {}) as Record<string, unknown>;
  const fromEmail = (firstEmail(envelope.from ?? raw.from) ?? "").toLowerCase();
  const subject = typeof headers.subject === "string" ? headers.subject : typeof raw.subject === "string" ? raw.subject : "";
  const bodyText = typeof raw.plain === "string" && raw.plain.trim() ? raw.plain
    : typeof raw.text === "string" && (raw.text as string).trim() ? raw.text as string
    : typeof raw.html === "string" ? (raw.html as string).replace(/<[^>]+>/g, " ") : "";
  const attachments = (Array.isArray(raw.attachments) ? raw.attachments : []) as Attachment[];
  if (!fromEmail) return NextResponse.json({ ok: false, error: "Missing sender" }, { status: 400 });

  // Load the project state server-side.
  const H = { apikey: svc, Authorization: `Bearer ${svc}` };
  const res = await fetch(`${url}/rest/v1/project_state?id=eq.evergreen&select=db`, { headers: H, cache: "no-store" });
  if (!res.ok) return NextResponse.json({ ok: false, error: "DB read failed" }, { status: 502 });
  const rows = await res.json();
  const db = rows[0]?.db;
  if (!db) return NextResponse.json({ ok: false, error: "No project state" }, { status: 502 });

  // Sender allowlist: only project members' mail is accepted. Answer 200 so
  // the provider doesn't retry-bomb, but file nothing.
  type U = { id: string; name: string; email: string; role: string; status?: string; disabled?: boolean };
  const sender = (db.users as U[]).find((u) => u.email?.trim().toLowerCase() === fromEmail && !u.disabled);
  if (!sender) return NextResponse.json({ ok: true, filed: false, skipped: "Sender not on the project" });

  // Pick the first readable attachment (image or PDF).
  const att = attachments.find((a) => {
    const t = (a.content_type ?? a.contentType ?? a.type ?? "").toLowerCase();
    return (IMG_TYPES.has(t) || t === "application/pdf") && typeof a.content === "string" && a.content.length > 100;
  });
  const attType = att ? (att.content_type ?? att.contentType ?? att.type ?? "").toLowerCase() : "";
  const attName = att ? (att.file_name ?? att.fileName ?? att.filename ?? (attType === "application/pdf" ? "receipt.pdf" : "receipt.jpg")) : undefined;

  // Keep the original in Storage — the evidence the owner reviews against.
  let fileUrl: string | undefined;
  if (att?.content) {
    try {
      const admin = createClient(url, svc, { auth: { persistSession: false, autoRefreshToken: false } });
      await admin.storage.createBucket(BUCKET, { public: true }).catch(() => {});
      const safe = (attName ?? "receipt").replace(/[^a-z0-9.\-_]+/gi, "_").slice(-80);
      const path = `receipts/${Date.now()}-${rid()}-${safe}`;
      const bytes = Buffer.from(att.content.replace(/\s/g, ""), "base64");
      const up = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: attType || "application/octet-stream" });
      if (!up.error) fileUrl = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    } catch { /* the suggestion still files without the file */ }
  }

  // Ask Claude to read it. Failure is survivable: the receipt still lands in
  // the inbox with empty fields for the owner to fill by hand.
  type Line = { id: string; name: string; tradeId: string };
  type Agr = { tradeId: string; contract?: { vendorName?: string } };
  const lines = (db.costLines as Line[]).map((l) => {
    const vendor = (db.vendorAgreements as Agr[]).find((a) => a.tradeId === l.tradeId)?.contract?.vendorName;
    return `${l.id} | ${l.name}${vendor ? ` | contracted vendor: ${vendor}` : ""}`;
  }).slice(0, 60).join("\n");

  let parsed: { vendor?: string; date?: string; amount?: number; summary?: string; suggestedLineId?: string; suggestedReason?: string; confidence?: string } = {};
  const key = process.env.ANTHROPIC_API_KEY;
  if (key) {
    try {
      const client = new Anthropic({ apiKey: key });
      const instruction =
        `You are reading a receipt or bill forwarded to a home-renovation project's expense inbox.\n` +
        `Extract the facts, then suggest which budget line it belongs to from this list (format: id | name | vendor):\n${lines}\n\n` +
        `Email subject: ${subject || "(none)"}\nForwarded by: ${sender.name}\n` +
        (bodyText.trim() ? `Email body (may carry the bill itself, or context):\n${bodyText.slice(0, 3000)}\n\n` : "") +
        `Respond with ONLY a JSON object, no prose, exactly:\n` +
        `{"vendor":"string","date":"YYYY-MM-DD or empty","amount":number (the total paid, USD),"summary":"one line: what was bought","suggestedLineId":"an id from the list, or empty if nothing fits","suggestedReason":"one short sentence","confidence":"high|medium|low"}`;
      const content: Anthropic.ContentBlockParam[] = [];
      if (att?.content && IMG_TYPES.has(attType)) {
        content.push({ type: "image", source: { type: "base64", media_type: attType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: att.content.replace(/\s/g, "") } });
      } else if (att?.content && attType === "application/pdf") {
        content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: att.content.replace(/\s/g, "") } });
      }
      content.push({ type: "text", text: instruction });
      const response = await client.messages.create({ model: "claude-sonnet-5", max_tokens: 700, messages: [{ role: "user", content }] });
      const text = response.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("\n");
      const j = extractJSON(text);
      const lineOk = typeof j.suggestedLineId === "string" && (db.costLines as Line[]).some((l) => l.id === j.suggestedLineId);
      parsed = {
        vendor: typeof j.vendor === "string" ? j.vendor.slice(0, 120) : undefined,
        date: typeof j.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(j.date) ? j.date : undefined,
        amount: typeof j.amount === "number" && isFinite(j.amount) && j.amount > 0 ? Math.round(j.amount * 100) / 100 : undefined,
        summary: typeof j.summary === "string" ? j.summary.slice(0, 300) : undefined,
        suggestedLineId: lineOk ? (j.suggestedLineId as string) : undefined,
        suggestedReason: lineOk && typeof j.suggestedReason === "string" ? j.suggestedReason.slice(0, 200) : undefined,
        confidence: j.confidence === "high" || j.confidence === "medium" || j.confidence === "low" ? j.confidence : undefined,
      };
    } catch { /* fall through — the owner can read the original */ }
  }

  const now = new Date().toISOString();
  const receipt = {
    id: `rcp-${rid()}`,
    receivedAt: now,
    fromEmail,
    subject: subject.slice(0, 160) || undefined,
    fileUrl,
    fileName: attName,
    ...parsed,
    status: "pending" as const,
  };
  db.receipts = Array.isArray(db.receipts) ? db.receipts : [];
  (db.receipts as unknown[]).unshift(receipt);

  // Tell the reviewers — the owner(s) and the full admin.
  for (const u of (db.users as U[]).filter((x) => (x.role === "owner" || x.role === "full_admin") && !x.disabled)) {
    (db.notifications as unknown[]).unshift({
      id: `n-${rid()}`, toUserId: u.id, kind: "info", module: "costs",
      message: `🧾 Receipt from ${sender.name}${parsed.vendor ? ` — ${parsed.vendor}` : ""}${parsed.amount ? ` · $${parsed.amount.toLocaleString()}` : ""} — review it in Budget Management`,
      createdAt: now, read: false,
    });
  }

  const put = await fetch(`${url}/rest/v1/project_state?id=eq.evergreen`, {
    method: "PATCH",
    headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ db }),
  });
  if (!put.ok) return NextResponse.json({ ok: false, error: "DB write failed" }, { status: 502 });
  return NextResponse.json({ ok: true, filed: true, id: receipt.id, parsed: !!parsed.amount });
}

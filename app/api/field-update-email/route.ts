import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Email delivery for a published Field Update. The email IS the report — the
// same masthead / decisions-first / red / progress layout the app renders —
// laid out for the inbox: one column, no app chrome, a plain link back into
// Evergreen at the bottom. Uses Resend when RESEND_API_KEY is configured;
// otherwise it no-ops so the in-app flow keeps working.
//
// The body is STRUCTURED (items, not raw HTML) so this endpoint can never be
// used to mail arbitrary markup to arbitrary addresses.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type MailItem = {
  text?: string;
  line?: string;
  rag?: "green" | "yellow" | "red";
  ask?: string;
  /** http(s) photo URLs; data URLs are dropped client-side (too big to mail). */
  photos?: string[];
  photoCount?: number;
};

const RAG_STYLE: Record<string, { label: string; fg: string; bg: string; border: string }> = {
  red: { label: "RED", fg: "#8a4029", bg: "#f0e2d8", border: "#a8553c" },
  yellow: { label: "YELLOW", fg: "#7a5d1f", bg: "#f5ecd7", border: "#c2a14a" },
  green: { label: "GREEN", fg: "#33452a", bg: "#e6ebdd", border: "#6b7f5b" },
};

const chip = (label: string, s: { fg: string; bg: string; border: string }) =>
  `<span style="display:inline-block;font-family:Arial,sans-serif;font-size:11px;letter-spacing:.08em;text-transform:uppercase;background:${s.bg};color:${s.fg};border:1px solid ${s.border};border-radius:2px;padding:3px 9px;margin:0 6px 6px 0;">${esc(label)}</span>`;

function photoBlock(it: MailItem): string {
  const urls = (it.photos ?? []).filter((p) => typeof p === "string" && /^https?:\/\//i.test(p)).slice(0, 4);
  if (urls.length) {
    return `<div style="margin-top:8px;">${urls
      .map((u) => `<img src="${esc(u)}" alt="Site photo" style="max-width:100%;width:220px;border-radius:3px;border:1px solid #ddd2bd;margin:0 6px 6px 0;vertical-align:top;" />`)
      .join("")}</div>`;
  }
  const n = it.photoCount ?? 0;
  return n ? `<div style="font-size:12px;color:#7a6f60;margin-top:6px;">&#128247; ${n} photo${n === 1 ? "" : "s"} &mdash; view them in the app.</div>` : "";
}

function renderReport(o: {
  projectName: string; no: string; title: string; dateLabel: string; by: string;
  items: MailItem[]; viewUrl: string; ownerFirst?: string;
}): string {
  const items = o.items;
  const asks = items.filter((i) => (i.ask ?? "").trim());
  const reds = items.filter((i) => i.rag === "red");
  const rest = items
    .filter((i) => i.rag !== "red")
    .sort((a, b) => (a.rag === "yellow" ? 0 : 1) - (b.rag === "yellow" ? 0 : 1));
  const yelN = items.filter((i) => i.rag === "yellow").length;
  const grnN = items.filter((i) => i.rag === "green").length;

  const summaryChips = [
    reds.length ? chip(`${reds.length} Red`, RAG_STYLE.red) : "",
    yelN ? chip(`${yelN} Yellow`, RAG_STYLE.yellow) : "",
    grnN ? chip(`${grnN} Green`, RAG_STYLE.green) : "",
    asks.length ? chip(`${asks.length} for ${o.ownerFirst ?? "the owner"}`, { fg: "#f0e6cd", bg: "#3a2f25", border: "#3a2f25" }) : "",
  ].join("");

  const askCards = asks
    .map(
      (i) => `<div style="background:#fffdf7;border:1px solid #c2a14a;border-radius:3px;padding:11px 13px;margin-bottom:10px;">
        <div style="font-family:Georgia,serif;font-size:15px;line-height:1.45;color:#3a2f25;">${esc(i.ask ?? "")}</div>
        <div style="font-size:12.5px;line-height:1.5;color:#7a6f60;margin-top:5px;">${esc(i.line ?? "")} &mdash; ${esc(i.text ?? "")}</div>
      </div>`,
    )
    .join("");

  const redCards = reds
    .map(
      (i) => `<div style="border:1px solid #a8553c;border-left:5px solid #a8553c;border-radius:3px;background:#f0e2d8;padding:12px 14px;margin-bottom:10px;">
        <div style="font-size:11.5px;color:#8a4029;letter-spacing:.06em;text-transform:uppercase;font-family:Arial,sans-serif;">${esc(i.line ?? "")}</div>
        <div style="font-size:14px;line-height:1.5;color:#2c241c;margin-top:6px;">${esc(i.text ?? "")}</div>
        ${photoBlock(i)}
      </div>`,
    )
    .join("");

  const restRows = rest
    .map((i) => {
      const s = RAG_STYLE[i.rag ?? "green"] ?? RAG_STYLE.green;
      return `<div style="border-bottom:1px solid #efe8d6;padding-bottom:10px;margin-bottom:10px;">
        <div>${chip(s.label, s)}<span style="font-size:12px;color:#7a6f60;">${esc(i.line ?? "")}</span></div>
        <div style="font-size:13.5px;line-height:1.5;color:#2c241c;margin-top:5px;">${esc(i.text ?? "")}</div>
        ${photoBlock(i)}
      </div>`;
    })
    .join("");

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4efe3;font-family:Georgia,'Times New Roman',serif;">
  <div style="max-width:620px;margin:0 auto;padding:24px 12px;">
    <div style="background:#fffdf7;border:1px solid #c9bfa8;border-radius:3px;overflow:hidden;">
      <div style="background:#3a2f25;color:#f5f0e4;padding:16px 20px;">
        <div style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#c9bfa8;">EVERGREEN AI &middot; ${esc(o.projectName)} &middot; FIELD UPDATE No ${esc(o.no)}</div>
        <div style="font-family:Georgia,serif;font-size:21px;line-height:1.15;margin-top:4px;">${esc(o.title)}</div>
        <div style="font-size:12px;color:#c9bfa8;margin-top:4px;">${esc(o.dateLabel)} &middot; ${esc(o.by)}, General Contractor</div>
      </div>
      <div style="padding:13px 20px 7px;border-bottom:1px solid #ddd2bd;background:#f5f0e4;">${summaryChips}</div>
      ${asks.length ? `<div style="padding:16px 20px;border-bottom:1px solid #ddd2bd;background:#f5ecd7;">
        <div style="font-family:Arial,sans-serif;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#7a5d1f;margin-bottom:10px;">Needs your decision</div>
        ${askCards}
      </div>` : ""}
      ${reds.length ? `<div style="padding:16px 20px;border-bottom:1px solid #ddd2bd;">
        <div style="font-family:Arial,sans-serif;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#8a4029;margin-bottom:10px;">Flagged red</div>
        ${redCards}
      </div>` : ""}
      ${rest.length ? `<div style="padding:16px 20px;">
        <div style="font-family:Arial,sans-serif;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#8f6f2e;margin-bottom:10px;">Progress</div>
        ${restRows}
      </div>` : ""}
      <div style="padding:14px 20px 18px;border-top:1px solid #ddd2bd;">
        <a href="${esc(o.viewUrl)}" style="display:inline-block;background:#6b7f5b;color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;padding:12px 26px;border-radius:99px;">Open this update in Evergreen</a>
        <div style="font-size:10.5px;line-height:1.5;color:#8a7f6c;margin-top:10px;">Evergreen AI &middot; ${esc(o.projectName)} &middot; You receive these because you are on this project. Reply to ${esc(o.by)} in Messages.</div>
      </div>
    </div>
  </div>
</body></html>`;
}

export async function POST(req: NextRequest) {
  const key = process.env.RESEND_API_KEY;
  let payload: {
    to?: string[]; projectName?: string; no?: string | number; title?: string;
    dateLabel?: string; by?: string; viewUrl?: string; ownerFirst?: string; items?: MailItem[];
  };
  try { payload = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Bad body" }, { status: 400 }); }
  const to = (payload.to ?? []).filter((e) => typeof e === "string" && e.includes("@")).slice(0, 20);
  const items = Array.isArray(payload.items) ? payload.items.slice(0, 40) : [];
  if (!to.length || !payload.title || !items.length) return NextResponse.json({ ok: false, error: "Missing to/title/items" }, { status: 400 });
  if (!key) return NextResponse.json({ ok: true, sent: false, skipped: "RESEND_API_KEY not configured" });

  const from = process.env.EMAIL_FROM || "Evergreen AI <onboarding@resend.dev>";
  const no = String(payload.no ?? "").padStart(2, "0");
  const subject = `Field update No ${no} — ${payload.title}`;
  const viewUrl = payload.viewUrl || "https://evergreen-rust-five.vercel.app/field-updates";
  const html = renderReport({
    projectName: payload.projectName || "31810 Evergreen Rd",
    no, title: payload.title, dateLabel: payload.dateLabel || "", by: payload.by || "The GC",
    items, viewUrl, ownerFirst: payload.ownerFirst,
  });
  const text = items
    .map((i) => `[${(i.rag ?? "green").toUpperCase()}] ${i.line ?? ""} — ${i.text ?? ""}${(i.ask ?? "").trim() ? `\n  NEEDS YOUR DECISION: ${i.ask}` : ""}`)
    .join("\n\n") + `\n\n—\nOpen this update in Evergreen: ${viewUrl}`;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, text, html }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return NextResponse.json({ ok: false, error: j?.message ?? `Resend ${r.status}` });
    return NextResponse.json({ ok: true, sent: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Email service unreachable" });
  }
}

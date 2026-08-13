import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const maxDuration = 120;

// Apples-to-apples check. Given the package scope and each vendor's submitted
// scope, Claude flags which bids are actually comparable, what each one appears
// to be MISSING versus the package, and what EXTRA work it includes — so a low
// number that quietly drops half the scope can't win by default.

type Body = {
  title?: string;
  trade?: string;
  scopeItems?: string[];
  scopeDetails?: string;
  bids?: { id: string; vendorName: string; amount?: number; scopeText?: string }[];
};

const SHAPE = `{
  "bids": [ { "id": "string (echo the bid id)", "comparable": true, "missing": ["scope item this bid does not appear to cover"], "extra": ["work this bid adds beyond the package"], "note": "string (one short sentence for the builder)" } ],
  "summary": "string (one or two sentences: are these apples-to-apples, and what should the builder watch out for)"
}`;

function extractJSON(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(candidate);
}

export async function POST(req: Request) {
  let body: Body = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const bids = (body.bids ?? []).filter((b) => (b.scopeText ?? "").trim().length > 3);
  if (bids.length < 1) return NextResponse.json({ ok: false, error: "Add each vendor's submitted scope first — there's nothing to compare yet." });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: false, configured: false, error: "AI comparison isn't configured — add ANTHROPIC_API_KEY." });

  const client = new Anthropic({ apiKey });
  const scope = (body.scopeItems ?? []).length
    ? (body.scopeItems ?? []).map((s) => `- ${s}`).join("\n")
    : (body.scopeDetails ?? "(no scope recorded)");

  const prompt =
    `You are helping a residential general contractor compare competing subcontractor bids for the same job. ` +
    `Decide whether each bid is truly apples-to-apples with the requested scope.\n\n` +
    `JOB: ${body.title ?? "(untitled)"}${body.trade ? ` (trade: ${body.trade})` : ""}\n\n` +
    `REQUESTED SCOPE:\n${scope}\n\n` +
    `BIDS:\n${bids.map((b) => `--- id: ${b.id} · vendor: ${b.vendorName}${b.amount != null ? ` · price: $${b.amount.toLocaleString()}` : ""}\n${b.scopeText}`).join("\n\n")}\n\n` +
    `Rules:\n` +
    `- "missing" = requested scope items this bid does not appear to include. Be specific and quote the scope item.\n` +
    `- "extra" = work this bid includes that the package did not ask for.\n` +
    `- comparable = false when the bid omits or adds enough that comparing prices head-to-head would mislead.\n` +
    `- Judge only from the text given. If a bid is vague rather than clearly missing something, say so in "note" rather than inventing omissions.\n` +
    `- Keep every string short and plain — this is read on a phone on a job site.\n\n` +
    `Respond with ONLY a JSON object in exactly this shape (no prose, no markdown fences):\n${SHAPE}`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("\n").trim();
    try {
      return NextResponse.json({ ok: true, data: extractJSON(text) });
    } catch {
      return NextResponse.json({ ok: true, data: { bids: [], summary: text.slice(0, 600) } });
    }
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `${e.status ?? ""} ${e.message}`.trim() : e instanceof Error ? e.message : "Comparison failed.";
    return NextResponse.json({ ok: false, error: msg });
  }
}

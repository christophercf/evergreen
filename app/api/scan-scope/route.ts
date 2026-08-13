import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const maxDuration = 120;

// Scan a vendor's own scope — a PDF they emailed, or a phone photo of a paper
// quote — and translate it into the same line-item format as the trade default
// template, so an imported scope is instantly comparable with everyone else's.

type Body = { data?: string; mediaType?: string; fileName?: string; templateItems?: string[]; trade?: string };

const SHAPE = `{
  "vendor": "string (company name if visible, else empty)",
  "items": ["one scope line item per entry, imperative and specific, in the same style as the template"],
  "price": 0,
  "materialsIncluded": "included | labor_only | partial | unclear",
  "ownerSupplied": ["materials the document says the owner/client must provide"],
  "exclusions": ["anything the document explicitly excludes"],
  "leadTime": "string (start date or lead time if stated, else empty)",
  "permits": "string (who pulls/pays for permits, if stated, else empty)",
  "warranty": "string (if stated, else empty)",
  "confidence": "high | medium | low",
  "note": "string (one sentence: anything the builder should eyeball on the original)"
}`;

function extractJSON(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(candidate);
}

export async function POST(req: Request) {
  let body: Body = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const data = body.data;
  const mediaType = body.mediaType ?? "application/pdf";
  if (!data) return NextResponse.json({ ok: false, error: "No file received." }, { status: 400 });
  // Base64 is ~4/3 of the byte size; keep well under the serverless body cap.
  if (data.length > 5_500_000) return NextResponse.json({ ok: false, error: "That file is too large to scan (about 4MB max). Try a photo of just the scope pages, or a smaller PDF." });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: false, configured: false, error: "Scanning isn't configured — add ANTHROPIC_API_KEY." });

  const isPdf = mediaType.includes("pdf");
  const client = new Anthropic({ apiKey });

  const tpl = (body.templateItems ?? []).filter(Boolean);
  const prompt =
    `You are reading a subcontractor's scope of work for a residential renovation${body.trade ? ` (trade: ${body.trade})` : ""}. ` +
    `Transcribe it into structured scope line items so it can be compared against competing bids.\n\n` +
    (tpl.length
      ? `Match the style and granularity of this project's template, and where the document covers the same work, reuse the template's wording so the lists line up:\n${tpl.map((t) => `- ${t}`).join("\n")}\n\n`
      : `Write each line item as a short imperative task, one piece of work per line.\n\n`) +
    `Rules:\n` +
    `- Transcribe what the document actually says. Never invent scope that isn't there.\n` +
    `- "price" = the overall total as a number (no currency symbols or commas). Use 0 if no total is shown.\n` +
    `- If the handwriting or scan is unclear, lower "confidence" and say what to check in "note".\n` +
    `- Keep every string short and plain — this is read on a phone.\n\n` +
    `Respond with ONLY a JSON object in exactly this shape (no prose, no markdown fences):\n${SHAPE}`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 3000,
      messages: [{
        role: "user",
        content: [
          isPdf
            ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
            : { type: "image", source: { type: "base64", media_type: (mediaType || "image/jpeg") as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data } },
          { type: "text", text: prompt },
        ],
      }],
    });
    const text = response.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("\n").trim();
    try {
      return NextResponse.json({ ok: true, data: extractJSON(text) });
    } catch {
      return NextResponse.json({ ok: false, error: "Couldn't read a scope out of that file. Try a clearer photo, or paste the text instead." });
    }
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `${e.status ?? ""} ${e.message}`.trim() : e instanceof Error ? e.message : "Scan failed.";
    return NextResponse.json({ ok: false, error: msg });
  }
}

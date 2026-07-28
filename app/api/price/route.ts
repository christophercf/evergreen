import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

// Pricing AI for a material: Claude researches real, current US prices with the
// web-search tool and returns a small set of sourcing options + any rebates.
// Requires ANTHROPIC_API_KEY in the server env (never exposed to the client).

export const runtime = "nodejs";
export const maxDuration = 300; // web-search research runs well past 60s

type Body = { item?: string; desc?: string; specs?: string; specLink?: string; qty?: number; room?: string; category?: string };

const SHAPE = `{
  "options": [ { "vendor": "string (retailer or brand)", "product": "string (exact product/model)", "price": "string like \\"$182\\" or \\"$180–$210\\"", "url": "string (direct product page URL)", "note": "string (why it fits / shipping / in-stock)" } ],
  "rebates": [ "string (any federal/state/utility rebate or tax incentive that applies, else omit)" ],
  "summary": "string (one-line recommendation)"
}`;

function extractJSON(text: string): unknown {
  // Prefer a fenced block, else the outermost {...}.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(candidate);
}

export async function POST(req: Request) {
  let body: Body = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const item = body.item?.trim();
  if (!item) return NextResponse.json({ ok: false, error: "No material specified." });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, configured: false, error: "Pricing AI isn’t configured yet — add ANTHROPIC_API_KEY to the Vercel project’s environment variables to enable it." });
  }

  const client = new Anthropic({ apiKey });

  const context = [
    `Material: ${item}`,
    body.desc ? `Description: ${body.desc}` : "",
    body.specs ? `Specs: ${body.specs}` : "",
    body.category ? `Category: ${body.category}` : "",
    body.room ? `Room: ${body.room}` : "",
    body.qty && body.qty > 1 ? `Quantity needed: ${body.qty}` : "",
    body.specLink ? `Reference product URL: ${body.specLink}` : "",
  ].filter(Boolean).join("\n");

  const prompt =
    `You are sourcing a building/renovation material for a US home renovation. Search the web for REAL, current listings and find the best 3–5 options to buy this item.\n\n${context}\n\n` +
    `Requirements:\n` +
    `- Use web search to find actual current prices and in-stock product pages (Home Depot, Lowe's, Build.com, Ferguson, Wayfair, Amazon, manufacturer sites, etc.).\n` +
    `- Give the exact product/model and a direct product-page URL for each option.\n` +
    `- Prefer options that match the description/specs and reference URL if given.\n` +
    `- Include any applicable federal/state/utility rebates or tax incentives (e.g. heat-pump water heaters, efficient windows) in "rebates".\n` +
    `- Prices in USD.\n\n` +
    `After researching, respond with ONLY a JSON object (no prose, no markdown fences) in exactly this shape:\n${SHAPE}`;

  try {
    const tools = [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }] as unknown as Anthropic.Tool[];
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];

    let response: Anthropic.Message | null = null;
    for (let i = 0; i < 5; i++) {
      response = await client.messages.create({
        // Sonnet 5: near-Opus quality on product sourcing at a fraction of the
        // latency — keeps the lookup inside the serverless time budget.
        model: "claude-sonnet-5",
        max_tokens: 4096,
        tools,
        messages,
      });
      if (response.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: response.content });
        continue;
      }
      break;
    }

    if (!response) return NextResponse.json({ ok: false, error: "No response from the model." });
    if (response.stop_reason === "refusal") {
      return NextResponse.json({ ok: false, error: "The model declined to answer this request." });
    }

    const text = response.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("\n").trim();
    try {
      const data = extractJSON(text);
      return NextResponse.json({ ok: true, data });
    } catch {
      // Couldn't parse structured output — hand back the prose so the UI can still show something.
      return NextResponse.json({ ok: true, data: { options: [], rebates: [], summary: text.slice(0, 600) } });
    }
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `${e.status ?? ""} ${e.message}`.trim() : e instanceof Error ? e.message : "Pricing lookup failed.";
    return NextResponse.json({ ok: false, error: msg });
  }
}

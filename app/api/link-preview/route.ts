import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// In-memory cache (per serverless instance) so repeat views don't refetch.
const cache = new Map<string, { image?: string; title?: string; at: number }>();
const TTL = 1000 * 60 * 60; // 1h

function absolutize(src: string, base: string): string | undefined {
  try { return new URL(src, base).href; } catch { return undefined; }
}

/** Pull a representative image + title out of a product page's HTML. */
function extract(html: string, base: string): { image?: string; title?: string } {
  const meta = (names: string[]): string | undefined => {
    for (const n of names) {
      // property/name can appear before or after content
      const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]+content=["']([^"']+)["']`, "i");
      const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${n}["']`, "i");
      const m = html.match(re1) ?? html.match(re2);
      if (m?.[1]) return m[1];
    }
    return undefined;
  };
  let image = meta(["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"]);
  if (!image) {
    const link = html.match(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i);
    if (link?.[1]) image = link[1];
  }
  if (!image) {
    // Product JSON-LD — many retailers embed it even without og tags.
    const ld = html.match(/"image"\s*:\s*\[?\s*"(https?:[^"\\]+)"/);
    if (ld?.[1]) image = ld[1];
  }
  const title = meta(["og:title", "twitter:title"]) ?? html.match(/<title[^>]*>([^<]{1,200})/i)?.[1]?.trim();
  return { image: image ? absolutize(image, base) : undefined, title };
}

// Some stores (notably Amazon) hide og tags from browsers but serve them to
// social-preview crawlers — try a normal browser first, then the crawler UA.
const UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
];

async function fetchExtract(url: string, ua: string): Promise<{ image?: string; title?: string } | null> {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: "follow",
      headers: { "User-Agent": ua, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" },
    });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 400_000);
    return extract(html, res.url || url);
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url") ?? "";
  let target: URL;
  try { target = new URL(url); } catch { return NextResponse.json({ ok: false, error: "Bad URL" }, { status: 400 }); }
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return NextResponse.json({ ok: false, error: "Bad URL" }, { status: 400 });
  }

  const hit = cache.get(target.href);
  if (hit && Date.now() - hit.at < TTL) return NextResponse.json({ ok: true, image: hit.image, title: hit.title, cached: true });

  // Try each user-agent until one yields an image; keep the best titled result.
  let best: { image?: string; title?: string } | null = null;
  for (const ua of UAS) {
    const out = await fetchExtract(target.href, ua);
    if (out) {
      if (!best || (!best.image && out.image)) best = out;
      if (out.image) break;
    }
  }
  // Cache hits AND misses (negative cache stops us hammering bot-walled hosts).
  cache.set(target.href, { ...(best ?? {}), at: Date.now() });
  if (!best) return NextResponse.json({ ok: false, error: "Blocked or unreachable" });
  return NextResponse.json({ ok: true, ...best });
}

// Client-side file helpers. Uploaded images are downscaled + recompressed to a
// data URL so they fit in the single-row mock/Supabase state without ballooning.
// Non-image files fall back to a raw data URL (use Drive links for large files).

import { IS_SUPABASE } from "@/lib/data/config";

// Store a file for an artifact. In Supabase mode, uploads to Storage and returns
// a public URL (so large PDFs/drawings work). Otherwise (mock, or if storage
// isn't configured / fails), keeps it inline as a data URL (images compressed).
export async function storeFile(file: File): Promise<{ fileUrl: string; fileName: string }> {
  if (IS_SUPABASE) {
    try {
      // 1) get a signed upload URL (server, service role)
      const r = await fetch("/api/upload", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: file.name }) });
      if (r.ok) {
        const j = await r.json();
        if (j?.ok && j.signedUrl && j.publicUrl) {
          // 2) PUT the file straight to Storage (no serverless body limit)
          const put = await fetch(j.signedUrl, { method: "PUT", headers: { "content-type": file.type || "application/octet-stream", "x-upsert": "true" }, body: file });
          if (put.ok) return { fileUrl: j.publicUrl as string, fileName: file.name };
        }
      }
    } catch {
      /* fall through to inline */
    }
  }
  return { fileUrl: await fileToDataURL(file), fileName: file.name };
}

/** Split a file into the base64 payload the Anthropic API expects. Images are
 *  downscaled first; PDFs pass through untouched. */
export async function fileToBase64Payload(file: File): Promise<{ data: string; mediaType: string }> {
  const url = await fileToDataURL(file);
  const m = url.match(/^data:([^;]+);base64,(.*)$/);
  if (!m) return { data: "", mediaType: file.type || "application/octet-stream" };
  return { mediaType: m[1], data: m[2] };
}

export async function fileToDataURL(file: File, maxDim = 1500, quality = 0.72): Promise<string> {
  if (!file.type.startsWith("image/")) return rawDataURL(file);
  const raw = await rawDataURL(file);
  try {
    const img = await loadImage(raw);
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
    const type = file.type === "image/png" ? "image/png" : "image/jpeg";
    return canvas.toDataURL(type, quality);
  } catch {
    return raw; // if anything fails, keep the original
  }
}

function rawDataURL(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

// Normalize a Google Drive "share" link into a direct-view link where possible.
export function driveViewLink(url: string): string {
  const m = url.match(/\/file\/d\/([^/]+)/) || url.match(/[?&]id=([^&]+)/);
  return m ? `https://drive.google.com/uc?export=view&id=${m[1]}` : url;
}

// An embeddable Drive preview URL (renders inside an iframe), where possible.
export function drivePreviewLink(url: string): string {
  const m = url.match(/\/file\/d\/([^/]+)/) || url.match(/[?&]id=([^&]+)/);
  return m ? `https://drive.google.com/file/d/${m[1]}/preview` : url;
}

// Classify what a stored file URL / filename is, for previewing.
export function fileKindOf(opts: { fileUrl?: string; driveUrl?: string; fileName?: string }): "image" | "pdf" | "drive" | "other" | "none" {
  const { fileUrl, driveUrl, fileName } = opts;
  if (fileUrl?.startsWith("data:image") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(fileName ?? "")) return "image";
  if (fileUrl?.startsWith("data:application/pdf") || /\.pdf$/i.test(fileName ?? "") || (!!fileUrl && /\.pdf/i.test(fileUrl))) return "pdf";
  if (driveUrl) return "drive";
  if (fileUrl) return "other";
  return "none";
}

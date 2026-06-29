// Client-side file helpers. Uploaded images are downscaled + recompressed to a
// data URL so they fit in the single-row mock/Supabase state without ballooning.
// Non-image files fall back to a raw data URL (use Drive links for large files).

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

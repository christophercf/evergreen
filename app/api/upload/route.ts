import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Uploads a file to Supabase Storage (public "artifacts" bucket) using the
// service_role key, and returns a public URL. This is how large documents
// (PDFs, drawing sets) are stored — inline base64 in the project_state row
// can't hold them. Falls back gracefully when the key isn't configured (the
// client then keeps the file inline for small files / mock mode).

const BUCKET = "artifacts";

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) {
    return NextResponse.json({ ok: false, error: "Storage not configured (SUPABASE_SERVICE_ROLE_KEY missing)." });
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    /* ignore */
  }
  if (!file) return NextResponse.json({ ok: false, error: "No file." }, { status: 400 });

  const admin = createClient(url, svc, { auth: { persistSession: false, autoRefreshToken: false } });

  // Ensure the public bucket exists (ignore "already exists").
  await admin.storage.createBucket(BUCKET, { public: true }).catch(() => {});

  const safe = file.name.replace(/[^a-z0-9.\-_]+/gi, "_").slice(-80) || "file";
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error } = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message });

  const { data } = admin.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({ ok: true, url: data.publicUrl, name: file.name });
}

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Issues a Supabase Storage *signed upload URL* so the client can PUT the file
// straight to Storage — bypassing the serverless request-body limit (~4.5 MB),
// which is why large drawing sets previously fell back to inline base64.
// Returns { signedUrl, publicUrl }. The client uploads to signedUrl, then stores
// publicUrl on the artifact version.

const BUCKET = "artifacts";

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) {
    return NextResponse.json({ ok: false, error: "Storage not configured (SUPABASE_SERVICE_ROLE_KEY missing)." });
  }

  let name = "file";
  try { const b = await req.json(); if (b?.name) name = String(b.name); } catch { /* ignore */ }
  const safe = name.replace(/[^a-z0-9.\-_]+/gi, "_").slice(-80) || "file";
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;

  const admin = createClient(url, svc, { auth: { persistSession: false, autoRefreshToken: false } });
  await admin.storage.createBucket(BUCKET, { public: true }).catch(() => {});

  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ ok: false, error: error?.message ?? "Could not create upload URL." });

  const publicUrl = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  return NextResponse.json({ ok: true, signedUrl: data.signedUrl, path, publicUrl });
}

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { IS_SUPABASE } from "./config";

// ----------------------------------------------------------------------------
// ONE Supabase client for the whole app.
//
// There used to be two — one in auth.ts, one in the data backend — built from
// the same URL and key. Two GoTrue clients sharing a storage key is a documented
// footgun: they race each other hydrating and refreshing the session, and
// supabase-js warns about it. Worse, it made the data client's auth state a
// coin toss, which matters the moment the database stops allowing anonymous
// reads: a request that should carry the user's JWT might not.
//
// One client means the session is hydrated once and every query — data or auth —
// carries it.
// ----------------------------------------------------------------------------

let client: SupabaseClient | null = null;

export function sb(): SupabaseClient | null {
  if (typeof window === "undefined") return null;
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return null;
    client = createClient(url, key);
  }
  return client;
}

/** The data backend needs a client that definitely exists — it is only ever
 *  constructed when the app is running against Supabase in a browser. */
export function sbOrThrow(): SupabaseClient {
  const s = sb();
  if (!s) throw new Error("Supabase client requested before it could be created.");
  return s;
}

export const supabaseConfigured = () => IS_SUPABASE && !!sb();

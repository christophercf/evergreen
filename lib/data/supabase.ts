// ----------------------------------------------------------------------------
// Supabase backend (opt-in). Mock-first means this is NOT used until you set
// NEXT_PUBLIC_DATA_SOURCE=supabase and fill in the URL/anon key. To keep the
// first build dependency-light, the whole project DB is stored as one JSON
// document in a `project_state` table (see db/01_schema.sql). Swap to
// normalized tables later without touching the store/UI.
// ----------------------------------------------------------------------------

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DB, Session } from "./types";
import { buildDB } from "./seed";
import { type Backend, defaultSession } from "./backend";

const PROJECT_ID = "evergreen";

export class SupabaseBackend implements Backend {
  readonly mode = "supabase" as const;
  private client: SupabaseClient;

  constructor() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    this.client = createClient(url, key);
  }

  async loadDB(): Promise<DB> {
    const { data } = await this.client
      .from("project_state")
      .select("db")
      .eq("id", PROJECT_ID)
      .maybeSingle();
    if (data?.db) return data.db as DB;
    const fresh = buildDB();
    await this.persistDB(fresh);
    return fresh;
  }

  loadSession(): Promise<Session> {
    let s = defaultSession();
    try {
      const raw = sessionStorage.getItem("evergreen.session.v1");
      if (raw) s = { ...defaultSession(), ...JSON.parse(raw) };
    } catch {
      /* ignore */
    }
    return Promise.resolve(s);
  }

  onRemoteDB(cb: (db: DB) => void): void {
    this.client
      .channel("project_state")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "project_state", filter: `id=eq.${PROJECT_ID}` },
        (payload) => {
          const row = payload.new as { db?: DB };
          if (row?.db) cb(row.db);
        },
      )
      .subscribe();
  }

  async persistDB(db: DB): Promise<void> {
    await this.client.from("project_state").upsert({ id: PROJECT_ID, db, updated_at: new Date().toISOString() });
  }

  persistSession(session: Session): void {
    try {
      sessionStorage.setItem("evergreen.session.v1", JSON.stringify(session));
    } catch {
      /* ignore */
    }
  }

  async reset(): Promise<DB> {
    const db = buildDB();
    await this.persistDB(db);
    return db;
  }
}

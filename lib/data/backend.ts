// ----------------------------------------------------------------------------
// Backend seam. The store talks to a Backend; two implementations exist:
//   • MockBackend     — localStorage + BroadcastChannel (default, no keys).
//   • SupabaseBackend — real Postgres (lib/data/supabase.ts), opt-in via env.
// Mock is the default so the whole app runs with zero setup.
// ----------------------------------------------------------------------------

import type { DB, Session } from "./types";
import { buildDB } from "./seed";
import { IS_SUPABASE } from "./config";
import { SupabaseBackend } from "./supabase";

export const DB_KEY = "evergreen.db.v1";
export const SESSION_KEY = "evergreen.session.v1";

export function defaultSession(): Session {
  return { role: "full_admin", userId: "u-owner", displayName: "Chris Johnson" };
}

export interface Backend {
  readonly mode: "mock" | "supabase";
  loadDB(): Promise<DB>;
  loadSession(): Promise<Session>;
  onRemoteDB(cb: (db: DB) => void): void;
  persistDB(db: DB): void | Promise<void>;
  persistSession(session: Session): void | Promise<void>;
  reset(): Promise<DB>;
}

export class MockBackend implements Backend {
  readonly mode = "mock" as const;
  private channel: BroadcastChannel | null = null;

  loadDB(): Promise<DB> {
    let db = buildDB();
    try {
      const raw = localStorage.getItem(DB_KEY);
      // Merge over a fresh seed so DBs saved before a new field gets defaults.
      if (raw) db = { ...buildDB(), ...(JSON.parse(raw) as DB) };
    } catch {
      /* ignore corrupt state */
    }
    return Promise.resolve(db);
  }

  loadSession(): Promise<Session> {
    let s = defaultSession();
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) s = { ...defaultSession(), ...JSON.parse(raw) };
    } catch {
      /* ignore */
    }
    return Promise.resolve(s);
  }

  onRemoteDB(cb: (db: DB) => void): void {
    if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;
    this.channel = new BroadcastChannel("evergreen");
    this.channel.onmessage = (ev) => {
      if (ev.data?.type === "db" || ev.data?.type === "reset") cb(ev.data.db as DB);
    };
  }

  persistDB(db: DB): void {
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(db));
    } catch {
      /* ignore quota */
    }
    this.channel?.postMessage({ type: "db", db });
  }

  persistSession(session: Session): void {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      /* ignore */
    }
  }

  reset(): Promise<DB> {
    const db = buildDB();
    try {
      localStorage.removeItem(DB_KEY);
    } catch {
      /* ignore */
    }
    this.channel?.postMessage({ type: "reset", db });
    return Promise.resolve(db);
  }
}

export function makeBackend(): Backend {
  return IS_SUPABASE ? new SupabaseBackend() : new MockBackend();
}

-- ============================================================================
-- URGENT — project_state is currently readable AND writable by anyone.
--
-- Verified 2026-08-23 against the live project, using only the publishable key
-- that ships inside the app's own JavaScript bundle (and is therefore public):
--
--   SELECT  → 200, returned the entire project
--   UPDATE  → 200, accepted (matched no rows, so nothing changed)
--   INSERT  → 201, created a row (removed again immediately)
--
-- So anyone who opens the app, reads one line of its bundle, and makes an HTTP
-- request can:
--   * read every contract, budget figure, draw, message and personal email;
--   * overwrite or delete the whole project;
--   * insert a user record carrying their own email with role "full_admin",
--     then sign up through the normal login screen and be admitted as an
--     administrator — the app binds a session to whatever the users list says.
--
-- Run this in the Supabase SQL editor. It is the fix.
-- ============================================================================

-- Safe to run more than once: the policies are dropped and recreated, and RLS
-- is switched on LAST so the rules exist before they start being enforced.

-- ---------------------------------------------------------------------------
-- RECOMMENDED — project members only.
--
-- "Any signed-in Supabase user" is NOT enough here: the app allows sign-up, so
-- a stranger could create an account and read everything. Access is granted by
-- being on the project's own users list, which is where membership already
-- lives.
-- ---------------------------------------------------------------------------
drop policy if exists "members read" on public.project_state;
drop policy if exists "members update" on public.project_state;

create policy "members read"
  on public.project_state for select to authenticated
  using (
    exists (
      select 1 from jsonb_array_elements(db -> 'users') as u
      where lower(u ->> 'email') = lower(auth.jwt() ->> 'email')
        and coalesce((u ->> 'disabled')::boolean, false) = false
    )
  );

create policy "members update"
  on public.project_state for update to authenticated
  using (
    exists (
      select 1 from jsonb_array_elements(db -> 'users') as u
      where lower(u ->> 'email') = lower(auth.jwt() ->> 'email')
        and coalesce((u ->> 'disabled')::boolean, false) = false
    )
  )
  with check (true);

-- Enforcement goes on last, once the rules above are in place.
alter table public.project_state enable row level security;

-- To undo all of this in one line, if anything looks wrong:
--   alter table public.project_state disable row level security;

-- No INSERT or DELETE policy: the single project row already exists, and
-- nothing in the app creates or removes it. The service-role key (server
-- routes only) bypasses RLS and can still do both.

-- ---------------------------------------------------------------------------
-- What this changes for the app — already handled in code as of 2026-08-23:
--
--   * One Supabase client (lib/data/supabase-client.ts) shared by auth and
--     data, so every query carries the signed-in user's JWT. There used to be
--     two clients racing each other on the same storage key.
--   * The store re-reads the project AFTER a session exists
--     (Store.reloadThenBind). The first load happens before sign-in, and with
--     RLS on it returns nothing — binding against an empty roster would have
--     locked everyone out of their own project.
--
-- What this breaks, correctly:
--
--   * scripts/pull-feedback.mjs and any QA snapshot pull using the publishable
--     key with no session. Point them at the service-role key, run them from a
--     server route, or accept that they need a signed-in token.
--
-- How to check it worked, from a terminal with no session at all:
--
--   curl -s "$SUPABASE_URL/rest/v1/project_state?select=id" \
--     -H "apikey: $PUBLISHABLE_KEY" -H "Authorization: Bearer $PUBLISHABLE_KEY"
--
--   Before: the row.   After: [] — and the app still works when signed in.
-- ---------------------------------------------------------------------------

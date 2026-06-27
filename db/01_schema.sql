-- Evergreen — minimal Supabase schema for the mock-first → real migration.
-- The app currently stores the entire project as one JSON document. This lets
-- you flip NEXT_PUBLIC_DATA_SOURCE=supabase with zero code changes; normalize
-- into per-entity tables later when multi-project / fine-grained RLS is needed.

create table if not exists project_state (
  id text primary key,
  db jsonb not null,
  updated_at timestamptz not null default now()
);

-- Enable realtime so other devices see live edits.
alter publication supabase_realtime add table project_state;

-- Open policy for the single-project prototype. Tighten before real multi-user:
-- gate by auth.uid() and a project_members table mapping users → roles.
alter table project_state enable row level security;
create policy "anon read/write evergreen prototype"
  on project_state for all
  using (true) with check (true);

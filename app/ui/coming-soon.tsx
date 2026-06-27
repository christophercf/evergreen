"use client";

import { useStore } from "@/lib/data/hooks";
import { PageHeader, NoAccess, Pill } from "./bits";
import { accessFor, type ModuleKey } from "@/lib/data/types";

export function ComingSoon({
  module, title, subtitle, features, note,
}: { module: ModuleKey; title: string; subtitle: string; features: string[]; note?: string }) {
  const store = useStore();
  const role = store.session.role;
  const user = store.currentUser;
  if (accessFor(user, role, module) === "none") return <NoAccess module={title} />;

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} right={<Pill color="var(--brass-2)" bg="#f0e6cd">Phase 2</Pill>} />
      <div className="card" style={{ padding: 22, marginTop: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--walnut)", marginBottom: 12 }}>Planned for this module</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px,1fr))", gap: "10px 18px" }}>
          {features.map((f) => (
            <div key={f} style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 13.5 }}>
              <span style={{ color: "var(--sage)", marginTop: 1 }}>◆</span>
              <span>{f}</span>
            </div>
          ))}
        </div>
        {note && <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 12 }}>{note}</p>}
      </div>
    </>
  );
}

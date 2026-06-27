"use client";

import { ComingSoon } from "../ui/coming-soon";

export default function ArtifactsPage() {
  return (
    <ComingSoon
      module="artifacts"
      title="Artifacts"
      subtitle="A shared library of project documents that can be viewed, downloaded, and shared with trades."
      features={[
        "Architectural drawings (Joseph Mosey Architecture)",
        "Survey (Fenn & Associates)",
        "Permits and inspection records",
        "Design intent document & Pinterest references",
        "Version history and per-trade sharing",
        "Download / share links with access control",
      ]}
      note="Access is role-gated like every module — trades see what they're shared, the owner controls the rest."
    />
  );
}

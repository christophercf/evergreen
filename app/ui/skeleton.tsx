"use client";

// ---------------------------------------------------------------------------
// Loading state.
//
// Mock data loads instantly, so nothing here ever looked slow in development.
// Live Supabase over a phone connection on site is a different thing, and the
// first paint today is blank cards — which reads as "empty project", not
// "still loading". Those two must never look the same.
// ---------------------------------------------------------------------------

export function SkeletonCard({ lines = 3, height }: { lines?: number; height?: number }) {
  return (
    <div className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8, minHeight: height }} aria-hidden>
      <div className="ever-shimmer" style={{ height: 13, width: "38%", borderRadius: 5 }} />
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="ever-shimmer" style={{ height: 10, width: `${88 - i * 14}%`, borderRadius: 5 }} />
      ))}
    </div>
  );
}

/** A list that is loading looks like a list, not like an empty page. */
export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }} role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => <SkeletonCard key={i} lines={2} />)}
    </div>
  );
}

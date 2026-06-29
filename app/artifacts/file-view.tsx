"use client";

import type { Artifact, ArtifactVersion } from "@/lib/data/types";
import { driveViewLink, drivePreviewLink, fileKindOf } from "../ui/upload";

export function currentVersion(a: Artifact): ArtifactVersion | undefined {
  if (a.versions?.length) return a.versions[a.versions.length - 1];
  if (a.url || a.version) return { id: "legacy", label: a.version ?? "v1", uploadedAt: a.date ?? "", uploadedBy: a.source ?? "", fileUrl: a.url?.startsWith("data:") ? a.url : undefined, driveUrl: a.url && !a.url.startsWith("data:") ? a.url : undefined };
  return undefined;
}

const ICON: Record<string, string> = { drawing: "📐", photo: "🖼️", permit: "📋", contract: "✍️", survey: "🗺️", design: "🎨", other: "📄" };

// A lightweight visual thumbnail of whatever is attached: image preview, a
// scaled first-page render for PDFs (native browser embed), or a kind icon.
export function FilePreview({ a, height = 150 }: { a: Artifact; height?: number }) {
  const v = currentVersion(a);
  const kind = fileKindOf({ fileUrl: v?.fileUrl, driveUrl: v?.driveUrl, fileName: v?.fileName });
  const box = (children: React.ReactNode, extra: React.CSSProperties = {}) =>
    <div style={{ width: "100%", height, borderRadius: 8, border: "1px solid var(--line)", overflow: "hidden", background: "var(--paper)", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", ...extra }}>{children}</div>;

  if (kind === "image") return box(<img src={v!.fileUrl} alt={a.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />);
  if (kind === "pdf" && v?.fileUrl) return box(
    <>
      <iframe title={a.name} src={`${v.fileUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`} style={{ width: "100%", height: "260%", border: "none", transform: "scale(1)", transformOrigin: "top left", pointerEvents: "none" }} />
      <span style={{ position: "absolute", bottom: 4, right: 4, fontSize: 9, fontWeight: 700, color: "#fff", background: "rgba(44,36,28,.7)", borderRadius: 4, padding: "1px 5px" }}>PDF</span>
    </>);
  if (kind === "drive" && v?.driveUrl) return box(
    <iframe title={a.name} src={drivePreviewLink(v.driveUrl)} style={{ width: "100%", height: "100%", border: "none", pointerEvents: "none" }} />);
  // other / none
  return box(<div style={{ textAlign: "center", color: "var(--muted)" }}><div style={{ fontSize: 34 }}>{ICON[a.kind] ?? "📄"}</div>{v?.fileName && <div style={{ fontSize: 10.5, padding: "0 6px", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.fileName}</div>}{!v && <div style={{ fontSize: 11 }}>No file attached</div>}</div>);
}

// Full in-app viewer (modal) — image lightbox, embedded PDF, or Drive preview.
export function FileViewerModal({ a, onClose }: { a: Artifact; onClose: () => void }) {
  const v = currentVersion(a);
  const kind = fileKindOf({ fileUrl: v?.fileUrl, driveUrl: v?.driveUrl, fileName: v?.fileName });
  const downloadHref = v?.fileUrl;
  const openHref = v?.driveUrl ? driveViewLink(v.driveUrl) : v?.fileUrl;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(28,24,20,.7)", zIndex: 60, display: "flex", padding: 18 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ margin: "auto", width: "min(960px, 100%)", maxHeight: "94vh", display: "flex", flexDirection: "column", padding: 14, background: "var(--cream)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          <strong className="serif" style={{ fontSize: 16, color: "var(--walnut)" }}>{a.name}</strong>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{a.source}{v?.label ? ` · ${v.label}` : ""}</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            {downloadHref && <a className="btn btn-sm" href={downloadHref} download={v?.fileName ?? a.name}>⬇ Download</a>}
            {openHref && <a className="btn btn-sm" href={openHref} target="_blank" rel="noreferrer">↗ Open in new tab</a>}
            <button className="btn btn-sm" onClick={onClose}>✕ Close</button>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, borderRadius: 8, overflow: "hidden", border: "1px solid var(--line)", background: "#fff", display: "flex" }}>
          {kind === "image" ? <img src={v!.fileUrl} alt={a.name} style={{ width: "100%", height: "auto", maxHeight: "82vh", objectFit: "contain", margin: "auto" }} />
            : kind === "pdf" && v?.fileUrl ? <iframe title={a.name} src={v.fileUrl} style={{ width: "100%", height: "82vh", border: "none" }} />
            : kind === "drive" && v?.driveUrl ? <iframe title={a.name} src={drivePreviewLink(v.driveUrl)} style={{ width: "100%", height: "82vh", border: "none" }} allow="autoplay" />
            : <div style={{ margin: "auto", textAlign: "center", color: "var(--muted)", padding: 40 }}><div style={{ fontSize: 48 }}>{ICON[a.kind] ?? "📄"}</div><div style={{ marginTop: 8 }}>{v?.fileName ?? "No preview available"}</div>{downloadHref && <div style={{ fontSize: 12, marginTop: 6 }}>Use Download to open this file.</div>}</div>}
        </div>
      </div>
    </div>
  );
}

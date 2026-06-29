"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/data/hooks";
import { PageHeader, NoAccess, Pill, SectionTitle, StatCard } from "../ui/bits";
import { accessFor, canSeeArtifact, ARTIFACT_KIND_LABEL, type Artifact, type ArtifactKind, type ArtifactVersion, type Role } from "@/lib/data/types";
import { tradeName } from "@/lib/data/money";
import { fileToDataURL, driveViewLink } from "../ui/upload";
import { useFileDrop } from "../ui/use-drop";
import DrawingViewer from "./drawing-viewer";

const KIND_ORDER: ArtifactKind[] = ["survey", "drawing", "permit", "contract", "photo", "design", "other"];
const KIND_HINT: Partial<Record<ArtifactKind, string>> = {
  survey: "Property survey & site documents.",
  drawing: "Architectural & structural drawings — open the interactive view to mark up and shade scope.",
  permit: "Building & trade permits (upload a photo).",
  contract: "Signed contracts — visible only to the parties they're between.",
  photo: "Project photos, including ones tagged to budget line items.",
  design: "Design intent & references.",
};

function currentVersion(a: Artifact): ArtifactVersion | undefined {
  if (a.versions?.length) return a.versions[a.versions.length - 1];
  if (a.url || a.version) return { id: "legacy", label: a.version ?? "v1", uploadedAt: a.date ?? "", uploadedBy: a.source ?? "", fileUrl: a.url?.startsWith("data:") ? a.url : undefined, driveUrl: a.url && !a.url.startsWith("data:") ? a.url : undefined };
  return undefined;
}
function versionHref(v: ArtifactVersion | undefined): string | undefined {
  if (!v) return undefined;
  if (v.fileUrl) return v.fileUrl;
  if (v.driveUrl) return v.driveUrl;
  return undefined;
}

export default function ArtifactsPage() {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const user = store.currentUser;
  const access = accessFor(user, role, "artifacts");
  const [viewer, setViewer] = useState<{ id: string; trade?: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  // deep-link: ?artifact=…&view=scope&trade=…
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const id = q.get("artifact");
    if (id) setViewer({ id, trade: q.get("view") === "scope" ? q.get("trade") ?? undefined : undefined });
  }, []);

  if (access === "none") return <NoAccess module="Artifacts" />;
  const ro = access !== "edit";

  const seen = db.artifacts.filter((a) => canSeeArtifact(role, user, a));
  const visible = seen.filter((a) => !a.archived);
  const archived = seen.filter((a) => a.archived);
  const byKind = (k: ArtifactKind) => visible.filter((a) => a.kind === k);
  const watched = visible.filter((a) => a.watch).length;
  const isAdmin = role === "full_admin";

  return (
    <>
      <PageHeader
        title="Artifacts"
        subtitle="The project's shared document library — surveys, drawings, permits, signed contracts and photos. Upload a file or pull from Google Drive, with version history and change notifications. Open a drawing to mark it up and shade each trade's scope."
        right={ro ? <Pill color="var(--muted)">View only</Pill> : undefined}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))", gap: 12, marginTop: 16 }}>
        <StatCard label="Documents" value={`${visible.length}`} />
        <StatCard label="Drawings" value={`${byKind("drawing").length}`} accent="var(--sage-2)" />
        <StatCard label="Watched for changes" value={`${watched}`} accent="var(--brass-2)" sub="notify on new version" />
        <StatCard label="Photos" value={`${byKind("photo").length}`} sub="incl. line-item photos" />
      </div>

      {!ro && <AddArtifact />}

      {KIND_ORDER.map((k) => {
        const items = byKind(k);
        if (!items.length) return null;
        return (
          <section key={k} style={{ marginTop: 18 }}>
            <SectionTitle>{ARTIFACT_KIND_LABEL[k]}</SectionTitle>
            {KIND_HINT[k] && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: -6, marginBottom: 8 }}>{KIND_HINT[k]}</div>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px,1fr))", gap: 12 }}>
              {items.map((a) => <ArtifactCard key={a.id} a={a} ro={ro} isAdmin={isAdmin} onOpen={() => setViewer({ id: a.id })} />)}
            </div>
          </section>
        );
      })}

      {archived.length > 0 && (
        <section style={{ marginTop: 22 }}>
          <button onClick={() => setShowArchived((v) => !v)} className="btn btn-sm" style={{ display: "inline-flex", gap: 6 }}>
            {showArchived ? "▾" : "▸"} 🗄 Archived ({archived.length})
          </button>
          {showArchived && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px,1fr))", gap: 12, marginTop: 10 }}>
              {archived.map((a) => <ArtifactCard key={a.id} a={a} ro={ro} isAdmin={isAdmin} onOpen={() => setViewer({ id: a.id })} />)}
            </div>
          )}
        </section>
      )}

      {viewer && <DrawingViewer artifactId={viewer.id} initialTrade={viewer.trade} onClose={() => setViewer(null)} />}
    </>
  );
}

function ArtifactCard({ a, ro, isAdmin, onOpen }: { a: Artifact; ro: boolean; isAdmin: boolean; onOpen: () => void }) {
  const store = useStore();
  const db = store.db;
  const by = store.session.displayName;
  const [hist, setHist] = useState(false);
  const [showAccess, setShowAccess] = useState(false);
  const cur = currentVersion(a);
  const href = versionHref(cur);
  const isImg = !!cur?.fileUrl?.startsWith("data:image");
  const hasFile = !!cur?.fileUrl;
  const isDrive = !!cur?.driveUrl && !cur?.fileUrl;

  const nextLabel = () => `v${(a.versions?.length ?? (a.url || a.version ? 1 : 0)) + 1}`;
  const { over, dropProps } = useFileDrop(async (files) => {
    const f = files[0];
    store.addArtifactVersion(a.id, { label: nextLabel(), fileUrl: await fileToDataURL(f), fileName: f.name }, by);
    setHist(true);
  }, { disabled: ro });

  return (
    <div className="card" {...dropProps} style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6, position: "relative", outline: over ? "2px dashed var(--sage)" : "none", outlineOffset: 2, opacity: a.archived ? 0.7 : 1 }}>
      {over && <div style={{ position: "absolute", inset: 0, background: "var(--sage-tint)", opacity: 0.92, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "var(--walnut)", zIndex: 2, pointerEvents: "none" }}>⬆ Drop to add {nextLabel()}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ width: 44, height: 44, borderRadius: 8, background: "var(--cream-2)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
          {a.kind === "drawing" ? "📐" : a.kind === "photo" ? "🖼️" : a.kind === "permit" ? "📋" : a.kind === "contract" ? "✍️" : a.kind === "survey" ? "🗺️" : a.kind === "design" ? "🎨" : "📄"}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, color: "var(--walnut)" }}>{a.name}{a.archived && <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 400 }}> · archived</span>}</div>
          <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{a.source}{cur?.label ? ` · ${cur.label}` : ""}</div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 3 }}>
            {a.tradeIds?.map((t) => <Pill key={t} bg="var(--cream-2)">{tradeName(db, t)}</Pill>)}
            {a.lineId && <Pill bg="var(--sage-tint)">{db.costLines.find((l) => l.id === a.lineId)?.name ?? "line"}</Pill>}
            {a.kind === "contract" && <Pill bg="#f3d9cf" color="var(--rust)">parties only</Pill>}
            <AccessSummary a={a} />
          </div>
        </div>
      </div>

      {/* uploaded-file preview — make it obvious what's attached */}
      {isImg ? (
        <img src={cur!.fileUrl} alt={a.name} style={{ width: "100%", maxHeight: 150, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)" }} />
      ) : hasFile ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px" }}>📎 <strong style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cur?.fileName ?? "Uploaded file"}</strong><span style={{ color: "var(--muted)" }}>uploaded</span></div>
      ) : isDrive ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px" }}>🔗 <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Google Drive link</span></div>
      ) : (
        <div style={{ fontSize: 11.5, color: "var(--muted)", fontStyle: "italic", padding: "4px 0" }}>No file attached yet — {ro ? "awaiting upload." : "drop a file here or use ⬆ below."}</div>
      )}

      {a.notes && <div style={{ fontSize: 12, color: "var(--ink)" }}>{a.notes}</div>}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {a.kind === "drawing" && <button className="btn btn-sm btn-primary" onClick={onOpen}>✍️ Interactive view</button>}
        {href ? (cur?.fileUrl ? <a className="btn btn-sm" href={href} download={cur.fileName ?? a.name}>⬇ Download</a> : <a className="btn btn-sm" href={driveViewLink(href)} target="_blank" rel="noreferrer">↗ Open</a>) : null}
        <button className="btn btn-sm" onClick={() => setHist((v) => !v)}>🕑 {(a.versions?.length ?? (a.url || a.version ? 1 : 0))} ver.</button>
        {!ro && <button className="btn btn-sm" title="Notify the team on new versions" onClick={() => store.toggleArtifactWatch(a.id)} style={{ color: a.watch ? "var(--brass-2)" : "var(--muted)" }}>{a.watch ? "🔔 Watching" : "🔕 Watch"}</button>}
        {isAdmin && <button className="btn btn-sm" title="Assign which roles can view this" onClick={() => setShowAccess((v) => !v)}>🔐 Access</button>}
        {!ro && <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button className="btn btn-sm" title={a.archived ? "Restore to the library" : "Archive (keep on record, hide from library)"} onClick={() => store.setArtifactArchived(a.id, !a.archived)}>{a.archived ? "♻ Unarchive" : "🗄 Archive"}</button>
          <button className="btn btn-sm" style={{ color: "var(--rust)" }} title="Delete permanently" onClick={() => { if (confirm(`Permanently remove "${a.name}"? This can't be undone.`)) store.removeArtifact(a.id); }}>🗑</button>
        </div>}
      </div>

      {isAdmin && showAccess && <AccessEditor a={a} />}

      {hist && (
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 6 }}>
          {(a.versions ?? []).slice().reverse().map((v) => (
            <div key={v.id} style={{ display: "flex", gap: 8, fontSize: 11.5, alignItems: "center", padding: "2px 0" }}>
              <span style={{ flex: 1, minWidth: 0 }}><strong>{v.label}</strong>{v.fileName ? <span style={{ color: "var(--muted)" }}> · {v.fileName}</span> : v.driveUrl ? <span style={{ color: "var(--muted)" }}> · Drive link</span> : ""} · {v.uploadedBy} {v.uploadedAt && <span style={{ color: "var(--muted)" }}>· {new Date(v.uploadedAt).toLocaleDateString()}</span>}</span>
              {v.fileUrl ? <a href={v.fileUrl} download={v.fileName} style={{ color: "var(--sage-2)" }}>⬇</a> : v.driveUrl ? <a href={driveViewLink(v.driveUrl)} target="_blank" rel="noreferrer" style={{ color: "var(--sage-2)" }}>↗</a> : null}
            </div>
          ))}
          {!a.versions?.length && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{a.url || a.version ? `${a.version ?? "v1"} (legacy)` : "No versions."}</div>}
          {!ro && <NewVersion artifactId={a.id} />}
        </div>
      )}
    </div>
  );
}

// The roles a Full Admin can grant view access to (full_admin always sees all).
const AUDIENCE_ROLES: { role: Role; label: string }[] = [
  { role: "owner", label: "Owner" }, { role: "builder", label: "Builder" }, { role: "trade", label: "Trades" }, { role: "viewer", label: "Viewer / Designer" },
];

function AccessSummary({ a }: { a: Artifact }) {
  if (!a.audience || a.audience.length === 0) return <Pill bg="var(--cream-2)">whole team</Pill>;
  const labels = AUDIENCE_ROLES.filter((r) => a.audience!.includes(r.role)).map((r) => r.label);
  return <Pill bg="#e7e0d2" color="var(--brass-2)">🔐 {labels.join(", ") || "admin only"}</Pill>;
}

function AccessEditor({ a }: { a: Artifact }) {
  const store = useStore();
  const db = store.db;
  const allRoles = AUDIENCE_ROLES.map((r) => r.role);
  const allowed = new Set<Role>(a.audience && a.audience.length ? a.audience : allRoles);
  const trades = Array.from(new Set(db.scope.filter((c) => c.status === "in").map((c) => c.tradeId)));
  const setAllowed = (next: Set<Role>) => {
    const arr = allRoles.filter((r) => next.has(r));
    store.updateArtifact(a.id, { audience: arr.length === allRoles.length ? undefined : arr });
  };
  const toggleTrade = (t: string, on: boolean) => {
    const cur = new Set(a.tradeIds ?? []);
    if (on) cur.add(t); else cur.delete(t);
    store.updateArtifact(a.id, { tradeIds: cur.size ? [...cur] : undefined });
  };
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px", background: "var(--paper)" }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)" }}>Who can view this document</div>
      <div style={{ fontSize: 11, color: "var(--muted)", margin: "2px 0 6px" }}>Full Admin always has access. Uncheck a role to hide this document from it.</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
        {AUDIENCE_ROLES.map(({ role, label }) => (
          <label key={role} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
            <input type="checkbox" checked={allowed.has(role)} onChange={(e) => { const n = new Set(allowed); if (e.target.checked) n.add(role); else n.delete(role); setAllowed(n); }} />
            {label}
          </label>
        ))}
      </div>
      {allowed.has("trade") && trades.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>Limit to specific trades (optional — leave all unchecked for every trade):</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: 4 }}>
            {trades.map((t) => (
              <label key={t} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12 }}>
                <input type="checkbox" checked={a.tradeIds?.includes(t) ?? false} onChange={(e) => toggleTrade(t, e.target.checked)} />
                {tradeName(db, t)}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NewVersion({ artifactId }: { artifactId: string }) {
  const store = useStore();
  const by = store.session.displayName;
  const fileRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState("");
  const [drive, setDrive] = useState("");
  const add = (patch: Partial<ArtifactVersion>) => { store.addArtifactVersion(artifactId, { label: label.trim() || `v${Date.now().toString().slice(-4)}`, ...patch }, by); setLabel(""); setDrive(""); };
  return (
    <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", background: "var(--paper)", padding: 6, borderRadius: 6 }}>
      <input placeholder="New version label" value={label} onChange={(e) => setLabel(e.target.value)} style={{ width: 130, fontSize: 11.5 }} />
      <input ref={fileRef} type="file" style={{ display: "none" }} onChange={async (e) => { const f = e.target.files?.[0]; if (f) add({ fileUrl: await fileToDataURL(f), fileName: f.name }); }} />
      <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>⬆ File</button>
      <input placeholder="…or Google Drive link" value={drive} onChange={(e) => setDrive(e.target.value)} style={{ flex: 1, minWidth: 120, fontSize: 11.5 }} />
      <button className="btn btn-sm btn-primary" disabled={!drive.trim()} onClick={() => add({ driveUrl: drive.trim() })}>Add</button>
    </div>
  );
}

const ROLE_OPTS: Role[] = ["owner", "builder", "trade", "viewer"];

function AddArtifact() {
  const store = useStore();
  const db = store.db;
  const by = store.session.displayName;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ArtifactKind>("drawing");
  const [source, setSource] = useState("");
  const [drive, setDrive] = useState("");
  const [fileData, setFileData] = useState<{ url: string; name: string } | null>(null);
  const [trade, setTrade] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const trades = Array.from(new Set(db.scope.filter((c) => c.status === "in").map((c) => c.tradeId)));

  const loadFile = async (f: File) => { setFileData({ url: await fileToDataURL(f), name: f.name }); setName((n) => n || f.name.replace(/\.[^.]+$/, "")); setOpen(true); };
  const { over, dropProps } = useFileDrop((files) => void loadFile(files[0]));

  if (!open) return (
    <div {...dropProps} onClick={() => setOpen(true)}
      style={{ marginTop: 14, padding: "16px 18px", borderRadius: 12, border: `2px dashed ${over ? "var(--sage)" : "var(--line)"}`, background: over ? "var(--sage-tint)" : "var(--paper)", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, color: over ? "var(--walnut)" : "var(--muted)" }}>
      <span style={{ fontSize: 20 }}>⬆</span>
      <span style={{ fontSize: 13 }}><strong style={{ color: "var(--ink)" }}>＋ Add document</strong> — drag &amp; drop a file or photo here, or click to browse.</span>
    </div>
  );

  const save = () => {
    if (!name.trim()) return;
    const version: ArtifactVersion = { id: `seed-v`, label: "v1", uploadedAt: new Date().toISOString(), uploadedBy: by, fileUrl: fileData?.url, fileName: fileData?.name, driveUrl: drive.trim() || undefined };
    store.addArtifact({
      name: name.trim(), kind, source: source.trim() || by, date: new Date().toISOString().slice(0, 10),
      tradeIds: trade ? [trade] : undefined,
      audience: kind === "contract" && trade ? ["builder", "owner", "trade"] : undefined,
      watch: kind === "drawing" || kind === "survey" || kind === "permit",
      versions: [version],
    });
    setName(""); setSource(""); setDrive(""); setFileData(null); setTrade(""); setOpen(false);
  };

  return (
    <div className="card" {...dropProps} style={{ padding: 14, marginTop: 14, display: "flex", flexDirection: "column", gap: 8, outline: over ? "2px dashed var(--sage)" : "none" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input placeholder="Document name" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
        <select value={kind} onChange={(e) => setKind(e.target.value as ArtifactKind)}>
          {KIND_ORDER.map((k) => <option key={k} value={k}>{ARTIFACT_KIND_LABEL[k]}</option>)}
        </select>
        <input placeholder="Source (architect, surveyor…)" value={source} onChange={(e) => setSource(e.target.value)} style={{ width: 180 }} />
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input ref={fileRef} type="file" style={{ display: "none" }} onChange={async (e) => { const f = e.target.files?.[0]; if (f) setFileData({ url: await fileToDataURL(f), name: f.name }); }} />
        <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>⬆ Upload file / photo</button>
        {fileData && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--sage-tint)", borderRadius: 8, padding: "3px 8px 3px 3px", fontSize: 12 }}>
            {fileData.url.startsWith("data:image") ? <img src={fileData.url} alt="" style={{ width: 30, height: 30, objectFit: "cover", borderRadius: 5 }} /> : <span style={{ fontSize: 16, padding: "0 4px" }}>📎</span>}
            <strong style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fileData.name}</strong>
            <button className="btn btn-sm" style={{ color: "var(--rust)", padding: "0 5px" }} onClick={() => setFileData(null)}>✕</button>
          </span>
        )}
        <span style={{ color: "var(--muted)", fontSize: 12 }}>or</span>
        <input placeholder="Google Drive link" value={drive} onChange={(e) => setDrive(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
        <select value={trade} onChange={(e) => setTrade(e.target.value)} title="Restrict to a trade (required for signed contracts)">
          <option value="">{kind === "contract" ? "— party trade —" : "all trades"}</option>
          {trades.map((t) => <option key={t} value={t}>{tradeName(db, t)}</option>)}
        </select>
      </div>
      {kind === "contract" && <div style={{ fontSize: 11.5, color: "var(--rust)" }}>Signed contracts are visible only to the builder, owner and the selected party trade.</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-primary btn-sm" disabled={!name.trim()} onClick={save}>Add document</button>
        <button className="btn btn-sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

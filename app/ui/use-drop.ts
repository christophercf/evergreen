"use client";

import { useRef, useState } from "react";

// Reusable file drag-and-drop. Only reacts to FILE drags (ignores the app's
// internal element drags, e.g. budget lines in Payments, which carry text/plain).
// Spread `dropProps` on the target element; `over` is true while a file hovers.
export function useFileDrop(onFiles: (files: File[]) => void, opts: { accept?: (f: File) => boolean; disabled?: boolean } = {}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const isFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

  const dropProps = {
    onDragEnter: (e: React.DragEvent) => { if (opts.disabled || !isFiles(e)) return; e.preventDefault(); depth.current++; setOver(true); },
    onDragOver: (e: React.DragEvent) => { if (opts.disabled || !isFiles(e)) return; e.preventDefault(); },
    onDragLeave: (e: React.DragEvent) => { if (opts.disabled || !isFiles(e)) return; depth.current--; if (depth.current <= 0) { depth.current = 0; setOver(false); } },
    onDrop: (e: React.DragEvent) => {
      if (opts.disabled || !isFiles(e)) return;
      e.preventDefault(); depth.current = 0; setOver(false);
      let files = Array.from(e.dataTransfer.files);
      if (opts.accept) files = files.filter(opts.accept);
      if (files.length) onFiles(files);
    },
  };
  return { over, dropProps };
}

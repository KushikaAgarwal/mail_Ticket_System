import React, { useState } from 'react';
import { PaperclipIcon, XIcon } from 'lucide-react';
import { AttachmentInfo, downloadAttachment } from '../pages/services/ticketApi';
import { formatSize } from './attachmentRules';

// Re-exported so existing `import { formatSize } from './AttachmentList'` keeps working.
export { formatSize };

/** Downloadable files already saved on a ticket or comment (agent side, authenticated). */
export default function AttachmentList({ ticketId, items }: { ticketId: string; items?: AttachmentInfo[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!items || items.length === 0) return null;

  const open = async (a: AttachmentInfo) => {
    setBusy(a.id);
    setErr(null);
    try {
      await downloadAttachment(ticketId, a);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="att-list">
      {items.map((a) => (
        <button key={a.id} type="button" className="att-chip" onClick={() => open(a)} disabled={busy === a.id} title="Download">
          <PaperclipIcon size={13} />
          <span className="att-name">{a.filename}</span>
          <span className="att-size">{formatSize(a.sizeBytes)}</span>
        </button>
      ))}
      {err && <div className="att-err">{err}</div>}
    </div>
  );
}

/** Files the user has picked but not sent yet (comment box, new-ticket form). */
export function PendingFiles({ files, onRemove }: { files: File[]; onRemove: (index: number) => void }) {
  if (files.length === 0) return null;
  return (
    <div className="att-list">
      {files.map((f, i) => (
        <span key={`${f.name}-${i}`} className="att-chip att-chip-new">
          <PaperclipIcon size={13} />
          <span className="att-name">{f.name}</span>
          <span className="att-size">{formatSize(f.size)}</span>
          <button type="button" onClick={() => onRemove(i)} aria-label={`Remove ${f.name}`}>
            <XIcon size={13} />
          </button>
        </span>
      ))}
    </div>
  );
}
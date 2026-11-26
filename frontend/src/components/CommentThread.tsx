import React, { useRef, useState } from 'react';
import { EyeIcon, EyeOffIcon, MessageSquareIcon, PaperclipIcon } from 'lucide-react';
import { CommentEntry, MentionUser } from '../pages/services/ticketApi';
import AttachmentList, { PendingFiles } from './AttachmentList';
import { useFilePicker } from './attachmentRules';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Which tagged people are actually written in the text (longest names first). */
function findMentions(text: string, users: MentionUser[]): string[] {
  let work = text.toLowerCase();
  const ids: string[] = [];
  [...users]
    .sort((a, b) => b.name.length - a.name.length)
    .forEach((u) => {
      const needle = `@${u.name}`.toLowerCase();
      const i = work.indexOf(needle);
      if (i >= 0) {
        ids.push(u.id);
        work = work.slice(0, i) + ' '.repeat(needle.length) + work.slice(i + needle.length);
      }
    });
  return ids;
}

function renderText(text: string, mentions?: { id: string; name: string }[]) {
  if (!mentions || mentions.length === 0) return text;
  const pattern = new RegExp(
    `(${[...mentions].sort((a, b) => b.name.length - a.name.length).map((m) => '@' + escapeRe(m.name)).join('|')})`,
    'gi'
  );
  return text.split(pattern).map((part, i) =>
    i % 2 === 1 ? <span key={i} className="ct-mention">{part}</span> : <React.Fragment key={i}>{part}</React.Fragment>
  );
}

interface Props {
  ticketId: string;
  comments: CommentEntry[];
  mentionable: MentionUser[];
  disabled?: boolean;
  /** Resolve with a warning string (e.g. "1 file couldn't be saved") to show it after sending. */
  onAdd: (text: string, sendMail: boolean, files: File[], mentionIds: string[]) => Promise<string | void>;
  onToggleVisibility: (commentId: string, visible: boolean) => Promise<void> | void;
}

export function CommentThread({ ticketId, comments, mentionable, disabled, onAdd, onToggleVisibility }: Props) {
  const [text, setText] = useState('');
  const [sendMail, setSendMail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sendMsg, setSendMsg] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ query: string; start: number } | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const attach = useFilePicker();

  const canSend = !busy && (text.trim() !== '' || attach.files.length > 0);
  const notice = sendMsg ?? attach.error; // both are shown the same way

  const suggestions = picker
    ? mentionable.filter((u) => u.name.toLowerCase().includes(picker.query)).slice(0, 6)
    : [];

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setText(v);
    const caret = e.target.selectionStart ?? v.length;
    const m = v.slice(0, caret).match(/(^|\s)@([^\s@]{0,30})$/);
    setPicker(m ? { query: m[2].toLowerCase(), start: caret - m[2].length - 1 } : null);
  };

  const pick = (u: MentionUser) => {
    if (!picker) return;
    const start = picker.start;
    const caret = taRef.current?.selectionStart ?? text.length;
    setText(text.slice(0, start) + '@' + u.name + ' ' + text.slice(caret));
    setPicker(null);
    requestAnimationFrame(() => {
      const pos = start + u.name.length + 2;
      taRef.current?.focus();
      taRef.current?.setSelectionRange(pos, pos);
    });
  };

  const send = async () => {
    if (!canSend) return;
    setBusy(true);
    setSendMsg(null);
    try {
      const warn = await onAdd(text.trim(), sendMail, attach.files, findMentions(text, mentionable));
      setText('');
      attach.clear();
      setSendMail(false);
      if (warn) setSendMsg(warn);
    } catch (e) {
      setSendMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ct">
      <div className="ct-head">
        <MessageSquareIcon size={16} /> <b>Comments ({comments.length})</b>
      </div>

      {comments.length === 0 && <div className="ct-empty">No comments yet.</div>}

      {comments.map((c) => {
        const hidden = c.visible === false;
        return (
          <div key={c.id} className="ct-item">
            <div className="ct-item-head">
              <b>{c.authorName || 'Admin'}</b>
              <span className="ct-tag">{(c.role || 'admin').toUpperCase()}</span>
              {hidden && <span className="ct-tag ct-tag-hidden">HIDDEN FROM CUSTOMER</span>}
              <span className="ct-time">{c.timestamp ? new Date(c.timestamp).toLocaleString() : ''}</span>
              <button
                type="button"
                className="ct-eye"
                title={hidden ? 'Show to customer' : 'Hide from customer'}
                onClick={() => onToggleVisibility(c.id, hidden)}
              >
                {hidden ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
              </button>
            </div>
            <div className="ct-text">{renderText(c.text, c.mentions)}</div>
            <AttachmentList ticketId={ticketId} items={c.attachments} />
          </div>
        );
      })}

      {!disabled && (
        <div className="ct-compose">
          <div className="ct-box">
            <textarea
              ref={taRef}
              value={text}
              onChange={onChange}
              onKeyDown={(e) => { if (e.key === 'Escape') setPicker(null); }}
              placeholder="Write a comment… type @ to tag a teammate"
              rows={3}
            />
            {picker && suggestions.length > 0 && (
              <div className="ct-picker">
                {suggestions.map((u) => (
                  <button key={u.id} type="button" onMouseDown={(e) => { e.preventDefault(); pick(u); }}>
                    <b>{u.name}</b>
                    <span>{u.role.replace(/_/g, ' ').toLowerCase()}{u.zoneName ? ` · ${u.zoneName}` : ''}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <PendingFiles files={attach.files} onRemove={attach.removeAt} />

          <div className="ct-actions">
            <input ref={attach.inputRef} type="file" multiple hidden onChange={(e) => attach.add(e.target.files)} />
            <button type="button" className="btn btn-ghost" onClick={attach.openDialog}>
              <PaperclipIcon size={14} /> Attach files
            </button>
            <label className="ct-check">
              <input type="checkbox" checked={sendMail} onChange={(e) => setSendMail(e.target.checked)} />
              Email this to the customer{attach.files.length > 0 ? ' (with attachments)' : ''}
            </label>
            <button type="button" className="btn btn-primary" style={{ marginLeft: 'auto' }} disabled={!canSend} onClick={send}>
              {busy ? 'Sending…' : 'Add comment'}
            </button>
          </div>

          {notice && <div className="ct-msg err">{notice}</div>}
        </div>
      )}
    </div>
  );
}

export default CommentThread;
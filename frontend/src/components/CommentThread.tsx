import React, { useState } from 'react';
import { MessageSquareIcon, Loader2Icon, EyeIcon, EyeOffIcon, SendIcon } from 'lucide-react';
import type { CommentEntry } from '../pages/services/ticketApi';

interface CommentThreadProps {
  comments: CommentEntry[];
  onAdd: (text: string, sendMail: boolean) => Promise<void>;
  onToggleVisibility?: (commentId: string, visible: boolean) => Promise<void>;
  disabled?: boolean;
}

export function CommentThread({ comments, onAdd, onToggleVisibility, disabled }: CommentThreadProps) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<'comment' | 'mail' | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

const submit = async (sendMail: boolean) => {
  if (!text.trim()) return;
  setSaving(sendMail ? 'mail' : 'comment');
  setError(null);
  try {
    await onAdd(text.trim(), sendMail);
    setText('');
    setOpen(false);
  } catch (e) {
    setError((e as Error).message);
  } finally {
    setSaving(null);
  }
};

  const toggle = async (c: CommentEntry) => {
    if (!onToggleVisibility) return;
    setTogglingId(c.id);
    try {
      await onToggleVisibility(c.id, c.visible === false);
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          <MessageSquareIcon className="w-4 h-4" /> Comments ({comments.length})
        </h3>
        {!disabled && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-sm text-blue-600 hover:underline"
          >
            {open ? 'Cancel' : 'Add comment'}
          </button>
        )}
      </div>

      {open && (
        <div className="mb-4">
          <textarea
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            placeholder="Enter your comment..."
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => submit(false)}
              disabled={!text.trim() || saving !== null}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm disabled:opacity-50"
            >
              {saving === 'comment' && <Loader2Icon className="w-4 h-4 animate-spin" />}
              Comment
            </button>
            <button
              type="button"
              onClick={() => submit(true)}
              disabled={!text.trim() || saving !== null}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50"
            >
              {saving === 'mail' ? <Loader2Icon className="w-4 h-4 animate-spin" /> : <SendIcon className="w-4 h-4" />}
              Comment and mail
            </button>
          </div>
        </div>
      )}

      {comments.length === 0 ? (
        <p className="text-sm text-gray-400">No comments yet.</p>
      ) : (
        <ul className="space-y-3 max-h-60 overflow-y-auto">
          {[...comments].reverse().map((c) => {
            const isVisible = c.visible !== false;
            return (
              <li key={c.id} className="p-3 bg-gray-50 rounded-lg text-sm">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-gray-800">{c.authorName || c.authorId}</span>
                  {c.role && (
                    <span className="text-[10px] uppercase tracking-wide text-gray-400">{c.role}</span>
                  )}
                  {!isVisible && (
                    <span className="text-[10px] uppercase tracking-wide text-amber-500">Hidden from customer</span>
                  )}
                  <span className="text-xs text-gray-400 ml-auto">
                    {c.timestamp ? new Date(c.timestamp).toLocaleString() : ''}
                  </span>
                  {onToggleVisibility && (
                    <button
                      type="button"
                      onClick={() => toggle(c)}
                      disabled={togglingId === c.id}
                      title={isVisible ? 'Hide from customer' : 'Show to customer'}
                      className="text-gray-400 hover:text-gray-700 disabled:opacity-50"
                    >
                      {isVisible ? <EyeIcon className="w-4 h-4" /> : <EyeOffIcon className="w-4 h-4" />}
                    </button>
                  )}
                </div>
                <p className="text-gray-700 whitespace-pre-wrap">{c.text}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
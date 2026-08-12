import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeftIcon } from 'lucide-react';

import { CommentThread } from '../components/CommentThread';
import { STATUS_LABELS, statusBadgeClass, urgencyBadgeClass, sentimentBadgeClass, TICKET_STATUS } from '../constants/ticketStatus';
import { useAuth } from './AuthContext';
import { getTicket, addTicketComment, updateTicketStatus, getTicketHistory, setCommentVisibility, TicketDetail as TicketDetailType, StatusHistoryEntry } from './services/ticketApi';

export default function TicketDetail() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [detail, setDetail] = useState<TicketDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<StatusHistoryEntry[]>([]);

  const load = async () => {
    if (!taskId) return;
    setLoading(true);
    try {
      const [d, h] = await Promise.all([getTicket(taskId), getTicketHistory(taskId)]);
      setDetail(d);
      setHistory(h);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [taskId]);

  const handleAddComment = async (text: string, sendMail: boolean) => {
    if (!taskId) return;
    const comments = await addTicketComment(taskId, user?.id || 'admin', user?.name || 'Admin', text, sendMail);
    setDetail((d) => (d ? { ...d, comments } : d));
  };

  const handleToggleVisibility = async (commentId: string, visible: boolean) => {
    if (!taskId) return;
    const comments = await setCommentVisibility(taskId, commentId, visible);
    setDetail((d) => (d ? { ...d, comments } : d));
  };

  const handleStatusChange = async (status: string) => {
    if (!taskId) return;
    setSaving(true);
    try {
      await updateTicketStatus(taskId, status, user?.id);
      await load();
      if (status === TICKET_STATUS.CLOSED) navigate('/tickets');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-gray-400">Loading ticket…</p>;
  if (error) return <div className="badge badge-danger">{error}</div>;
  if (!detail) return null;

  const v = detail.variables;
  const status = v.ticketStatus || 'OPEN';
  const customerComments = detail.comments.filter((c) => c.role === 'customer');
  const adminComments = detail.comments.filter((c) => c.role !== 'customer');

  return (
    <div>
      <button type="button" className="btn btn-ghost mb-3" onClick={() => navigate('/tickets')}>
        <ArrowLeftIcon className="w-4 h-4" /> Back to tickets
      </button>

      <div className="card mb-4">
        <div className="card-head">
          <h3>{v.subject}</h3>
          <span className={`badge ${statusBadgeClass(status)}`} style={{ marginLeft: 'auto' }}>{STATUS_LABELS[status] || status}</span>
        </div>
        <div className="card-body">
          <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
            <div>
              <div className="text-gray-400 text-xs uppercase mb-1">Customer</div>
              <div className="text-gray-800">{v.customerName}</div>
              <div className="text-gray-500">{v.customerEmail}</div>
            </div>
            <div>
              <div className="text-gray-400 text-xs uppercase mb-1">Category</div>
              <div className="text-gray-800">{v.productOrCategory}</div>
            </div>
            <div>
              <div className="text-gray-400 text-xs uppercase mb-1">Urgency</div>
              <span className={`badge ${urgencyBadgeClass(v.urgency)}`}>{v.urgency}</span>
            </div>
            <div>
              <div className="text-gray-400 text-xs uppercase mb-1">Sentiment</div>
              <span className={`badge ${sentimentBadgeClass(v.sentiment)}`}>{v.sentiment}</span>
            </div>
            <div>
              <div className="text-gray-400 text-xs uppercase mb-1">Received</div>
              <div className="text-gray-800">{v.receivedAt ? new Date(v.receivedAt).toLocaleString() : '—'}</div>
            </div>
          </div>

          <div className="text-gray-400 text-xs uppercase mb-1">Description (AI summary)</div>
          <p className="text-gray-700 whitespace-pre-wrap mb-4">{v.description}</p>

          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">Update status:</span>
            {(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const).map((s) => (
              <button
                key={s}
                type="button"
                disabled={saving || s === status}
                onClick={() => handleStatusChange(s)}
                className={`btn ${s === status ? 'btn-primary' : 'btn-outline'}`}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {customerComments.length > 0 && (
        <div className="card mb-4">
          <div className="card-body">
            <h4 className="text-sm font-semibold text-gray-800 mb-3">
              Customer follow-ups ({customerComments.length})
            </h4>
            <ul className="space-y-3">
              {customerComments.map((c, i) => (
                <li key={i} className="text-sm border-l-2 border-blue-400 pl-3">
                  <div className="text-gray-800 whitespace-pre-wrap">{c.text}</div>
                  <div className="text-gray-400 text-xs mt-1">
                    {c.authorName} · {c.timestamp ? new Date(c.timestamp).toLocaleString() : '—'}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-body">
          <CommentThread
            comments={adminComments}
            onAdd={handleAddComment}
            onToggleVisibility={handleToggleVisibility}
            disabled={status === 'CLOSED'}
          />
        </div>
      </div>

      <div className="card mt-4">
        <div className="card-body">
          <h4 className="text-sm font-semibold text-gray-800 mb-3">Status history</h4>
          {history.length === 0 ? (
            <p className="text-gray-400 text-sm">No status changes recorded yet.</p>
          ) : (
            <ul className="space-y-2">
              {history.map((h, i) => (
                <li key={i} className="flex items-center gap-3 text-sm">
                  <span className={`badge ${statusBadgeClass(h.status)}`}>{STATUS_LABELS[h.status] || h.status}</span>
                  <span className="text-gray-500">{new Date(h.time).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
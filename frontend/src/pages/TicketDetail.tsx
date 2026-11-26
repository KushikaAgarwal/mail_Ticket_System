import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeftIcon } from 'lucide-react';
import AttachmentList from '../components/AttachmentList';
import { CommentThread } from '../components/CommentThread';
import { STATUS_LABELS, statusBadgeClass, urgencyBadgeClass, sentimentBadgeClass, TICKET_STATUS } from '../constants/ticketStatus';
import { useAuth } from './AuthContext';
import {
  getTicket,
  addTicketComment,
  updateTicketStatus,
  getTicketHistory,
  setCommentVisibility,
  getMyAssignableAgents,
  getAllCustomerSupport,
  getMentionable,          // ← add
  assignTicket,
  TicketDetail as TicketDetailType,
  StatusHistoryEntry,
  TeamUser,
  MentionUser,             // ← add
} from './services/ticketApi';

// Who can assign tickets at all.
const ASSIGN_ROLES = ['LEAD', 'MANAGER', 'ZONAL_ADMIN', 'SUPERVISOR', 'SUPER_ADMIN'];
// Who can override ANY existing assignment (a Lead can only change their own).
const OVERRIDE_ROLES = ['SUPER_ADMIN', 'SUPERVISOR', 'ZONAL_ADMIN', 'MANAGER'];
// Roles whose roster spans every zone.
const ALL_ZONE_ASSIGN_ROLES = ['SUPER_ADMIN', 'SUPERVISOR'];

function rosterLabel(u: TeamUser): string {
  return u.zoneName ? `${u.name} — ${u.zoneName}` : u.name;
}

export default function TicketDetail() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [detail, setDetail] = useState<TicketDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<StatusHistoryEntry[]>([]);

  const [roster, setRoster] = useState<TeamUser[]>([]);
  const [assigning, setAssigning] = useState(false);

  const canAssign = !!user && ASSIGN_ROLES.includes(user.role);
  const [mentionable, setMentionable] = useState<MentionUser[]>([]);

  useEffect(() => {
    if (!taskId) return;
    getMentionable(taskId).then(setMentionable).catch(() => setMentionable([]));
  }, [taskId]);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  // Roster is decided by the backend from the verified token:
  //   Lead -> their own team · Manager / Zonal Admin -> their zone ·
  //   Super Admin / Supervisor -> every agent (labelled with zone).
  useEffect(() => {
    if (!user) return;
    if (ALL_ZONE_ASSIGN_ROLES.includes(user.role)) {
      getAllCustomerSupport().then(setRoster).catch(() => {});
    } else if (ASSIGN_ROLES.includes(user.role)) {
      getMyAssignableAgents().then(setRoster).catch(() => {});
    } else {
      setRoster([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, user?.id]);

    const handleAddComment = async (text: string, sendMail: boolean, files: File[], mentionIds: string[]) => {
    if (!taskId) return;
    const r = await addTicketComment(taskId, text, sendMail, files, mentionIds);
    setDetail((d) => (d ? { ...d, comments: r.comments } : d));
    if (sendMail && r.mailError) return `Saved, but the email was not sent: ${r.mailError}`;
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

  const handleAssign = async (engineerId: string, engineerName: string) => {
    if (!taskId) return;
    setAssigning(true);
    setError(null);
    try {
      await assignTicket(taskId, engineerId, engineerName);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAssigning(false);
    }
  };

  if (loading) return <p className="text-gray-400">Loading ticket…</p>;
  if (error) return <div className="badge badge-danger">{error}</div>;
  if (!detail) return null;

  const v = detail.variables;
  const status = v.ticketStatus || 'OPEN';
  const customerComments = detail.comments.filter((c) => c.role === 'customer');
  const adminComments = detail.comments.filter((c) => c.role !== 'customer');

  const isLocked = v.assignmentLocked === 'true' || v.assignmentLocked === true;
  const canOverrideLock = !!user && OVERRIDE_ROLES.includes(user.role);
  // A Lead may change an assignment only if they made it themselves.
  const assignedByMe = isLocked && !!user && !!v.assignedById && v.assignedById === user.id;
  const showAssignPicker = canAssign && (!isLocked || canOverrideLock || assignedByMe);
  const showLockedNotice = canAssign && isLocked && !canOverrideLock && !assignedByMe;

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
              <div className="text-gray-400 text-xs uppercase mb-1">Received</div>
              <div className="text-gray-800">{v.receivedAt ? new Date(v.receivedAt).toLocaleString() : '—'}</div>
            </div>
          </div>

          <div className="text-gray-400 text-xs uppercase mb-1">Description (AI summary)</div>
          <p className="text-gray-700 whitespace-pre-wrap mb-4">{v.description}</p>
          {detail.attachments && detail.attachments.length > 0 && (
            <div className="mb-4">
              <div className="text-gray-400 text-xs uppercase mb-1">Attachments</div>
              <AttachmentList ticketId={taskId || ''} items={detail.attachments} />
            </div>
          )}
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

          {canAssign && (
            <div className="flex items-center gap-2 mt-3">
              <span className="text-sm text-gray-500">Assigned to:</span>
              {v.assignedEngineerName ? (
                <span className="badge badge-info">{v.assignedEngineerName}</span>
              ) : (
                <span className="text-gray-400 text-sm">Unassigned</span>
              )}

              {showAssignPicker && roster.length > 0 && (
                <select
                  disabled={assigning}
                  defaultValue=""
                  onChange={(e) => {
                    const picked = roster.find((r) => r.id === e.target.value);
                    if (picked) handleAssign(picked.id, picked.name);
                    e.target.value = '';
                  }}
                  className="px-2 py-1 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="" disabled>
                    {v.assignedEngineerName ? 'Reassign to…' : 'Assign to…'}
                  </option>
                  {roster.map((r) => (
                    <option key={r.id} value={r.id}>{rosterLabel(r)}</option>
                  ))}
                </select>
              )}

              {showAssignPicker && roster.length === 0 && (
                <span className="text-xs text-gray-400">
                  {user?.role === 'LEAD'
                    ? 'You have no Customer Support agents in your team yet.'
                    : 'No Customer Support agents available to assign.'}
                </span>
              )}

              {showLockedNotice && (
                <span className="text-xs text-gray-400">Locked — assigned by another lead</span>
              )}
            </div>
          )}
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
                                    <AttachmentList ticketId={taskId || ''} items={c.attachments} />
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
            ticketId={taskId || ''}
            comments={adminComments}
            mentionable={mentionable}
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
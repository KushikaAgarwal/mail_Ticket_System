import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellIcon } from 'lucide-react';
import { useAuth } from '../pages/AuthContext';
import { getTickets, getMyMentions, TicketSummary, MentionItem } from '../pages/services/ticketApi';
import { ticketKey } from './ui';

const POLL_MS = 60_000;
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type Kind = 'mention' | 'high' | 'unassigned' | 'update';

interface Item {
  id: string;
  ticketId: string;
  at: number;
  kind: Kind;
  text: string;
}

const KIND_LABEL: Record<Kind, string> = {
  mention: 'Mentioned you',
  high: 'High priority',
  unassigned: 'Needs assignment',
  update: 'Activity',
};

const KIND_COLOR: Record<Kind, string> = {
  mention: '#8270db',
  high: '#c9372c',
  unassigned: '#e56910',
  update: '#0c66e4',
};

function ticketKind(t: TicketSummary): Kind {
  const active = t.ticketStatus === 'OPEN' || t.ticketStatus === 'IN_PROGRESS';
  if (active && t.urgency === 'HIGH') return 'high';
  if (active && !t.assignedEngineerId) return 'unassigned';
  return 'update';
}

function timeAgo(ms: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [mentions, setMentions] = useState<MentionItem[]>([]);
  const [open, setOpen] = useState(false);
  const [seenAt, setSeenAt] = useState<number>(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const storageKey = user ? `qi_notif_seen_${user.id}` : '';

  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      setSeenAt(raw ? Number(raw) : Date.now() - 24 * 60 * 60 * 1000);
    } catch {
      setSeenAt(Date.now() - 24 * 60 * 60 * 1000);
    }
  }, [storageKey]);

  const load = useCallback(() => {
    getTickets().then(setTickets).catch(() => {});
    getMyMentions().then(setMentions).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return;
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [user, load]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const now = Date.now();
  const ticketItems: Item[] = tickets.map((t) => ({
    id: `t-${t.id}`,
    ticketId: t.id,
    at: new Date(t.lastActivityAt || t.receivedAt || t.createTime).getTime(),
    kind: ticketKind(t),
    text: `${ticketKey(t.ticketNumber)} · ${t.subject}`,
  }));
  const mentionItems: Item[] = mentions.map((m) => ({
    id: `m-${m.commentId}`,
    ticketId: m.ticketId,
    at: new Date(m.createdAt).getTime(),
    kind: 'mention',
    text: `${ticketKey(m.ticketNumber)} · ${m.authorName}: ${m.text}`,
  }));

  const items = [...mentionItems, ...ticketItems]
    .filter((i) => now - i.at <= WINDOW_MS)
    .sort((a, b) => b.at - a.at)
    .slice(0, 15);

  const unread = items.filter((i) => i.at > seenAt).length;

  const active = tickets.filter((t) => t.ticketStatus === 'OPEN' || t.ticketStatus === 'IN_PROGRESS');
  const unassignedCount = user?.role === 'CUSTOMER_SUPPORT' ? 0 : active.filter((t) => !t.assignedEngineerId).length;
  const highCount = active.filter((t) => t.urgency === 'HIGH').length;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) load();
  };

  const markAllRead = () => {
    const t = Date.now();
    setSeenAt(t);
    try {
      localStorage.setItem(storageKey, String(t));
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="notif-wrap" ref={boxRef}>
      <button type="button" className="icon-btn notif-btn" onClick={toggle} title="Notifications" aria-label="Notifications">
        <BellIcon size={16} />
        {unread > 0 && <span className="notif-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-head">
            <b>Notifications</b>
            {unread > 0 && (
              <button type="button" className="notif-link" onClick={markAllRead}>
                Mark all as read
              </button>
            )}
          </div>

          {(unassignedCount > 0 || highCount > 0) && (
            <div className="notif-summary">
              {unassignedCount > 0 && (
                <span className="notif-pill" style={{ color: KIND_COLOR.unassigned }}>{unassignedCount} unassigned</span>
              )}
              {highCount > 0 && (
                <span className="notif-pill" style={{ color: KIND_COLOR.high }}>{highCount} high priority open</span>
              )}
            </div>
          )}

          <div className="notif-list">
            {items.length === 0 && <div className="notif-empty">You're all caught up.</div>}
            {items.map((i) => (
              <div
                key={i.id}
                className={`notif-item${i.at > seenAt ? ' unread' : ''}`}
                onClick={() => {
                  setOpen(false);
                  navigate(`/tickets/${i.ticketId}`);
                }}
              >
                <span className="notif-dot" style={{ background: KIND_COLOR[i.kind] }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="notif-title">
                    <span style={{ color: KIND_COLOR[i.kind], fontWeight: 600 }}>{KIND_LABEL[i.kind]}</span>
                    <span className="notif-time">{timeAgo(i.at)}</span>
                  </div>
                  <div className="notif-text">{i.text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
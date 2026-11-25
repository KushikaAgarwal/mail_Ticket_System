import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckIcon } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';
const REFRESH_MS = 60_000;

interface PublicTicket {
  id: string;
  ticketNumber?: number;
  subject: string;
  description: string;
  productOrCategory: string;
  status: string;
  receivedAt: string;
  comments: { authorName: string; text: string; timestamp?: string }[];
  history: { status: string; time: string }[];
}

const STEPS = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

const STEP_LABEL: Record<string, string> = {
  OPEN: 'Received',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

const STATUS_NOTE: Record<string, string> = {
  OPEN: 'We have received your request and our team will review it shortly.',
  IN_PROGRESS: 'Our team is working on your request.',
  RESOLVED: 'Your request has been resolved. Reply to our email if you still need help.',
  CLOSED: 'This ticket is closed. Please send a new email if you need further help.',
};

const fmt = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '—';

export default function TicketTrack() {
  const { id } = useParams<{ id: string }>();
  const [t, setT] = useState<PublicTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${API_BASE}/api/public/tickets/${id}`)
        .then((r) => {
          if (!r.ok) throw new Error('not found');
          return r.json();
        })
        .then((d) => alive && (setT(d), setNotFound(false)))
        .catch(() => alive && !t && setNotFound(true))
        .finally(() => alive && setLoading(false));
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) return <div className="trk-page"><div className="trk-card trk-center">Loading your ticket…</div></div>;
  if (notFound || !t)
    return (
      <div className="trk-page">
        <div className="trk-card trk-center">
          <h2>Ticket not found</h2>
          <p className="trk-muted">Please check the link in your email, or reply to that email and we’ll help.</p>
        </div>
      </div>
    );

  const key = t.ticketNumber ? `PS-${t.ticketNumber}` : 'Your ticket';
  const idx = Math.max(0, STEPS.indexOf(t.status));
  const timeline = [...t.history].reverse();

  return (
    <div className="trk-page">
      <div className="trk-card">
        <div className="trk-brand">
          <div className="trk-logo">PS</div>
          <div>
            <div className="trk-brand-name">PS QuickIt</div>
            <div className="trk-muted">Support ticket status</div>
          </div>
        </div>

        <div className="trk-head">
          <div>
            <div className="trk-label">Ticket</div>
            <div className="trk-key">{key}</div>
          </div>
          <span className={`trk-badge trk-${t.status.toLowerCase()}`}>{STEP_LABEL[t.status] || t.status}</span>
        </div>

        <h1 className="trk-subject">{t.subject}</h1>

        {/* Progress tracker */}
        <div className="trk-steps">
          {STEPS.map((s, i) => (
            <div key={s} className={`trk-step${i <= idx ? ' done' : ''}${i === idx ? ' current' : ''}`}>
              <div className="trk-dot">{i < idx || (i === idx && t.status === 'CLOSED') ? <CheckIcon size={12} /> : i + 1}</div>
              <div className="trk-step-label">{STEP_LABEL[s]}</div>
            </div>
          ))}
        </div>
        <div className="trk-note">{STATUS_NOTE[t.status]}</div>

        <div className="trk-meta">
          <div>
            <div className="trk-label">Category</div>
            <div>{t.productOrCategory || 'General Inquiry'}</div>
          </div>
          <div>
            <div className="trk-label">Submitted</div>
            <div>{fmt(t.receivedAt)}</div>
          </div>
        </div>

        <div className="trk-section">
          <div className="trk-label">Your request</div>
          <p className="trk-text">{t.description}</p>
        </div>

        <div className="trk-section">
          <h3>Updates from our team</h3>
          {t.comments.length === 0 ? (
            <p className="trk-muted">No updates yet. We’ll email you as soon as there’s news.</p>
          ) : (
            <div className="trk-updates">
              {t.comments.map((c, i) => (
                <div key={i} className="trk-update">
                  <div className="trk-update-head">
                    <b>{c.authorName || 'Support'}</b>
                    <span className="trk-muted">{fmt(c.timestamp)}</span>
                  </div>
                  <div className="trk-text">{c.text}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="trk-section">
          <h3>Activity</h3>
          <div className="trk-timeline">
            {timeline.map((h, i) => (
              <div key={i} className="trk-tl-row">
                <span className="trk-tl-dot" />
                <b>{STEP_LABEL[h.status] || h.status}</b>
                <span className="trk-muted">{fmt(h.time)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="trk-foot">
          Need to add something? Simply reply to the email we sent you and it will be added to this ticket.
        </div>
      </div>
    </div>
  );
}
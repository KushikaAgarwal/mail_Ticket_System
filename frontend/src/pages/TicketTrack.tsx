import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckIcon } from 'lucide-react';
import { formatSize } from '../components/attachmentRules'; // adjust the relative path to where you put it

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';
const REFRESH_MS = 60_000;

interface PubAttachment { id: string; filename: string; sizeBytes?: number | null }

interface PublicTicket {
  id: string;
  ticketNumber?: number;
  subject: string;
  description: string;
  productOrCategory: string;
  status: string;
  receivedAt: string;
  attachments?: PubAttachment[];
  comments: { authorName: string; text: string; timestamp?: string; attachments?: PubAttachment[] }[];
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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="trk-root">
      <div className="trk-bg" aria-hidden="true">
        <i className="trk-stripe s1" />
        <i className="trk-stripe s2" />
        <i className="trk-stripe s3" />
        <i className="trk-stripe s4" />
        <i className="trk-stripe s5" />
      </div>

      <div className="trk-strip" />
      <header className="trk-header">
        <div className="trk-brand">
          <img src="/image.png" alt="PS QuickIT" className="trk-logo-img" />
          <div className="trk-brand-sub">Support Desk</div>
        </div>
        <div className="trk-header-title">Ticket Status</div>
      </header>

      <section className="trk-hero">
        <div className="trk-hero-text">
          <div className="trk-hero-welcome">Track Your Request</div>
          <div className="trk-hero-sub">PS QuickIt Support Portal</div>
        </div>
      </section>

      <main className="trk-main">{children}</main>

      <footer className="trk-footer">© PS QuickIt Support · This is an automated status page</footer>
    </div>
  );
}

/** Download links for files on the ticket or on a comment (public, no login). */
function Files({ ticketId, items }: { ticketId: string; items?: PubAttachment[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="trk-files">
      {items.map((a) => (
        <a
          key={a.id}
          href={`${API_BASE}/api/public/tickets/${ticketId}/attachments/${a.id}`}
          className="trk-file"
          download
        >
          📎 <span>{a.filename}</span> <em>{formatSize(a.sizeBytes)}</em>
        </a>
      ))}
    </div>
  );
}

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
        .then((d) => {
          if (alive) {
            setT(d);
            setNotFound(false);
          }
        })
        .catch(() => alive && setT((cur) => { if (!cur) setNotFound(true); return cur; }))
        .finally(() => alive && setLoading(false));
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id]);

  if (loading) return <Shell><div className="trk-card trk-center">Loading your ticket…</div></Shell>;

  if (notFound || !t)
    return (
      <Shell>
        <div className="trk-card trk-center">
          <h2>Ticket not found</h2>
          <p className="trk-muted">Please check the link in your email, or reply to that email and we’ll help.</p>
        </div>
      </Shell>
    );

  const key = t.ticketNumber ? `PS-${t.ticketNumber}` : 'Your ticket';
  const idx = Math.max(0, STEPS.indexOf(t.status));
  const timeline = [...t.history].reverse();

  return (
    <Shell>
      <div className="trk-card">
        <div className="trk-head">
          <div>
            <div className="trk-label">Ticket number</div>
            <div className="trk-key">{key}</div>
          </div>
          <span className={`trk-badge trk-${t.status.toLowerCase()}`}>{STEP_LABEL[t.status] || t.status}</span>
        </div>

        <h1 className="trk-subject">{t.subject}</h1>

        <div className="trk-steps">
          {STEPS.map((s, i) => (
            <div key={s} className={`trk-step${i <= idx ? ' done' : ''}${i === idx ? ' current' : ''}`}>
              <div className="trk-dot">{i < idx || (i === idx && t.status === 'CLOSED') ? <CheckIcon size={13} /> : i + 1}</div>
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
          <h3>Your request</h3>
          <p className="trk-text">{t.description}</p>
          <Files ticketId={t.id} items={t.attachments} />
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
                  <Files ticketId={t.id} items={c.attachments} />
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
    </Shell>
  );
}
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { STATUS_LABELS, statusBadgeClass, urgencyBadgeClass, sentimentBadgeClass } from '../constants/ticketStatus';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';

interface PublicComment {
  authorName: string;
  text: string;
  timestamp: string;
}

interface StatusHistoryEntry {
  status: string;
  time: string;
}

interface PublicTicket {
  id: string;
  subject: string;
  description: string;
  productOrCategory: string;
  urgency: string;
  sentiment: string;
  status: string;
  receivedAt: string;
  comments: PublicComment[];
  history: StatusHistoryEntry[];
}

export default function TicketTrack() {
  const { id } = useParams<{ id: string }>();
  const [ticket, setTicket] = useState<PublicTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/api/public/tickets/${id}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Ticket not found');
        setTicket(data);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div className="min-h-screen flex items-center justify-center py-10" style={{ background: 'var(--bg)' }}>
      <div className="card" style={{ width: 560, padding: 28 }}>
        <div className="flex items-center gap-2 mb-6">
          <div
            className="brand-logo"
            style={{ background: 'linear-gradient(135deg,#3b82f6,#0ea5a3)' }}
          />
          <div>
            <div className="font-semibold text-gray-800">PS QuickIt</div>
            <div className="text-xs text-gray-400">Ticket status</div>
          </div>
        </div>

        {loading && <p className="text-gray-400">Loading ticket…</p>}

        {!loading && error && (
          <div className="badge badge-danger">
            We couldn't find a ticket with this ID. Double-check the link from your email.
          </div>
        )}

        {!loading && ticket && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <h3 className="text-gray-800">{ticket.subject}</h3>
              <span className={`badge ${statusBadgeClass(ticket.status)}`} style={{ marginLeft: 'auto' }}>
                {STATUS_LABELS[ticket.status] || ticket.status}
              </span>
            </div>

            <div className="text-xs text-gray-400 mb-4">Ticket ID: {ticket.id}</div>

            <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
              <div>
                <div className="text-gray-400 text-xs uppercase mb-1">Category</div>
                <div className="text-gray-800">{ticket.productOrCategory || '—'}</div>
              </div>
              <div>
                <div className="text-gray-400 text-xs uppercase mb-1">Urgency</div>
                <span className={`badge ${urgencyBadgeClass(ticket.urgency)}`}>{ticket.urgency || '—'}</span>
              </div>
              <div>
                <div className="text-gray-400 text-xs uppercase mb-1">Sentiment</div>
                <span className={`badge ${sentimentBadgeClass(ticket.sentiment)}`}>{ticket.sentiment || '—'}</span>
              </div>
              <div>
                <div className="text-gray-400 text-xs uppercase mb-1">Received</div>
                <div className="text-gray-800">
                  {ticket.receivedAt ? new Date(ticket.receivedAt).toLocaleString() : '—'}
                </div>
              </div>
            </div>

            <div className="text-gray-400 text-xs uppercase mb-1">Description</div>
            <p className="text-gray-700 whitespace-pre-wrap mb-6">{ticket.description}</p>

            <div className="text-sm font-semibold text-gray-800 mb-2">Updates</div>
            {ticket.comments.length === 0 ? (
              <p className="text-gray-400 text-sm mb-6">No updates yet — our team is on it.</p>
            ) : (
              <ul className="space-y-3 mb-6">
                {ticket.comments.map((c, i) => (
                  <li key={i} className="text-sm">
                    <div className="text-gray-800">{c.text}</div>
                    <div className="text-gray-400 text-xs">
                      {c.authorName} · {new Date(c.timestamp).toLocaleString()}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="text-sm font-semibold text-gray-800 mb-2">Status history</div>
            {ticket.history.length === 0 ? (
              <p className="text-gray-400 text-sm">No status changes recorded yet.</p>
            ) : (
              <ul className="space-y-2">
                {ticket.history.map((h, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm">
                    <span className={`badge ${statusBadgeClass(h.status)}`}>
                      {STATUS_LABELS[h.status] || h.status}
                    </span>
                    <span className="text-gray-500">{new Date(h.time).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
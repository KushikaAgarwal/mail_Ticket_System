import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getTickets, TicketSummary } from './services/ticketApi';

const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;

const STATUS_LABELS: Record<(typeof STATUSES)[number], string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

const STATUS_BADGES: Record<(typeof STATUSES)[number], string> = {
  OPEN: 'badge-info',
  IN_PROGRESS: 'badge-warn',
  RESOLVED: 'badge-success',
  CLOSED: 'badge-danger',
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getTickets().then(setTickets).finally(() => setLoading(false));
  }, []);

  const sorted = [...tickets].sort(
    (a, b) => new Date(b.receivedAt || b.createTime).getTime() - new Date(a.receivedAt || a.createTime).getTime()
  );

  const cards = STATUSES.map((status) => ({
    label: STATUS_LABELS[status],
    value: tickets.filter((t) => t.ticketStatus === status).length,
    badge: STATUS_BADGES[status],
    status,
  }));

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-800 mb-4">Dashboard</h2>

      <div className="grid grid-cols-4 gap-4 mb-6">
        {cards.map((c) => (
          <div
            key={c.label}
            className="card card-body"
            style={{ cursor: 'pointer' }}
            onClick={() => navigate(`/tickets?status=${c.status}`)}
          >
            <div className="text-xs text-gray-400 uppercase mb-2">{c.label}</div>
            <div className="text-2xl font-semibold text-gray-800">{loading ? '—' : c.value}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Recent Tickets</h3>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => navigate('/tickets')}>
            View all
          </button>
        </div>
        <table className="table">
          <thead>
            <tr><th>Subject</th><th>Customer</th><th>Urgency</th><th>Status</th></tr>
          </thead>
          <tbody>
            {sorted.slice(0, 6).map((t) => (
              <tr key={t.id} onClick={() => navigate(`/tickets/${t.id}`)}>
                <td>{t.subject}</td>
                <td>{t.customerName}</td>
                <td>{t.urgency}</td>
                <td>{t.ticketStatus}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2Icon } from 'lucide-react';
import { getTickets, triggerIngestNow, TicketSummary } from './services/ticketApi';
import { STATUS_LABELS, statusBadgeClass, urgencyBadgeClass, sentimentBadgeClass } from '../constants/ticketStatus';

export default function TicketsList() {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [ingesting, setIngesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setTickets(await getTickets());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const runIngestNow = async () => {
    setIngesting(true);
    try {
      await triggerIngestNow();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIngesting(false);
    }
  };

  const sorted = [...tickets].sort(
    (a, b) => new Date(b.receivedAt || b.createTime).getTime() - new Date(a.receivedAt || a.createTime).getTime()
  );
  const visible = statusFilter === 'ALL' ? sorted : sorted.filter((t) => t.ticketStatus === statusFilter);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-800">Tickets</h2>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            <option value="ALL">All statuses</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        
          <button type="button" className="btn btn-primary" onClick={runIngestNow} disabled={ingesting}>
            {ingesting ? <Loader2Icon className="w-4 h-4 animate-spin" /> : null} Refresh
          </button>
        </div>
      </div>

      {error && <div className="badge badge-danger mb-3">{error}</div>}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Subject</th>
              <th>Customer</th>
              <th>Category</th>
              <th>Urgency</th>
              <th>Sentiment</th>
              <th>Status</th>
              <th>Received</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="text-center text-gray-400 py-6">Loading tickets…</td></tr>
            )}
            {!loading && visible.length === 0 && (
              <tr><td colSpan={7} className="text-center text-gray-400 py-6">No tickets yet — new support mail will appear here automatically.</td></tr>
            )}
            {!loading && visible.map((t) => (
              <tr key={t.id} onClick={() => navigate(`/tickets/${t.id}`)}>
                <td className="font-medium text-gray-800">{t.subject}</td>
                <td>
                  <div>{t.customerName}</div>
                  <div className="text-xs text-gray-400">{t.customerEmail}</div>
                </td>
                <td>{t.productOrCategory}</td>
                <td><span className={`badge ${urgencyBadgeClass(t.urgency)}`}>{t.urgency}</span></td>
                <td><span className={`badge ${sentimentBadgeClass(t.sentiment)}`}>{t.sentiment}</span></td>
                <td><span className={`badge ${statusBadgeClass(t.ticketStatus)}`}>{STATUS_LABELS[t.ticketStatus] || t.ticketStatus}</span></td>
                <td className="text-xs text-gray-500">{t.receivedAt ? new Date(t.receivedAt).toLocaleString() : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
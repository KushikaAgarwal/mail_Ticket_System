import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2Icon, RefreshCwIcon, SearchIcon } from 'lucide-react';
import { getTickets, getZones, triggerIngestNow, TicketSummary, Zone } from './services/ticketApi';
import { useAuth } from './AuthContext';
import { Avatar, PriorityIcon, ticketKey } from '../components/ui';
import { ALL_ZONE_ROLES, STATUS_LABELS, statusBadgeClass, zoneColor } from '../constants/ticketStatus';

const PAGE_SIZE = 15;

export default function TicketsList() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();

  // Roles allowed to filter by zone (the backend enforces this too).
  const canFilterZone = !!user && ALL_ZONE_ROLES.includes(user.role);

  const zone = params.get('zone') || 'ALL';
  const status = params.get('status') || 'ALL';
  const q = params.get('q') || '';

  const [urgency, setUrgency] = useState('ALL');
  const [page, setPage] = useState(1);
  const [zones, setZones] = useState<Zone[]>([]);
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [ingesting, setIngesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (!value || value === 'ALL') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
    setPage(1);
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setTickets(await getTickets(canFilterZone && zone !== 'ALL' ? { zoneId: zone } : {}));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canFilterZone) getZones().then(setZones).catch(() => {});
  }, [canFilterZone]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone, canFilterZone]);

  const refresh = async () => {
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

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...tickets]
      .sort(
        (a, b) =>
          new Date(b.receivedAt || b.createTime).getTime() - new Date(a.receivedAt || a.createTime).getTime()
      )
      .filter((t) => status === 'ALL' || t.ticketStatus === status)
      .filter((t) => urgency === 'ALL' || t.urgency === urgency)
      .filter(
        (t) =>
          !needle ||
          [t.subject, t.customerName, t.customerEmail, ticketKey(t.ticketNumber), t.productOrCategory]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(needle))
      );
  }, [tickets, status, urgency, q]);

  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = visible.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const colCount = canFilterZone ? 8 : 7;
  const zoneTitle =
    zone === 'ALL' ? 'All zones' : zone === 'none' ? 'Unassigned' : zones.find((z) => String(z.id) === zone)?.name || '';

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Tickets</h1>
          <div className="subtitle">
            {canFilterZone ? `${zoneTitle} · ` : ''}
            {loading ? 'Loading…' : `${visible.length} ticket${visible.length === 1 ? '' : 's'}`}
          </div>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-outline" onClick={refresh} disabled={ingesting}>
            {ingesting ? <Loader2Icon size={14} className="animate-spin" /> : <RefreshCwIcon size={14} />} Refresh
          </button>
        </div>
      </div>

      <div className="toolbar">
        <div className="field">
          <SearchIcon />
          <input
            type="search"
            value={q}
            onChange={(e) => setParam('q', e.target.value)}
            placeholder="Search by key, subject or customer"
          />
        </div>

        {canFilterZone && (
          <select value={zone} onChange={(e) => setParam('zone', e.target.value)} aria-label="Zone">
            <option value="ALL">Zone: All</option>
            {zones.map((z) => (
              <option key={z.id} value={String(z.id)}>Zone: {z.name}</option>
            ))}
            <option value="none">Zone: Unassigned</option>
          </select>
        )}

        <select value={status} onChange={(e) => setParam('status', e.target.value)} aria-label="Status">
          <option value="ALL">Status: All</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>Status: {label}</option>
          ))}
        </select>

        <select value={urgency} onChange={(e) => { setUrgency(e.target.value); setPage(1); }} aria-label="Priority">
          <option value="ALL">Priority: All</option>
          <option value="HIGH">Priority: High</option>
          <option value="MEDIUM">Priority: Medium</option>
          <option value="LOW">Priority: Low</option>
        </select>

        {(zone !== 'ALL' || status !== 'ALL' || urgency !== 'ALL' || q) && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => { setParams({}, { replace: true }); setUrgency('ALL'); setPage(1); }}
          >
            Clear filters
          </button>
        )}
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Summary</th>
              {canFilterZone && <th>Zone</th>}
              <th>Priority</th>
              <th>Status</th>
              <th>Assignee</th>
              <th>Category</th>
              <th>Received</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={colCount}><div className="empty">Loading tickets…</div></td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={colCount}>
                  <div className="empty"><b>No tickets found</b>Try changing or clearing the filters.</div>
                </td>
              </tr>
            )}
            {!loading && rows.map((t) => (
              <tr key={t.id} onClick={() => navigate(`/tickets/${t.id}`)}>
                <td className="ticket-key">{ticketKey(t.ticketNumber)}</td>
                <td style={{ maxWidth: 360 }}>
                  <div style={{ fontWeight: 500 }}>{t.subject}</div>
                  <div className="ticket-sub">{t.customerName} · {t.customerEmail}</div>
                </td>
                {canFilterZone && (
                  <td className="cell-muted">
                    <span className="row" style={{ gap: 6 }}>
                      <span className="zone-dot" style={{ background: zoneColor(t.zoneName) }} />
                      {t.zoneName || 'Unassigned'}
                    </span>
                  </td>
                )}
                <td><PriorityIcon urgency={t.urgency} /></td>
                <td>
                  <span className={`badge ${statusBadgeClass(t.ticketStatus)}`}>
                    {STATUS_LABELS[t.ticketStatus] || t.ticketStatus}
                  </span>
                </td>
                <td>
                  {t.assignedEngineerName ? (
                    <span className="cell-user"><Avatar name={t.assignedEngineerName} size="sm" /> {t.assignedEngineerName}</span>
                  ) : (
                    <span className="cell-muted">Unassigned</span>
                  )}
                </td>
                <td className="cell-muted">{t.productOrCategory}</td>
                <td className="cell-muted">{t.receivedAt ? new Date(t.receivedAt).toLocaleString() : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {!loading && visible.length > PAGE_SIZE && (
          <div className="pagination">
            <span>
              {(current - 1) * PAGE_SIZE + 1}–{Math.min(current * PAGE_SIZE, visible.length)} of {visible.length}
            </span>
            <div className="pages">
              <button type="button" disabled={current === 1} onClick={() => setPage(current - 1)}>‹</button>
              {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
                <button key={n} type="button" className={n === current ? 'active' : ''} onClick={() => setPage(n)}>
                  {n}
                </button>
              ))}
              <button type="button" disabled={current === pages} onClick={() => setPage(current + 1)}>›</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
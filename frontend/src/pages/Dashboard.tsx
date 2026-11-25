import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangleIcon, InboxIcon, UserXIcon, CheckCircle2Icon, TrendingUpIcon, TrendingDownIcon } from 'lucide-react';
import { getTickets, getZones, getZoneStats, TicketSummary, Zone, ZoneStat } from './services/ticketApi';
import { useAuth } from './AuthContext';
import { Avatar, PriorityIcon, ticketKey } from '../components/ui';
import {
  ALL_ZONE_ROLES,
  STATUS_COLORS,
  STATUS_LABELS,
  statusBadgeClass,
  zoneColor,
} from '../constants/ticketStatus';

const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const TREND_DAYS = 14;
const REFRESH_MS = 60_000;

const URGENCY_COLORS: Record<string, string> = { HIGH: '#c9372c', MEDIUM: '#e56910', LOW: '#8590a2' };
const SENTIMENT_COLORS: Record<string, string> = {
  POSITIVE: '#1f845a',
  NEUTRAL: '#8590a2',
  NEGATIVE: '#e56910',
  FRUSTRATED: '#c9372c',
};
const BAR_PALETTE = ['#0c66e4', '#1f845a', '#e56910', '#8270db', '#c9372c', '#2898bd'];

interface Slice {
  label: string;
  value: number;
  color: string;
}

// ── Small chart components (plain SVG, no library) ───────────────────

function Donut({ data, centerValue, centerLabel }: { data: Slice[]; centerValue: number; centerLabel: string }) {
  const r = 52;
  const C = 2 * Math.PI * r;
  const total = data.reduce((n, d) => n + d.value, 0);
  let offset = 0;
  return (
    <svg viewBox="0 0 140 140" className="dash-donut" role="img" aria-label="Tickets by status">
      <circle cx="70" cy="70" r={r} fill="none" stroke="#eef0f3" strokeWidth="16" />
      {total > 0 &&
        data.map((d) => {
          if (d.value === 0) return null;
          const len = (d.value / total) * C;
          const el = (
            <circle
              key={d.label}
              cx="70"
              cy="70"
              r={r}
              fill="none"
              stroke={d.color}
              strokeWidth="16"
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 70 70)"
            >
              <title>{`${d.label}: ${d.value}`}</title>
            </circle>
          );
          offset += len;
          return el;
        })}
      <text x="70" y="68" textAnchor="middle" fontSize="26" fontWeight="700" fill="currentColor">
        {centerValue}
      </text>
      <text x="70" y="86" textAnchor="middle" fontSize="11" fill="#6b778c">
        {centerLabel}
      </text>
    </svg>
  );
}

function TrendChart({ points }: { points: { label: string; value: number }[] }) {
  const W = 640;
  const H = 210;
  const pad = { l: 30, r: 12, t: 12, b: 28 };
  const max = Math.max(4, ...points.map((p) => p.value));
  const niceMax = Math.ceil(max / 4) * 4;
  const n = points.length;
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, n - 1);
  const y = (v: number) => pad.t + (1 - v / niceMax) * (H - pad.t - pad.b);

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(n - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
  const ticks = [0, 1, 2, 3, 4].map((i) => (niceMax / 4) * i);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="dash-trend" role="img" aria-label="Tickets received per day">
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0c66e4" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#0c66e4" stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#eef0f3" />
          <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="#6b778c">
            {Math.round(t)}
          </text>
        </g>
      ))}
      <path d={area} fill="url(#trendFill)" />
      <path d={line} fill="none" stroke="#0c66e4" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.value)} r="3.5" fill="#fff" stroke="#0c66e4" strokeWidth="2">
            <title>{`${p.label}: ${p.value} ticket${p.value === 1 ? '' : 's'}`}</title>
          </circle>
          {i % 2 === 0 && (
            <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="#6b778c">
              {p.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

function BarList({ rows, empty }: { rows: Slice[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <div className="empty" style={{ padding: 16 }}>{empty}</div>;
  return (
    <div className="dash-bars">
      {rows.map((r) => (
        <div key={r.label} className="dash-bar-row">
          <div className="dash-bar-label" title={r.label}>{r.label}</div>
          <div className="dash-bar-track">
            <div className="dash-bar-fill" style={{ width: `${(r.value / max) * 100}%`, background: r.color }} />
          </div>
          <div className="dash-bar-val">{r.value}</div>
        </div>
      ))}
    </div>
  );
}

function Panel({ title, sub, children, action }: { title: string; sub?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="card dash-panel">
      <div className="card-head">
        <div>
          <h3>{title}</h3>
          {sub && <div className="dash-panel-sub">{sub}</div>}
        </div>
        {action && <div style={{ marginLeft: 'auto' }}>{action}</div>}
      </div>
      <div className="dash-panel-body">{children}</div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const seesAllZones = !!user && ALL_ZONE_ROLES.includes(user.role);
  const isAgent = user?.role === 'CUSTOMER_SUPPORT';

  const [zone, setZone] = useState<string>('ALL'); // 'ALL' | 'none' | zone id
  const [zones, setZones] = useState<Zone[]>([]);
  const [stats, setStats] = useState<ZoneStat[]>([]);
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!seesAllZones) return;
    Promise.all([getZones(), getZoneStats()])
      .then(([z, s]) => {
        setZones(z);
        setStats(s);
      })
      .catch(() => {});
  }, [seesAllZones]);

  const loadTickets = useCallback(
    (showSpinner: boolean) => {
      if (showSpinner) setLoading(true);
      return getTickets(zone === 'ALL' ? {} : { zoneId: zone })
        .then(setTickets)
        .catch(() => {})
        .finally(() => setLoading(false));
    },
    [zone]
  );

  useEffect(() => {
    loadTickets(true);
    const id = setInterval(() => loadTickets(false), REFRESH_MS);
    return () => clearInterval(id);
  }, [loadTickets]);

  // ── Derived numbers ────────────────────────────────────────────────
  const m = useMemo(() => {
    const isActive = (t: TicketSummary) => t.ticketStatus === 'OPEN' || t.ticketStatus === 'IN_PROGRESS';
    const count = (s: string) => tickets.filter((t) => t.ticketStatus === s).length;
    const total = tickets.length;
    const open = count('OPEN');
    const inProgress = count('IN_PROGRESS');
    const resolved = count('RESOLVED');
    const closed = count('CLOSED');
    const active = tickets.filter(isActive);
    const unassigned = active.filter((t) => !t.assignedEngineerId).length;
    const highOpen = active.filter((t) => t.urgency === 'HIGH').length;
    const resolutionRate = total ? Math.round(((resolved + closed) / total) * 100) : 0;

    // Per-day received (last TREND_DAYS days, local time)
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const buckets: { key: string; label: string; value: number }[] = [];
    for (let i = TREND_DAYS - 1; i >= 0; i--) {
      const d = new Date(dayStart);
      d.setDate(d.getDate() - i);
      buckets.push({
        key: d.toDateString(),
        label: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
        value: 0,
      });
    }
    tickets.forEach((t) => {
      const k = new Date(t.receivedAt || t.createTime).toDateString();
      const b = buckets.find((x) => x.key === k);
      if (b) b.value += 1;
    });
    const today = buckets[buckets.length - 1].value;
    const yesterday = buckets[buckets.length - 2].value;
    const last14 = buckets.reduce((n, b) => n + b.value, 0);

    const group = (fn: (t: TicketSummary) => string | undefined | null) => {
      const map = new Map<string, number>();
      tickets.forEach((t) => {
        const k = fn(t);
        if (k) map.set(k, (map.get(k) || 0) + 1);
      });
      return [...map.entries()].sort((a, b) => b[1] - a[1]);
    };

    const urgency: Slice[] = ['HIGH', 'MEDIUM', 'LOW'].map((u) => ({
      label: u.charAt(0) + u.slice(1).toLowerCase(),
      value: tickets.filter((t) => t.urgency === u).length,
      color: URGENCY_COLORS[u],
    }));

    const sentiment: Slice[] = ['POSITIVE', 'NEUTRAL', 'NEGATIVE', 'FRUSTRATED']
      .map((s) => ({
        label: s.charAt(0) + s.slice(1).toLowerCase(),
        value: tickets.filter((t) => t.sentiment === s).length,
        color: SENTIMENT_COLORS[s],
      }))
      .filter((s) => s.value > 0);

    const categories: Slice[] = group((t) => t.productOrCategory)
      .slice(0, 6)
      .map(([label, value], i) => ({ label, value, color: BAR_PALETTE[i % BAR_PALETTE.length] }));

    // Open workload per agent
    const load = new Map<string, number>();
    active.forEach((t) => {
      if (t.assignedEngineerName) load.set(t.assignedEngineerName, (load.get(t.assignedEngineerName) || 0) + 1);
    });
    const workload: Slice[] = [...load.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, value]) => ({ label, value, color: '#0c66e4' }));

    // Needs attention: active tickets that are high priority or unassigned
    const rank = (t: TicketSummary) => (t.urgency === 'HIGH' ? 0 : 1);
    const attention = active
      .filter((t) => t.urgency === 'HIGH' || (!isAgent && !t.assignedEngineerId))
      .sort(
        (a, b) =>
          rank(a) - rank(b) ||
          new Date(a.receivedAt || a.createTime).getTime() - new Date(b.receivedAt || b.createTime).getTime()
      )
      .slice(0, 6);

    const recent = [...tickets]
      .sort(
        (a, b) =>
          new Date(b.receivedAt || b.createTime).getTime() - new Date(a.receivedAt || a.createTime).getTime()
      )
      .slice(0, 8);

    return {
      total, open, inProgress, resolved, closed, unassigned, highOpen, resolutionRate,
      today, yesterday, last14, buckets, urgency, sentiment, categories, workload, attention, recent,
    };
  }, [tickets, isAgent]);

  const statusSlices: Slice[] = STATUSES.map((s) => ({
    label: STATUS_LABELS[s],
    value: m[s === 'OPEN' ? 'open' : s === 'IN_PROGRESS' ? 'inProgress' : s === 'RESOLVED' ? 'resolved' : 'closed'],
    color: STATUS_COLORS[s],
  }));

  // One row per zone (plus "Unassigned" if any ticket has no zone yet).
  const zoneRows = useMemo(() => {
    const rows = zones.map((z) => ({
      key: String(z.id),
      name: z.name,
      counts: Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<string, number>,
    }));
    const unassigned = {
      key: 'none',
      name: 'Unassigned',
      counts: Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<string, number>,
    };
    stats.forEach((s) => {
      const row = s.zoneId == null ? unassigned : rows.find((r) => r.key === String(s.zoneId));
      if (row && s.status in row.counts) row.counts[s.status] += s.count;
    });
    const total = (r: { counts: Record<string, number> }) => STATUSES.reduce((n, k) => n + r.counts[k], 0);
    const all = total(unassigned) > 0 ? [...rows, unassigned] : rows;
    return all.map((r) => ({ ...r, total: total(r) }));
  }, [zones, stats]);

  const maxZoneTotal = Math.max(1, ...zoneRows.map((r) => r.total));
  const grandTotal = zoneRows.reduce((n, r) => n + r.total, 0);

  const zoneQuery = zone === 'ALL' ? '' : `&zone=${zone}`;
  const zoneLabel =
    zone === 'ALL' ? 'All zones' : zone === 'none' ? 'Unassigned' : zones.find((z) => String(z.id) === zone)?.name || '';

  const delta = m.today - m.yesterday;
  const scopeText = seesAllZones
    ? `Ticket overview — ${zoneLabel}`
    : user?.role === 'LEAD'
    ? 'Your team and your zone’s unassigned pool'
    : user?.role === 'CUSTOMER_SUPPORT'
    ? 'Tickets assigned to you'
    : user?.zoneName
    ? `Ticket overview — ${user.zoneName} zone`
    : 'Ticket overview';

  const v = (n: number) => (loading ? '—' : n);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <div className="subtitle">{scopeText}</div>
        </div>
      </div>

      {seesAllZones && (
        <div className="zone-chips">
          <button type="button" className={`zone-chip${zone === 'ALL' ? ' active' : ''}`} onClick={() => setZone('ALL')}>
            All zones <span className="n">{grandTotal}</span>
          </button>
          {zoneRows.map((r) => (
            <button
              key={r.key}
              type="button"
              className={`zone-chip${zone === r.key ? ' active' : ''}`}
              onClick={() => setZone(r.key)}
            >
              <span className="zone-dot" style={{ background: zoneColor(r.name) }} />
              {r.name} <span className="n">{r.total}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── KPI cards ── */}
      <div className="dash-kpis">
        <div className="kpi" style={{ borderTopColor: '#0c66e4' }} onClick={() => navigate(`/tickets?${zoneQuery.slice(1)}`)}>
          <div className="kpi-label"><InboxIcon size={13} /> Total tickets</div>
          <div className="kpi-value">{v(m.total)}</div>
          <div className="kpi-foot">
            {loading ? ' ' : (
              <>
                {delta >= 0 ? <TrendingUpIcon size={13} /> : <TrendingDownIcon size={13} />}
                {m.today} today <span className="dash-muted">({delta >= 0 ? '+' : ''}{delta} vs yesterday)</span>
              </>
            )}
          </div>
        </div>

        <div className="kpi" style={{ borderTopColor: STATUS_COLORS.OPEN }} onClick={() => navigate(`/tickets?status=OPEN${zoneQuery}`)}>
          <div className="kpi-label">Open</div>
          <div className="kpi-value">{v(m.open)}</div>
          <div className="kpi-foot dash-muted">Waiting for pickup</div>
        </div>

        <div className="kpi" style={{ borderTopColor: STATUS_COLORS.IN_PROGRESS }} onClick={() => navigate(`/tickets?status=IN_PROGRESS${zoneQuery}`)}>
          <div className="kpi-label">In progress</div>
          <div className="kpi-value">{v(m.inProgress)}</div>
          <div className="kpi-foot dash-muted">Being worked on</div>
        </div>

        <div className="kpi" style={{ borderTopColor: STATUS_COLORS.RESOLVED }} onClick={() => navigate(`/tickets?status=RESOLVED${zoneQuery}`)}>
          <div className="kpi-label"><CheckCircle2Icon size={13} /> Resolution rate</div>
          <div className="kpi-value">{loading ? '—' : `${m.resolutionRate}%`}</div>
          <div className="kpi-foot dash-muted">{m.resolved + m.closed} resolved or closed</div>
        </div>

        <div className="kpi" style={{ borderTopColor: '#c9372c' }} onClick={() => navigate(`/tickets?status=OPEN${zoneQuery}`)}>
          <div className="kpi-label"><AlertTriangleIcon size={13} /> High priority</div>
          <div className="kpi-value" style={{ color: m.highOpen > 0 ? '#c9372c' : undefined }}>{v(m.highOpen)}</div>
          <div className="kpi-foot dash-muted">Active, need attention</div>
        </div>

        {!isAgent && (
          <div className="kpi" style={{ borderTopColor: '#e56910' }} onClick={() => navigate(`/tickets?${zoneQuery.slice(1)}`)}>
            <div className="kpi-label"><UserXIcon size={13} /> Unassigned</div>
            <div className="kpi-value" style={{ color: m.unassigned > 0 ? '#e56910' : undefined }}>{v(m.unassigned)}</div>
            <div className="kpi-foot dash-muted">Active, no agent yet</div>
          </div>
        )}
      </div>

      {/* ── Trend + status donut ── */}
      <div className="dash-grid dash-grid-trend">
        <Panel title="Tickets received" sub={`Last ${TREND_DAYS} days · ${m.last14} total`}>
          <TrendChart points={m.buckets.map((b) => ({ label: b.label, value: b.value }))} />
        </Panel>

        <Panel title="Status breakdown" sub="All tickets in view">
          <div className="dash-donut-wrap">
            <Donut data={statusSlices} centerValue={m.total} centerLabel="tickets" />
            <div className="dash-legend-col">
              {statusSlices.map((s) => (
                <div
                  key={s.label}
                  className="dash-legend-row"
                  onClick={() =>
                    navigate(`/tickets?status=${STATUSES[statusSlices.indexOf(s)]}${zoneQuery}`)
                  }
                >
                  <i style={{ background: s.color }} />
                  <span>{s.label}</span>
                  <b>{s.value}</b>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      {/* ── Priority / sentiment / category ── */}
      <div className="dash-grid dash-grid-3">
        <Panel title="By priority">
          <BarList rows={m.urgency} empty="No tickets yet." />
        </Panel>
        <Panel title="Customer sentiment">
          <BarList rows={m.sentiment} empty="No tickets yet." />
        </Panel>
        <Panel title="Top categories">
          <BarList rows={m.categories} empty="No tickets yet." />
        </Panel>
      </div>

      {/* ── Zone chart (Super Admin / Supervisor) ── */}
      {seesAllZones && (
        <Panel title="Tickets by zone" sub="Stacked by status">
          {zoneRows.length === 0 && <div className="empty">No zones yet.</div>}
          {zoneRows.map((r) => (
            <div key={r.key} className="zone-row" onClick={() => navigate(`/tickets?zone=${r.key}`)}>
              <div className="row" style={{ gap: 8 }}>
                <span className="zone-dot" style={{ background: zoneColor(r.name) }} />
                <b style={{ fontWeight: 600 }}>{r.name}</b>
              </div>
              <div className="zone-bar" style={{ width: `${Math.max(4, (r.total / maxZoneTotal) * 100)}%` }}>
                {STATUSES.map((s) =>
                  r.counts[s] > 0 ? (
                    <i
                      key={s}
                      title={`${STATUS_LABELS[s]}: ${r.counts[s]}`}
                      style={{ width: `${(r.counts[s] / r.total) * 100}%`, background: STATUS_COLORS[s] }}
                    />
                  ) : null
                )}
              </div>
              <div style={{ textAlign: 'right', fontWeight: 600 }}>{r.total}</div>
            </div>
          ))}
          <div className="legend">
            {STATUSES.map((s) => (
              <span key={s}>
                <i style={{ background: STATUS_COLORS[s] }} /> {STATUS_LABELS[s]}
              </span>
            ))}
          </div>
        </Panel>
      )}

      {/* ── Needs attention + workload ── */}
      <div className="dash-grid dash-grid-2" style={{ marginTop: 16 }}>
        <Panel title="Needs attention" sub={isAgent ? 'Your high-priority tickets' : 'High priority or not yet assigned'}>
          {m.attention.length === 0 ? (
            <div className="empty" style={{ padding: 16 }}><b>All clear</b>Nothing urgent right now.</div>
          ) : (
            <div className="dash-attn">
              {m.attention.map((t) => (
                <div key={t.id} className="dash-attn-row" onClick={() => navigate(`/tickets/${t.id}`)}>
                  <PriorityIcon urgency={t.urgency} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="dash-attn-title">{t.subject}</div>
                    <div className="ticket-sub">
                      {ticketKey(t.ticketNumber)} · {t.customerName}
                    </div>
                  </div>
                  {t.assignedEngineerName ? (
                    <span className="cell-muted" style={{ fontSize: 12 }}>{t.assignedEngineerName}</span>
                  ) : (
                    <span className="badge badge-warn">Unassigned</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>

        {!isAgent ? (
          <Panel title="Agent workload" sub="Active tickets per agent">
            <BarList rows={m.workload} empty="No assigned tickets yet." />
          </Panel>
        ) : (
          <Panel title="Your progress" sub="Resolved or closed vs. total">
            <div className="dash-progress">
              <div className="dash-progress-num">{m.resolutionRate}%</div>
              <div className="dash-bar-track" style={{ height: 10 }}>
                <div className="dash-bar-fill" style={{ width: `${m.resolutionRate}%`, background: '#1f845a' }} />
              </div>
              <div className="dash-muted" style={{ marginTop: 8 }}>
                {m.resolved + m.closed} of {m.total} tickets done
              </div>
            </div>
          </Panel>
        )}
      </div>

      {/* ── Recent tickets ── */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <h3>Recent tickets</h3>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ marginLeft: 'auto' }}
            onClick={() => navigate(zone === 'ALL' ? '/tickets' : `/tickets?zone=${zone}`)}
          >
            View all
          </button>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Summary</th>
              {seesAllZones && <th>Zone</th>}
              <th>Priority</th>
              <th>Assignee</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {!loading && m.recent.length === 0 && (
              <tr>
                <td colSpan={seesAllZones ? 6 : 5}>
                  <div className="empty"><b>No tickets</b>New support mail will appear here automatically.</div>
                </td>
              </tr>
            )}
            {m.recent.map((t) => (
              <tr key={t.id} onClick={() => navigate(`/tickets/${t.id}`)}>
                <td className="ticket-key">{ticketKey(t.ticketNumber)}</td>
                <td>
                  {t.subject}
                  <div className="ticket-sub">{t.customerName}</div>
                </td>
                {seesAllZones && (
                  <td className="cell-muted">
                    <span className="row" style={{ gap: 6 }}>
                      <span className="zone-dot" style={{ background: zoneColor(t.zoneName) }} />
                      {t.zoneName || 'Unassigned'}
                    </span>
                  </td>
                )}
                <td><PriorityIcon urgency={t.urgency} /></td>
                <td>
                  {t.assignedEngineerName ? (
                    <span className="cell-user"><Avatar name={t.assignedEngineerName} size="sm" /> {t.assignedEngineerName}</span>
                  ) : (
                    <span className="cell-muted">Unassigned</span>
                  )}
                </td>
                <td>
                  <span className={`badge ${statusBadgeClass(t.ticketStatus)}`}>
                    {STATUS_LABELS[t.ticketStatus] || t.ticketStatus}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
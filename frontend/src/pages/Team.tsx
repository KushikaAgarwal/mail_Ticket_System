import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PlusIcon } from 'lucide-react';
import { useAuth } from './AuthContext';
import { getTeam, createTeamMember, getZones, TeamUser, Zone } from './services/ticketApi';
import { Avatar } from '../components/ui';
import { ALL_ZONE_ROLES, ROLE_LABELS, zoneColor } from '../constants/ticketStatus';

const TABS = ['ALL', 'SUPERVISOR', 'ZONAL_ADMIN', 'MANAGER', 'LEAD', 'CUSTOMER_SUPPORT'];

// Mirrors ALLOWED_CREATION in usersRepo.js (the backend is the real enforcer).
const CREATABLE_ROLES: Record<string, string[]> = {
  SUPER_ADMIN: ['SUPERVISOR', 'ZONAL_ADMIN'],
  SUPERVISOR: ['ZONAL_ADMIN'],
  ZONAL_ADMIN: ['MANAGER'],
  MANAGER: ['LEAD'],
  LEAD: ['CUSTOMER_SUPPORT'],
};

// Only these roles are created by someone with no zone of their own,
// so the creator has to pick the zone explicitly.
const ZONE_PICK_ROLES = ['ZONAL_ADMIN'];

const SUBTITLES: Record<string, string> = {
  SUPER_ADMIN: 'Create Supervisors and Zonal Admins, and see everyone in the organisation.',
  SUPERVISOR: 'Create Zonal Admins and assign them to a zone.',
  ZONAL_ADMIN: 'Create Managers for your zone and see everyone in it.',
  MANAGER: 'Create Leads for your zone and see everyone in it.',
  LEAD: 'Create Customer Support agents for your team.',
};

export default function Team() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();

  const creatable = user ? CREATABLE_ROLES[user.role] || [] : [];
  const seesAllZones = !!user && ALL_ZONE_ROLES.includes(user.role);

  const [team, setTeam] = useState<TeamUser[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<string>(creatable[0] || 'ALL');
  const [zoneFilter, setZoneFilter] = useState<string>('ALL');

  const [showForm, setShowForm] = useState(params.get('new') === '1');
  const [newRole, setNewRole] = useState<string>(''); // chosen role in the form
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [zoneId, setZoneId] = useState<number | ''>('');

  // Role actually being created (defaults to the first one this user can create).
  const activeRole = newRole && creatable.includes(newRole) ? newRole : creatable[0] || '';
  const zonePickerNeeded = ZONE_PICK_ROLES.includes(activeRole);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, z] = await Promise.all([getTeam(), getZones()]);
      setTeam(t);
      setZones(z);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openForm = (role: string) => {
    setNewRole(role);
    setFormError(null);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setFormError(null);
    if (params.get('new')) {
      const next = new URLSearchParams(params);
      next.delete('new');
      setParams(next, { replace: true });
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRole) return;
    setCreating(true);
    setFormError(null);
    try {
      await createTeamMember({
        name,
        email,
        password,
        role: activeRole,
        zoneId: zonePickerNeeded ? Number(zoneId) : undefined,
      });
      setName('');
      setEmail('');
      setPassword('');
      setZoneId('');
      closeForm();
      setTab(activeRole);
      await load();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const countFor = (role: string) => (role === 'ALL' ? team.length : team.filter((u) => u.role === role).length);

  const rows = useMemo(
    () =>
      team
        .filter((u) => tab === 'ALL' || u.role === tab)
        .filter((u) => zoneFilter === 'ALL' || String(u.zoneId) === zoneFilter),
    [team, tab, zoneFilter]
  );

  if (!user || user.role === 'CUSTOMER_SUPPORT') {
    return <div className="empty"><b>No access</b>Your role doesn't manage any accounts.</div>;
  }

  const roleName = activeRole ? ROLE_LABELS[activeRole] : '';

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Team</h1>
          <div className="subtitle">{SUBTITLES[user.role] || 'Manage the people you are responsible for.'}</div>
        </div>
        {creatable.length > 0 && (
          <div className="page-actions" style={{ display: 'flex', gap: 8 }}>
            {creatable.map((r, i) => (
              <button
                key={r}
                type="button"
                className={`btn ${i === 0 ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => openForm(r)}
              >
                <PlusIcon size={14} /> Create {ROLE_LABELS[r]}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="toolbar">
        <div className="tab-bar" style={{ marginBottom: 0, flex: 1 }}>
          {TABS.map((t) => (
            <div key={t} className={`seg-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
              {t === 'ALL' ? 'Everyone' : `${ROLE_LABELS[t]}s`} <span className="text-soft">({countFor(t)})</span>
            </div>
          ))}
        </div>
        {seesAllZones && (
          <select value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)} aria-label="Zone">
            <option value="ALL">Zone: All</option>
            {zones.map((z) => (
              <option key={z.id} value={String(z.id)}>Zone: {z.name}</option>
            ))}
          </select>
        )}
      </div>

      <div className="card">
        <table className="table">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Role</th><th>Zone</th><th>Status</th></tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5}><div className="empty">Loading…</div></td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={5}><div className="empty"><b>No accounts here yet</b>Use the Create button to add one.</div></td></tr>
            )}
            {!loading && rows.map((u) => (
              <tr key={u.id} style={{ cursor: 'default' }}>
                <td><span className="cell-user"><Avatar name={u.name} /> <b style={{ fontWeight: 500 }}>{u.name}</b></span></td>
                <td className="cell-muted">{u.email}</td>
                <td><span className="badge badge-neutral">{ROLE_LABELS[u.role] || u.role}</span></td>
                <td className="cell-muted">
                  {u.zoneName ? (
                    <span className="row" style={{ gap: 6 }}>
                      <span className="zone-dot" style={{ background: zoneColor(u.zoneName) }} /> {u.zoneName}
                    </span>
                  ) : (
                    'All zones'
                  )}
                </td>
                <td>
                  <span className={`badge ${u.active === false ? 'badge-danger' : 'badge-success'}`}>
                    {u.active === false ? 'Inactive' : 'Active'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && activeRole && (
        <div className="modal-back" onClick={closeForm}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
            <div className="modal-head">
              <h2>Create {roleName}</h2>
              <p>
                They will receive their login details by email.
                {zonePickerNeeded && ' Choose the zone they will manage.'}
                {!zonePickerNeeded && user.zoneName && ` They will be placed in your zone (${user.zoneName}).`}
              </p>
            </div>
            <div className="modal-body">
              {formError && <div className="alert alert-danger">{formError}</div>}

              {creatable.length > 1 && (
                <div className="form-row">
                  <label>Role</label>
                  <select value={activeRole} onChange={(e) => setNewRole(e.target.value)}>
                    {creatable.map((r) => (
                      <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="form-row">
                <label>Full name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
              </div>
              <div className="form-row">
                <label>Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="form-row">
                <label>Temporary password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
              </div>
              {zonePickerNeeded && (
                <div className="form-row">
                  <label>Zone</label>
                  <select value={zoneId} onChange={(e) => setZoneId(e.target.value === '' ? '' : Number(e.target.value))} required>
                    <option value="">Select a zone</option>
                    {zones.map((z) => (
                      <option key={z.id} value={z.id}>{z.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-ghost" onClick={closeForm}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={creating}>
                {creating ? 'Creating…' : `Create ${roleName}`}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
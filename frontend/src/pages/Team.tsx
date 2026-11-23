import React, { useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { getTeam, createTeamMember, getZones, TeamUser, Zone } from './services/ticketApi';

// What each role is allowed to create — mirrors usersRepo.ALLOWED_CREATION
// on the backend. This is just for the UI label; the backend re-checks it.
const NEXT_ROLE: Record<string, string | undefined> = {
  SUPER_ADMIN: 'SUPERVISOR',
  SUPERVISOR: 'ZONAL_ADMIN',
  ZONAL_ADMIN: 'ZONAL_EXECUTIVE',
  ZONAL_EXECUTIVE: 'CUSTOMER_SUPPORT',
  CUSTOMER_SUPPORT: undefined,
};

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  SUPERVISOR: 'Supervisor',
  ZONAL_ADMIN: 'Zonal Admin',
  ZONAL_EXECUTIVE: 'Zonal Executive',
  CUSTOMER_SUPPORT: 'Customer Support',
};

export default function Team() {
  const { user } = useAuth();
  const [team, setTeam] = useState<TeamUser[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [zoneId, setZoneId] = useState<number | ''>('');

  const nextRole = user ? NEXT_ROLE[user.role] : undefined;
  const zonePickerNeeded = nextRole === 'ZONAL_ADMIN'; // only a Supervisor picks the zone explicitly

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, z] = await Promise.all([getTeam(nextRole), getZones()]);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nextRole) return;
    setCreating(true);
    setError(null);
    try {
      await createTeamMember({
        name,
        email,
        password,
        role: nextRole,
        zoneId: zonePickerNeeded ? Number(zoneId) : undefined,
      });
      setName('');
      setEmail('');
      setPassword('');
      setZoneId('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  if (!nextRole) {
    return <p className="text-gray-400">Your role doesn't manage any accounts.</p>;
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-800 mb-4">
        {ROLE_LABELS[nextRole]} accounts
      </h2>

      <div className="card mb-4">
        <div className="card-body">
          <h4 className="text-sm font-semibold text-gray-800 mb-3">Create a new {ROLE_LABELS[nextRole]}</h4>
          <form onSubmit={submit} className="grid grid-cols-2 gap-3">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name"
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm" required />
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email"
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm" required />
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Temporary password"
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm" required />
            {zonePickerNeeded && (
              <select value={zoneId} onChange={(e) => setZoneId(Number(e.target.value))}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm" required>
                <option value="">Select zone</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>{z.name}</option>
                ))}
              </select>
            )}
            <button type="submit" disabled={creating} className="btn btn-primary col-span-2 justify-center">
              {creating ? 'Creating…' : `Create ${ROLE_LABELS[nextRole]}`}
            </button>
          </form>
          {error && <div className="badge badge-danger mt-3">{error}</div>}
        </div>
      </div>

      <div className="card">
        <table className="table">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Zone</th></tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={3} className="text-center text-gray-400 py-6">Loading…</td></tr>}
            {!loading && team.length === 0 && (
              <tr><td colSpan={3} className="text-center text-gray-400 py-6">No accounts yet.</td></tr>
            )}
            {!loading && team.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{u.zoneName || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
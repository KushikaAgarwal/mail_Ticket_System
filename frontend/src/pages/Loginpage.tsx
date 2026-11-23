import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { MailIcon, EyeIcon, EyeOffIcon } from 'lucide-react';
import { useAuth } from './AuthContext';
import { login as loginApi, getZones, Zone } from './services/ticketApi';

export default function Loginpage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [zoneId, setZoneId] = useState<number | ''>('');
  const [zones, setZones] = useState<Zone[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getZones().then(setZones).catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setError('');
    setLoading(true);
    try {
      const data = await loginApi(email.trim(), password, zoneId === '' ? undefined : zoneId);
      login(data.user as any, data.token);
      navigate('/');
    } catch (err) {
      setError((err as Error).message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
      <form onSubmit={submit} className="card" style={{ width: 360, padding: 28 }}>
        <div className="flex items-center gap-2 mb-6">
          <div className="brand-logo" style={{ background: 'linear-gradient(135deg,#3b82f6,#0ea5a3)' }}>
            <MailIcon className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="font-semibold text-gray-800">PS QuickIt</div>
            <div className="text-xs text-gray-400">Admin sign in</div>
          </div>
        </div>

        <label className="text-xs text-gray-500 mb-1 block">Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-4" placeholder="you@company.com" />

        <label className="text-xs text-gray-500 mb-1 block">Password</label>
        <div className="relative mb-4">
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type={showPassword ? 'text' : 'password'}
            className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg text-sm"
            placeholder="••••••••"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            tabIndex={-1}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            {showPassword ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
          </button>
        </div>

        <label className="text-xs text-gray-500 mb-1 block">Zone (only for zone-based accounts)</label>
        <select
          value={zoneId}
          onChange={(e) => setZoneId(e.target.value === '' ? '' : Number(e.target.value))}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-4"
        >
          <option value="">Not applicable / Super Admin / Supervisor</option>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>{z.name}</option>
          ))}
        </select>

        {error && <div className="text-xs text-red-500 mb-4">{error}</div>}

        <div className="text-right mb-4">
          <Link to="/forgot-password" className="text-xs text-blue-600 hover:underline">
            Forgot password?
          </Link>
        </div>

        <button type="submit" disabled={loading} className="btn btn-primary w-full justify-center">
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
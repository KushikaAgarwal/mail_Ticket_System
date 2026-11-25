import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { EyeIcon, EyeOffIcon } from 'lucide-react';
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
    <div className="login-wrap">
      <form onSubmit={submit} className="login-card">
        <div className="brand" style={{ padding: 0, marginBottom: 20 }}>
          <div className="brand-logo">PS</div>
          <div>
            <div className="brand-name">PS QuickIt</div>
            <div className="brand-sub">Support desk</div>
          </div>
        </div>

        <h2>Log in to your account</h2>
        <div className="hint">Use the email and password you were given.</div>

        {error && <div className="alert alert-danger">{error}</div>}

        <div className="form-row">
          <label>Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@company.com" autoFocus />
        </div>

        <div className="form-row">
          <label>Password</label>
          <div style={{ position: 'relative' }}>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type={showPassword ? 'text' : 'password'}
              placeholder="Enter password"
              style={{ paddingRight: 36 }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              tabIndex={-1}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-soft)' }}
            >
              {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
            </button>
          </div>
        </div>

        <div className="form-row">
          <label>Zone</label>
          <select
            value={zoneId}
            onChange={(e) => setZoneId(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">Not applicable (Super Admin / Supervisor)</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>{z.name}</option>
            ))}
          </select>
        </div>

        <button type="submit" disabled={loading} className="btn btn-primary login-btn" style={{ justifyContent: 'center', height: 40 }}>
          {loading ? 'Signing in…' : 'Log in'}
        </button>

        <div className="login-foot">
          <Link to="/forgot-password" style={{ color: 'var(--primary)' }}>Forgot password?</Link>
        </div>
      </form>
    </div>
  );
}
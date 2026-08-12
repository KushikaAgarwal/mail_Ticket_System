import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MailIcon } from 'lucide-react';
import { useAuth } from './AuthContext';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';

export default function Loginpage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Login failed');
        return;
      }
      login(data);
      navigate('/');
    } catch {
      setError('Could not reach the server. Is the backend running?');
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
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-2" placeholder="••••••••" />

        {error && <div className="text-xs text-red-500 mb-4">{error}</div>}

        <button type="submit" disabled={loading} className="btn btn-primary w-full justify-center">
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
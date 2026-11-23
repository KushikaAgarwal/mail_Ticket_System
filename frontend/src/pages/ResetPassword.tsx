import React, { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { MailIcon, EyeIcon, EyeOffIcon } from 'lucide-react';
import { resetPassword } from './services/ticketApi';

export default function ResetPassword() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await resetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate('/login'), 2000);
    } catch (err) {
      setError((err as Error).message || 'Could not reset password');
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
            <div className="text-xs text-gray-400">Set a new password</div>
          </div>
        </div>

        {done ? (
          <p className="text-sm text-gray-600">Password updated — redirecting you to sign in…</p>
        ) : (
          <>
            <label className="text-xs text-gray-500 mb-1 block">New password</label>
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

            <label className="text-xs text-gray-500 mb-1 block">Confirm new password</label>
            <input
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              type={showPassword ? 'text' : 'password'}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-4"
              placeholder="••••••••"
            />

            {error && <div className="text-xs text-red-500 mb-4">{error}</div>}

            <button type="submit" disabled={loading} className="btn btn-primary w-full justify-center mb-3">
              {loading ? 'Updating…' : 'Update password'}
            </button>

            <Link to="/login" className="text-sm text-gray-500 hover:underline">
              Back to sign in
            </Link>
          </>
        )}
      </form>
    </div>
  );
}
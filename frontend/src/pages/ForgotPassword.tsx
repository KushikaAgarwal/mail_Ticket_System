import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { MailIcon } from 'lucide-react';
import { forgotPassword } from './services/ticketApi';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setError('');
    setLoading(true);
    try {
      const data = await forgotPassword(email.trim());
      setMessage(data.message);
    } catch (err) {
      setError((err as Error).message || 'Something went wrong');
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
            <div className="text-xs text-gray-400">Reset your password</div>
          </div>
        </div>

        {message ? (
          <>
            <p className="text-sm text-gray-600 mb-4">{message}</p>
            <Link to="/login" className="text-sm text-blue-600 hover:underline">
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <label className="text-xs text-gray-500 mb-1 block">Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-4"
              placeholder="you@company.com"
            />

            {error && <div className="text-xs text-red-500 mb-4">{error}</div>}

            <button type="submit" disabled={loading} className="btn btn-primary w-full justify-center mb-3">
              {loading ? 'Sending…' : 'Send reset link'}
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
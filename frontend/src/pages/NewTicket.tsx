import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftIcon } from 'lucide-react';
import { useAuth } from './AuthContext';
import { createTicket, getZones, Zone } from './services/ticketApi';

const CATEGORIES = ['General Inquiry', 'Technical Issue', 'Card Issue', 'Billing', 'Complaint', 'Other'];

export default function NewTicket() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const needsZonePick = !!user && user.zoneId == null; // Super Admin / Supervisor
  const [zones, setZones] = useState<Zone[]>([]);

  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [category, setCategory] = useState('General Inquiry');
  const [urgency, setUrgency] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('LOW');
  const [zoneId, setZoneId] = useState<number | ''>('');
  const [notify, setNotify] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (needsZonePick) getZones().then(setZones).catch(() => {});
  }, [needsZonePick]);

  const scopeNote =
    user?.role === 'LEAD' || user?.role === 'CUSTOMER_SUPPORT'
      ? 'Only your team, the managers above you in this zone, and Supervisors / Super Admins can view or update it.'
      : 'Only people in this zone’s hierarchy, and Supervisors / Super Admins, can view or update it.';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (needsZonePick && zoneId === '') {
      setError('Please choose a zone for this ticket.');
      return;
    }
    setSaving(true);
    try {
      const t = await createTicket({
        subject,
        description,
        customerName: customerName.trim() || undefined,
        customerEmail: customerEmail.trim() || undefined,
        productOrCategory: category,
        urgency,
        zoneId: needsZonePick ? Number(zoneId) : undefined,
        notifyCustomer: notify,
      });
      navigate(`/tickets/${t.id}`);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="nt-wrap">
      <button type="button" className="btn btn-ghost mb-3" onClick={() => navigate('/tickets')}>
        <ArrowLeftIcon className="w-4 h-4" /> Back to tickets
      </button>

      <div className="page-head">
        <div>
          <h1>New ticket</h1>
          <div className="subtitle">
            {user?.zoneName ? `Will be created in the ${user.zoneName} zone. ` : ''}
            {scopeNote}
          </div>
        </div>
      </div>

      <form className="card" onSubmit={submit}>
        <div className="card-body">
          {error && <div className="alert alert-danger">{error}</div>}

          <div className="nt-grid">
            <div className="form-row nt-full">
              <label>Subject</label>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} required autoFocus maxLength={200} />
            </div>

            <div className="form-row nt-full">
              <label>Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} required rows={5} />
            </div>

            <div className="form-row">
              <label>Customer name</label>
              <input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder={user?.name ? `Defaults to ${user.name}` : ''}
              />
            </div>

            <div className="form-row">
              <label>Customer email (optional)</label>
              <input type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="customer@example.com" />
            </div>

            <div className="form-row">
              <label>Category</label>
              <input list="nt-categories" value={category} onChange={(e) => setCategory(e.target.value)} />
              <datalist id="nt-categories">
                {CATEGORIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>

            <div className="form-row">
              <label>Priority</label>
              <select value={urgency} onChange={(e) => setUrgency(e.target.value as 'LOW' | 'MEDIUM' | 'HIGH')}>
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
              </select>
            </div>

            {needsZonePick && (
              <div className="form-row nt-full">
                <label>Zone</label>
                <select value={zoneId} onChange={(e) => setZoneId(e.target.value === '' ? '' : Number(e.target.value))} required>
                  <option value="">Select a zone</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>{z.name}</option>
                  ))}
                </select>
              </div>
            )}

            <label className="nt-check nt-full">
              <input
                type="checkbox"
                checked={notify && !!customerEmail.trim()}
                disabled={!customerEmail.trim()}
                onChange={(e) => setNotify(e.target.checked)}
              />
              Email the customer a confirmation with their ticket number
            </label>
          </div>
        </div>

        <div className="modal-foot" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 16px' }}>
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/tickets')}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Creating…' : 'Create ticket'}
          </button>
        </div>
      </form>
    </div>
  );
}
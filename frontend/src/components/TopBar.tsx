import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SearchIcon, PlusIcon, LogOutIcon, TicketIcon } from 'lucide-react';
import { useAuth } from '../pages/AuthContext';
import { Avatar } from './ui';
import NotificationBell from './NotificationBell';
import { CREATABLE_ROLES, ROLE_LABELS } from '../constants/ticketStatus';

interface TopbarProps {
  pathname: string;
}

function crumbFor(pathname: string): string {
  if (pathname === '/') return 'Dashboard';
  if (pathname === '/tickets') return 'Tickets';
  if (pathname === '/tickets/new') return 'New ticket';
  if (pathname.startsWith('/tickets/')) return 'Ticket';
  if (pathname === '/team') return 'Team';
  if (pathname === '/agent') return 'Agent Extension';
  return 'PS QuickIt';
}

export default function Topbar({ pathname }: TopbarProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');

  const creatable = user ? CREATABLE_ROLES[user.role] || [] : [];
  const createLabel =
    creatable.length === 0
      ? ''
      : creatable.length === 1
      ? `Create ${ROLE_LABELS[creatable[0]]}`
      : 'Create account';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(q.trim() ? `/tickets?q=${encodeURIComponent(q.trim())}` : '/tickets');
  };

  return (
    <div className="topbar">
      <div className="crumbs">
        PS QuickIt &nbsp;/&nbsp; <strong>{crumbFor(pathname)}</strong>
      </div>

      <form className="search" onSubmit={submit}>
        <SearchIcon className="search-ico" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tickets" />
      </form>

      <div className="top-actions">
        {user && (
          <button type="button" className="btn btn-outline" onClick={() => navigate('/tickets/new')}>
            <TicketIcon size={14} /> New ticket
          </button>
        )}
        {creatable.length > 0 && (
          <button type="button" className="btn btn-primary" onClick={() => navigate('/team?new=1')}>
            <PlusIcon size={14} /> {createLabel}
          </button>
        )}
        <NotificationBell />
        {user && (
          <div className="user-chip">
            <Avatar name={user.name} />
            <div className="who">
              <b>{user.name}</b>
              <span>{ROLE_LABELS[user.role] || user.role}{user.zoneName ? ` · ${user.zoneName}` : ''}</span>
            </div>
          </div>
        )}
        <button type="button" className="icon-btn" onClick={logout} title="Log out" aria-label="Log out">
          <LogOutIcon size={16} />
        </button>
      </div>
    </div>
  );
}
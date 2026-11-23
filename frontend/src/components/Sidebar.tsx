import React from 'react';
import { NavLink } from 'react-router-dom';
import { InboxIcon, LayoutDashboardIcon, MailIcon, PhoneIcon, LogOutIcon, UsersIcon } from 'lucide-react';
import { useAuth } from '../pages/AuthContext';

export default function Sidebar() {
  const { user, logout } = useAuth();

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-logo">PS</div>
        <div>
          <div className="brand-name">PS QuickIt</div>
          <div className="brand-sub">csdsmartcard.helpdesk@psquickit.com</div>
        </div>
      </div>

      <div className="nav-section">Workspace</div>
      <NavLink to="/" end className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
        <LayoutDashboardIcon className="ico" /> Dashboard
      </NavLink>
      <NavLink to="/tickets" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
        <InboxIcon className="ico" /> Tickets
      </NavLink>
      <NavLink to="/agent" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
        <PhoneIcon className="ico" /> Agent Extension
      </NavLink>
      {user && user.role !== 'CUSTOMER_SUPPORT' && (
        <NavLink to="/team" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <UsersIcon className="ico" /> Team
        </NavLink>
      )}

      <div style={{ marginTop: 'auto' }}>
        {user && (
          <div className="nav-section" style={{ marginBottom: 4 }}>
            Signed in as <strong>{user.name}</strong>
          </div>
        )}
        <button
          type="button"
          onClick={logout}
          className="nav-item"
          style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
        >
          <LogOutIcon className="ico" /> Logout
        </button>
      </div>

      <div className="sidebar-footer">
        <MailIcon className="ico" style={{ display: 'inline', width: 12, height: 12, marginRight: 4 }} />
        Tickets are auto-created from incoming support mail via NLP + Claude extraction.
      </div>
    </aside>
  );
}
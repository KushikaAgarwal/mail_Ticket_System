import React, { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { InboxIcon, LayoutDashboardIcon, UsersIcon } from 'lucide-react';
import { useAuth } from '../pages/AuthContext';
import { getZones, Zone } from '../pages/services/ticketApi';
import { ALL_ZONE_ROLES, zoneColor } from '../constants/ticketStatus';

// Sidebar label for the Team page, per role. Customer Support has no entry,
// so they don't see the Administration section at all.
const TEAM_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Team',
  SUPERVISOR: 'Zonal Admins',
  ZONAL_ADMIN: 'Managers',
  MANAGER: 'Leads',
  LEAD: 'My team',
};

export default function Sidebar() {
  const { user } = useAuth();
  const location = useLocation();
  const [zones, setZones] = useState<Zone[]>([]);

  const seesAllZones = !!user && ALL_ZONE_ROLES.includes(user.role);

  useEffect(() => {
    if (seesAllZones) getZones().then(setZones).catch(() => {});
  }, [seesAllZones]);

  const activeZone = new URLSearchParams(location.search).get('zone');
  const onTickets = location.pathname === '/tickets';
  const link = (isActive: boolean) => `nav-item${isActive ? ' active' : ''}`;

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-logo">PS</div>
        <div>
          <div className="brand-name">PS QuickIt</div>
          <div className="brand-sub">Support desk</div>
        </div>
      </div>

      <div className="nav-section">Workspace</div>
      <NavLink to="/" end className={({ isActive }) => link(isActive)}>
        <LayoutDashboardIcon className="ico" /> Dashboard
      </NavLink>
      <NavLink to="/tickets" end className={() => link(onTickets && !activeZone)}>
        <InboxIcon className="ico" /> {seesAllZones ? 'All tickets' : 'Tickets'}
      </NavLink>

      {seesAllZones && (
        <>
          <div className="nav-section">Zones</div>
          {zones.map((z) => (
            <Link key={z.id} to={`/tickets?zone=${z.id}`} className={link(onTickets && activeZone === String(z.id))}>
              <span className="zone-dot" style={{ background: zoneColor(z.name) }} /> {z.name}
            </Link>
          ))}
          <Link to="/tickets?zone=none" className={link(onTickets && activeZone === 'none')}>
            <span className="zone-dot" style={{ background: zoneColor('Unassigned') }} /> Unassigned
          </Link>
        </>
      )}

      {user && TEAM_LABEL[user.role] && (
        <>
          <div className="nav-section">Administration</div>
          <NavLink to="/team" className={({ isActive }) => link(isActive)}>
            <UsersIcon className="ico" /> {TEAM_LABEL[user.role]}
          </NavLink>
        </>
      )}

      <div style={{ flex: 1 }} />
      <div className="sidebar-footer">Tickets are created automatically from support mail.</div>
    </aside>
  );
}
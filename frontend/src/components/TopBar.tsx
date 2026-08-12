import React from 'react';

interface TopbarProps {
  pathname: string;
}

const CRUMBS: Record<string, string> = {
  '/': 'Dashboard',
  '/tickets': 'Tickets',
};

function crumbFor(pathname: string): string {
  if (CRUMBS[pathname]) return CRUMBS[pathname];
  if (pathname.startsWith('/tickets/')) return 'Ticket Detail';
  return 'PS QuickIt';
}

export default function Topbar({ pathname }: TopbarProps) {
  return (
    <div className="topbar">
      <div className="crumbs">
        PS QuickIt &nbsp;/&nbsp; <strong>{crumbFor(pathname)}</strong>
      </div>
    </div>
  );
}

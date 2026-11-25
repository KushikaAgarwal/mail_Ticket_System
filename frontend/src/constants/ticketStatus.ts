/** Ticket lifecycle values stored in Flowable process variable `ticketStatus`. */
export const TICKET_STATUS = {
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
} as const;

export type TicketStatus = typeof TICKET_STATUS[keyof typeof TICKET_STATUS];

export const STATUS_LABELS: Record<string, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

export function statusBadgeClass(status: string): string {
  switch (status) {
    case 'OPEN': return 'badge-neutral';
    case 'IN_PROGRESS': return 'badge-primary';
    case 'RESOLVED': return 'badge-success';
    case 'CLOSED': return 'badge-closed';
    default: return 'badge-neutral';
  }
}

export function urgencyBadgeClass(urgency: string): string {
  switch (urgency) {
    case 'HIGH': return 'badge-danger';
    case 'MEDIUM': return 'badge-warn';
    case 'LOW': return 'badge-neutral';
    default: return 'badge-neutral';
  }
}

export function sentimentBadgeClass(sentiment: string): string {
  switch (sentiment) {
    case 'POSITIVE': return 'badge-success';
    case 'NEGATIVE':
    case 'FRUSTRATED': return 'badge-danger';
    case 'NEUTRAL': return 'badge-neutral';
    default: return 'badge-neutral';
  }
}

/** Statuses that still need admin attention, for a dashboard "pending" count. */
export const TICKET_PENDING = ['OPEN', 'IN_PROGRESS'];

/** Colours used for the zone/status bars and sidebar dots. */
export const STATUS_COLORS: Record<string, string> = {
  OPEN: '#8590a2',
  IN_PROGRESS: '#0c66e4',
  RESOLVED: '#1f845a',
  CLOSED: '#44546f',
};

export const ZONE_COLORS: Record<string, string> = {
  North: '#0c66e4',
  South: '#1f845a',
  East: '#e56910',
  West: '#8270db',
  Unassigned: '#8590a2',
};

export function zoneColor(name?: string | null): string {
  return ZONE_COLORS[name || 'Unassigned'] || '#8590a2';
}

/** Hierarchy: SUPER_ADMIN > SUPERVISOR > ZONAL_ADMIN > MANAGER > LEAD > CUSTOMER_SUPPORT */
export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  SUPERVISOR: 'Supervisor',
  ZONAL_ADMIN: 'Zonal Admin',
  MANAGER: 'Manager',
  LEAD: 'Lead',
  CUSTOMER_SUPPORT: 'Customer Support',
};

/** Everything each role can create — mirrors usersRepo.ALLOWED_CREATION on the
 *  backend (the backend enforces it; this is only for labels and buttons). */
export const CREATABLE_ROLES: Record<string, string[]> = {
  SUPER_ADMIN: ['SUPERVISOR', 'ZONAL_ADMIN'],
  SUPERVISOR: ['ZONAL_ADMIN'],
  ZONAL_ADMIN: ['MANAGER'],
  MANAGER: ['LEAD'],
  LEAD: ['CUSTOMER_SUPPORT'],
  CUSTOMER_SUPPORT: [],
};

/** Kept for any file (sidebar/Layout) that still imports it: the PRIMARY
 *  role each role creates. Use CREATABLE_ROLES for the full list. */
export const NEXT_ROLE: Record<string, string | undefined> = {
  SUPER_ADMIN: 'SUPERVISOR',
  SUPERVISOR: 'ZONAL_ADMIN',
  ZONAL_ADMIN: 'MANAGER',
  MANAGER: 'LEAD',
  LEAD: 'CUSTOMER_SUPPORT',
  CUSTOMER_SUPPORT: undefined,
};

/** Roles that can look across every zone. */
export const ALL_ZONE_ROLES = ['SUPER_ADMIN', 'SUPERVISOR'];
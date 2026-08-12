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
    case 'OPEN': return 'badge-info';
    case 'IN_PROGRESS': return 'badge-warn';
    case 'RESOLVED': return 'badge-success';
    case 'CLOSED': return 'badge-neutral';
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

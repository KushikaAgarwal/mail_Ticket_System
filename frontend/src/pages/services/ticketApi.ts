const API_BASE = import.meta.env.VITE_API_BASE ?? '';

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error?.message || err.error || `API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface StatusHistoryEntry {
  status: string;
  time: string;
}

export async function getTicketHistory(id: string): Promise<StatusHistoryEntry[]> {
  const data = await apiFetch<{ history: StatusHistoryEntry[] }>(`/api/tickets/${id}/history`);
  return data.history;
}

export interface TicketSummary {
  id: string; // processInstanceId — stable for the ticket's whole lifecycle
  createTime: string;
  subject: string;
  description: string;
  customerName: string;
  customerEmail: string;
  productOrCategory: string;
  urgency: 'LOW' | 'MEDIUM' | 'HIGH';
  sentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'FRUSTRATED';
  receivedAt: string;
  ticketStatus: string;
  closed: boolean;
}

export interface CommentEntry {
  id: string;
  authorId?: string;
  authorName?: string;
  role?: string;
  text: string;
  timestamp?: string;
  visible?: boolean; // undefined/true = visible to customer, false = hidden
}

export interface TicketDetail {
  processInstanceId: string;
  taskId: string | null; // null once the ticket is closed — status/comment actions disable
  variables: Record<string, string>;
  comments: CommentEntry[];
}

export async function getTickets(): Promise<TicketSummary[]> {
  const data = await apiFetch<{ tickets: TicketSummary[] }>('/api/tickets');
  return data.tickets;
}

export async function getTicket(id: string): Promise<TicketDetail> {
  return apiFetch<TicketDetail>(`/api/tickets/${id}`);
}

export async function addTicketComment(
  id: string,
  authorId: string,
  authorName: string,
  text: string,
  sendMail: boolean
): Promise<CommentEntry[]> {
  const data = await apiFetch<{ comments: CommentEntry[] }>(`/api/tickets/${id}/comments`, {
    method: 'POST',
    body: JSON.stringify({ authorId, authorName, text, sendMail }),
  });
  return data.comments;
}

export async function setCommentVisibility(
  id: string,
  commentId: string,
  visible: boolean
): Promise<CommentEntry[]> {
  const data = await apiFetch<{ comments: CommentEntry[] }>(`/api/tickets/${id}/comments/${commentId}/visibility`, {
    method: 'PUT',
    body: JSON.stringify({ visible }),
  });
  return data.comments;
}

export async function updateTicketStatus(id: string, status: string, assignee?: string): Promise<void> {
  await apiFetch(`/api/tickets/${id}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status, assignee }),
  });
}

export async function triggerIngestNow(): Promise<{ results: unknown[] }> {
  return apiFetch('/api/ingest/run', { method: 'POST' });
}

export interface CreateTicketFromCallInput {
  callerNumber: string;
  agentId: string;
  description: string;
  category: string;
  urgency: 'LOW' | 'MEDIUM' | 'HIGH';
  customerName?: string;
  customerEmail?: string;
}

export async function notifyInboundCall(callId: string, callerNumber: string, agentId: string): Promise<void> {
  await apiFetch('/api/calls/inbound', {
    method: 'POST',
    body: JSON.stringify({ callId, callerNumber, agentId }),
  });
}

export async function createTicketFromCall(
  callId: string,
  data: CreateTicketFromCallInput
): Promise<{ success: boolean; processInstanceId?: string; skipped?: boolean }> {
  return apiFetch(`/api/calls/${callId}/create-ticket`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
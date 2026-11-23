import { TOKEN_KEY } from '../AuthContext';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY);

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const message =
      typeof err.error === 'string'
        ? err.error
        : err.error?.message || err.error?.error || JSON.stringify(err.error) || res.statusText;
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

// ---- Auth ----

export interface LoginResponse {
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
  token: string;
}

// ── REPLACE the existing login() function with this ──────────────────
export async function login(email: string, password: string, zoneId?: number): Promise<LoginResponse> {
  return apiFetch<LoginResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, zoneId }),
  });
}

export async function getAllCustomerSupport(): Promise<TeamUser[]> {
  const data = await apiFetch<{ users: TeamUser[] }>('/api/customer-support/all');
  return data.users;
}
 
// ---- Team management ----

export interface TeamUser {
  id: string;
  name: string;
  email: string;
  role: string;
  zoneId?: number;
  zoneName?: string;
}

export interface Zone {
  id: number;
  name: string;
}

export async function getTeam(role?: string): Promise<TeamUser[]> {
  const query = role ? `?role=${encodeURIComponent(role)}` : '';
  const data = await apiFetch<{ users: TeamUser[] }>(`/api/users${query}`);
  return data.users;
}

export interface CreateTeamMemberInput {
  name: string;
  email: string;
  password: string;
  role: string;
  zoneId?: number;
}

export async function createTeamMember(input: {
  name: string;
  email: string;
  password: string;
  role: string;
  zoneId?: number;
}): Promise<TeamUser> {
  const data = await apiFetch<{ user: TeamUser }>('/api/users', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.user;
}
export async function getZones(): Promise<Zone[]> {
  const data = await apiFetch<{ zones: Zone[] }>('/api/zones');
  return data.zones;
}

// ---- Tickets ----

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

export interface TicketVariables {
  subject: string;
  description: string;
  customerName: string;
  customerEmail: string;
  productOrCategory: string;
  urgency: string;
  sentiment: string;
  ticketStatus: string;
  receivedAt: string;
  assignedEngineerId?: string;
  assignedEngineerName?: string;
  // Anything not listed above (like assignmentLocked, which the backend
  // sends as a real boolean, not a string) falls through to this looser
  // type — keeps the named fields strict while still allowing that one.
  [key: string]: string | boolean | undefined;
}

export interface TicketDetail {
  processInstanceId: string;
  taskId: string | null;
  variables: TicketVariables;
  comments: CommentEntry[];
}

export async function getTickets(): Promise<TicketSummary[]> {
  const data = await apiFetch<{ tickets: TicketSummary[] }>('/api/tickets');
  return data.tickets;
}

export async function getTicket(id: string): Promise<TicketDetail> {
  return apiFetch<TicketDetail>(`/api/tickets/${id}`);
}

export async function getCustomerSupportForZone(zoneId: number): Promise<TeamUser[]> {
  const data = await apiFetch<{ users: TeamUser[] }>(`/api/customer-support?zoneId=${zoneId}`);
  return data.users;
}

export async function assignTicket(id: string, engineerId: string, engineerName: string): Promise<void> {
  await apiFetch(`/api/tickets/${id}/assign`, {
    method: 'PUT',
    body: JSON.stringify({ engineerId, engineerName }),
  });
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

// ── ADD these two functions to ticketApi.ts ──────────────────────────

export async function forgotPassword(email: string): Promise<{ success: boolean; message: string }> {
  return apiFetch('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function resetPassword(token: string, newPassword: string): Promise<{ success: boolean }> {
  return apiFetch('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
  });
}
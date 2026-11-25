import React from 'react';
import { ChevronsUpIcon, EqualIcon, ChevronDownIcon } from 'lucide-react';

const AVATAR_COLORS = ['#6e5dc6', '#0c66e4', '#1f845a', '#c9372c', '#e56910', '#206a83', '#ae4787'];

function initialsOf(name: string): string {
  return (name || '?').split(' ').filter(Boolean).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
}

function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function Avatar({ name, size }: { name: string; size?: 'sm' | 'lg' }) {
  return (
    <span className={`avatar${size ? ` ${size}` : ''}`} style={{ background: colorFor(name || '?') }} title={name}>
      {initialsOf(name)}
    </span>
  );
}

/** Jira-style priority marker: ⇈ high, = medium, ⌄ low. */
export function PriorityIcon({ urgency }: { urgency?: string }) {
  if (urgency === 'HIGH') {
    return <span className="priority high"><ChevronsUpIcon /> High</span>;
  }
  if (urgency === 'MEDIUM') {
    return <span className="priority med"><EqualIcon /> Medium</span>;
  }
  return <span className="priority low"><ChevronDownIcon /> Low</span>;
}

/** PS-12 style ticket key. */
export function ticketKey(n?: number): string {
  return n ? `PS-${n}` : '—';
}
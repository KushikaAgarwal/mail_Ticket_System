// attachmentRules.ts
// Single source of truth for attachment limits on the client. Keep the numbers
// in sync with backend/attachments.js. Used by the comment box and the
// "new ticket" form.

import { useRef, useState } from 'react';

export const MAX_FILES = 5;
export const MAX_FILE = 10 * 1024 * 1024;
export const MAX_TOTAL = 20 * 1024 * 1024;
export const BLOCKED_EXT = [
  'exe', 'bat', 'cmd', 'com', 'scr', 'msi', 'js', 'jse', 'vbs', 'vbe',
  'wsf', 'ps1', 'jar', 'dll', 'lnk', 'reg', 'hta', 'cpl',
];

export function formatSize(n?: number | null): string {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Returns an error message, or null if `file` can be added to `current`. */
export function checkFile(file: File, current: File[]): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (BLOCKED_EXT.includes(ext)) return `"${file.name}" is not allowed (executables and scripts are blocked).`;
  if (file.size > MAX_FILE) return `"${file.name}" is larger than ${MAX_FILE / 1048576} MB.`;
  if (current.length >= MAX_FILES) return `You can attach up to ${MAX_FILES} files.`;
  if (current.reduce((n, x) => n + x.size, 0) + file.size > MAX_TOTAL) {
    return `Attachments are too large together (max ${MAX_TOTAL / 1048576} MB).`;
  }
  return null;
}

/** Picked-files state + validation. Reusable by any form that attaches files. */
export function useFilePicker() {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const add = (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    let firstError: string | null = null;
    for (const f of Array.from(list)) {
      const problem = checkFile(f, next);
      if (problem) {
        firstError ??= problem;
        continue;
      }
      next.push(f);
    }
    setFiles(next);
    setError(firstError);
    if (inputRef.current) inputRef.current.value = '';
  };

  const removeAt = (i: number) => setFiles((cur) => cur.filter((_, j) => j !== i));
  const clear = () => {
    setFiles([]);
    setError(null);
  };
  const openDialog = () => inputRef.current?.click();

  return { files, error, inputRef, add, removeAt, clear, openDialog };
}
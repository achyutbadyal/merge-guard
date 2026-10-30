import type { Method } from './types';

const PATTERNS: Array<[Method, RegExp]> = [
  ['merge', /^(create a merge commit\b|merge pull request$)/i],
  ['squash', /^squash and merge\b/i],
  ['rebase', /^rebase and merge\b/i],
];

/** Which merge method a control's visible text stands for (labels start with the method name). */
export function classifyText(text: string): Method | null {
  const s = text.replace(/\s+/g, ' ').trim();
  if (!s || s.length > 300) return null;
  for (const [method, re] of PATTERNS) if (re.test(s)) return method;
  return null;
}

const LABELS: Record<string, Method> = {
  'create a merge commit': 'merge',
  'merge pull request': 'merge',
  'squash and merge': 'squash',
  'rebase and merge': 'rebase',
};

/** Exact label match, for single text nodes (stricter than classifyText, so PR titles can't match). */
export function classifyLabel(text: string): Method | null {
  return LABELS[text.replace(/\s+/g, ' ').trim().toLowerCase()] ?? null;
}

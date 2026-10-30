export const METHODS = ['merge', 'squash', 'rebase'] as const;
export type Method = (typeof METHODS)[number];
export type MethodSet = Record<Method, boolean>;

export const METHOD_LABEL: Record<Method, string> = {
  merge: 'Merge commit',
  squash: 'Squash and merge',
  rebase: 'Rebase and merge',
};

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  /** Regex source, matched case-insensitively from the start of `host/owner/repo/`. */
  pattern: string;
  /** Regex for the PR's head ("from") branch, matched against the whole name, ignoring case. '' = any branch. */
  head: string;
  /** Regex for the PR's base ("to") branch, same rules as `head`. */
  base: string;
  methods: MethodSet;
}

export interface Branches {
  head: string;
  base: string;
}

export const hasBranchFilter = (r: Rule): boolean => r.head !== '' || r.base !== '';

/** Human-readable rule name for messages, e.g. `acme (feature/.* → main)`. */
export function ruleLabel(r: Rule): string {
  const name = r.name || r.pattern;
  return hasBranchFilter(r) ? `${name} (${r.head || 'any'} → ${r.base || 'any'})` : name;
}

export interface Settings {
  version: 1;
  default: MethodSet;
  rules: Rule[];
}

export const allMethods = (value: boolean): MethodSet => ({ merge: value, squash: value, rebase: value });

export const defaultSettings = (): Settings => ({ version: 1, default: allMethods(true), rules: [] });

export type DefaultMode = 'enable-all' | 'custom' | 'disable-all';

export function modeOf(m: MethodSet): DefaultMode {
  const on = METHODS.filter((k) => m[k]).length;
  return on === METHODS.length ? 'enable-all' : on === 0 ? 'disable-all' : 'custom';
}

export const METHODS = ['merge', 'squash', 'rebase'] as const;
export type Method = (typeof METHODS)[number];
export type MethodSet = Record<Method, boolean>;

export const METHOD_LABEL: Record<Method, string> = {
  merge: 'Merge commit',
  squash: 'Squash and merge',
  rebase: 'Rebase and merge',
};

/** The only host rules apply to, for now. */
export const HOST = 'github.com';

/** Every scope field is a glob (see pattern.ts); '' means any. */
export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  /** Owner (user or org). */
  org: string;
  repo: string;
  /** The PR's head ("from") branch. */
  head: string;
  /** The PR's base ("into") branch. */
  base: string;
  methods: MethodSet;
}

export interface Branches {
  head: string;
  base: string;
}

export interface Settings {
  version: 2;
  default: MethodSet;
  rules: Rule[];
}

export const hasBranchFilter = (r: Rule): boolean => r.head !== '' || r.base !== '';

/** Human-readable rule name for messages, e.g. `acme/* (release/* → main)`. */
export function ruleLabel(r: Rule): string {
  const name = r.name || `${r.org || '*'}/${r.repo || '*'}`;
  return hasBranchFilter(r) ? `${name} (${r.head || 'any'} → ${r.base || 'any'})` : name;
}

export const allMethods = (value: boolean): MethodSet => ({ merge: value, squash: value, rebase: value });

export const defaultSettings = (): Settings => ({ version: 2, default: allMethods(true), rules: [] });

export type DefaultMode = 'enable-all' | 'custom' | 'disable-all';

export function modeOf(m: MethodSet): DefaultMode {
  const on = METHODS.filter((k) => m[k]).length;
  return on === METHODS.length ? 'enable-all' : on === 0 ? 'disable-all' : 'custom';
}

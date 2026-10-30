import { compileGlob, fits, isExact } from './pattern';
import { HOST, allMethods, hasBranchFilter, type Branches, type MethodSet, type Rule, type Settings } from './types';

/** The repo a page belongs to, lower-cased. */
export interface Target {
  org: string;
  repo: string;
}

/** Owner and repo of a github.com URL, or null. */
export function targetOf(url: string): Target | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.hostname.toLowerCase() !== HOST) return null;
  const [org, repo] = u.pathname.split('/').filter(Boolean);
  return org && repo ? { org: org.toLowerCase(), repo: repo.toLowerCase() } : null;
}

export const isPullPath = (pathname: string): boolean => /^\/[^/]+\/[^/]+\/pull\/\d+/.test(pathname);

interface Entry {
  rule: Rule;
  /** Position in the user's rule list; lower wins. */
  index: number;
  org: RegExp | null;
  repo: RegExp | null;
  head: RegExp | null;
  base: RegExp | null;
  branched: boolean;
}

export interface Resolution {
  methods: MethodSet;
  /** Winning rule, or null when the default policy applies. */
  rule: Rule | null;
  /** Branches were not supplied, and a branch-filtered rule above `rule` matches the repo. */
  branchDependent: boolean;
}

const CACHE_SIZE = 500;

/** Yields entries from two index-ordered lists in index order. */
function* merged(a: Entry[], b: Entry[]): Generator<Entry> {
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (j >= b.length || (i < a.length && (a[i] as Entry).index < (b[j] as Entry).index)) yield a[i++] as Entry;
    else yield b[j++] as Entry;
  }
}

export class Matcher {
  /** Rules naming one exact org, keyed by that org lower-cased: a lookup only touches its own org's rules. */
  private readonly byOrg = new Map<string, Entry[]>();
  /** Rules with an org glob or any org, in list order. */
  private readonly other: Entry[] = [];
  private readonly all: Entry[] = [];
  private readonly cache = new Map<string, Resolution>();

  constructor(private readonly settings: Settings) {
    settings.rules.forEach((rule, index) => {
      if (!rule.enabled) return;
      const entry: Entry = {
        rule,
        index,
        org: compileGlob(rule.org),
        repo: compileGlob(rule.repo),
        head: compileGlob(rule.head),
        base: compileGlob(rule.base),
        branched: hasBranchFilter(rule),
      };
      this.all.push(entry);
      if (!isExact(rule.org)) return void this.other.push(entry);
      const key = rule.org.toLowerCase();
      const list = this.byOrg.get(key);
      if (list) list.push(entry);
      else this.byOrg.set(key, [entry]);
    });
  }

  get hasBranchRules(): boolean {
    return this.all.some((e) => e.branched);
  }

  /** Without `branches`, branch-filtered rules are skipped and `branchDependent` says whether that mattered. */
  resolve(target: Target | null, branches: Branches | null = null): Resolution {
    if (!target) return { methods: this.settings.default, rule: null, branchDependent: false };
    const ck = `${target.org}/${target.repo}${branches ? `\0${branches.head}\0${branches.base}` : ''}`;
    const cached = this.cache.get(ck);
    if (cached) {
      this.cache.delete(ck);
      this.cache.set(ck, cached);
      return cached;
    }

    let win: Entry | null = null;
    let branchDependent = false;
    for (const e of merged(this.byOrg.get(target.org) ?? [], this.other)) {
      const state = this.test(e, target, branches);
      if (state === 'unknown') branchDependent = true;
      if (state === 'match') {
        win = e;
        break;
      }
    }
    const res: Resolution = win
      ? { methods: win.rule.methods, rule: win.rule, branchDependent }
      : { methods: this.settings.default, rule: null, branchDependent };

    this.cache.set(ck, res);
    if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value as string);
    return res;
  }

  /** Every enabled rule matching, in priority order. For the UI tester. */
  matchAll(target: Target, branches: Branches | null = null): Rule[] {
    return this.all.filter((e) => this.test(e, target, branches) === 'match').map((e) => e.rule);
  }

  private test(e: Entry, t: Target, branches: Branches | null): 'match' | 'miss' | 'unknown' {
    if (!fits(e.org, t.org) || !fits(e.repo, t.repo)) return 'miss';
    if (!e.branched) return 'match';
    if (!branches) return 'unknown';
    return fits(e.head, branches.head) && fits(e.base, branches.base) ? 'match' : 'miss';
  }
}

export const emptyMatcher = (): Matcher => new Matcher({ version: 2, default: allMethods(true), rules: [] });

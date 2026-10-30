import { analyze, bucketKey, countGroups } from './pattern';
import { allMethods, type MethodSet, type Rule, type Settings } from './types';

/** `host/owner/repo/` (lower-cased, trailing slash) for a GitHub URL, or null. */
export function normalizeKey(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const [owner, repo] = u.pathname.split('/').filter(Boolean);
  if (!owner || !repo) return null;
  return `${u.hostname}/${owner}/${repo}/`.toLowerCase();
}

export const isPullPath = (pathname: string): boolean => /^\/[^/]+\/[^/]+\/pull\/\d+/.test(pathname);

interface Entry {
  rule: Rule;
  /** Position in the user's rule list; lower wins. */
  index: number;
}

/**
 * Rules compiled into ONE sticky alternation `(p0)|(p1)|...`. The engine tries
 * alternatives left to right at position 0, so the first matching rule wins
 * without us looping over rules in JS. Which alternative matched is read from the
 * capture groups (offset-adjusted for groups inside user patterns).
 */
class Group {
  private readonly re: RegExp;
  private readonly offsets: number[] = [];

  constructor(private readonly entries: Entry[]) {
    let next = 1;
    const sources: string[] = [];
    for (const { rule } of entries) {
      this.offsets.push(next);
      next += 1 + countGroups(rule.pattern);
      sources.push(`(${rule.pattern})`);
    }
    this.re = new RegExp(sources.join('|'), 'iy');
  }

  first(key: string): Entry | null {
    this.re.lastIndex = 0;
    const m = this.re.exec(key);
    if (!m) return null;
    for (let j = 0; j < this.offsets.length; j++) {
      if (m[this.offsets[j] as number] !== undefined) return this.entries[j] as Entry;
    }
    return null;
  }
}

export interface Resolution {
  methods: MethodSet;
  /** Winning rule, or null when the default policy applies. */
  rule: Rule | null;
}

const CACHE_SIZE = 500;

export class Matcher {
  /** Rule id -> error, for rules that were skipped because they are invalid. */
  readonly invalid = new Map<string, string>();
  private readonly buckets = new Map<string, Group>();
  private readonly generic: Group | null;
  private readonly cache = new Map<string, Resolution>();

  constructor(private readonly settings: Settings) {
    const generic: Entry[] = [];
    const byOwner = new Map<string, Entry[]>();

    settings.rules.forEach((rule, index) => {
      if (!rule.enabled) return;
      const info = analyze(rule.pattern);
      if (info.error) {
        this.invalid.set(rule.id, info.error);
        return;
      }
      const entry: Entry = { rule, index };
      const bk = info.prefix ? bucketKey(info.prefix) : null;
      if (!bk) return void generic.push(entry);
      const list = byOwner.get(bk);
      if (list) list.push(entry);
      else byOwner.set(bk, [entry]);
    });

    for (const [k, entries] of byOwner) this.buckets.set(k, new Group(entries));
    this.generic = generic.length ? new Group(generic) : null;
  }

  resolve(key: string | null): Resolution {
    if (!key) return { methods: this.settings.default, rule: null };
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }

    const bk = bucketKey(key);
    const a = bk ? (this.buckets.get(bk)?.first(key) ?? null) : null;
    const b = this.generic?.first(key) ?? null;
    const win = a && b ? (a.index < b.index ? a : b) : (a ?? b);
    const res: Resolution = win ? { methods: win.rule.methods, rule: win.rule } : { methods: this.settings.default, rule: null };

    this.cache.set(key, res);
    if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value as string);
    return res;
  }

  /** Every enabled, valid rule matching `key`, in priority order. O(n); for the UI tester only. */
  matchAll(key: string): Rule[] {
    const out: Rule[] = [];
    for (const rule of this.settings.rules) {
      if (!rule.enabled || this.invalid.has(rule.id)) continue;
      if (new RegExp(`(?:${rule.pattern})`, 'iy').test(key)) out.push(rule);
    }
    return out;
  }
}

export const emptyMatcher = (): Matcher => new Matcher({ version: 1, default: allMethods(true), rules: [] });

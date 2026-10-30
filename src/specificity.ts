import { analyze, branchError, type PatternInfo } from './pattern';
import { hasBranchFilter, type Rule } from './types';

const segments = (prefix: string): number => prefix.split('/').filter(Boolean).length;

/**
 * Negative when `a` is more specific than `b`: deeper literal path first (repo before org), then more
 * branch filters, then the finer tie-breaks. Rules without a literal prefix sort last, order untouched.
 */
export function compareSpecificity(a: PatternInfo, b: PatternInfo, aBranches = 0, bBranches = 0): number {
  if (!a.prefix && !b.prefix) return 0;
  if (!a.prefix) return 1;
  if (!b.prefix) return -1;
  return (
    segments(b.prefix) - segments(a.prefix) ||
    bBranches - aBranches ||
    Number(b.endAnchor) - Number(a.endAnchor) ||
    b.prefix.length - a.prefix.length ||
    a.wildcards - b.wildcards
  );
}

export interface Move {
  id: string;
  from: number;
  to: number;
  /** No literal prefix, so the optimiser could not rank it. */
  unordered: boolean;
}

export interface Optimization {
  rules: Rule[];
  moves: Move[];
  changed: boolean;
}

const branchFilters = (r: Rule): number => Number(r.head !== '') + Number(r.base !== '');

/** Reorders enabled, valid rules by specificity; disabled/invalid rules keep their slots. */
export function optimizeOrder(rules: Rule[]): Optimization {
  const infos = rules.map((r) => analyze(r.pattern));
  const slots: number[] = [];
  rules.forEach((r, i) => {
    if (r.enabled && !(infos[i] as PatternInfo).error && !branchError(r.head) && !branchError(r.base)) slots.push(i);
  });

  const sorted = [...slots].sort(
    (a, b) =>
      compareSpecificity(infos[a] as PatternInfo, infos[b] as PatternInfo, branchFilters(rules[a] as Rule), branchFilters(rules[b] as Rule)) ||
      a - b,
  );
  const result = rules.slice();
  slots.forEach((slot, k) => {
    result[slot] = rules[sorted[k] as number] as Rule;
  });

  const oldIndex = new Map(rules.map((r, i) => [r.id, i]));
  const moves: Move[] = result.map((r, to) => ({
    id: r.id,
    from: oldIndex.get(r.id) as number,
    to,
    unordered: slots.includes(to) && !(infos[oldIndex.get(r.id) as number] as PatternInfo).prefix,
  }));
  return { rules: result, moves, changed: moves.some((m) => m.from !== m.to) };
}

/** An earlier rule that certainly matches everything `rules[index]` would, or null. Conservative. */
export function findShadow(rules: Rule[], index: number): Rule | null {
  const me = rules[index] as Rule;
  const mine = analyze(me.pattern);
  if (!me.enabled || mine.error) return null;
  for (let j = 0; j < index; j++) {
    const other = rules[j] as Rule;
    if (!other.enabled || hasBranchFilter(other)) continue;
    const o = analyze(other.pattern);
    if (o.error || !o.pureTail) continue;
    if (o.prefix === '' ? other.pattern.replace(/^\^/, '') === '.*' : !mine.topAlt && mine.prefix.startsWith(o.prefix)) return other;
  }
  return null;
}

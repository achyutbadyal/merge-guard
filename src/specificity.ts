import { covers, rank } from './pattern';
import type { Rule } from './types';

const literal = (glob: string): number => glob.replace(/\*/g, '').length;

/**
 * Negative when `a` is more specific than `b`. Each field ranks exact > glob > any, compared org, then
 * repo, then both branches together; longer literal text breaks ties between globs.
 */
export function compareSpecificity(a: Rule, b: Rule): number {
  return (
    rank(b.org) - rank(a.org) ||
    rank(b.repo) - rank(a.repo) ||
    rank(b.head) + rank(b.base) - (rank(a.head) + rank(a.base)) ||
    literal(b.org) + literal(b.repo) + literal(b.head) + literal(b.base) - (literal(a.org) + literal(a.repo) + literal(a.head) + literal(a.base))
  );
}

export interface Move {
  id: string;
  from: number;
  to: number;
}

export interface Optimization {
  rules: Rule[];
  moves: Move[];
  changed: boolean;
}

/** Reorders enabled rules by specificity (stable); disabled rules keep their slots. */
export function optimizeOrder(rules: Rule[]): Optimization {
  const slots: number[] = [];
  rules.forEach((r, i) => {
    if (r.enabled) slots.push(i);
  });

  const sorted = [...slots].sort((a, b) => compareSpecificity(rules[a] as Rule, rules[b] as Rule) || a - b);
  const result = rules.slice();
  slots.forEach((slot, k) => {
    result[slot] = rules[sorted[k] as number] as Rule;
  });

  const oldIndex = new Map(rules.map((r, i) => [r.id, i]));
  const moves: Move[] = result.map((r, to) => ({ id: r.id, from: oldIndex.get(r.id) as number, to }));
  return { rules: result, moves, changed: moves.some((m) => m.from !== m.to) };
}

/** An earlier enabled rule that matches every PR `rules[index]` would, or null. */
export function findShadow(rules: Rule[], index: number): Rule | null {
  const me = rules[index] as Rule;
  if (!me.enabled) return null;
  for (let j = 0; j < index; j++) {
    const o = rules[j] as Rule;
    if (o.enabled && covers(o.org, me.org) && covers(o.repo, me.repo) && covers(o.head, me.head) && covers(o.base, me.base)) return o;
  }
  return null;
}

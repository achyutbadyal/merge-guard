import { describe, expect, it } from 'vitest';
import { analyze } from '../src/pattern';
import { findShadow, optimizeOrder } from '../src/specificity';
import { allMethods } from '../src/types';
import { rule } from './helpers';

const R = (id: string, p: string, enabled = true) => rule(id, p, allMethods(true), enabled);

describe('analyze', () => {
  it('extracts literal prefixes', () => {
    expect(analyze('github\\.com/Org1/').prefix).toBe('github.com/org1/');
    expect(analyze('^github\\.com/org1/.*').prefix).toBe('github.com/org1/');
    expect(analyze('github\\.com/org1/repo?').prefix).toBe('github.com/org1/rep');
    expect(analyze('a|b').prefix).toBe('');
    expect(analyze('.*').prefix).toBe('');
    expect(analyze('github\\.com/\\d+/').prefix).toBe('github.com/');
  });
  it('flags unusable patterns', () => {
    expect(analyze('').error).toBeTruthy();
    expect(analyze('(x').error).toBeTruthy();
    expect(analyze('(x)\\1').error).toBeTruthy();
    expect(analyze('(?<n>x)').error).toBeTruthy();
    expect(analyze('(?<=a)b').error).toBeNull();
  });
});

describe('optimizeOrder', () => {
  it('puts repo rules before org rules before catch-alls', () => {
    const res = optimizeOrder([R('all', '.*'), R('org', 'github\\.com/org1/'), R('repo', 'github\\.com/org1/repo1/')]);
    expect(res.rules.map((r) => r.id)).toEqual(['repo', 'org', 'all']);
    expect(res.changed).toBe(true);
  });
  it('prefers exact (anchored) over prefix, and is stable on ties', () => {
    const res = optimizeOrder([R('a', 'github\\.com/x/'), R('b', 'github\\.com/y/'), R('c', 'github\\.com/x/z$')]);
    expect(res.rules.map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });
  it('is idempotent', () => {
    const once = optimizeOrder([R('all', '.*'), R('org', 'github\\.com/o/'), R('repo', 'github\\.com/o/r/')]);
    const twice = optimizeOrder(once.rules);
    expect(twice.changed).toBe(false);
  });
  it('leaves disabled rules in their slots', () => {
    const res = optimizeOrder([R('off', 'github\\.com/a/', false), R('org', 'github\\.com/o/'), R('repo', 'github\\.com/o/r/')]);
    expect(res.rules.map((r) => r.id)).toEqual(['off', 'repo', 'org']);
  });
  it('marks prefix-less rules as unordered', () => {
    const res = optimizeOrder([R('x', '(a|b)/c'), R('org', 'github\\.com/o/')]);
    expect(res.rules.map((r) => r.id)).toEqual(['org', 'x']);
    expect(res.moves.find((m) => m.id === 'x')?.unordered).toBe(true);
  });
});

describe('findShadow', () => {
  it('detects a rule hidden by an earlier broader prefix rule', () => {
    const rules = [R('org', 'github\\.com/o/'), R('repo', 'github\\.com/o/r/')];
    expect(findShadow(rules, 1)?.id).toBe('org');
    expect(findShadow(rules, 0)).toBeNull();
    expect(findShadow([rules[1] as never, rules[0] as never], 1)).toBeNull();
  });
  it('a leading .* shadows everything after it', () => {
    expect(findShadow([R('all', '.*'), R('x', 'github\\.com/o/')], 1)?.id).toBe('all');
  });
});

describe('branch filters', () => {
  const B = (id: string, p: string, base: string) => rule(id, p, allMethods(true), true, { base });
  it('optimizeOrder puts branch-filtered rules above the same repo pattern', () => {
    const res = optimizeOrder([R('org', 'github\\.com/o/'), B('main', 'github\\.com/o/', 'main')]);
    expect(res.rules.map((r) => r.id)).toEqual(['main', 'org']);
  });
  it('a branch-filtered rule never shadows later rules', () => {
    expect(findShadow([B('main', 'github\\.com/o/', 'main'), R('org', 'github\\.com/o/')], 1)).toBeNull();
  });
});

describe('branch filters outrank finer tie-breaks', () => {
  it('keeps a branch rule above a same-depth plain rule with a longer literal', () => {
    const res = optimizeOrder([
      rule('branch', 'github\\.com/acme', allMethods(true), true, { base: 'main' }),
      R('plain', 'github\\.com/acme/'),
    ]);
    expect(res.rules.map((r) => r.id)).toEqual(['branch', 'plain']);
  });
  it('still puts a deeper (repo) rule above an org branch rule', () => {
    const res = optimizeOrder([rule('branch', 'github\\.com/acme/', allMethods(true), true, { base: 'main' }), R('repo', 'github\\.com/acme/app/')]);
    expect(res.rules.map((r) => r.id)).toEqual(['repo', 'branch']);
  });
});

import { describe, expect, it } from 'vitest';
import { findShadow, optimizeOrder } from '../src/specificity';
import { rule } from './helpers';

const ids = (rules: { id: string }[]) => rules.map((r) => r.id);

describe('optimizeOrder', () => {
  it('puts repo rules before org rules before catch-alls', () => {
    const res = optimizeOrder([rule('all', {}), rule('org', { org: 'o' }), rule('repo', { org: 'o', repo: 'r' })]);
    expect(ids(res.rules)).toEqual(['repo', 'org', 'all']);
    expect(res.changed).toBe(true);
  });
  it('ranks exact > glob > any per field, stable on ties', () => {
    const res = optimizeOrder([rule('a', { org: 'x' }), rule('b', { org: 'y' }), rule('glob', { org: 'x', repo: 'svc-*' }), rule('exact', { org: 'x', repo: 'svc-api' })]);
    expect(ids(res.rules)).toEqual(['exact', 'glob', 'a', 'b']);
  });
  it('puts branch-filtered rules above the same scope without branches', () => {
    expect(ids(optimizeOrder([rule('org', { org: 'o' }), rule('main', { org: 'o', base: 'main' })]).rules)).toEqual(['main', 'org']);
  });
  it('still puts a repo rule above an org branch rule', () => {
    expect(ids(optimizeOrder([rule('branch', { org: 'o', base: 'main' }), rule('repo', { org: 'o', repo: 'app' })]).rules)).toEqual(['repo', 'branch']);
  });
  it('is idempotent', () => {
    const once = optimizeOrder([rule('all', {}), rule('org', { org: 'o' }), rule('repo', { org: 'o', repo: 'r' })]);
    expect(optimizeOrder(once.rules).changed).toBe(false);
  });
  it('leaves disabled rules in their slots', () => {
    const res = optimizeOrder([rule('off', { org: 'a' }, undefined, false), rule('org', { org: 'o' }), rule('repo', { org: 'o', repo: 'r' })]);
    expect(ids(res.rules)).toEqual(['off', 'repo', 'org']);
  });
});

describe('findShadow', () => {
  it('detects a rule covered by an earlier broader rule', () => {
    const rules = [rule('org', { org: 'o' }), rule('repo', { org: 'o', repo: 'r' })];
    expect(findShadow(rules, 1)?.id).toBe('org');
    expect(findShadow(rules, 0)).toBeNull();
    expect(findShadow([rules[1] as never, rules[0] as never], 1)).toBeNull();
  });
  it('understands globs and case', () => {
    expect(findShadow([rule('g', { org: 'O', repo: 'svc-*' }), rule('x', { org: 'o', repo: 'svc-api' })], 1)?.id).toBe('g');
    expect(findShadow([rule('g', { org: 'o', repo: 'svc-*' }), rule('x', { org: 'o', repo: 'svc*' })], 1)).toBeNull();
  });
  it('a branch-filtered rule does not shadow a broader one', () => {
    expect(findShadow([rule('main', { org: 'o', base: 'main' }), rule('org', { org: 'o' })], 1)).toBeNull();
    expect(findShadow([rule('org', { org: 'o' }), rule('main', { org: 'o', base: 'main' })], 1)?.id).toBe('org');
  });
});

import { describe, expect, it } from 'vitest';
import { Matcher, normalizeKey } from '../src/matcher';
import { allMethods } from '../src/types';
import { only, rule, settings } from './helpers';

describe('normalizeKey', () => {
  it('reduces PR urls to host/owner/repo/', () => {
    expect(normalizeKey('https://github.com/Acme/Repo/pull/12/files?w=1#x')).toBe('github.com/acme/repo/');
    expect(normalizeKey('https://github.com/acme')).toBeNull();
    expect(normalizeKey('chrome://extensions')).toBeNull();
    expect(normalizeKey('nope')).toBeNull();
  });
});

describe('Matcher priority', () => {
  const org = rule('org', 'github\\.com/org1/', only('merge', 'squash'));
  const repo = rule('repo', 'github\\.com/org1/repo1/', only('rebase'));

  it('first rule in list order wins (specific above general)', () => {
    const m = new Matcher(settings([repo, org]));
    expect(m.resolve('github.com/org1/repo1/').rule?.id).toBe('repo');
    expect(m.resolve('github.com/org1/other/').rule?.id).toBe('org');
  });

  it('general above specific shadows the specific rule', () => {
    const m = new Matcher(settings([org, repo]));
    expect(m.resolve('github.com/org1/repo1/').rule?.id).toBe('org');
  });

  it('falls back to the default policy', () => {
    const m = new Matcher(settings([org], only('squash')));
    const res = m.resolve('github.com/zzz/x/');
    expect(res.rule).toBeNull();
    expect(res.methods).toEqual(only('squash'));
  });

  it('picks the lower index across bucket and generic rules', () => {
    const generic = rule('g', '.*', only('merge'));
    const a = new Matcher(settings([generic, org]));
    expect(a.resolve('github.com/org1/x/').rule?.id).toBe('g');
    const b = new Matcher(settings([org, generic]));
    expect(b.resolve('github.com/org1/x/').rule?.id).toBe('org');
    expect(b.resolve('github.com/other/x/').rule?.id).toBe('g');
  });

  it('skips disabled rules and reports invalid ones', () => {
    const bad = rule('bad', '(unclosed', allMethods(false));
    const off = rule('off', 'github\\.com/org1/', allMethods(false), false);
    const m = new Matcher(settings([bad, off]));
    expect(m.invalid.has('bad')).toBe(true);
    expect(m.resolve('github.com/org1/x/').rule).toBeNull();
  });

  it('handles capture groups inside user patterns (offset correctness)', () => {
    const r1 = rule('r1', '(github\\.com)/(a|b)/(x|y)/', only('merge'));
    const r2 = rule('r2', '.*/c/', only('rebase'));
    const r3 = rule('r3', 'github\\.com/d/', only('squash'));
    const m = new Matcher(settings([r1, r2, r3]));
    expect(m.resolve('github.com/b/y/').rule?.id).toBe('r1');
    expect(m.resolve('github.com/c/z/').rule?.id).toBe('r2');
    expect(m.resolve('github.com/d/z/').rule?.id).toBe('r3');
  });

  it('rejects numeric backrefs and named groups', () => {
    const m = new Matcher(settings([rule('a', '(x)\\1', allMethods(false)), rule('b', '(?<n>x)', allMethods(false))]));
    expect([...m.invalid.keys()].sort()).toEqual(['a', 'b']);
  });

  it('is case-insensitive and does not confuse org1 with org10', () => {
    const m = new Matcher(settings([rule('o', 'github\\.com/Org1/', only('squash'))]));
    expect(m.resolve('github.com/org1/x/').rule?.id).toBe('o');
    expect(m.resolve('github.com/org10/x/').rule).toBeNull();
  });

  it('matchAll lists every matching rule in order', () => {
    const m = new Matcher(settings([repo, org, rule('all', '.*', allMethods(true))]));
    expect(m.matchAll('github.com/org1/repo1/').map((r) => r.id)).toEqual(['repo', 'org', 'all']);
  });
});

describe('performance', () => {
  it('lookup cost does not scale with the number of rules', () => {
    const rules = Array.from({ length: 10_000 }, (_, i) => rule(`r${i}`, `github\\.com/org${i}/`, only('squash')));
    rules.push(...Array.from({ length: 200 }, (_, i) => rule(`g${i}`, `.*-suffix${i}/`, only('merge'))));
    const t0 = performance.now();
    const m = new Matcher(settings(rules));
    const compile = performance.now() - t0;

    const t1 = performance.now();
    for (let i = 0; i < 5000; i++) m.resolve(`github.com/org${i * 2}/repo${i}/`);
    const perLookup = (performance.now() - t1) / 5000;
    console.log(`compile ${compile.toFixed(1)}ms, ${(perLookup * 1000).toFixed(1)}us/uncached lookup`);
    expect(perLookup).toBeLessThan(0.5);
    expect(m.resolve('github.com/org9999/x/').rule?.id).toBe('r9999');
  });
});

describe('branch filters', () => {
  const intoMain = rule('main', 'github\\.com/org1/', only('squash'), true, { base: 'main' });
  const release = rule('rel', 'github\\.com/org1/', only('merge'), true, { head: 'release/.*', base: 'main' });
  const org = rule('org', 'github\\.com/org1/', only('rebase'));

  it('applies only when both branches match (whole name, ignoring case)', () => {
    const m = new Matcher(settings([release, intoMain, org]));
    expect(m.resolve('github.com/org1/x/', { head: 'release/1.2', base: 'main' }).rule?.id).toBe('rel');
    expect(m.resolve('github.com/org1/x/', { head: 'feature', base: 'main' }).rule?.id).toBe('main');
    expect(m.resolve('github.com/org1/x/', { head: 'feature', base: 'main-old' }).rule?.id).toBe('org');
    expect(m.resolve('github.com/org1/x/', { head: 'Release/1.2', base: 'Main' }).rule?.id).toBe('rel');
  });

  it('is skipped without branches and reports that it might apply', () => {
    const m = new Matcher(settings([intoMain, org]));
    const res = m.resolve('github.com/org1/x/');
    expect(res.rule?.id).toBe('org');
    expect(res.branchDependent).toBe(true);
    expect(m.resolve('github.com/other/x/').branchDependent).toBe(false);
  });

  it('does not matter below the winning rule', () => {
    const m = new Matcher(settings([org, intoMain]));
    expect(m.resolve('github.com/org1/x/').branchDependent).toBe(false);
    expect(m.resolve('github.com/org1/x/', { head: 'f', base: 'main' }).rule?.id).toBe('org');
  });

  it('caches per branch pair', () => {
    const m = new Matcher(settings([intoMain]));
    expect(m.resolve('github.com/org1/x/', { head: 'a', base: 'main' }).rule?.id).toBe('main');
    expect(m.resolve('github.com/org1/x/', { head: 'a', base: 'dev' }).rule).toBeNull();
  });

  it('reports invalid branch regexes', () => {
    const m = new Matcher(settings([rule('bad', 'github\\.com/', only('merge'), true, { head: '(' })]));
    expect(m.invalid.get('bad')).toMatch(/^From branch:/);
  });

  it('matchAll includes branch rules only when branches match', () => {
    const m = new Matcher(settings([intoMain, org]));
    expect(m.matchAll('github.com/org1/x/').map((r) => r.id)).toEqual(['org']);
    expect(m.matchAll('github.com/org1/x/', { head: 'a', base: 'main' }).map((r) => r.id)).toEqual(['main', 'org']);
  });
});

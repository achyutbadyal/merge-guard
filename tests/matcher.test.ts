import { describe, expect, it } from 'vitest';
import { Matcher, targetOf } from '../src/matcher';
import { allMethods } from '../src/types';
import { only, rule, settings } from './helpers';

const t = (org: string, repo: string) => ({ org, repo });

describe('targetOf', () => {
  it('reads owner and repo from github.com URLs, lower-cased', () => {
    expect(targetOf('https://github.com/Acme/Repo/pull/12/files?w=1#x')).toEqual(t('acme', 'repo'));
    expect(targetOf('https://github.com/acme')).toBeNull();
    expect(targetOf('https://gitlab.com/acme/repo')).toBeNull();
    expect(targetOf('chrome://extensions')).toBeNull();
    expect(targetOf('nope')).toBeNull();
  });
});

describe('Matcher priority', () => {
  const org = rule('org', { org: 'org1' }, only('merge', 'squash'));
  const repo = rule('repo', { org: 'org1', repo: 'repo1' }, only('rebase'));

  it('first rule in list order wins', () => {
    const m = new Matcher(settings([repo, org]));
    expect(m.resolve(t('org1', 'repo1')).rule?.id).toBe('repo');
    expect(m.resolve(t('org1', 'other')).rule?.id).toBe('org');
    expect(new Matcher(settings([org, repo])).resolve(t('org1', 'repo1')).rule?.id).toBe('org');
  });

  it('falls back to the default policy', () => {
    const res = new Matcher(settings([org], only('squash'))).resolve(t('zzz', 'x'));
    expect(res.rule).toBeNull();
    expect(res.methods).toEqual(only('squash'));
  });

  it('picks the lower index across exact-org and wildcard rules', () => {
    const any = rule('any', {}, only('merge'));
    expect(new Matcher(settings([any, org])).resolve(t('org1', 'x')).rule?.id).toBe('any');
    const m = new Matcher(settings([org, any]));
    expect(m.resolve(t('org1', 'x')).rule?.id).toBe('org');
    expect(m.resolve(t('other', 'x')).rule?.id).toBe('any');
  });

  it('skips disabled rules', () => {
    const m = new Matcher(settings([rule('off', { org: 'org1' }, allMethods(false), false)]));
    expect(m.resolve(t('org1', 'x')).rule).toBeNull();
  });

  it('matches whole names ignoring case, with * wildcards', () => {
    const m = new Matcher(settings([rule('svc', { org: 'Org1', repo: 'service-*' }), rule('o', { org: 'ORG1' })]));
    expect(m.resolve(t('org1', 'service-api')).rule?.id).toBe('svc');
    expect(m.resolve(t('org1', 'my-service-api')).rule?.id).toBe('o');
    expect(m.resolve(t('org10', 'x')).rule).toBeNull();
  });

  it('org globs work', () => {
    const m = new Matcher(settings([rule('g', { org: 'team-*' })]));
    expect(m.resolve(t('team-a', 'x')).rule?.id).toBe('g');
    expect(m.resolve(t('a-team', 'x')).rule).toBeNull();
  });

  it('matchAll lists every matching rule in order', () => {
    const m = new Matcher(settings([repo, org, rule('all', {})]));
    expect(m.matchAll(t('org1', 'repo1')).map((r) => r.id)).toEqual(['repo', 'org', 'all']);
  });
});

describe('branch filters', () => {
  const intoMain = rule('main', { org: 'org1', base: 'main' }, only('squash'));
  const release = rule('rel', { org: 'org1', head: 'release/*', base: 'main' }, only('merge'));
  const org = rule('org', { org: 'org1' }, only('rebase'));

  it('applies only when both branches match (whole name, ignoring case)', () => {
    const m = new Matcher(settings([release, intoMain, org]));
    expect(m.resolve(t('org1', 'x'), { head: 'release/1.2', base: 'main' }).rule?.id).toBe('rel');
    expect(m.resolve(t('org1', 'x'), { head: 'Release/1.2', base: 'Main' }).rule?.id).toBe('rel');
    expect(m.resolve(t('org1', 'x'), { head: 'feature', base: 'main' }).rule?.id).toBe('main');
    expect(m.resolve(t('org1', 'x'), { head: 'feature', base: 'main-old' }).rule?.id).toBe('org');
  });

  it('is skipped without branches and reports that it might apply', () => {
    const m = new Matcher(settings([intoMain, org]));
    const res = m.resolve(t('org1', 'x'));
    expect(res.rule?.id).toBe('org');
    expect(res.branchDependent).toBe(true);
    expect(m.resolve(t('other', 'x')).branchDependent).toBe(false);
  });

  it('does not matter below the winning rule', () => {
    const m = new Matcher(settings([org, intoMain]));
    expect(m.resolve(t('org1', 'x')).branchDependent).toBe(false);
    expect(m.resolve(t('org1', 'x'), { head: 'f', base: 'main' }).rule?.id).toBe('org');
  });

  it('caches per branch pair', () => {
    const m = new Matcher(settings([intoMain]));
    expect(m.resolve(t('org1', 'x'), { head: 'a', base: 'main' }).rule?.id).toBe('main');
    expect(m.resolve(t('org1', 'x'), { head: 'a', base: 'dev' }).rule).toBeNull();
  });

  it('matchAll includes branch rules only when branches match', () => {
    const m = new Matcher(settings([intoMain, org]));
    expect(m.matchAll(t('org1', 'x')).map((r) => r.id)).toEqual(['org']);
    expect(m.matchAll(t('org1', 'x'), { head: 'a', base: 'main' }).map((r) => r.id)).toEqual(['main', 'org']);
  });
});

describe('performance', () => {
  it('lookup cost does not scale with the number of exact-org rules', () => {
    const rules = Array.from({ length: 10_000 }, (_, i) => rule(`r${i}`, { org: `org${i}` }, only('squash')));
    rules.push(...Array.from({ length: 200 }, (_, i) => rule(`g${i}`, { repo: `*-suffix${i}` }, only('merge'))));
    const t0 = performance.now();
    const m = new Matcher(settings(rules));
    const compile = performance.now() - t0;

    const t1 = performance.now();
    for (let i = 0; i < 5000; i++) m.resolve(t(`org${i * 2}`, `repo${i}`));
    const perLookup = (performance.now() - t1) / 5000;
    console.log(`compile ${compile.toFixed(1)}ms, ${(perLookup * 1000).toFixed(1)}us/uncached lookup`);
    expect(perLookup).toBeLessThan(0.5);
    expect(m.resolve(t('org9999', 'x')).rule?.id).toBe('r9999');
  });
});

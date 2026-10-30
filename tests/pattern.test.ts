import { expect, it, vi } from 'vitest';
import { compileGlob, covers, legacyScope, regexToGlob } from '../src/pattern';

vi.stubGlobal('chrome', {});
const { normalize } = await import('../src/storage');

it('globs match whole names ignoring case', () => {
  expect(compileGlob('')).toBeNull();
  expect(compileGlob('*')).toBeNull();
  expect(compileGlob('release/*')?.test('Release/1.2')).toBe(true);
  expect(compileGlob('main')?.test('main-old')).toBe(false);
  expect(compileGlob('a.b')?.test('axb')).toBe(false);
});

it('covers is conservative', () => {
  expect(covers('', 'x')).toBe(true);
  expect(covers('x', '')).toBe(false);
  expect(covers('svc-*', 'svc-api')).toBe(true);
  expect(covers('svc-*', 'svc-a*')).toBe(false);
});

it('converts v1 regexes', () => {
  expect(regexToGlob('release/.*')).toBe('release/*');
  expect(regexToGlob('main|master')).toBeNull();
  expect(legacyScope('github\\.com/balkanID/')).toEqual({ org: 'balkanID', repo: '' });
  expect(legacyScope('^github\\.com/acme/app/$')).toEqual({ org: 'acme', repo: 'app' });
  expect(legacyScope('https://github.com/acme')).toEqual({ org: 'acme', repo: '' });
  expect(legacyScope('.*')).toEqual({ org: '', repo: '' });
  expect(legacyScope('github\\.com/[^/]+/docs/')).toEqual({ org: '', repo: 'docs' });
  expect(legacyScope('gitlab\\.com/acme/')).toBeNull();
  expect(legacyScope('github\\.com/(a|b)/')).toBeNull();
});

it('migrates v1 settings, disabling what it cannot convert', () => {
  const s = normalize({
    version: 1,
    rules: [
      { id: 'a', name: '', pattern: 'github\\.com/balkanID/', base: 'main' },
      { id: 'b', name: 'odd', pattern: 'github\\.com/(a|b)/' },
    ],
  });
  expect(s.version).toBe(2);
  expect(s.rules[0]).toMatchObject({ org: 'balkanID', repo: '', head: '', base: 'main', enabled: true });
  expect(s.rules[1]).toMatchObject({ enabled: false, org: '', name: 'odd [review: was /github\\.com/(a|b)//]' });
});

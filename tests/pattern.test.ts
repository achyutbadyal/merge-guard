import { expect, it, vi } from 'vitest';
import { urlToPattern } from '../src/pattern';

vi.stubGlobal('chrome', {});
const { normalize } = await import('../src/storage');

it('turns pasted URLs into host/owner[/repo]/ patterns', () => {
  expect(urlToPattern('https://github.com/balkanID')).toBe('github\\.com/balkanID/');
  expect(urlToPattern('https://github.com/acme/app/pull/12')).toBe('github\\.com/acme/app/');
  expect(urlToPattern('http://github.com/acme/')).toBe('github\\.com/acme/');
  expect(urlToPattern('https://github.com/')).toBeNull();
  expect(urlToPattern('github\\.com/acme/')).toBeNull();
  expect(urlToPattern('https://github.com/acme/.*')).toBeNull();
});

it('fixes URL patterns already in storage', () => {
  expect(normalize({ rules: [{ pattern: 'https://github.com/balkanID' }] }).rules[0]?.pattern).toBe('github\\.com/balkanID/');
});

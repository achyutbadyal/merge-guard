import { expect, it } from 'vitest';
import { classifyText } from '../src/classify';

it('maps control labels to methods', () => {
  expect(classifyText('Create a merge commit')).toBe('merge');
  expect(classifyText('Create a merge commit All commits from this branch will be added')).toBe('merge');
  expect(classifyText('  Merge pull request ')).toBe('merge');
  expect(classifyText('Squash and merge\n  The 3 commits will be combined')).toBe('squash');
  expect(classifyText('Rebase and merge')).toBe('rebase');
});

it('ignores lookalikes', () => {
  expect(classifyText('Merge pull request #12 from a/b')).toBeNull();
  expect(classifyText('Confirm squash and merge')).toBeNull();
  expect(classifyText('')).toBeNull();
  expect(classifyText('Squash and merge ' + 'x'.repeat(400))).toBeNull();
});

import { classifyLabel } from '../src/classify';

it('classifyLabel only accepts exact labels', () => {
  expect(classifyLabel(' Squash and merge ')).toBe('squash');
  expect(classifyLabel('Squash and merge docs')).toBeNull();
  expect(classifyLabel('Merge pull request #4 from a/b')).toBeNull();
});

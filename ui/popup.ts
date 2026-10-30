import { ext } from '../src/api';
import { Matcher, normalizeKey } from '../src/matcher';
import { escapeRegex } from '../src/pattern';
import { loadSettings, newRuleId, saveSettings } from '../src/storage';
import { METHODS, hasBranchFilter, ruleLabel, type MethodSet, type Settings } from '../src/types';
import { methodToggle, toast } from './components';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/** Add a rule for `pattern` (or update the existing one with the same pattern) at top priority. */
async function upsert(settings: Settings, pattern: string, name: string, methods: MethodSet): Promise<void> {
  const existing = settings.rules.find((r) => r.pattern === pattern && !hasBranchFilter(r));
  if (existing) Object.assign(existing, { enabled: true, methods: { ...methods } });
  else settings.rules.unshift({ id: newRuleId(), name, enabled: true, pattern, head: '', base: '', methods: { ...methods } });
  await saveSettings(settings);
}

async function init(): Promise<void> {
  $('options').addEventListener('click', () => {
    void ext.runtime.openOptionsPage();
    window.close();
  });

  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  const key = tab?.url ? normalizeKey(tab.url) : null;
  const settings = await loadSettings();

  if (!key || !tab?.url?.includes('github.com')) {
    $('repo').textContent = 'Not a GitHub repo page';
    $('source').textContent = 'Open a repository on GitHub to set its merge options.';
    $('actions').hidden = true;
    return;
  }

  const [host, owner, repo] = key.split('/') as [string, string, string];
  const res = new Matcher(settings).resolve(key);
  $('repo').textContent = `${owner}/${repo}`;
  $('source').textContent = `${res.rule ? `Rule: ${ruleLabel(res.rule)}` : 'Default policy'}${res.branchDependent ? ' (branch rules may override on some PRs)' : ''}`;

  const methods: MethodSet = { ...res.methods };
  $('methods').replaceChildren(...METHODS.map((m) => methodToggle(m, methods[m], (v) => (methods[m] = v)).el));

  const save = (pattern: string, name: string) => async (): Promise<void> => {
    await upsert(await loadSettings(), pattern, name, methods);
    toast('Saved. Reload the PR page if it does not update.', 3000);
  };
  $('save-repo').addEventListener('click', save(`${escapeRegex(host)}/${escapeRegex(owner)}/${escapeRegex(repo)}/`, `${owner}/${repo}`));
  $('save-org').addEventListener('click', save(`${escapeRegex(host)}/${escapeRegex(owner)}/`, owner));
}

void init();

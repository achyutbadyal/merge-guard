import { ext } from '../src/api';
import { Matcher, targetOf } from '../src/matcher';
import { loadSettings, newRuleId, saveSettings } from '../src/storage';
import { METHODS, hasBranchFilter, ruleLabel, type MethodSet, type Settings } from '../src/types';
import { methodToggle, toast } from './components';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/** Add a rule for `org`/`repo` (or update the existing branch-less one) at top priority. */
async function upsert(settings: Settings, org: string, repo: string, methods: MethodSet): Promise<void> {
  const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
  const existing = settings.rules.find((r) => same(r.org, org) && same(r.repo, repo) && !hasBranchFilter(r));
  if (existing) Object.assign(existing, { enabled: true, methods: { ...methods } });
  else settings.rules.unshift({ id: newRuleId(), name: '', enabled: true, org, repo, head: '', base: '', methods: { ...methods } });
  await saveSettings(settings);
}

async function init(): Promise<void> {
  $('options').addEventListener('click', () => {
    void ext.runtime.openOptionsPage();
    window.close();
  });

  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  const target = tab?.url ? targetOf(tab.url) : null;
  const settings = await loadSettings();

  if (!target) {
    $('repo').textContent = 'Not a GitHub repo page';
    $('source').textContent = 'Open a repository on GitHub to set its merge options.';
    $('actions').hidden = true;
    return;
  }

  // Display and save with the URL's casing; matching ignores case.
  const [owner, repo] = new URL(tab?.url as string).pathname.split('/').filter(Boolean) as [string, string];
  const res = new Matcher(settings).resolve(target);
  $('repo').textContent = `${owner}/${repo}`;
  $('source').textContent = `${res.rule ? `Rule: ${ruleLabel(res.rule)}` : 'Default policy'}${res.branchDependent ? ' (branch rules may override on some PRs)' : ''}`;

  const methods: MethodSet = { ...res.methods };
  $('methods').replaceChildren(...METHODS.map((m) => methodToggle(m, methods[m], (v) => (methods[m] = v)).el));

  const save = (org: string, repoName: string) => async (): Promise<void> => {
    await upsert(await loadSettings(), org, repoName, methods);
    toast('Saved. Reload the PR page if it does not update.', 3000);
  };
  $('save-repo').addEventListener('click', save(owner, repo));
  $('save-org').addEventListener('click', save(owner, ''));
}

void init();

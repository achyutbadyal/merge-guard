import { Matcher, type Target } from '../src/matcher';
import { findShadow, optimizeOrder, type Optimization } from '../src/specificity';
import { loadSettings, newRuleId, normalize, onSettingsChanged, saveSettings } from '../src/storage';
import { HOST, METHODS, METHOD_LABEL, allMethods, modeOf, ruleLabel, type Branches, type DefaultMode, type MethodSet, type Rule, type Settings } from '../src/types';
import { h, icons, methodToggle, toast, type MethodToggle } from './components';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

let settings: Settings;
let lastSaved = '';
let undoSnapshot: Rule[] | null = null;
let saveTimer = 0;
let dragId: string | null = null;

/* ---------- persistence ---------- */

function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    lastSaved = JSON.stringify(settings);
    await saveSettings(settings);
    toast('Saved');
  }, 250);
}

function changed(rerender: 'none' | 'rules' = 'none'): void {
  scheduleSave();
  if (rerender === 'rules') renderRules();
  refresh();
}

/* ---------- default policy ---------- */

const MODE_LABEL: Record<DefaultMode, string> = { 'enable-all': 'Enable all', custom: 'Selective', 'disable-all': 'Disable all' };
let defaultToggles: Record<string, MethodToggle> = {};

function renderDefault(): void {
  const mode = modeOf(settings.default);
  $('default-mode').replaceChildren(
    ...(Object.keys(MODE_LABEL) as DefaultMode[]).map((m) =>
      h('button', {
        type: 'button',
        'aria-pressed': String(m === mode),
        onclick: () => {
          if (m === 'enable-all') settings.default = allMethods(true);
          else if (m === 'disable-all') settings.default = allMethods(false);
          else if (modeOf(settings.default) !== 'custom') settings.default = { merge: false, squash: true, rebase: false };
          renderDefault();
          changed();
        },
      }, MODE_LABEL[m]),
    ),
  );
  defaultToggles = {};
  $('default-methods').replaceChildren(
    ...METHODS.map((m) => {
      const t = methodToggle(m, settings.default[m], (v) => {
        settings.default[m] = v;
        renderDefault();
        changed();
      });
      defaultToggles[m] = t;
      return t.el;
    }),
  );
}

/* ---------- rules ---------- */

function move(from: number, to: number): void {
  if (from === to || to < 0 || to >= settings.rules.length) return;
  const [r] = settings.rules.splice(from, 1);
  settings.rules.splice(to, 0, r as Rule);
  changed('rules');
}

function ruleCard(rule: Rule, index: number): HTMLElement {
  const toggles = METHODS.map((m) =>
    methodToggle(m, rule.methods[m], (v) => {
      rule.methods[m] = v;
      changed();
    }),
  );
  const input = (key: 'org' | 'repo' | 'head' | 'base', placeholder: string, label: string): HTMLInputElement => {
    const el = h('input', { type: 'text', class: key, value: rule[key], placeholder, spellcheck: 'false', autocomplete: 'off', 'aria-label': label });
    el.addEventListener('input', () => {
      rule[key] = el.value.trim();
      changed();
    });
    return el;
  };
  const org = input('org', 'any org', 'Org');
  const repo = input('repo', 'any repo', 'Repo');
  // Pasting `owner/repo` or a GitHub URL into the org field fills both.
  org.addEventListener('change', () => {
    const t = parseScope(org.value);
    if (!t || !org.value.includes('/')) return;
    org.value = rule.org = t.org;
    repo.value = rule.repo = t.repo;
    changed();
  });
  const scope = h('div', { class: 'inline' }, h('span', { class: 'muted mono' }, HOST), '/', org, '/', repo);
  const branches = h(
    'div',
    { class: 'inline' },
    h('span', { class: 'muted' }, 'From'),
    input('head', 'any branch', 'From branch'),
    h('span', { class: 'muted' }, 'into'),
    input('base', 'any branch', 'Into branch'),
  );
  const name = h('input', { type: 'text', class: 'name', value: rule.name, placeholder: 'Rule name (optional)', 'aria-label': 'Rule name' });
  name.addEventListener('input', () => {
    rule.name = name.value;
    scheduleSave();
  });
  const enabled = h('input', { type: 'checkbox', checked: rule.enabled, 'aria-label': 'Rule enabled' });
  enabled.addEventListener('change', () => {
    rule.enabled = enabled.checked;
    card.classList.toggle('disabled', !rule.enabled);
    changed();
  });

  const grip = h('button', { type: 'button', class: 'grip', title: 'Drag to reorder', 'aria-label': 'Drag to reorder' }, icons.grip());
  const card = h(
    'div',
    { class: `rule${rule.enabled ? '' : ' disabled'}`, 'data-id': rule.id },
    grip,
    h('label', { class: 'sw', title: 'Enable rule' }, enabled),
    h('div', { class: 'fields' }, name, scope, branches, h('div', { class: 'status' })),
    h('div', { class: 'methods' }, ...toggles.map((t) => t.el)),
    h(
      'div',
      { class: 'rule-actions' },
      h('button', { type: 'button', class: 'btn ghost', title: 'Move up', 'aria-label': 'Move up', onclick: () => move(index, index - 1) }, icons.up()),
      h('button', { type: 'button', class: 'btn ghost', title: 'Move down', 'aria-label': 'Move down', onclick: () => move(index, index + 1) }, icons.down()),
      h('button', {
        type: 'button',
        class: 'btn ghost',
        title: 'Delete rule',
        'aria-label': 'Delete rule',
        onclick: () => {
          settings.rules.splice(index, 1);
          changed('rules');
        },
      }, icons.trash()),
    ),
  );

  grip.addEventListener('mousedown', () => (card.draggable = true));
  grip.addEventListener('mouseup', () => (card.draggable = false));
  card.addEventListener('dragstart', (e) => {
    dragId = rule.id;
    e.dataTransfer?.setData('text/plain', rule.id);
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => {
    dragId = null;
    card.draggable = false;
    document.querySelectorAll('.rule').forEach((c) => c.classList.remove('dragging', 'drop-before', 'drop-after'));
  });
  card.addEventListener('dragover', (e) => {
    if (!dragId || dragId === rule.id) return;
    e.preventDefault();
    const r = card.getBoundingClientRect();
    const before = e.clientY < r.top + r.height / 2;
    card.classList.toggle('drop-before', before);
    card.classList.toggle('drop-after', !before);
  });
  card.addEventListener('dragleave', () => card.classList.remove('drop-before', 'drop-after'));
  card.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!dragId || dragId === rule.id) return;
    const from = settings.rules.findIndex((x) => x.id === dragId);
    const before = card.classList.contains('drop-before');
    let to = index + (before ? 0 : 1);
    if (from < to) to--;
    move(from, to);
  });
  return card;
}

function renderRules(): void {
  $('rules').replaceChildren(...settings.rules.map(ruleCard));
  $('rules-empty').hidden = settings.rules.length > 0;
  ($('optimize') as HTMLButtonElement).disabled = settings.rules.length < 2;
  $('undo').hidden = !undoSnapshot;
  refresh();
}

/** Cheap in-place status refresh (shadow warnings, tester) without rebuilding inputs. */
function refresh(): void {
  const cards = $('rules').children;
  settings.rules.forEach((rule, i) => {
    const status = cards[i]?.querySelector('.status');
    if (!status) return;
    const shadow = findShadow(settings.rules, i);
    status.className = `status ${shadow ? 'warn' : ''}`;
    status.textContent = shadow ? `Never applies: "${ruleLabel(shadow)}" above already matches everything this does.` : '';
  });
  runTester();
}

/* ---------- tester ---------- */

function chips(m: MethodSet): HTMLElement {
  return h(
    'span',
    { class: 'chips' },
    ...METHODS.map((k) => h('span', { class: `chip ${m[k] ? 'on' : 'off'}`, title: m[k] ? 'shown' : 'hidden' }, m[k] ? icons.check() : icons.cross(), h('span', { class: 't' }, METHOD_LABEL[k]))),
  );
}

/**
 * Org and repo from `owner`, `owner/repo` or a github.com URL (any page in the repo). The repo is ''
 * for an org on its own; null for other hosts or empty input.
 */
function parseScope(text: string): Target | null {
  const s = text.trim().replace(/\\/g, '').replace(/^[a-z]+:\/\//i, '');
  const parts = s.split(/[/?#]/).filter(Boolean);
  if (parts[0]?.includes('.')) {
    if (parts[0].toLowerCase() !== HOST) return null;
    parts.shift();
  }
  const [org, repo = ''] = parts;
  return org ? { org, repo } : null;
}

function runTester(matcher = new Matcher(settings)): void {
  const out = $('test-result');
  document.querySelectorAll('.rule.hit').forEach((c) => c.classList.remove('hit'));
  const raw = ($('test-url') as HTMLInputElement).value;
  if (!raw.trim()) return out.replaceChildren();
  const scope = parseScope(raw);
  const target = scope && { org: scope.org.toLowerCase(), repo: scope.repo.toLowerCase() };
  if (!target) return out.replaceChildren(h('div', { class: 'muted' }, `Enter an org, owner/repo or ${HOST} URL, e.g. acme/app`));

  const head = ($('test-head') as HTMLInputElement).value.trim();
  const base = ($('test-base') as HTMLInputElement).value.trim();
  const branches: Branches | null = head || base ? { head, base } : null;
  const matches = matcher.matchAll(target, branches);
  const res = matcher.resolve(target, branches);
  const lines: HTMLElement[] = [
    h(
      'div',
      { class: 'line' },
      h('span', { class: 'muted' }, 'Testing'),
      h('code', {}, `${target.org}/${target.repo || '…'}`),
      !target.repo && h('span', { class: 'muted' }, '(no repo: only rules for any repo match)'),
      branches && h('code', {}, `${head || '?'} → ${base || '?'}`),
    ),
  ];
  if (res.branchDependent) lines.push(h('div', { class: 'line muted' }, 'Some rules filter by branch. Enter branches to include them.'));
  if (!matches.length) lines.push(h('div', { class: 'line' }, h('span', { class: 'winner' }, 'No rule matches. Default policy applies.')));
  for (const [i, r] of matches.entries()) {
    lines.push(h('div', { class: 'line' }, h('span', { class: i === 0 ? 'winner' : 'muted' }, `${ruleLabel(r)}${i === 0 ? ' (applies)' : ' (shadowed)'}`)));
    document.querySelector(`.rule[data-id="${r.id}"]`)?.classList.toggle('hit', i === 0);
  }
  lines.push(h('div', { class: 'line' }, h('span', { class: 'muted' }, 'Result'), chips(res.methods)));
  out.replaceChildren(...lines);
}

/* ---------- actions ---------- */

function addRule(rule: Partial<Rule>): void {
  settings.rules.unshift({ id: newRuleId(), name: '', enabled: true, org: '', repo: '', head: '', base: '', methods: allMethods(true), ...rule });
  undoSnapshot = null;
  changed('rules');
  document.querySelector<HTMLInputElement>('.rule .org')?.focus();
}

function showOptimize(): void {
  const opt: Optimization = optimizeOrder(settings.rules);
  const byId = new Map(settings.rules.map((r) => [r.id, r]));
  const dlg = $<HTMLDialogElement>('opt-dialog');
  const body = $('opt-body');
  const apply = $<HTMLButtonElement>('opt-apply');
  apply.disabled = !opt.changed;

  if (!opt.changed) {
    body.replaceChildren(h('p', { class: 'muted' }, 'Rules are already ordered from most to least specific.'));
  } else {
    body.replaceChildren(
      h('p', { class: 'muted' }, 'Most specific first: exact names before wildcards before "any", comparing org, then repo, then branches. Disabled rules stay where they are.'),
      ...opt.moves.map((m) => {
        const r = byId.get(m.id) as Rule;
        return h(
          'div',
          { class: `move${m.from === m.to ? ' same' : ''}` },
          h('span', { class: 'pos' }, m.from === m.to ? `${m.to + 1}` : `${m.from + 1} → ${m.to + 1}`),
          h('span', {}, ruleLabel(r)),
        );
      }),
    );
  }
  dlg.returnValue = '';
  dlg.onclose = () => {
    if (dlg.returnValue !== 'apply' || !opt.changed) return;
    undoSnapshot = settings.rules.slice();
    settings.rules = opt.rules;
    changed('rules');
  };
  dlg.showModal();
}

function download(name: string, text: string): void {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function adopt(s: Settings): void {
  settings = s;
  undoSnapshot = null;
  renderDefault();
  renderRules();
}

/* ---------- init ---------- */

async function init(): Promise<void> {
  settings = await loadSettings();
  lastSaved = JSON.stringify(settings);
  renderDefault();
  renderRules();

  $('add').addEventListener('click', () => addRule({}));
  $('optimize').addEventListener('click', showOptimize);
  $('undo').addEventListener('click', () => {
    if (!undoSnapshot) return;
    settings.rules = undoSnapshot;
    undoSnapshot = null;
    changed('rules');
  });
  $('export').addEventListener('click', () => download('merge-guard.json', JSON.stringify(settings, null, 2)));
  $('import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      adopt(normalize(JSON.parse(await file.text())));
      changed();
    } catch {
      alert('That file is not valid JSON.');
    }
  });
  $('quick').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>('quick-org');
    const org = parseScope(input.value)?.org;
    if (!org) return;
    addRule({ org, methods: { merge: false, squash: true, rebase: false } });
    input.value = '';
  });
  for (const id of ['test-url', 'test-head', 'test-base']) $(id).addEventListener('input', () => runTester());

  onSettingsChanged((s) => {
    if (JSON.stringify(s) !== lastSaved) {
      lastSaved = JSON.stringify(s);
      adopt(s);
    }
  });
}

void init();

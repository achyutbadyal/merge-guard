import { Matcher, normalizeKey } from '../src/matcher';
import { escapeRegex } from '../src/pattern';
import { findShadow, optimizeOrder, type Optimization } from '../src/specificity';
import { loadSettings, newRuleId, normalize, onSettingsChanged, saveSettings } from '../src/storage';
import { METHODS, METHOD_LABEL, allMethods, modeOf, type DefaultMode, type MethodSet, type Rule, type Settings } from '../src/types';
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
  const pattern = h('input', { type: 'text', class: 'pattern', value: rule.pattern, placeholder: 'github\\.com/acme/', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Pattern' });
  pattern.addEventListener('input', () => {
    rule.pattern = pattern.value;
    changed();
  });
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
    h('div', { class: 'fields' }, name, pattern, h('div', { class: 'status' })),
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

/** Cheap in-place status refresh (validation, shadow warnings, tester) without rebuilding inputs. */
function refresh(): void {
  const matcher = new Matcher(settings);
  const cards = $('rules').children;
  settings.rules.forEach((rule, i) => {
    const status = cards[i]?.querySelector('.status');
    if (!status) return;
    const err = matcher.invalid.get(rule.id) ?? (rule.pattern ? null : 'Pattern is empty');
    const shadow = err ? null : findShadow(settings.rules, i);
    status.className = `status ${err ? 'err' : shadow ? 'warn' : ''}`;
    status.textContent = err
      ? `Invalid pattern: ${err}. This rule is ignored.`
      : shadow
        ? `Never applies: "${shadow.name || shadow.pattern}" above already matches everything this does.`
        : '';
  });
  runTester(matcher);
}

/* ---------- tester ---------- */

function chips(m: MethodSet): HTMLElement {
  return h(
    'span',
    { class: 'chips' },
    ...METHODS.map((k) => h('span', { class: `chip ${m[k] ? 'on' : 'off'}`, title: m[k] ? 'shown' : 'hidden' }, m[k] ? icons.check() : icons.cross(), h('span', { class: 't' }, METHOD_LABEL[k]))),
  );
}

function runTester(matcher = new Matcher(settings)): void {
  const out = $('test-result');
  document.querySelectorAll('.rule.hit').forEach((c) => c.classList.remove('hit'));
  const raw = ($('test-url') as HTMLInputElement).value.trim();
  if (!raw) return out.replaceChildren();
  const key = normalizeKey(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (!key) return out.replaceChildren(h('div', { class: 'muted' }, 'Enter a URL like https://github.com/owner/repo/pull/1'));

  const matches = matcher.matchAll(key);
  const res = matcher.resolve(key);
  const lines: HTMLElement[] = [h('div', { class: 'line' }, h('span', { class: 'muted' }, 'Matched as'), h('code', {}, key))];
  if (!matches.length) lines.push(h('div', { class: 'line' }, h('span', { class: 'winner' }, 'No rule matches. Default policy applies.')));
  for (const [i, r] of matches.entries()) {
    lines.push(h('div', { class: 'line' }, h('span', { class: i === 0 ? 'winner' : 'muted' }, `${r.name || r.pattern}${i === 0 ? ' (applies)' : ' (shadowed)'}`)));
    document.querySelector(`.rule[data-id="${r.id}"]`)?.classList.toggle('hit', i === 0);
  }
  lines.push(h('div', { class: 'line' }, h('span', { class: 'muted' }, 'Result'), chips(res.methods)));
  out.replaceChildren(...lines);
}

/* ---------- actions ---------- */

function addRule(rule: Partial<Rule>): void {
  settings.rules.unshift({ id: newRuleId(), name: '', enabled: true, pattern: '', methods: allMethods(true), ...rule });
  undoSnapshot = null;
  changed('rules');
  document.querySelector<HTMLInputElement>('.rule .pattern')?.focus();
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
      h('p', { class: 'muted' }, 'Most specific rules first (longer literal paths, then exact matches). Disabled and invalid rules stay where they are.'),
      ...opt.moves.map((m) => {
        const r = byId.get(m.id) as Rule;
        return h(
          'div',
          { class: `move${m.from === m.to ? ' same' : ''}` },
          h('span', { class: 'pos' }, m.from === m.to ? `${m.to + 1}` : `${m.from + 1} → ${m.to + 1}`),
          h('span', {}, r.name || r.pattern, m.unordered ? h('span', { class: 'note' }, '  can’t auto-order (no literal prefix)') : null),
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

  $('add').addEventListener('click', () => addRule({ pattern: 'github\\.com/' }));
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
    const org = input.value.trim().replace(/^\/+|\/+$/g, '');
    if (!org) return;
    addRule({ name: org, pattern: `github\\.com/${escapeRegex(org)}/`, methods: { merge: false, squash: true, rebase: false } });
    input.value = '';
  });
  $('test-url').addEventListener('input', () => runTester());

  onSettingsChanged((s) => {
    if (JSON.stringify(s) !== lastSaved) {
      lastSaved = JSON.stringify(s);
      adopt(s);
    }
  });
}

void init();

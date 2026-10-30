import { ext } from './api';
import { legacyScope, regexToGlob } from './pattern';
import { METHODS, allMethods, defaultSettings, type MethodSet, type Rule, type Settings } from './types';

const KEY = 'settings';

function toMethodSet(raw: unknown, fallback: boolean): MethodSet {
  const out = allMethods(fallback);
  if (raw && typeof raw === 'object') {
    for (const m of METHODS) {
      const v = (raw as Record<string, unknown>)[m];
      if (typeof v === 'boolean') out[m] = v;
    }
  }
  return out;
}

export const newRuleId = (): string => Math.random().toString(36).slice(2, 10);

const field = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** A v1 rule (regex `pattern`, regex branches) as fields; disabled and labelled when it can't be converted. */
function migrate(x: Record<string, unknown>, rule: Rule): Rule {
  const pattern = typeof x.pattern === 'string' ? x.pattern : '';
  const scope = legacyScope(pattern);
  const head = regexToGlob(rule.head);
  const base = regexToGlob(rule.base);
  if (scope && head !== null && base !== null) return { ...rule, ...scope, head, base };
  const branches = rule.head || rule.base ? ` ${rule.head || 'any'} → ${rule.base || 'any'}` : '';
  return { ...rule, enabled: false, name: `${rule.name ? `${rule.name} ` : ''}[review: was /${pattern}/${branches}]`, org: '', repo: '', head: '', base: '' };
}

/** Defensively coerce anything (storage, imported file) into valid Settings. */
export function normalize(raw: unknown): Settings {
  const base = defaultSettings();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  base.default = toMethodSet(r.default, true);
  if (Array.isArray(r.rules)) {
    base.rules = r.rules
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map((x) => {
        const rule: Rule = {
          id: typeof x.id === 'string' && x.id ? x.id : newRuleId(),
          name: typeof x.name === 'string' ? x.name : '',
          enabled: x.enabled !== false,
          org: field(x.org),
          repo: field(x.repo),
          head: field(x.head),
          base: field(x.base),
          methods: toMethodSet(x.methods, true),
        };
        return 'pattern' in x && !('org' in x) ? migrate(x, rule) : rule;
      });
  }
  return base;
}

export async function loadSettings(): Promise<Settings> {
  const res = await ext.storage.local.get(KEY);
  return normalize(res[KEY]);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await ext.storage.local.set({ [KEY]: settings });
}

export function onSettingsChanged(cb: (s: Settings) => void): void {
  ext.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[KEY]) cb(normalize(changes[KEY].newValue));
  });
}

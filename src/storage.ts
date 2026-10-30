import { ext } from './api';
import { urlToPattern } from './pattern';
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

/** Defensively coerce anything (storage, imported file) into valid Settings. */
export function normalize(raw: unknown): Settings {
  const base = defaultSettings();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  base.default = toMethodSet(r.default, true);
  if (Array.isArray(r.rules)) {
    base.rules = r.rules
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map(
        (x): Rule => ({
          id: typeof x.id === 'string' && x.id ? x.id : newRuleId(),
          name: typeof x.name === 'string' ? x.name : '',
          enabled: x.enabled !== false,
          pattern: typeof x.pattern === 'string' ? (urlToPattern(x.pattern) ?? x.pattern) : '',
          head: typeof x.head === 'string' ? x.head : '',
          base: typeof x.base === 'string' ? x.base : '',
          methods: toMethodSet(x.methods, true),
        }),
      );
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

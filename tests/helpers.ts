import { allMethods, type MethodSet, type Rule, type Settings } from '../src/types';

export const only = (...on: Array<keyof MethodSet>): MethodSet => {
  const m = allMethods(false);
  for (const k of on) m[k] = true;
  return m;
};

export const rule = (id: string, pattern: string, methods: MethodSet, enabled = true): Rule => ({
  id,
  name: id,
  enabled,
  pattern,
  methods,
});

export const settings = (rules: Rule[], def: MethodSet = allMethods(true)): Settings => ({ version: 1, default: def, rules });

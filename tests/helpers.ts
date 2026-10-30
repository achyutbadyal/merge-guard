import { allMethods, type MethodSet, type Rule, type Settings } from '../src/types';

export const only = (...on: Array<keyof MethodSet>): MethodSet => {
  const m = allMethods(false);
  for (const k of on) m[k] = true;
  return m;
};

type Scope = Partial<Pick<Rule, 'org' | 'repo' | 'head' | 'base'>>;

export const rule = (id: string, scope: Scope, methods: MethodSet = allMethods(true), enabled = true): Rule => ({
  id,
  name: id,
  enabled,
  org: '',
  repo: '',
  head: '',
  base: '',
  ...scope,
  methods,
});

export const settings = (rules: Rule[], def: MethodSet = allMethods(true)): Settings => ({ version: 2, default: def, rules });

/**
 * Rule fields are globs: `*` matches any run of characters (including `/` in branch names), everything
 * else is literal, compared ignoring case. An empty field (or a lone `*`) matches anything.
 */

export const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const isAny = (glob: string): boolean => /^\**$/.test(glob);
export const isExact = (glob: string): boolean => glob !== '' && !glob.includes('*');

/** Whole-name, case-insensitive regex for a glob; null when it matches anything. */
export const compileGlob = (glob: string): RegExp | null =>
  isAny(glob) ? null : new RegExp(`^${glob.split('*').map(escapeRegex).join('.*')}$`, 'i');

export const fits = (re: RegExp | null, name: string): boolean => !re || re.test(name);

/** True when glob `a` certainly matches every name glob `b` matches. Conservative. */
export function covers(a: string, b: string): boolean {
  if (isAny(a)) return true;
  if (isAny(b)) return false;
  if (a.toLowerCase() === b.toLowerCase()) return true;
  return isExact(b) && (compileGlob(a) as RegExp).test(b);
}

/** 2 = exact name, 1 = glob, 0 = any. */
export const rank = (glob: string): number => (isAny(glob) ? 0 : isExact(glob) ? 2 : 1);

/* ---------- migration from v1 regex rules ---------- */

/**
 * A v1 regex that only uses literals, `\x` escapes of punctuation and `.*` / `[^/]*` wildcards, as a glob.
 * A lone `.` is read as a literal dot (people wrote `github.com`). Null when it uses anything else.
 */
export function regexToGlob(src: string): string | null {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i] as string;
    const wild = ['.*', '.+', '[^/]*', '[^/]+'].find((w) => src.startsWith(w, i));
    if (wild) {
      out += '*';
      i += wild.length - 1;
    } else if (c === '\\') {
      const n = src[i + 1];
      if (n === undefined || /\w/.test(n)) return null;
      out += n;
      i++;
    } else if (c === '.') out += '.';
    else if ('^$*+?()[]{}|'.includes(c)) return null;
    else out += c;
  }
  return out;
}

/** Org and repo globs for a v1 `host/owner/repo/` regex, or null when it can't be expressed as fields. */
export function legacyScope(pattern: string): { org: string; repo: string } | null {
  const glob = regexToGlob(pattern.replace(/^\^/, '').replace(/\$$/, ''));
  if (glob === null) return null;
  const rest = glob.replace(/^https?:\/\//i, '');
  if (isAny(rest)) return { org: '', repo: '' };
  const [host, org = '', repo = '', ...extra] = rest.split('/');
  if (host?.toLowerCase() !== 'github.com' || extra.some((s) => !isAny(s))) return null;
  return { org: isAny(org) ? '' : org, repo: isAny(repo) ? '' : repo };
}

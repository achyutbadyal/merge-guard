/**
 * Static analysis of a user-supplied regex source. Everything here is purely
 * syntactic and deliberately conservative: when unsure, report "no literal prefix".
 */

const LITERAL_ESCAPES = '.^$*+?()[]{}|/\\-';

export interface PatternInfo {
  /** Error that makes the pattern unusable, or null. */
  error: string | null;
  /** Lower-cased literal text every match must start with ('' if unknown). */
  prefix: string;
  /** Top-level alternation (a|b): prefix is unreliable. */
  topAlt: boolean;
  /** Count of wildcard-ish tokens (., *, +, ?, {, classes, \d ...). */
  wildcards: number;
  endAnchor: boolean;
  /** Pattern is just the literal prefix, optionally followed by `.*`. */
  pureTail: boolean;
}

const regexError = (e: unknown): string => (e instanceof Error ? e.message.replace(/^Invalid regular expression: /, '') : 'Invalid regex');

export const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A pasted URL such as `https://github.com/acme/app/pull/1` as the pattern it was meant to be
 * (`github\.com/acme/app/`), or null when `text` is not a plain URL. Rules never see the scheme.
 */
export function urlToPattern(text: string): string | null {
  if (!/^https?:\/\/[^\s*+?^${}()|[\]\\]+$/i.test(text)) return null;
  const u = new URL(text);
  const parts = [u.hostname, ...u.pathname.split('/').filter(Boolean).slice(0, 2)];
  return parts.length > 1 ? `${parts.map(escapeRegex).join('/')}/` : null;
}

export function countGroups(pattern: string): number {
  return (new RegExp(pattern + '|').exec('') as RegExpExecArray).length - 1;
}

export function analyze(pattern: string): PatternInfo {
  const info: PatternInfo = { error: null, prefix: '', topAlt: false, wildcards: 0, endAnchor: false, pureTail: false };
  if (!pattern) {
    info.error = 'Pattern is empty';
    return info;
  }

  let depth = 0;
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] as string;
    if (c === '\\') {
      const n = pattern[i + 1];
      if (n !== undefined && n >= '1' && n <= '9' && !inClass) info.error = 'Numeric backreferences are not supported';
      if (n !== undefined && !LITERAL_ESCAPES.includes(n)) info.wildcards++;
      i++;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      continue;
    }
    if (c === '[') {
      inClass = true;
      info.wildcards++;
    } else if (c === '(') {
      depth++;
      if (pattern.startsWith('(?<', i) && !'=!'.includes(pattern[i + 3] ?? '')) info.error = 'Named groups are not supported';
    } else if (c === ')') depth--;
    else if (c === '|' && depth === 0) info.topAlt = true;
    else if ('.*+?{'.includes(c)) info.wildcards++;
  }

  if (!info.error) {
    try {
      new RegExp(pattern, 'i');
    } catch (e) {
      info.error = regexError(e);
    }
  }

  info.endAnchor = pattern.endsWith('$') && !pattern.endsWith('\\$');

  let k = pattern[0] === '^' ? 1 : 0;
  let prefix = '';
  while (k < pattern.length) {
    const c = pattern[k] as string;
    if (c === '\\') {
      const n = pattern[k + 1];
      if (n !== undefined && LITERAL_ESCAPES.includes(n)) {
        prefix += n;
        k += 2;
        continue;
      }
      break;
    }
    if ('.*+?()[]{}|$^'.includes(c)) break;
    prefix += c;
    k++;
  }
  // A quantifier that can drop the last literal (x?, x*, x{0,}) makes it optional.
  if (prefix && k < pattern.length && '*?{'.includes(pattern[k] as string)) prefix = prefix.slice(0, -1);

  const rest = pattern.slice(k);
  info.prefix = info.topAlt ? '' : prefix.toLowerCase();
  info.pureTail = !info.topAlt && (rest === '' || rest === '.*');
  return info;
}

export const validatePattern = (pattern: string): string | null => analyze(pattern).error;

/** Bucket key `host/owner/` if the literal prefix pins down the owner, else null. */
export function bucketKey(prefixOrKey: string): string | null {
  const m = /^([^/]+\/[^/]+\/)/.exec(prefixOrKey);
  return m ? (m[1] as string) : null;
}

/** Branch filter as a whole-name, case-insensitive regex; null means "any branch". Throws when invalid. */
export const compileBranch = (pattern: string): RegExp | null => (pattern ? new RegExp(`^(?:${pattern})$`, 'i') : null);

export function branchError(pattern: string): string | null {
  try {
    compileBranch(pattern);
    return null;
  } catch (e) {
    return regexError(e);
  }
}

import { classifyLabel } from './classify';
import { Matcher, isPullPath, normalizeKey } from './matcher';
import { loadSettings, onSettingsChanged } from './storage';
import { METHODS, ruleLabel, type Branches, type Method, type MethodSet, type Settings } from './types';

/**
 * GitHub ships no stable hooks for the merge-method controls, so they are found by
 * their exact label text. Keep every GitHub-specific selector in this block.
 */
const INTERACTIVE = 'button, summary, [role="menuitemradio"], [role="menuitem"], [role="option"], .select-menu-item';
const MENU_CONTAINER = '[role="menu"], [role="listbox"], [role="dialog"], .select-menu-list, .select-menu-modal, ul, ol';
const MENU_ITEM_INNER = '[role^="menuitem"], [role="option"], button';
const SELECT_PREFERENCE: Method[] = ['squash', 'merge', 'rebase'];
/** Classic PR header: `.head-ref` / `.base-ref`, titled `owner/repo:branch`. */
const HEAD_REF = '.head-ref';
const BASE_REF = '.base-ref';
/** React PR header fallback: Primer BranchName links, base first ("into base from head"). */
const BRANCH_NAME = '[class*="BranchName"]';
/** How long to wait for the branches to render before ignoring branch rules. */
const BRANCH_WAIT_MS = 4000;

const root = document.documentElement;
let matcher: Matcher | null = null;
let current: MethodSet | null = null;
let reason = '';
let lastHref = '';
let active = false;
let raf = 0;

let branches: Branches | null = null;
let branchTimer = 0;
let branchTimedOut = false;

let selecting = false;
let selectTimer = 0;
let attemptedFor = '';

const inMenu = (el: Element): boolean => el.closest(MENU_CONTAINER) !== null;

/* ---------- tagging and painting (synchronous: runs before the browser paints new nodes) ---------- */

function paint(el: Element): void {
  const method = el.getAttribute('data-mmf-method') as Method;
  const blocked = current !== null && !current[method];
  const loading = current === null;
  const was = el.hasAttribute('data-mmf-blocked');

  if (blocked || loading) {
    if (!was) {
      el.setAttribute('data-mmf-orig-title', el.getAttribute('title') ?? '');
      el.setAttribute('data-mmf-blocked', '');
      el.setAttribute('aria-disabled', 'true');
    }
    el.setAttribute('title', loading ? 'Checking merge rules…' : reason);
  } else if (was) {
    el.removeAttribute('data-mmf-blocked');
    el.removeAttribute('aria-disabled');
    const orig = el.getAttribute('data-mmf-orig-title');
    if (orig) el.setAttribute('title', orig);
    else el.removeAttribute('title');
    el.removeAttribute('data-mmf-orig-title');
  }
}

function tagText(text: Text): void {
  const v = text.nodeValue;
  if (!v || v.length > 40) return;
  const method = classifyLabel(v);
  if (!method) return;
  const el = text.parentElement?.closest(INTERACTIVE);
  if (!el || el.hasAttribute('data-mmf-method') || el.parentElement?.closest('[data-mmf-method]')) return;
  el.setAttribute('data-mmf-method', method);
  paint(el);
}

function scan(node: Node): void {
  if (node.nodeType === Node.TEXT_NODE) return tagText(node as Text);
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) tagText(t as Text);
}

/** Swallow activation of blocked (or still-loading) controls before GitHub's handlers see it. */
function block(e: Event): void {
  if (e instanceof KeyboardEvent && e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target instanceof Element ? e.target.closest('[data-mmf-method]') : null;
  if (el && (el.hasAttribute('data-mmf-blocked') || root.hasAttribute('data-mmf-loading'))) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}
for (const type of ['click', 'keydown'] as const) window.addEventListener(type, block, true);

/* ---------- branches ---------- */

/** Git refnames cannot contain ':', so the branch is whatever follows the last one (`owner/repo:` or `user:`). */
const refName = (el: Element): string => (el.getAttribute('title') || el.textContent || '').trim().split(':').pop() as string;

function readBranches(): Branches | null {
  let head: Element | null | undefined = document.querySelector(HEAD_REF);
  let base: Element | null | undefined = document.querySelector(BASE_REF);
  if (!head || !base) {
    const names = Array.from(document.querySelectorAll(BRANCH_NAME)).filter((el) => !el.parentElement?.closest(BRANCH_NAME));
    [base, head] = names;
  }
  if (!head || !base) return null;
  const found = { head: refName(head), base: refName(base) };
  return found.head && found.base ? found : null;
}

/** Keeps the last branches seen on this page (headers re-render), returning true when they changed. */
function updateBranches(): boolean {
  const next = readBranches();
  if (!next || (next.head === branches?.head && next.base === branches.base)) return false;
  branches = next;
  return true;
}

/* ---------- policy ---------- */

function applyPolicy(): void {
  if (!active) {
    root.removeAttribute('data-mmf-loading');
    current = null;
    return;
  }
  if (!matcher) {
    current = null;
    root.setAttribute('data-mmf-loading', '');
  } else {
    const res = matcher.resolve(normalizeKey(location.href), branches);
    if (res.branchDependent && !branchTimedOut) {
      current = null;
      root.setAttribute('data-mmf-loading', '');
    } else {
      current = res.methods;
      reason = `Disabled by Merge Guard (${res.rule ? `rule: ${ruleLabel(res.rule)}` : 'default policy'}).${
        res.branchDependent ? ' The PR branches could not be read, so branch rules were skipped.' : ''
      } Change it in the extension options.`;
      root.removeAttribute('data-mmf-loading');
    }
  }
  document.querySelectorAll('[data-mmf-method]').forEach(paint);
}

function navigate(): void {
  lastHref = location.href;
  active = isPullPath(location.pathname);
  branches = null;
  branchTimedOut = false;
  clearTimeout(branchTimer);
  if (active) {
    scan(root);
    updateBranches();
    branchTimer = window.setTimeout(() => {
      branchTimedOut = true;
      applyPolicy();
      schedule();
    }, BRANCH_WAIT_MS);
  }
  applyPolicy();
  schedule();
}

const checkNav = (): void => {
  if (location.href !== lastHref) navigate();
};

/* ---------- auto-select an allowed method when the preselected one is blocked ---------- */

const findPrimary = (): HTMLElement | null => {
  for (const b of document.querySelectorAll<HTMLElement>('button[data-mmf-method]')) if (!inMenu(b)) return b;
  return null;
};

function endSelecting(): void {
  selecting = false;
  clearTimeout(selectTimer);
  root.removeAttribute('data-mmf-selecting');
}

function trySelect(): void {
  if (!active || !current) return;
  const primary = findPrimary();
  if (!primary) return;
  const have = primary.getAttribute('data-mmf-method') as Method;
  if (current[have]) return endSelecting();
  const target = SELECT_PREFERENCE.find((m) => current?.[m]);
  if (!target) return; // everything disabled: leave the (disabled) controls as they are

  if (!selecting) {
    const sig = `${location.href}|${METHODS.filter((m) => current?.[m]).join()}`;
    if (attemptedFor === sig) return;
    const caret = Array.from(primary.parentElement?.querySelectorAll<HTMLElement>('button, summary') ?? []).find(
      (b) => b !== primary && !b.hasAttribute('data-mmf-method'),
    );
    if (!caret) return;
    attemptedFor = sig;
    selecting = true;
    root.setAttribute('data-mmf-selecting', '');
    selectTimer = window.setTimeout(endSelecting, 1500);
    caret.click();
    return;
  }

  const item = Array.from(document.querySelectorAll<HTMLElement>(`[data-mmf-method="${target}"]`)).find((e) => e !== primary && inMenu(e));
  if (!item) return;
  (item.querySelector<HTMLElement>(MENU_ITEM_INNER) ?? item).click();
  endSelecting();
}

function schedule(): void {
  if (!raf) {
    raf = requestAnimationFrame(() => {
      raf = 0;
      trySelect();
    });
  }
}

/* ---------- wiring ---------- */

new MutationObserver((records) => {
  if (location.href !== lastHref) return navigate();
  if (!active) return;
  for (const r of records) r.addedNodes.forEach(scan);
  if (matcher?.hasBranchRules && updateBranches()) applyPolicy();
  schedule();
}).observe(root, { childList: true, subtree: true });

document.addEventListener('turbo:load', checkNav);
window.addEventListener('popstate', checkNav);

function setSettings(s: Settings): void {
  matcher = new Matcher(s);
  attemptedFor = '';
  applyPolicy();
  schedule();
}

navigate(); // synchronous at document_start: pending state shows before any control renders
void loadSettings().then(setSettings);
onSettingsChanged(setSettings);

import { METHOD_LABEL, type Method } from '../src/types';

type Kid = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...kids: Kid[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'value' || k === 'checked' || k === 'disabled') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids) if (kid) el.append(kid);
  return el;
}

const svg = (inner: string, size = 16): HTMLElement => {
  const s = h('span', { class: 'icon', 'aria-hidden': 'true' });
  s.innerHTML = `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none">${inner}</svg>`;
  return s;
};

export const icons = {
  check: () =>
    svg('<circle cx="8" cy="8" r="8" fill="currentColor"/><path d="M4.6 8.3l2.3 2.3 4.6-5" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'),
  cross: () =>
    svg('<circle cx="8" cy="8" r="8" fill="currentColor"/><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>'),
  grip: () =>
    svg('<g fill="currentColor"><circle cx="5.5" cy="3.5" r="1.2"/><circle cx="10.5" cy="3.5" r="1.2"/><circle cx="5.5" cy="8" r="1.2"/><circle cx="10.5" cy="8" r="1.2"/><circle cx="5.5" cy="12.5" r="1.2"/><circle cx="10.5" cy="12.5" r="1.2"/></g>'),
  up: () => svg('<path d="M4 10l4-4 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'),
  down: () => svg('<path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'),
  trash: () =>
    svg('<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8h5.8l.6-8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'),
};

export interface MethodToggle {
  el: HTMLButtonElement;
  set(value: boolean): void;
}

/** Checkbox-like button: green tick when the method is shown, red cross when hidden. */
export function methodToggle(method: Method, value: boolean, onChange: (v: boolean) => void, label = METHOD_LABEL[method]): MethodToggle {
  const iconHost = h('span', { class: 'mt-icon' });
  const el = h('button', { type: 'button', role: 'checkbox', class: 'mt', 'data-method': method }, iconHost, h('span', { class: 'mt-label' }, label));
  let state = value;
  const paint = (): void => {
    el.setAttribute('aria-checked', String(state));
    el.classList.toggle('on', state);
    el.classList.toggle('off', !state);
    el.title = state ? `${METHOD_LABEL[method]}: shown` : `${METHOD_LABEL[method]}: hidden`;
    iconHost.replaceChildren(state ? icons.check() : icons.cross());
  };
  paint();
  el.addEventListener('click', () => {
    state = !state;
    paint();
    onChange(state);
  });
  return {
    el,
    set(v) {
      state = v;
      paint();
    },
  };
}

let toastTimer = 0;

/** Show a transient message in the page's #toast live region; repeated calls restart the timer. */
export function toast(text: string, ms = 1500): void {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), ms);
}

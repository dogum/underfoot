/* Small DOM helpers. Everything browser-only is guarded so the engine can be
   imported by the unit tests under Node. */

export const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T;
export const $$ = <T extends HTMLElement = HTMLElement>(sel: string): T[] => [
  ...document.querySelectorAll<T>(sel),
];

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string | null,
  txt?: string | number | null,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = String(txt);
  return e;
}

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export const esc = (s: unknown) => String(s).replace(/[&<>"]/g, c => ESC[c]);

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string, ms = 2800) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}

/** true on phones and tablets: drives tap/long-press wording and behaviour */
export const TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer:coarse)').matches;

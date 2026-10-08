// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
/**
 * Dropdown menus.
 */
import { $$ } from '../core/dom';

export function closeMenus() {
  $$('.menu').forEach(m => m.classList.remove('on'));
}
/* keep an open menu inside the screen: on a phone the buttons spread across a
   row, so a menu anchored to one can hang off either edge */
export function keepOnScreen(m) {
  m.style.transform = '';
  const r = m.getBoundingClientRect(),
    dx = r.left < 8 ? 8 - r.left : r.right > innerWidth - 8 ? innerWidth - 8 - r.right : 0;
  if (dx) m.style.transform = `translateX(${dx}px)`;
}

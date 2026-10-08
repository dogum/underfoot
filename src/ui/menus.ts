// @ts-nocheck — ported from the v3 single file; remove this line when the module is typed.
/**
 * Dropdown menus.
 */
import { $$ } from '../core/dom';

export function closeMenus() {
  $$('.menu').forEach(m => m.classList.remove('on'));
}

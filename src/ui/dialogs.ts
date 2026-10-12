/**
 * Dialogs on a phone: full-screen, with Done at the top where a thumb finds
 * it, and the phone's Back closing the dialog instead of leaving the
 * sounding. Each dialog opened on a phone adds a history entry of its own;
 * Back pops it and closes the dialog, and closing it any other way pops the
 * entry so Back still goes where it went before. A desktop is left as it is.
 */
import { $$, el } from '../core/dom';
import { isPhone } from './sheet';

export function dialogsInit() {
  for (const d of $$<HTMLDialogElement>('dialog')) {
    let head = d.querySelector(':scope > header');
    if (!head) {
      head = el('header');
      d.prepend(head);
      head.classList.add('bare');
    }
    const done = el('button', 'btn dlgDone', 'Done');
    done.onclick = () => d.close();
    head.append(done);
    /* open and close, however they happen: showModal, a form, Escape */
    new MutationObserver(() => (d.open ? opened(d) : closed(d))).observe(d, {
      attributes: true,
      attributeFilter: ['open'],
    });
  }
  addEventListener('popstate', () => {
    for (const d of $$<HTMLDialogElement>('dialog[open]')) {
      d.dataset.popped = '1';
      d.close();
    }
  });
}

function opened(d: HTMLDialogElement) {
  if (!isPhone() || d.dataset.entry) return;
  d.dataset.entry = '1';
  history.pushState({ dlg: d.id }, '');
}
function closed(d: HTMLDialogElement) {
  if (!d.dataset.entry) return;
  delete d.dataset.entry;
  /* closed by Back: its entry is already gone; closed any other way: take the entry back off */
  if (d.dataset.popped) delete d.dataset.popped;
  else if (history.state?.dlg === d.id) history.back();
}

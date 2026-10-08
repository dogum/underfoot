/**
 * Marks ▸ Share: a dialog that lists every field a shared mark carries and
 * what stays in this browser, then sends the batch (io/contribute). While the
 * community store is off it saves the batch as a file instead, exactly as it
 * would be sent.
 */
import { render } from './console';
import { NAME, VERSION } from '../core/classes';
import { $, el, toast } from '../core/dom';
import { postRows, shareable, storeOn, toRow, whoAmI } from '../io/contribute';
import { download } from '../io/export';
import { HOW, marks, saveMark } from '../io/marks';

const KEPT = [
  'the coordinates',
  'the place name',
  'the link to the sounding',
  'the day and time',
  'not-sure marks',
];

export function openShare() {
  const dlg = $('#dlgShare') as HTMLDialogElement,
    body = $('#shareBody'),
    foot = $('#shareFoot'),
    all = marks(),
    list = shareable(all),
    n = list.length,
    on = storeOn();
  body.textContent = '';
  foot.textContent = '';
  $('#shareSub').textContent = `${all.length} mark${all.length === 1 ? '' : 's'} · ${n} to share`;
  const close = el('button', 'btn', n ? 'Cancel' : 'Close');
  close.onclick = () => dlg.close();
  if (!n) {
    body.append(
      el(
        'p',
        'help',
        all.some(m => m.shared)
          ? 'Every right or wrong mark here has been shared.'
          : 'Nothing to share yet. Right and wrong marks can teach the weights; not-sure marks stay here.',
      ),
    );
    foot.append(close);
    dlg.showModal();
    return;
  }

  /* every field, with this batch's first mark as the example */
  const ex = list[0],
    row = toRow(ex, whoAmI()),
    sent: [string, string][] = [
      ['what each source said', `${Object.keys(row.readings).length} × 12 numbers`],
      ['right or wrong, and what was really there', `${row.verdict} · ${NAME[row.truth].toLowerCase()}`],
      ["Underfoot's call and how sure", `${NAME[row.call].toLowerCase()} ${Math.round(row.p_call * 100)}%`],
      ['how you know', row.how ? HOW[row.how] : 'not said'],
      ['the 1° cell it’s in', row.cell],
      ['the month, the app version', `${row.month} · ${VERSION}`],
      ['a random id for this browser', 'so one person counts as one'],
    ];
  const grid = el('div', 'fields'),
    col = (title: string, rows: HTMLElement[]) => {
      const c = el('div'),
        ul = el('ul');
      ul.append(...rows);
      c.append(el('span', 'lbl', title), ul);
      grid.append(c);
    },
    li = (yes: boolean, text: string, example?: string) => {
      const l = el('li');
      l.append(el('i', yes ? 'yes' : 'no', yes ? '✓' : '✗'), el('span', null, text));
      if (example) l.append(el('em', null, example));
      return l;
    };
  col(
    'Sent, for each mark',
    sent.map(([t, e]) => li(true, t, e)),
  );
  col(
    'Kept in this browser',
    KEPT.map(t => li(false, t)),
  );
  const opt = el('label', 'opt'),
    box = el('input');
  box.type = 'checkbox';
  box.id = 'sharePoints';
  opt.append(box, el('span', null, 'Also share the exact points, as public ground truth anyone can use.'));
  body.append(grid, opt);
  if (!on)
    body.append(
      el(
        'p',
        'help off',
        'Sharing switches on when the community store does. Until then, nothing leaves this browser: you can save the batch as a file, exactly as it would be sent.',
      ),
    );

  const go = el('button', 'btn pri', on ? `Share ${n} mark${n === 1 ? '' : 's'}` : `Save ${n} as a file`);
  go.onclick = async () => {
    const rows = list.map(m => toRow(m, whoAmI(), box.checked));
    if (!on) {
      download(
        `underfoot-share-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(rows, null, 1),
        'application/json',
      );
      dlg.close();
      return;
    }
    go.disabled = true;
    go.textContent = 'Sharing…';
    const r = await postRows(rows),
      t = Date.now(),
      done = new Set(r.ids);
    /* tag what's in the store, even when some of the batch didn't go */
    for (const m of list) if (done.has(m.id)) await saveMark({ ...m, shared: t });
    render();
    if (!r.ok) {
      toast(
        done.size
          ? `Shared ${done.size} of ${n}; the rest didn’t go (${r.status}). Try again later.`
          : `Couldn’t share (${r.status || 'no connection'}). Nothing is marked as shared; try again later.`,
      );
      dlg.close();
      return;
    }
    dlg.close();
    toast(`Shared ${n} mark${n === 1 ? '' : 's'}. Thank you.`);
  };
  foot.append(
    el('small', null, on ? 'Shared marks can’t be taken back' : 'Nothing leaves this browser'),
    close,
    go,
  );
  dlg.showModal();
  /* not the checkbox: a focus ring there reads as ticked */
  close.focus();
}

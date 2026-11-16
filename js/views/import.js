// Import a fresh member list (text from the Member List PDF or a member list page) and apply the
// differences to the Members tab after the bishopric reviews them.

import { formatDate } from '../dates.js';
import { parseMemberList, diffImport, makeId } from '../members.js';
import { h, clear, busy, toast } from '../ui.js';

export function renderImport(root, ctx) {
  const text = h('textarea', { rows: 8, placeholder: 'Paste the member list here (Name, Gender, Age on each line)…', 'aria-label': 'Member list text' });
  const file = h('input', { type: 'file', accept: '.txt,.csv,text/plain,text/csv', 'aria-label': 'Member list file' });
  file.addEventListener('change', () => {
    const f = file.files && file.files[0];
    if (!f) return;
    const reader = new FileReader(); // read on this device; nothing is uploaded except what you apply
    reader.onload = () => { text.value = String(reader.result || ''); };
    reader.readAsText(f);
  });
  const preview = h('div', {});
  const check = h('button', { text: 'Check list' });
  check.addEventListener('click', () => showPreview(preview, text.value, ctx));
  root.append(
    h('p', { class: 'hint', text: 'Do this every month or so. Open the Member List, copy all the text (or save it as a text file), and paste it here. You will see what changed before anything is saved.' }),
    text, h('div', { class: 'toolbar' }, file, check), preview);
}

function showPreview(preview, raw, ctx) {
  clear(preview);
  const parsed = parseMemberList(raw);
  if (!parsed.rows.length) {
    preview.append(h('p', { class: 'error', text: 'No member lines found. Each person\'s line should look like "Last, First   F   42".' }));
    return;
  }
  const minAge = Number(ctx.settings.minAge) || 8;
  const d = diffImport(ctx.store.records('Members'), parsed.rows, minAge);
  const countOk = parsed.declared === null || parsed.declared === parsed.rows.length;
  const today = ctx.today();
  const newChecks = d.added.map((a) => ({ a, box: h('input', { type: 'checkbox', checked: a.newToWard }) }));
  const movedChecks = d.missing.map((m) => ({ m, box: h('input', { type: 'checkbox', checked: true }) }));
  const backChecks = d.returned.map((m) => ({ m, box: h('input', { type: 'checkbox', checked: true }) }));
  const apply = h('button', { text: 'Apply changes' });
  apply.addEventListener('click', () => busy(apply, async () => {
    const source = `Member list import ${today}`;
    if (newChecks.length) {
      await ctx.store.add('Members', newChecks.map(({ a, box }) => ({
        id: makeId('m'), name: a.name, gender: a.gender, age: a.age, age_as_of: today, source, status: 'active',
        notes: box.checked ? `New to ward (first on member list ${formatDate(today)})` : '',
        category: box.checked ? 'ask_soon' : '', category_until: '', moved_in: box.checked ? today : '', last_in_list: today,
      })));
    }
    const changes = d.updates.map((u) => ({ id: u.member.id, fields: { age: u.age, age_as_of: today, last_in_list: today, ...(u.member.gender ? {} : { gender: u.gender }) } }));
    for (const { m, box } of backChecks) {
      const ch = changes.find((c) => c.id === m.id);
      if (box.checked && ch) ch.fields.status = 'active';
    }
    for (const { m, box } of movedChecks) {
      if (box.checked) changes.push({ id: m.id, fields: { status: 'moved', notes: [m.notes, `Not on member list ${formatDate(today)}`].filter(Boolean).join('; ') } });
    }
    if (changes.length) await ctx.store.update('Members', changes);
    toast('Member list applied');
    ctx.go('members');
  }).catch(() => {}));

  preview.append(
    h('h3', { text: 'What changed' }),
    h('p', { class: countOk ? 'summary' : 'error', text: `${parsed.rows.length} people read from the list${parsed.declared !== null ? ` (the list says ${parsed.declared})` : ''}.${countOk ? '' : ' These do not match: some lines were not understood. Check before applying.'}` }),
    h('ul', { class: 'plain' },
      h('li', { text: `${d.updates.length} already in the Sheet (ages will be refreshed)` }),
      h('li', { text: `${d.added.length} new, age ${minAge}+` }),
      h('li', { text: `${d.missing.length} in the Sheet but not on this list` }),
      d.returned.length ? h('li', { text: `${d.returned.length} marked moved but back on the list` }) : null,
      d.ignoredYoung ? h('li', { text: `${d.ignoredYoung} under ${minAge} not added` }) : null,
      d.duplicates.length ? h('li', { text: `${d.duplicates.length} duplicate lines skipped` }) : null),
    newChecks.length ? h('section', { class: 'sub' },
      h('h3', { text: 'New people' }),
      h('p', { class: 'hint', text: `Checked = new to the ward ("Ask soon"). People who are exactly ${minAge} probably just turned ${minAge}, so they start unchecked.` }),
      h('ul', { class: 'rows' }, newChecks.map(({ a, box }) => h('li', { class: 'row' }, h('label', { class: 'check' }, box, ` ${a.name} · ${a.gender} · ${a.age}`))))) : null,
    movedChecks.length ? h('section', { class: 'sub' },
      h('h3', { text: 'Not on this list' }),
      h('p', { class: 'hint', text: 'Checked = mark as moved. They stay in the Sheet for history.' }),
      h('ul', { class: 'rows' }, movedChecks.map(({ m, box }) => h('li', { class: 'row' }, h('label', { class: 'check' }, box, ` ${m.name}`))))) : null,
    backChecks.length ? h('section', { class: 'sub' },
      h('h3', { text: 'Back on the list' }),
      h('ul', { class: 'rows' }, backChecks.map(({ m, box }) => h('li', { class: 'row' }, h('label', { class: 'check' }, box, ` ${m.name} (mark active)`))))) : null,
    apply);
}

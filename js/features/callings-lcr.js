// Import screen for the LCR callings report: paste the report's text (or choose a .txt/.csv file),
// review what will change, then apply. Nothing is written to the Sheet until "Apply".

import { formatDate } from '../dates.js';
import { h, add, clear, busy, toast } from '../ui.js';
import { ORG_NAMES, OTHER } from './callings-orgs.js';
import { parseCallingsText, parseCallingsCsv, diffCallingsImport } from './callings-import.js';

export function renderLcrImport(root, ctx, { go }) {
  const text = h('textarea', { rows: 8, placeholder: 'Paste the LCR callings report here…', 'aria-label': 'Callings report text' });
  const file = h('input', { type: 'file', accept: '.txt,.csv,text/plain,text/csv', 'aria-label': 'Callings report file' });
  file.addEventListener('change', () => {
    const f = file.files && file.files[0];
    if (!f) return;
    const reader = new FileReader(); // read on this device
    reader.onload = () => { text.value = String(reader.result || ''); };
    reader.readAsText(f);
  });
  const preview = h('div', {});
  const check = h('button', { text: 'Check report' });
  check.addEventListener('click', () => showPreview(preview, text.value, ctx, go));
  add(root,
    h('p', { class: 'hint', text: 'In LCR, run the callings report that shows each person\'s callings with the date sustained and set apart (Yes/No). Copy all of its text and paste it here, or choose a text or CSV file (columns: name, calling, organization, sustained, set_apart). You will see every change before anything is saved.' }),
    text, h('div', { class: 'toolbar' }, file, check), preview);
}

function line(c) {
  return `${c.member_name || c.name} — ${c.calling}${c.sustained_on || c.sustained ? `, sustained ${formatDate(c.sustained_on || c.sustained)}` : ''}`;
}

function showPreview(preview, raw, ctx, go) {
  clear(preview);
  const members = ctx.store.records('Members');
  const firstLine = String(raw || '').split(/\r?\n/).find((l) => l.trim()) || '';
  const isCsv = /^\s*"?name"?\s*,/i.test(firstLine);
  const parsed = isCsv ? parseCallingsCsv(raw) : parseCallingsText(raw, members.map((m) => m.name).filter(Boolean));
  if (!parsed.rows.length) {
    add(preview, h('p', { class: 'error', text: 'No callings found. Each calling should look like "Primary Teacher (5 Nov 2023/No)", after the person\'s name.' }),
      parsed.issues.length ? h('ul', { class: 'plain' }, parsed.issues.slice(0, 20).map((i) => h('li', { text: i }))) : null);
    return;
  }
  const today = ctx.today();
  const d = diffCallingsImport(ctx.store.records('Callings'), members, parsed.rows, today);
  const countOk = parsed.declared === null || parsed.declared === parsed.people;
  const dupChecks = d.pageDuplicates.map((r) => ({ r, box: h('input', { type: 'checkbox' }) }));
  const goneChecks = d.notInReport.map((c) => ({ c, box: h('input', { type: 'checkbox' }) }));

  const byOrg = new Map();
  for (const a of d.add) {
    if (!byOrg.has(a.organization)) byOrg.set(a.organization, []);
    byOrg.get(a.organization).push(a);
  }
  const orgOrder = [...byOrg.keys()].sort((a, b) => (ORG_NAMES.indexOf(a) + 1 || 99) - (ORG_NAMES.indexOf(b) + 1 || 99));

  const apply = h('button', { text: 'Apply changes' });
  apply.addEventListener('click', () => busy(apply, async () => {
    const extra = dupChecks.filter((x) => x.box.checked).map((x) => ({ ...x.r, pageBreakDuplicate: false }));
    const adds = extra.length ? diffCallingsImport([...ctx.store.records('Callings'), ...d.add], members, extra, today).add : [];
    const newRows = [...d.add, ...adds].map((a) => ({ ...a, entered_by: ctx.settings.initials, entered_at: ctx.stamp() }));
    if (newRows.length) await ctx.store.add('Callings', newRows);
    const changes = d.update.map((u) => ({ id: u.calling.id, fields: u.fields }));
    for (const { c, box } of goneChecks) {
      if (box.checked) changes.push({ id: c.id, fields: { released_on: today, release_recorded_on: today, notes: [c.notes, `Not in LCR report ${formatDate(today)}; release date not known`].filter(Boolean).join('; ') } });
    }
    if (changes.length) await ctx.store.update('Callings', changes);
    toast(`Callings report applied: ${newRows.length} added, ${changes.length} updated`);
    go('orgchart');
  }).catch(() => {}));

  add(preview,
    h('h3', { text: 'What will change' }),
    h('p', { class: countOk ? 'summary' : 'error', text: `${parsed.rows.length} calling lines for ${parsed.people} people${parsed.declared !== null ? ` (the report says ${parsed.declared} people)` : ''}.${countOk ? '' : ' These do not match: check the lines not understood below.'}` }),
    h('ul', { class: 'plain' },
      h('li', { text: `${d.add.length} new callings to add (as sustained and recorded in LCR)` }),
      h('li', { text: `${d.update.length} callings already in the Sheet get dates filled in` }),
      h('li', { text: `${d.unchanged.length} already up to date` }),
      h('li', { text: `${d.notInReport.length} current callings in the Sheet are not in this report` }),
      d.unmatched.length ? h('li', { class: 'error', text: `${d.unmatched.length} lines with a name not in Members (not imported)` }) : null,
      d.pageDuplicates.length ? h('li', { text: `${d.pageDuplicates.length} lines repeated across a page break (left out unless you check them)` }) : null,
      parsed.issues.length ? h('li', { class: 'error', text: `${parsed.issues.length} lines not understood` }) : null),
    d.add.length ? h('section', { class: 'sub' }, h('h3', { text: 'New callings by organization' }),
      h('p', { class: 'hint', text: `The organization comes from the calling's name; anything not recognized goes to "${OTHER}". You can change it later on the calling's page. Set apart = Yes uses the sustained date, because the report has no set-apart date.` }),
      orgOrder.map((org) => h('details', { class: 'panel' }, h('summary', { text: `${org} (${byOrg.get(org).length})` }),
        h('ul', { class: 'rows' }, byOrg.get(org).map((a) => h('li', { class: 'row', text: `${line(a)}${a.set_apart_on ? ' · set apart' : ''}` })))))) : null,
    d.update.length ? h('section', { class: 'sub' }, h('h3', { text: 'Dates filled in' }),
      h('ul', { class: 'rows' }, d.update.map((u) => h('li', { class: 'row', text: `${line(u.calling)}: ${Object.keys(u.fields).map((k) => k.replace(/_on$/, '').replace(/_/g, ' ')).join(', ')}` })))) : null,
    dupChecks.length ? h('section', { class: 'sub' }, h('h3', { text: 'Repeated across a page break' }),
      h('p', { class: 'hint', text: 'The same line at the bottom of one page and the top of the next is usually printed twice. Check it only if the person really holds the calling twice.' }),
      h('ul', { class: 'rows' }, dupChecks.map(({ r, box }) => h('li', { class: 'row' }, h('label', { class: 'check' }, box, ` Include: ${line(r)}`))))) : null,
    goneChecks.length ? h('section', { class: 'sub' }, h('h3', { text: 'Not in this report' }),
      h('p', { class: 'hint', text: 'Check the ones that have been released. Today\'s date is used because the report does not say when.' }),
      h('ul', { class: 'rows' }, goneChecks.map(({ c, box }) => h('li', { class: 'row' }, h('label', { class: 'check' }, box, ` Mark released: ${line(c)}`))))) : null,
    d.unmatched.length ? h('section', { class: 'sub' }, h('h3', { text: 'Names not in Members' }),
      h('p', { class: 'hint', text: 'Add these people on the Members screen (or import a newer member list), then check the report again.' }),
      h('ul', { class: 'rows' }, d.unmatched.map((r) => h('li', { class: 'row', text: line(r) })))) : null,
    parsed.issues.length ? h('section', { class: 'sub' }, h('h3', { text: 'Lines not understood' }),
      h('ul', { class: 'rows' }, parsed.issues.map((i) => h('li', { class: 'row', text: i })))) : null,
    d.add.length || d.update.length || goneChecks.length || dupChecks.length ? apply : h('p', { class: 'summary', text: 'Nothing to change.' }));
}

// Members screen and the member page (categories, status, notes, plus each feature's sections).

import { formatDate } from '../dates.js';
import { CATEGORIES, STATUSES, categoryLabel, currentAge, ageGroup, isActive, makeId, normName } from '../members.js';
import { h, clear, field, select, busy, toast, openDialog } from '../ui.js';

const filters = { search: '', category: 'any' };

const CATEGORY_FILTERS = [
  { value: 'any', label: 'All active' },
  { value: 'ask_soon', label: 'Ask soon' },
  { value: 'not_now', label: 'Not now' },
  { value: 'do_not_ask', label: 'Do not ask' },
  { value: 'moved', label: 'Moved' },
];

function matches(m, f) {
  if (f.category === 'moved') return !isActive(m);
  if (!isActive(m)) return false;
  if (f.category !== 'any' && (m.category || '') !== f.category) return false;
  return !f.search || normName(m.name).includes(normName(f.search));
}

export function renderMembers(root, ctx) {
  const listEl = h('ul', { class: 'cards' });
  const countEl = h('p', { class: 'summary' });
  const draw = () => {
    const today = ctx.today();
    const shown = ctx.store.records('Members').filter((m) => m.id && matches(m, filters))
      .sort((a, b) => a.name.localeCompare(b.name));
    countEl.textContent = `${shown.length} ${shown.length === 1 ? 'person' : 'people'}`;
    clear(listEl);
    for (const m of shown) {
      const age = currentAge(m, today);
      const badges = [];
      if (m.category) badges.push(h('span', { class: `badge cat-${m.category}`, text: categoryLabel(m.category) + (m.category === 'not_now' && m.category_until ? ` until ${formatDate(m.category_until)}` : '') }));
      if (!isActive(m)) badges.push(h('span', { class: 'badge muted', text: 'Moved' }));
      listEl.append(h('li', {}, h('button', { class: 'card', onclick: () => openMember(m.id, ctx) },
        h('span', { class: 'card-top' }, h('span', { class: 'name', text: m.name }), badges),
        h('span', { class: 'meta', text: [age === null ? 'Age unknown' : `Age ${age}`, m.gender].filter(Boolean).join(' · ') }))));
    }
  };
  const search = h('input', { type: 'search', placeholder: 'Search name', value: filters.search, 'aria-label': 'Search name' });
  search.addEventListener('input', () => { filters.search = search.value; draw(); });
  const cat = select(CATEGORY_FILTERS, filters.category, { 'aria-label': 'Category' });
  cat.addEventListener('change', () => { filters.category = cat.value; draw(); });
  root.append(
    h('div', { class: 'toolbar' }, search, cat, h('button', { text: 'Add person', onclick: () => addPerson(ctx) })),
    h('p', { class: 'hint', text: 'Tap a name to set a category (Ask soon, Not now, Do not ask), mark someone as moved, or add a note.' }),
    countEl, listEl);
  draw();
}

export function openMember(id, ctx) {
  const m = ctx.store.records('Members').find((x) => x.id === id);
  if (!m) { toast('That person is not in the Members tab.', 'error'); return; }
  const today = ctx.today();
  openDialog(m.name, (close) => {
    const age = currentAge(m, today);
    const cat = select(CATEGORIES, m.category || '', { 'aria-label': 'Category' });
    const until = h('input', { type: 'date', value: m.category_until || '', 'aria-label': 'Not now until' });
    const untilField = field('Not now until', until, 'They come back on the list on this date. Leave empty to keep them off until you change it.');
    const showUntil = () => { untilField.hidden = cat.value !== 'not_now'; };
    cat.addEventListener('change', showUntil);
    showUntil();
    const status = select(STATUSES, m.status || 'active', { 'aria-label': 'Status' });
    const notes = h('textarea', { rows: 2, 'aria-label': 'Note' });
    notes.value = m.notes || '';
    const save = h('button', { text: 'Save' });
    save.addEventListener('click', () => busy(save, async () => {
      const fields = {
        category: cat.value,
        category_until: cat.value === 'not_now' ? until.value : '',
        status: status.value,
        notes: notes.value.trim(),
      };
      await ctx.store.update('Members', [{ id: m.id, fields }]);
      toast('Saved');
      close(); ctx.refresh();
    }).catch(() => {}));
    const sections = ctx.features.flatMap((f) => (f.memberSections ? f.memberSections(m, ctx, close) : []));
    return [
      h('p', { class: 'meta', text: [age === null ? 'Age unknown' : `Age ${age} (about)`, m.gender, ageGroup(age) === 'unknown' ? null : `group ${ageGroup(age)}`].filter(Boolean).join(' · ') }),
      m.moved_in ? h('p', { class: 'meta', text: `New to ward: first seen ${formatDate(m.moved_in)}` }) : null,
      h('p', { class: 'meta small', text: `Source: ${m.source || 'unknown'}` }),
      h('section', { class: 'sub' },
        h('h3', { text: 'Planning' }),
        field('Category', cat), untilField, field('Status', status), field('Note', notes, 'Visible to everyone with the Sheet. Keep it brief and kind.'),
        save),
      sections,
    ];
  });
}

function addPerson(ctx) {
  openDialog('Add person', (close) => {
    const name = h('input', { type: 'text', placeholder: 'Last, First', autocomplete: 'off', 'aria-label': 'Name' });
    const gender = select([{ value: '', label: '—' }, { value: 'F', label: 'F' }, { value: 'M', label: 'M' }], '', { 'aria-label': 'Gender' });
    const age = h('input', { type: 'number', min: 0, max: 120, step: 1, 'aria-label': 'Age' });
    const isNew = h('input', { type: 'checkbox', checked: true });
    const save = h('button', { text: 'Add' });
    save.addEventListener('click', () => busy(save, async () => {
      const n = name.value.trim().replace(/\s+/g, ' ');
      if (!/,/.test(n)) throw new Error('Enter the name as "Last, First".');
      if (ctx.store.records('Members').some((m) => normName(m.name) === normName(n))) throw new Error(`${n} is already in the list.`);
      const today = ctx.today();
      await ctx.store.add('Members', [{
        id: makeId('m'), name: n, gender: gender.value, age: age.value === '' ? '' : Number(age.value),
        age_as_of: age.value === '' ? '' : today, source: `Added in app ${today} (${ctx.settings.initials || 'unknown'})`,
        status: 'active', notes: '', category: isNew.checked ? 'ask_soon' : '', category_until: '',
        moved_in: isNew.checked ? today : '', last_in_list: '',
      }]);
      toast(`${n} added`);
      close(); ctx.refresh();
    }).catch(() => {}));
    return [
      field('Name', name), field('Gender', gender), field('Age', age, 'Optional'),
      h('label', { class: 'check' }, isNew, ' New to the ward (mark "Ask soon")'),
      save,
    ];
  });
}

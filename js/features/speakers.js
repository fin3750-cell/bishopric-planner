// Speaker planner feature: who to ask, upcoming talks, talk history, and the talk/decline parts of
// a member's page. Uses the Talks and Refusals tabs of the Sheet.

import { formatDate, formatMonth, nextSunday } from '../dates.js';
import { makeId, isTrue } from '../members.js';
import { h, clear, field, select, busy, toast } from '../ui.js';
import { buildAskList, upcomingTalks, pastTalks, talksFor, refusalsFor } from './speakers-logic.js';

const tables = {
  Talks: {
    columns: ['id', 'date', 'date_estimated', 'member_id', 'member_name', 'name_as_shown', 'ward_member',
      'source', 'entered_by', 'entered_at', 'notes', 'void'],
    dates: ['date'],
  },
  Refusals: {
    columns: ['id', 'date', 'member_id', 'member_name', 'note', 'entered_by', 'entered_at', 'void'],
    dates: ['date'],
  },
};

const filters = { group: 'all', gender: 'all', search: '' };

function lastTalkText(r) {
  if (!r.lastTalk) return 'No talk on record';
  return r.lastEstimated ? `Last talk about ${formatMonth(r.lastTalk)}` : `Last talk ${formatDate(r.lastTalk)}`;
}

function ageText(age, gender) {
  return [age === null ? 'Age unknown' : `Age ${age}`, gender || ''].filter(Boolean).join(' · ');
}

function renderAsk(root, ctx) {
  const listEl = h('ul', { class: 'cards', 'aria-live': 'polite' });
  const summaryEl = h('p', { class: 'summary' });
  const draw = () => {
    const res = buildAskList({
      members: ctx.store.records('Members'), talks: ctx.store.records('Talks'), refusals: ctx.store.records('Refusals'),
      today: ctx.today(), settings: ctx.settings, filters,
    });
    const hd = res.hidden;
    clear(summaryEl).append(
      h('strong', { text: `${res.rows.length} to consider` }),
      ` · not listed: ${hd.recent} spoke since ${formatMonth(res.cutoff)}, ${hd.scheduled} scheduled, ${hd.notNow} not now, ${hd.doNotAsk} do not ask, ${hd.moved} moved`);
    clear(listEl);
    if (!res.rows.length) listEl.append(h('li', { class: 'empty', text: 'No one matches these filters.' }));
    for (const r of res.rows) {
      const m = r.member;
      const badges = [];
      if (r.askSoon) badges.push(h('span', { class: 'badge soon', text: 'Ask soon' }));
      if (r.isNew) badges.push(h('span', { class: 'badge new', text: 'New to ward' }));
      if (r.declined) badges.push(h('span', { class: 'badge declined', text: `Declined ${formatDate(r.declined)}` }));
      listEl.append(h('li', {},
        h('button', {
          class: `card${r.askSoon ? ' is-soon' : ''}${r.declined ? ' is-declined' : ''}`,
          onclick: () => ctx.openMember(m.id),
        },
        h('span', { class: 'card-top' }, h('span', { class: 'name', text: m.name }), badges),
        h('span', { class: 'meta', text: `${ageText(r.age, m.gender)} · ${lastTalkText(r)}` }),
        m.notes ? h('span', { class: 'note', text: m.notes }) : null)));
    }
  };
  const search = h('input', { type: 'search', placeholder: 'Search name', value: filters.search, 'aria-label': 'Search name' });
  search.addEventListener('input', () => { filters.search = search.value; draw(); });
  const group = select([{ value: 'all', label: 'All ages' }, { value: '8-11', label: '8–11' }, { value: '12-17', label: '12–17' }, { value: '18+', label: '18+' }, { value: 'unknown', label: 'Age unknown' }], filters.group, { 'aria-label': 'Age group' });
  group.addEventListener('change', () => { filters.group = group.value; draw(); });
  const gender = select([{ value: 'all', label: 'Everyone' }, { value: 'F', label: 'Women & girls' }, { value: 'M', label: 'Men & boys' }], filters.gender, { 'aria-label': 'Gender' });
  gender.addEventListener('change', () => { filters.gender = gender.value; draw(); });
  root.append(
    h('div', { class: 'toolbar' }, search, group, gender),
    h('p', { class: 'hint', text: `Listed: no talk in the last ${ctx.settings.windowYears} years. "Ask soon" first, then no talk on record, then longest since their last talk. Tap a name to schedule a talk or record a decline.` }),
    summaryEl, listEl);
  draw();
}

function talkName(t) {
  return t.member_name || t.name_as_shown || '(no name)';
}

function voidTalk(ctx, t) {
  if (!window.confirm(`Remove the talk for ${talkName(t)} on ${formatDate(t.date)}? It stays in the Sheet, marked as removed.`)) return;
  ctx.store.update('Talks', [{ id: t.id, fields: { void: true } }])
    .then(() => { toast('Talk removed'); ctx.refresh(); })
    .catch((e) => ctx.fail(e));
}

function renderUpcoming(root, ctx) {
  const items = upcomingTalks(ctx.store.records('Talks'), ctx.today());
  root.append(h('p', { class: 'hint', text: 'Talks scheduled after today. Schedule someone from "Who to ask" or a member\'s page.' }));
  if (!items.length) { root.append(h('p', { class: 'empty', text: 'Nothing scheduled yet.' })); return; }
  let current = '';
  let ul = null;
  for (const t of items) {
    if (t.date !== current) {
      current = t.date;
      ul = h('ul', { class: 'rows' });
      root.append(h('h3', { class: 'date-head', text: formatDate(t.date) }), ul);
    }
    ul.append(h('li', { class: 'row' },
      t.member_id ? h('button', { class: 'link', text: talkName(t), onclick: () => ctx.openMember(t.member_id) }) : h('span', { text: talkName(t) }),
      h('button', { class: 'small secondary', text: 'Remove', onclick: () => voidTalk(ctx, t) })));
  }
}

function renderHistory(root, ctx) {
  const all = pastTalks(ctx.store.records('Talks'), ctx.today());
  const name = h('input', { type: 'text', placeholder: 'Visitor name', 'aria-label': 'Visitor name', autocomplete: 'off' });
  const date = h('input', { type: 'date', value: ctx.lastSunday(), 'aria-label': 'Date' });
  const add = h('button', { text: 'Add visitor talk' });
  add.addEventListener('click', () => busy(add, async () => {
    if (!name.value.trim() || !date.value) throw new Error('Enter the visitor\'s name and the date.');
    await ctx.store.add('Talks', [{
      id: makeId('t'), date: date.value, date_estimated: false, member_id: '', member_name: '',
      name_as_shown: name.value.trim(), ward_member: false, source: 'app', entered_by: ctx.settings.initials,
      entered_at: ctx.stamp(), notes: 'visitor',
    }]);
    toast('Visitor talk added');
    ctx.refresh();
  }).catch(() => {}));
  root.append(
    h('details', { class: 'panel' }, h('summary', { text: 'Add a talk by a visitor (stake, missionary, etc.)' }),
      h('div', { class: 'inline-form' }, name, date, add)),
    h('p', { class: 'hint', text: '≈ means the date is an estimate from the WardBullet import.' }));
  let current = '';
  let ul = null;
  for (const t of all) {
    if (t.date !== current) {
      current = t.date;
      ul = h('ul', { class: 'rows' });
      root.append(h('h3', { class: 'date-head', text: `${isTrue(t.date_estimated) ? '≈ ' : ''}${formatDate(t.date)}` }), ul);
    }
    const visitor = !isTrue(t.ward_member);
    ul.append(h('li', { class: 'row' },
      t.member_id ? h('button', { class: 'link', text: talkName(t), onclick: () => ctx.openMember(t.member_id) }) : h('span', { text: talkName(t) }),
      visitor ? h('span', { class: 'badge muted', text: t.notes && /meeting item/.test(t.notes) ? 'meeting item' : 'visitor' }) : null,
      h('button', { class: 'small secondary', text: 'Remove', onclick: () => voidTalk(ctx, t) })));
  }
}

// Talk and decline sections on a member's page.
function memberSections(m, ctx, close) {
  const today = ctx.today();
  const talks = talksFor(m.id, ctx.store.records('Talks'));
  const declines = refusalsFor(m.id, ctx.store.records('Refusals'));
  const talkDate = h('input', { type: 'date', value: nextSunday(today), 'aria-label': 'Talk date' });
  const talkBtn = h('button', { text: 'Record talk' });
  talkBtn.addEventListener('click', () => busy(talkBtn, async () => {
    if (!talkDate.value) throw new Error('Choose the date of the talk.');
    await ctx.store.add('Talks', [{
      id: makeId('t'), date: talkDate.value, date_estimated: false, member_id: m.id, member_name: m.name,
      name_as_shown: m.name, ward_member: true, source: 'app', entered_by: ctx.settings.initials, entered_at: ctx.stamp(), notes: '',
    }]);
    toast(talkDate.value > today ? `Scheduled for ${formatDate(talkDate.value)}` : 'Talk recorded');
    close(); ctx.refresh();
  }).catch(() => {}));
  const decDate = h('input', { type: 'date', value: today, 'aria-label': 'Decline date' });
  const decNote = h('input', { type: 'text', placeholder: 'Note (optional)', 'aria-label': 'Decline note' });
  const decBtn = h('button', { class: 'warn', text: 'Record decline' });
  decBtn.addEventListener('click', () => busy(decBtn, async () => {
    if (!decDate.value) throw new Error('Choose the date they declined.');
    await ctx.store.add('Refusals', [{
      id: makeId('r'), date: decDate.value, member_id: m.id, member_name: m.name, note: decNote.value.trim(),
      entered_by: ctx.settings.initials, entered_at: ctx.stamp(),
    }]);
    toast('Decline recorded');
    close(); ctx.refresh();
  }).catch(() => {}));
  const voidRefusal = (r) => {
    if (!window.confirm(`Remove the decline on ${formatDate(r.date)}?`)) return;
    ctx.store.update('Refusals', [{ id: r.id, fields: { void: true } }])
      .then(() => { toast('Decline removed'); close(); ctx.refresh(); })
      .catch((e) => ctx.fail(e));
  };
  return [
    h('section', { class: 'sub' },
      h('h3', { text: 'Talks' }),
      talks.length
        ? h('ul', { class: 'rows' }, talks.map((t) => h('li', { class: 'row' },
          h('span', { text: `${isTrue(t.date_estimated) ? '≈ ' : ''}${formatDate(t.date)}${t.date > today ? ' (scheduled)' : ''}` }),
          h('button', { class: 'small secondary', text: 'Remove', onclick: () => { close(); voidTalk(ctx, t); } }))))
        : h('p', { class: 'empty', text: 'No talks on record.' }),
      h('div', { class: 'inline-form' }, field('Date', talkDate, 'A future date schedules the talk.'), talkBtn)),
    h('section', { class: 'sub' },
      h('h3', { text: 'Declines' }),
      declines.length
        ? h('ul', { class: 'rows' }, declines.map((r) => h('li', { class: 'row' },
          h('span', { text: `${formatDate(r.date)}${r.note ? ` — ${r.note}` : ''}` }),
          h('button', { class: 'small secondary', text: 'Remove', onclick: () => voidRefusal(r) }))))
        : h('p', { class: 'empty', text: 'No declines recorded.' }),
      h('div', { class: 'inline-form' }, field('Date', decDate), field('Note', decNote), decBtn)),
  ];
}

export const speakers = {
  id: 'speakers',
  tables,
  views: [
    { id: 'ask', label: 'Who to ask', render: renderAsk },
    { id: 'upcoming', label: 'Upcoming', render: renderUpcoming },
    { id: 'history', label: 'History', render: renderHistory },
  ],
  memberSections,
};

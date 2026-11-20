// Calendar feature: one dated list of events added by hand, the stake calendar (read live from the
// stake's own Sheet), scheduled speakers, to-do due dates and fast Sundays; and a Stake screen with
// the stake presidency, high council, stake callings and bishops from the same Sheet.
// The stake Sheet is only read, never written. Its link is a shared setting (Settings tab), so a new
// year's sheet is a new link pasted on the Settings screen, not a code change.

import { formatDate } from '../dates.js';
import { makeId } from '../members.js';
import { SheetsApi, quoteTab, spreadsheetIdFrom } from '../sheets.js';
import { currentToken } from '../auth.js';
import { h, add, field, select, busy, toast, openDialog } from '../ui.js';
import { EVENT_COLUMNS, calendarItems, monthNotes, formatTime, comingUpRange, comingUpText } from './calendar-logic.js';
import { readStakeSheet, hcVisits, wardKey } from './stake-parse.js';

const tables = { Events: { columns: EVENT_COLUMNS, dates: ['date'] } };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const view = { months: 6, otherWards: false, range: 'month' };

// ---------- the stake Sheet, read once per session (or on Reload) ----------

const stake = { id: '', title: '', tabs: null, error: '', loadedAt: '', loading: null };

export function stakeId(ctx) { return spreadsheetIdFrom(ctx.shared.get('stake_sheet')); }
export function wardNames(ctx) { return ctx.shared.get('stake_ward').split(',').map((s) => s.trim()).filter(Boolean); }

export function loadStake(ctx, force = false) {
  const id = stakeId(ctx);
  if (!id || stake.loading) return;
  if (!force && stake.id === id && (stake.tabs || stake.error)) return;
  stake.loading = (async () => {
    try {
      const api = new SheetsApi(id, currentToken);
      const info = await api.info();
      const values = await api.batchGet(info.tabs.map((t) => `${quoteTab(t.title)}!A1:Z`));
      Object.assign(stake, { id, title: info.title, tabs: info.tabs.map((t, i) => ({ title: t.title, rows: values[i] || [] })), error: '', loadedAt: ctx.stamp() });
    } catch (e) {
      Object.assign(stake, { id, title: '', tabs: null, error: e.message || String(e), loadedAt: ctx.stamp() });
    } finally {
      stake.loading = null;
      ctx.refresh();
    }
  })();
}

// The parsed stake Sheet for this ward, or null while loading / when there is none.
export function stakeData(ctx) {
  if (!stakeId(ctx) || stake.id !== stakeId(ctx) || !stake.tabs) return null;
  return readStakeSheet(stake.tabs, wardNames(ctx));
}

function stakeStatus(ctx) {
  const id = stakeId(ctx);
  if (!id) {
    return h('div', { class: 'panel' }, h('p', { text: 'Add the stake calendar Sheet\'s link on the Settings screen to see stake events and the stake directory.' }),
      h('a', { class: 'button', href: '#settings', text: 'Open Settings' }));
  }
  if (stake.loading || stake.id !== id) { loadStake(ctx); return h('p', { class: 'summary', text: 'Reading the stake Sheet…' }); }
  const reload = h('button', { class: 'small secondary', text: 'Reload stake Sheet', onclick: () => { loadStake(ctx, true); ctx.refresh(); } });
  if (stake.error) {
    return h('div', { class: 'panel' }, h('p', { class: 'error', text: `Could not read the stake Sheet: ${stake.error}` }),
      h('p', { class: 'hint', text: 'Everyone who uses this needs at least view access to the stake Sheet. Ask whoever keeps it to share it with your Google account.' }), reload);
  }
  const data = stakeData(ctx);
  const noWard = !wardNames(ctx).length;
  return h('div', { class: 'stake-status' },
    h('p', { class: 'hint' }, `Stake Sheet: ${stake.title || 'untitled'}`, data.updated.length ? ` · ${data.updated.join(' · ')}` : '', ` · read ${stake.loadedAt.slice(11)} `, reload),
    noWard ? h('p', { class: 'error', text: 'Add how the stake Sheet writes your ward (for example MS6) on the Settings screen to see your ward\'s events and assignments.' }) : null,
    data.problems.length ? h('details', { class: 'problems' }, h('summary', { text: `${data.problems.length} ${data.problems.length === 1 ? 'line' : 'lines'} in the stake Sheet could not be read as expected` }),
      h('ul', { class: 'plain' }, data.problems.map((p) => h('li', { text: p })))) : null);
}

// ---------- Calendar screen ----------

function monthStart(iso) { return `${iso.slice(0, 7)}-01`; }
export function monthEnd(y, m) { return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); }
function dayLabel(iso) { const d = new Date(`${iso}T00:00:00Z`); return `${DAYS[d.getUTCDay()]} ${formatDate(iso)}`; }

const BADGE = {
  fast: ['soon', 'Fast Sunday'], speakers: ['new', 'Speakers'], event: ['new', 'Ward'], ward: ['soon', 'Our ward'],
  stake: ['muted', 'Stake'], other: ['plain', 'Other ward'], todo: ['declined', 'To-do'],
};

function itemRow(ctx, it) {
  const [cls, label] = BADGE[it.kind];
  const time = formatTime(it.time);
  let body;
  if (it.kind === 'speakers') {
    body = h('span', {}, it.people.map((p, i) => [i ? ', ' : '', p.member_id
      ? h('button', { class: 'link', text: p.name, onclick: () => ctx.openMember(p.member_id) }) : p.name]));
  } else {
    body = h('span', {}, h('strong', { text: it.title }), it.location ? h('span', { class: 'cal-loc', text: ` · ${it.location}` }) : null, it.who ? ` · ${it.who}` : '');
  }
  let actions = null;
  // Items added by hand (or from a WardBullet program) can be fixed or removed. The limited app
  // may change only the items its person added. Stake events come from the stake's Sheet: fixed there.
  if (it.kind === 'event' && (!ctx.limited() || String(it.ref.entered_by || '') === String(ctx.who() || ''))) {
    const edit = h('button', { class: 'small secondary', text: 'Edit', onclick: () => eventDialog(ctx, it) });
    const remove = h('button', { class: 'small secondary', text: 'Remove' });
    remove.addEventListener('click', () => {
      if (!window.confirm(`Remove "${it.title}" on ${formatDate(it.date)}? It stays in the Sheet, marked as removed.`)) return;
      busy(remove, async () => { await ctx.store.update('Events', [{ id: it.ref.id, fields: { void: true } }]); toast('Event removed'); ctx.refresh(); }).catch(() => {});
    });
    actions = h('span', { class: 'cal-actions' }, edit, remove);
  }
  return h('li', { class: `row cal-item kind-${it.kind}` },
    h('span', { class: 'cal-main' }, h('span', { class: `badge ${cls}`, text: label }), time ? h('span', { class: 'cal-time', text: time }) : null, body,
      it.notes ? h('span', { class: 'note', text: it.notes }) : null),
    actions);
}

// Add a calendar item, or (with `it`, an item from calendarItems) fix one: the same row is changed
// in place, found by its id; who added it and when stay as they were.
function eventDialog(ctx, it = null) {
  openDialog(it ? 'Edit calendar item' : 'Add a calendar item', (close) => {
    const date = h('input', { type: 'date', value: it ? it.date : ctx.today(), 'aria-label': 'Event date' });
    const time = h('input', { type: 'time', value: it ? it.time : '', 'aria-label': 'Event time' });
    // autocomplete off: the browser should not offer earlier entries (a location typed once is not a default).
    const title = h('input', { type: 'text', value: it ? it.title : '', placeholder: 'e.g. Ward Christmas party', autocomplete: 'off', 'aria-label': 'Event title' });
    const location = h('input', { type: 'text', value: it ? it.location || '' : '', placeholder: 'Optional, e.g. the church', autocomplete: 'off', 'aria-label': 'Event location' });
    const notes = h('input', { type: 'text', value: it ? it.notes : '', placeholder: 'Optional', autocomplete: 'off', 'aria-label': 'Event notes' });
    const save = h('button', { text: it ? 'Save changes' : 'Add to calendar' });
    save.addEventListener('click', () => busy(save, async () => {
      if (!date.value || !title.value.trim()) throw new Error('Enter the date and what it is.');
      const fields = { date: date.value, time: time.value, title: title.value.trim(), location: location.value.trim(), notes: notes.value.trim() };
      if (it) await ctx.store.update('Events', [{ id: it.ref.id, fields }]);
      else await ctx.store.add('Events', [{ id: makeId('ev'), ...fields, entered_by: ctx.who(), entered_at: ctx.stamp() }]);
      toast(`${it ? 'Saved' : 'Added'}: ${fields.title}, ${formatDate(fields.date)}`);
      close(); ctx.refresh();
    }).catch(() => {}));
    return [field('Date', date), field('Time (optional)', time), field('What', title), field('Location (optional)', location), field('Notes (optional)', notes), save];
  });
}

// "Coming up": general ward information to copy into the bulletin or a correlation agenda: the
// ward's own items and stake events (stake-wide and the ward's), not other wards' events, fast
// Sundays, high council notes, speakers or to-dos.
function comingUp(ctx, data) {
  const { from, to } = comingUpRange(ctx.today(), view.range);
  const items = calendarItems({
    from, to, stake: data, otherWards: false, events: ctx.store.records('Events'),
    talks: ctx.limited() ? [] : ctx.store.records('Talks'), todos: ctx.limited() ? [] : ctx.store.records('Tasks'),
  });
  const text = comingUpText({ items, include: { events: true } });
  const range = select([{ value: 'month', label: 'Next month' }, { value: 'weeks2', label: 'Next 2 weeks' }, { value: 'nextMonth', label: 'Next calendar month' }],
    view.range, { 'aria-label': 'Coming up dates' });
  range.addEventListener('change', () => { view.range = range.value; ctx.refresh(); });
  const lines = text ? text.split('\n').length : 0;
  const area = h('textarea', { readonly: true, rows: Math.min(14, Math.max(3, lines)), 'aria-label': 'Coming up text' });
  area.value = text || 'Nothing on the calendar for these dates.';
  const copy = h('button', { text: 'Copy', disabled: !text });
  copy.addEventListener('click', () => {
    const done = () => toast(`Copied ${lines} ${lines === 1 ? 'line' : 'lines'}`);
    const manual = () => { area.focus(); area.select(); toast('Select the text and copy it from the box.', 'error'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, manual);
    else manual();
  });
  return h('section', { class: 'panel coming-up' },
    h('h3', { text: `Coming up: ${formatDate(from)} to ${formatDate(to)}` }),
    h('div', { class: 'toolbar' }, range, copy),
    area,
    h('p', { class: 'hint', text: 'Ward and stake events, one line per item, ready to paste into the bulletin or a correlation agenda. Other wards\' events are left out.' }));
}

function renderCalendar(root, ctx) {
  const today = ctx.today();
  const from = monthStart(today);
  const [fy, fm] = from.split('-').map(Number);
  const endM = fm - 1 + view.months;
  const to = monthEnd(fy + Math.floor((endM - 1) / 12), ((endM - 1) % 12) + 1);
  const data = stakeData(ctx);
  const items = calendarItems({
    from, to, stake: data, otherWards: view.otherWards, events: ctx.store.records('Events'),
    talks: ctx.limited() ? [] : ctx.store.records('Talks'), todos: ctx.limited() ? [] : ctx.store.records('Tasks'),
  });
  const notes = monthNotes({ from, to, stake: data });
  const other = h('input', { type: 'checkbox', checked: view.otherWards, 'aria-label': 'Show other wards\' stake events' });
  other.addEventListener('change', () => { view.otherWards = other.checked; ctx.refresh(); });
  add(root,
    h('div', { class: 'toolbar' }, h('button', { text: 'Add item', onclick: () => eventDialog(ctx) })),
    stakeStatus(ctx),
    comingUp(ctx, data),
    h('h3', { class: 'stage-head', text: 'Calendar' }),
    h('div', { class: 'toolbar' }, h('label', { class: 'check' }, other, 'Other wards\' stake events')),
    h('p', { class: 'hint', text: 'Your items, the stake calendar, scheduled speakers, to-do due dates and fast Sundays, from the start of this month. Stake events come from the stake\'s own Sheet each time the app opens.' }));
  for (let i = 0; i < view.months; i++) {
    const y = fy + Math.floor((fm - 1 + i) / 12);
    const m = ((fm - 1 + i) % 12) + 1;
    const key = `${y}-${String(m).padStart(2, '0')}`;
    const its = items.filter((it) => it.date.startsWith(key));
    const ns = notes.filter((n) => n.year === y && n.month === m);
    const days = [...new Set(its.map((it) => it.date))];
    root.append(h('section', { class: 'cal-month' },
      h('h3', { class: 'stage-head', text: `${MONTHS[m - 1]} ${y}` }),
      ns.length ? h('ul', { class: 'month-notes' }, ns.map((n) => h('li', {}, h('span', { class: `badge ${n.kind === 'hc' ? 'new' : 'soon'}`, text: n.kind === 'hc' ? 'High council' : 'Assignment' }), ` ${n.text}`))) : null,
      days.length ? days.map((d) => [h('h4', { class: `date-head${d < today ? ' past' : ''}`, text: dayLabel(d) }), h('ul', { class: 'rows' }, its.filter((it) => it.date === d).map((it) => itemRow(ctx, it)))])
        : h('p', { class: 'empty', text: 'Nothing on the calendar.' })));
  }
  root.append(h('button', { class: 'secondary', text: 'Show 6 more months', onclick: () => { view.months += 6; ctx.refresh(); } }));
}

// ---------- Stake screen ----------

function contact(p) {
  const tel = String(p.phone || '').replace(/[^\d+]/g, '');
  return [
    tel ? h('a', { class: 'contact', href: `tel:${tel}`, text: p.phone }) : null,
    p.email ? h('a', { class: 'contact', href: `mailto:${p.email}`, text: p.email }) : null,
  ];
}

function personCard(p, extra = []) {
  return h('li', { class: 'person' },
    h('span', { class: 'card-top' }, h('span', { class: 'name', text: p.name }), extra[0] || null),
    h('span', { class: 'meta', text: [p.calling, p.ward].filter(Boolean).join(' · ') }),
    p.assignment ? h('span', { class: 'meta', text: `Assignments: ${p.assignment}` }) : null,
    extra.slice(1),
    h('span', { class: 'contacts' }, contact(p)));
}

function renderStake(root, ctx) {
  add(root, stakeStatus(ctx));
  const data = stakeData(ctx);
  if (!data) return;
  const keys = data.wardKeys;
  const ours = (ward) => keys.includes(wardKey(ward));
  const visits = hcVisits(data);
  const monthName = (v) => `${MONTHS[v.month - 1].slice(0, 3)} ${v.year}`;
  const presidency = data.leaders.filter((p) => !/high council/i.test(p.calling));
  const council = data.leaders.filter((p) => /high council/i.test(p.calling));
  const speaksHere = (name) => visits.filter((v) => v.name === name);
  add(root,
    keys.length ? h('section', { class: 'sub' }, h('h3', { text: 'Our ward' }),
      h('ul', { class: 'plain' },
        council.filter((p) => ours(p.ward)).map((p) => h('li', { text: `Assigned high councilor: ${p.name}` })),
        [...visits.map((v) => ({ ...v, text: `${v.name} speaks${v.topic ? ` (${v.topic})` : ''}` })),
          ...data.turns.map((t) => ({ ...t, text: `${t.what}${t.who ? ` (${t.who})` : ''}` }))]
          .sort((a, b) => a.year - b.year || a.month - b.month)
          .map((x) => h('li', { text: `${monthName(x)}: ${x.text}` })))) : null,
    h('section', { class: 'sub' }, h('h3', { text: `Stake presidency and clerks (${presidency.length})` }), h('ul', { class: 'people' }, presidency.map((p) => personCard(p)))),
    h('section', { class: 'sub' }, h('h3', { text: `High council (${council.length})` }), h('ul', { class: 'people' }, council.map((p) => personCard(p, [
      ours(p.ward) ? h('span', { class: 'badge soon', text: 'Our ward' }) : null,
      speaksHere(p.name).length ? h('span', { class: 'meta', text: `Speaks in our ward: ${speaksHere(p.name).map(monthName).join(', ')}` }) : null,
    ])))),
    data.stakeCallings.length ? h('section', { class: 'sub' }, h('h3', { text: `Stake organizations (${data.stakeCallings.length})` }), h('ul', { class: 'people' }, data.stakeCallings.map((p) => personCard(p)))) : null,
    data.bishops.length ? h('section', { class: 'sub' }, h('h3', { text: `Bishops (${data.bishops.length})` }), h('ul', { class: 'people' }, data.bishops.map((p) => personCard({ ...p, calling: '' }, [ours(p.ward) ? h('span', { class: 'badge soon', text: 'Our ward' }) : null])))) : null);
}

// ---------- Settings: the stake Sheet ----------

function settingsSections(ctx) {
  const link = h('input', { type: 'url', value: ctx.shared.get('stake_sheet'), placeholder: 'https://docs.google.com/spreadsheets/d/…', 'aria-label': 'Stake Sheet link' });
  const ward = h('input', { type: 'text', value: ctx.shared.get('stake_ward'), placeholder: 'e.g. MS6', 'aria-label': 'Our ward in the stake Sheet' });
  const save = h('button', { class: 'secondary', text: 'Save for everyone' });
  save.addEventListener('click', () => busy(save, async () => {
    const v = link.value.trim();
    if (v && !spreadsheetIdFrom(v)) throw new Error('Paste the full link to the stake\'s Google Sheet.');
    await ctx.shared.set('stake_sheet', v);
    await ctx.shared.set('stake_ward', ward.value.trim());
    stake.id = '';   // read it again with the new link
    toast('Stake Sheet saved for everyone');
    ctx.refresh();
  }).catch(() => {}));
  return [h('section', { class: 'sub' },
    h('h3', { text: 'Stake calendar Sheet' }),
    h('p', { class: 'hint', text: 'The stake\'s yearly Sheet (calendar, high council, stake directory). The app only reads it. When the next year\'s Sheet comes out, paste its link here; if the stake adds the new year to the same Sheet, nothing needs to change. Saved in the planner Sheet, so it is the same for everyone.' }),
    field('Stake Sheet link', link), field('Our ward in the stake Sheet', ward, 'How the stake Sheet writes your ward, for example MS6. Separate more than one with commas.'),
    save)];
}

export const calendarFeature = {
  id: 'calendar',
  group: 'Calendar',
  tables,
  views: [
    { id: 'calendar', label: 'Calendar', title: 'Calendar', limited: true, render: renderCalendar },
    { id: 'stake', label: 'Stake', title: 'Stake directory', limited: true, render: renderStake },
  ],
  settingsSections,
};

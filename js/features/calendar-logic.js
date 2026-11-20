// Pure rules for the Calendar: fast Sundays, and one dated list from events added by hand, the stake
// calendar, scheduled speakers and to-do due dates, plus month notes (high council speaker, the
// ward's stake assignments).

import { addDays, addMonths } from '../dates.js';
import { isTrue, displayName } from '../members.js';
import { timeOf, hcVisits } from './stake-parse.js';

export const EVENT_COLUMNS = ['id', 'date', 'time', 'title', 'location', 'notes', 'entered_by', 'entered_at', 'void'];

const pad = (n) => String(n).padStart(2, '0');

function firstSunday(y, m) {
  const first = `${y}-${pad(m)}-01`;
  const dow = new Date(`${first}T00:00:00Z`).getUTCDay();
  return addDays(first, (7 - dow) % 7);
}

// Fast Sunday, as the bishop described the ward's practice (not a handbook rule): the first Sunday
// of the month. In April and October that Sunday is General Conference, so it is the second Sunday.
// It also moves a week when the stake calendar shows General Conference or stake conference on it.
export function fastSundays(fromISO, toISO, stakeEvents = []) {
  const out = [];
  let [y, m] = fromISO.split('-').map(Number);
  const [ty, tm] = toISO.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    let date = firstSunday(y, m);
    let moved = '';
    const clash = stakeEvents.find((e) => e.date === date && /general conference|stake conference/i.test(e.title));
    if (m === 4 || m === 10 || (clash && /general conference/i.test(clash.title))) moved = 'General Conference';
    else if (clash) moved = 'stake conference';
    if (moved) date = addDays(date, 7);
    if (date >= fromISO && date <= toISO) out.push({ date, moved });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

// kind: event (added by hand) | ward (stake event for this ward) | stake | other (another ward's) |
// speakers | todo | fast. Sorted by date, then items without a time, then by time.
const KIND_ORDER = ['fast', 'speakers', 'event', 'ward', 'stake', 'other', 'todo'];

export function calendarItems({ from, to, events = [], stake = null, talks = [], todos = [], otherWards = false }) {
  const inRange = (d) => d && d >= from && d <= to;
  const items = [];
  for (const e of events) {
    if (isTrue(e.void) || !inRange(e.date) || !String(e.title || '').trim()) continue;
    items.push({ kind: 'event', date: e.date, time: timeOf(e.time), title: String(e.title).trim(), location: String(e.location || '').trim(), notes: String(e.notes || '').trim(), ref: e });
  }
  const keys = stake ? stake.wardKeys || [] : [];
  for (const e of stake ? stake.events : []) {
    if (!inRange(e.date)) continue;
    const kind = !e.ward ? 'stake' : keys.includes(e.ward) ? 'ward' : 'other';
    if (kind === 'other' && !otherWards) continue;
    items.push({ kind, date: e.date, time: e.time, title: e.title, notes: e.notes, ward: e.ward });
  }
  const byDate = new Map();
  for (const t of talks) {
    if (isTrue(t.void) || !inRange(t.date)) continue;
    if (!byDate.has(t.date)) byDate.set(t.date, []);
    byDate.get(t.date).push({ name: t.member_name || t.name_as_shown || '(no name)', member_id: t.member_id || '' });
  }
  for (const [date, people] of byDate) items.push({ kind: 'speakers', date, time: '', title: 'Speakers', people, notes: '' });
  for (const t of todos) {
    if (isTrue(t.void) || t.done_on || !inRange(t.due_on) || !String(t.description || '').trim()) continue;
    items.push({ kind: 'todo', date: t.due_on, time: '', title: String(t.description).trim(), who: String(t.assigned_to || '').toUpperCase(), notes: '' });
  }
  for (const f of fastSundays(from, to, stake ? stake.events : [])) {
    items.push({ kind: 'fast', date: f.date, time: '', title: 'Fast Sunday', notes: f.moved ? `Second Sunday: the first Sunday is ${f.moved}.` : '' });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || (a.time ? 1 : 0) - (b.time ? 1 : 0) ||
    a.time.localeCompare(b.time) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

// Month notes from the stake sheet: the high council speaker for the ward (with the topic) and the
// ward's turns (rehab sacrament, hospital blessings). [{ year, month, kind, text, phone }]
export function monthNotes({ from, to, stake }) {
  if (!stake) return [];
  const key = (y, m) => `${y}-${pad(m)}`;
  const lo = from.slice(0, 7);
  const hi = to.slice(0, 7);
  const out = [];
  for (const v of hcVisits(stake)) {
    out.push({ year: v.year, month: v.month, kind: 'hc', text: `High council speaker: ${v.name}${v.topic ? `. Topic: ${v.topic}` : ''}`, phone: v.phone });
  }
  for (const t of stake.turns) out.push({ year: t.year, month: t.month, kind: 'turn', text: `${t.what}${t.who ? ` (${t.who})` : ''}`, phone: '' });
  return out.filter((n) => key(n.year, n.month) >= lo && key(n.year, n.month) <= hi)
    .sort((a, b) => a.year - b.year || a.month - b.month || a.kind.localeCompare(b.kind));
}

// "19:00" -> "7:00 PM"
export function formatTime(t) {
  const m = String(t || '').match(/^(\d{2}):(\d{2})$/);
  if (!m) return '';
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

// ---------- "Coming up": a plain-text list to paste into the bulletin or a correlation agenda ----------

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = MONTH_NAMES.map((m) => m.slice(0, 3));
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// range: 'month' = today to the same date next month; 'weeks2' = today and the next 14 days;
// 'nextMonth' = the whole next calendar month.
export function comingUpRange(today, range = 'month') {
  if (range === 'weeks2') return { from: today, to: addDays(today, 14) };
  if (range === 'nextMonth') {
    const first = `${addMonths(`${today.slice(0, 7)}-01`, 1).slice(0, 7)}-01`;
    return { from: first, to: addDays(addMonths(first, 1), -1) };
  }
  return { from: today, to: addMonths(today, 1) };
}

function shortDay(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return `${DAY[new Date(`${iso}T00:00:00Z`).getUTCDay()]}, ${MON[m - 1]} ${d}`;
}

// include: { events, fast, notes, speakers, todos } (true = listed). Other wards' events never are.
// One line per item, in date order; month notes (high council speaker, assignments) first.
export function comingUpText({ items, notes = [], include }) {
  const lines = [];
  if (include.notes) for (const n of notes) lines.push(`${MONTH_NAMES[n.month - 1]}: ${n.text}`);
  for (const it of items) {
    const group = { event: 'events', ward: 'events', stake: 'events', fast: 'fast', speakers: 'speakers', todo: 'todos' }[it.kind];
    if (!group || !include[group]) continue;
    const when = `${shortDay(it.date)}${it.time ? `, ${formatTime(it.time)}` : ''}`;
    let what;
    if (it.kind === 'speakers') what = `Speakers: ${it.people.map((p) => displayName(p.name)).join(', ')}`;
    else if (it.kind === 'todo') what = `${it.title}${it.who ? ` (${it.who})` : ''}`;
    else {
      // "MS6 - Ward Conference" reads "Ward Conference" in the ward's own bulletin.
      const title = it.kind === 'ward' ? it.title.replace(/^[A-Z]{2,3}\s?\d?\s*-\s+/, '') : it.title;
      // Notes saying where an item came from ("From the WardBullet program of …") are not for the bulletin.
      const note = it.kind !== 'fast' && it.notes && !/^From the WardBullet program\b/i.test(it.notes) ? it.notes : '';
      // "Ward Christmas Party, Stake Center (Bring a side dish)": the location only when one was entered.
      what = `${title}${it.location ? `, ${it.location}` : ''}${note ? ` (${note})` : ''}`;
    }
    lines.push(`${when}: ${what}`);
  }
  return lines.join('\n');
}

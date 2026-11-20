// Pure rules for the monthly update email (Calendar > "<ward> Update Email", bishopric only):
// reading the monthly topics document the bishopric writes (pasted from Google Docs), and putting
// the month's topics, calendar items and a short message into a subject line and plain-text body.

import { isTrue } from '../members.js';
import { addMonths } from '../dates.js';
import { comingUpText } from './calendar-logic.js';

export const TOPIC_COLUMNS = ['id', 'month', 'theme', 'n', 'kind', 'sunday', 'date', 'title', 'speaker', 'note', 'entered_by', 'entered_at', 'void'];

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = MONTH_NAMES.map((m) => m.slice(0, 3).toLowerCase());
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n) => String(n).padStart(2, '0');

// Text as Google Docs gives it: pasted it is plain; read through Drive it carries **bold**, *italic*
// and \! escapes. Both read the same.
function clean(line) {
  return String(line).replace(/ /g, ' ').replace(/\\([!*_#.()[\]-])/g, '$1').replace(/^\*+|\*+$/g, '').replace(/\s+/g, ' ').trim();
}
// "Title — Speaker — Nov 1, 2026": parts split on a dash with spaces around it (em dash, en dash or hyphen).
function parts(s) { return s.split(/\s+[—–-]\s+/).map((p) => p.trim()).filter(Boolean); }

function monthIndex(word) {
  const w = String(word || '').toLowerCase().replace(/\.$/, '');
  const i = MON.indexOf(w.slice(0, 3));
  return i >= 0 && (w.length === 3 || MONTH_NAMES[i].toLowerCase().startsWith(w) || w === 'sept') ? i : -1;
}
// "Nov 1, 2026" / "November 1, 2026" -> "2026-11-01", or '' when it is not a date.
export function dateIn(s) {
  const m = String(s || '').match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (!m) return '';
  const mi = monthIndex(m[1]);
  const d = Number(m[2]);
  if (mi < 0 || d < 1 || d > 31) return '';
  const iso = `${m[3]}-${pad(mi + 1)}-${pad(d)}`;
  return new Date(`${iso}T00:00:00Z`).getUTCDate() === d ? iso : '';
}

// The monthly topics document -> { months: [{ month: 'YYYY-MM', theme, lessons, talks }], problems }.
// lessons: [{ sunday: '1st Sunday', date, title, speaker, note }] — a line without "Lesson" (Christmas
//   Program, Stake Conference) has a title and maybe a note, no speaker.
// talks: [{ title, speaker }] — the lines under "Sacrament Talks:".
// Lines it cannot read are reported, never guessed.
export function parseTopics(text) {
  const months = [];
  const problems = [];
  let cur = null;
  let inTalks = false;
  let headerYear = 0;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = clean(raw);
    if (!line) continue;
    // "November 2026 – April 2027": the range at the top gives the first month's year.
    const range = line.match(/^([A-Za-z]+)\s+(\d{4})\s*[—–-]\s*[A-Za-z]+\s+\d{4}$/);
    if (range && monthIndex(range[1]) >= 0) { headerYear = Number(range[2]); continue; }
    // "December — Jesus Christ, the Light and Joy of the World": a month and its theme.
    const head = line.match(/^([A-Za-z]+)\s+[—–-]\s+(.+)$/);
    if (head && monthIndex(head[1]) >= 0 && head[1].length >= 3) {
      cur = { mi: monthIndex(head[1]), month: '', theme: head[2], lessons: [], talks: [] };
      months.push(cur);
      inTalks = false;
      continue;
    }
    if (!cur) continue;   // the document's title and anything else before the first month
    if (/^sacrament (meeting )?talks:?$/i.test(line)) { inTalks = true; continue; }
    const sun = line.match(/^(\d)(?:st|nd|rd|th)\s+Sunday(\s+Lesson)?\s*:\s*(.+)$/i);
    if (sun) {
      inTalks = false;
      const p = parts(sun[3]);
      const date = p.length > 1 ? dateIn(p[p.length - 1]) : '';
      if (!date) { problems.push(`${MONTH_NAMES[cur.mi]}: no date at the end of "${line}".`); continue; }
      const rest = p.slice(0, -1);
      const lesson = { sunday: `${sun[1]}${['st', 'nd', 'rd'][Number(sun[1]) - 1] || 'th'} Sunday`, date, title: '', speaker: '', note: '' };
      if (sun[2]) {   // "1st Sunday Lesson: Title — Speaker — date"
        lesson.speaker = rest.length > 1 ? rest.pop() : '';
        lesson.title = rest.join(' — ');
      } else {         // "3rd Sunday: Christmas Program — no lessons or talks assigned — date"
        lesson.title = rest.shift() || '';
        lesson.note = rest.join(' — ');
      }
      if (Number(date.slice(5, 7)) !== cur.mi + 1) problems.push(`${MONTH_NAMES[cur.mi]}: ${date} is not in ${MONTH_NAMES[cur.mi]} ("${line}").`);
      else if (new Date(`${date}T00:00:00Z`).getUTCDay() !== 0) problems.push(`${MONTH_NAMES[cur.mi]}: ${date} is not a Sunday ("${line}").`);
      cur.lessons.push(lesson);
      continue;
    }
    if (inTalks) {
      const p = parts(line);
      if (p.length >= 2) { cur.talks.push({ speaker: p.pop(), title: p.join(' — ') }); continue; }
    }
    problems.push(`${MONTH_NAMES[cur.mi]}: could not read "${line}".`);
  }
  // Each month's year: from its own dates, else the month before it (rolling into January), else the top line.
  let prev = null;
  for (const m of months) {
    const dated = m.lessons.find((l) => Number(l.date.slice(5, 7)) === m.mi + 1);
    let year = dated ? Number(dated.date.slice(0, 4)) : 0;
    if (!year && prev) year = prev.year + (m.mi < prev.mi ? 1 : 0);
    if (!year) year = headerYear;
    if (!year) problems.push(`${MONTH_NAMES[m.mi]}: could not tell the year (no dates in it and none before it).`);
    m.year = year;
    m.month = year ? `${year}-${pad(m.mi + 1)}` : '';
    prev = m;
  }
  if (!months.length) problems.push('No months found. Each month should start with a line like "December — the theme".');
  return { months: months.filter((m) => m.month).map(({ month, theme, lessons, talks }) => ({ month, theme, lessons, talks })), problems };
}

// Rows for the Topics tab (one per lesson and per talk, the theme on each, n = order in the document).
export function topicRows(months, makeId, stamp = {}) {
  const rows = [];
  for (const m of months) {
    let n = 0;
    for (const l of m.lessons) rows.push({ id: makeId('tp'), month: m.month, theme: m.theme, n: ++n, kind: 'lesson', sunday: l.sunday, date: l.date, title: l.title, speaker: l.speaker, note: l.note, ...stamp });
    for (const t of m.talks) rows.push({ id: makeId('tp'), month: m.month, theme: m.theme, n: ++n, kind: 'talk', sunday: '', date: '', title: t.title, speaker: t.speaker, note: '', ...stamp });
  }
  return rows;
}

// The saved topics for one month ('YYYY-MM'), from the Topics tab's rows, or null.
export function topicsFor(rows, month) {
  const list = rows.filter((r) => !isTrue(r.void) && String(r.month) === month).sort((a, b) => Number(a.n) - Number(b.n));
  if (!list.length) return null;
  return {
    month,
    theme: String(list[0].theme || ''),
    lessons: list.filter((r) => r.kind === 'lesson').map((r) => ({ sunday: r.sunday, date: r.date, title: r.title, speaker: r.speaker, note: r.note }))
      .sort((a, b) => String(a.date).localeCompare(String(b.date))),
    talks: list.filter((r) => r.kind === 'talk').map((r) => ({ title: r.title, speaker: r.speaker })),
  };
}

// The months the Topics tab has, sorted ('YYYY-MM').
export function topicMonths(rows) {
  return [...new Set(rows.filter((r) => !isTrue(r.void) && r.month).map((r) => String(r.month)))].sort();
}

export function monthLabel(month) { return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`; }

// Which month the email is for, by default: this month in its first 19 days, then next month
// (written near the end of a month, it goes out on the 1st).
export function defaultEmailMonth(today) {
  return Number(today.slice(8, 10)) >= 20 ? addMonths(`${today.slice(0, 7)}-01`, 1).slice(0, 7) : today.slice(0, 7);
}

function shortDate(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return `${DAY[new Date(`${iso}T00:00:00Z`).getUTCDay()]}, ${MONTH_NAMES[m - 1].slice(0, 3)} ${d}`;
}

// { subject, body } for the email. ward: the ward's code ("MS6"); month: 'YYYY-MM'; topics: from
// topicsFor (or null); items: calendarItems for that month; message: the bishopric's short message.
// The calendar part lists ward and stake events only, the same lines as "Coming up".
export function emailDraft({ ward = '', month, message = '', topics = null, items = [] }) {
  const name = MONTH_NAMES[Number(month.slice(5, 7)) - 1];
  const subject = `${ward ? `${ward} ` : ''}Bishopric Message - ${name}`;
  const out = [];
  const msg = String(message || '').trim();
  if (msg) out.push(msg, '');
  if (topics) {
    if (topics.theme) out.push(`${name} theme: ${topics.theme}`, '');
    if (topics.lessons.length) {
      out.push('Sunday lessons');
      for (const l of topics.lessons) {
        const what = l.speaker ? `${l.title} — ${l.speaker}` : `${l.title}${l.note ? ` (${l.note})` : ''}`;
        out.push(`- ${shortDate(l.date)}: ${what}`);
      }
      out.push('');
    }
    if (topics.talks.length) {
      out.push('Sacrament meeting talks');
      for (const t of topics.talks) out.push(`- ${t.title} — ${t.speaker}`);
      out.push('');
    }
  }
  const cal = comingUpText({ items, include: { events: true } });
  if (cal) out.push('Calendar', ...cal.split('\n').map((l) => `- ${l}`), '');
  out.push('The Bishopric');
  return { subject, body: out.join('\n') };
}

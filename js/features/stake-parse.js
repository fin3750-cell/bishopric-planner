// Reads the stake's yearly sheet ("Morningside Stake 2027" and its successors). The sheet is laid out
// for people (title rows, merged cells, notes), so every part is found by its tab title and header
// words, never by position. A new year's sheet with the same layout therefore needs no code change.
// Anything that cannot be read is listed in `problems` instead of being guessed.
//
// Input: tabs = [{ title, rows }], rows as the Sheets API returns them with UNFORMATTED_VALUE
// (times are fractions of a day, numbers are numbers, the rest is text).

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_ABBR = MONTH_NAMES.map((m) => m.slice(0, 3).toUpperCase());
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function text(v) {
  return v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim();
}

// A ward name or code reduced for comparison: "MS-6", "MS 6", "MS6th" -> "MS6"; "Morningside 6th" -> "MORNINGSIDE6".
export function wardKey(s) {
  return text(s).toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(\d)(ST|ND|RD|TH)$/, '$1');
}

// True when a cell names one of the ward's keys, alone or as one part ("Joe Example -- MS6th").
export function cellIsWard(cell, keys) {
  const t = text(cell);
  if (!t) return false;
  return [t, ...t.split(/\s*(?:--|–|—|,|\/|\(|\))\s*|\s-\s/)].some((part) => keys.includes(wardKey(part)));
}

// "19:00", "7:00 PM", "19:00:00" or a fraction of a day -> "19:00". Anything else -> ''.
export function timeOf(v) {
  if (typeof v === 'number' && v >= 0 && v < 1) {
    const mins = Math.round(v * 1440);
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }
  const m = text(v).match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp])?\.?[Mm]?\.?$/);
  if (!m) return '';
  let h = Number(m[1]);
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  return h < 24 && Number(m[2]) < 60 ? `${String(h).padStart(2, '0')}:${m[2]}` : '';
}

function isoDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return '';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function yearIn(s) {
  const m = text(s).match(/\b(20\d\d)\b/);
  return m ? Number(m[1]) : 0;
}

// The tab's year: from its title, or from the text above its header row.
function tabYear(tab, headerIndex) {
  const y = yearIn(tab.title);
  if (y) return y;
  for (const row of tab.rows.slice(0, Math.max(headerIndex, 1))) {
    for (const c of row || []) { const v = yearIn(c); if (v) return v; }
  }
  return 0;
}

// Index of the first row containing every word (whole cell, ignoring case), or -1.
function headerRow(rows, words) {
  return rows.findIndex((r) => {
    const cells = (r || []).map((c) => text(c).toUpperCase());
    return words.every((w) => cells.some((c) => (w instanceof RegExp ? w.test(c) : c === w)));
  });
}

function column(header, test) {
  return (header || []).findIndex((c) => test.test(text(c).toUpperCase()));
}

// "Updated 10-25-26" lines, so the screen can show how current the stake sheet is.
function updatedNote(tab) {
  for (const row of tab.rows) for (const c of row || []) { const t = text(c); if (/^updated\b/i.test(t)) return t; }
  return '';
}

// ---------- calendar (the "Chrono Calendar" tab) ----------

export function parseChrono(tab) {
  const problems = [];
  const hi = headerRow(tab.rows, ['MONTH', 'DAY', 'EVENT']);
  if (hi < 0) return { events: [], problems: [`"${tab.title}": no header row with Month, Day and Event.`] };
  const head = tab.rows[hi];
  const col = { month: column(head, /^MONTH$/), day: column(head, /^DAY$/), time: column(head, /^TIME$/), event: column(head, /^EVENT$/), notes: column(head, /^NOTES?$/) };
  const year = tabYear(tab, hi);
  if (!year) return { events: [], problems: [`"${tab.title}": the year is not in the tab name or title.`] };
  const events = [];
  let month = 0;
  tab.rows.slice(hi + 1).forEach((row, i) => {
    const r = row || [];
    const mName = text(r[col.month]).toLowerCase();
    const mi = MONTH_NAMES.indexOf(mName);
    if (mi >= 0) month = mi + 1;
    const title = text(r[col.event]);
    if (!title) return;
    const where = `"${tab.title}" row ${hi + i + 2}`;
    const dm = text(r[col.day]).match(/^(\d{1,2})\s*(?:\(\s*([A-Za-z]+)\.?\s*\))?/);
    const date = month && dm ? isoDate(year, month, Number(dm[1])) : '';
    if (!date) { problems.push(`${where}: could not read the date of "${title}".`); return; }
    if (dm[2]) {
      const said = dm[2].slice(0, 3).toLowerCase();
      const actual = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
      if (said !== actual) problems.push(`${where}: "${title}" says ${dm[2]}, but ${date} is a ${actual}. The date was used.`);
    }
    const wm = title.match(/^([A-Z]{2,3}\s?\d?)\s*-\s+\S/);
    events.push({ date, time: timeOf(r[col.time]), title, notes: col.notes >= 0 ? text(r[col.notes]) : '', ward: wm ? wardKey(wm[1]) : '' });
  });
  return { events, problems };
}

// ---------- month grids (high council speaking, rehab sacrament, hospital blessings) ----------

// Columns of the month header, each with its year. A row of years just above the header (like
// "2027 ... 2028") sets them; otherwise the tab's year, rolling over when the months start again.
function monthColumns(tab, hi, baseYear) {
  const head = tab.rows[hi] || [];
  const above = tab.rows[hi - 1] || [];
  const cols = [];
  let year = baseYear;
  let last = 0;
  head.forEach((c, j) => {
    const mi = MONTH_ABBR.indexOf(text(c).toUpperCase().slice(0, 3));
    if (mi < 0 || text(c).length > 9) return;
    const y = Number(above[j]);
    if (y >= 2000 && y < 2100) year = y;
    else if (mi + 1 < last) year += 1;
    last = mi + 1;
    cols.push({ j, year, month: mi + 1 });
  });
  return cols;
}

function gridHeader(tab) {
  return tab.rows.findIndex((r) => (r || []).filter((c) => MONTH_ABBR.includes(text(c).toUpperCase())).length >= 12);
}

// High council speaking assignments: who speaks in which ward each month, the monthly topics and
// the code legend ("MS6 = Morningside 6th").
export function parseHcSpeaking(tab) {
  const hi = gridHeader(tab);
  if (hi < 0) return { assignments: [], topics: [], legend: {}, problems: [`"${tab.title}": no row of month names.`] };
  const year = tabYear(tab, hi);
  if (!year) return { assignments: [], topics: [], legend: {}, problems: [`"${tab.title}": the year is not in the tab name or title.`] };
  const head = tab.rows[hi];
  const nameCol = Math.max(0, column(head, /^NAME/));
  const phoneCol = column(head, /CELL|PHONE/);
  const months = monthColumns(tab, hi, year);
  const assignments = [];
  const topics = [];
  const legend = {};
  for (const row of tab.rows.slice(hi + 1)) {
    const r = row || [];
    const first = text(r[nameCol]);
    const topic = first.match(/^(January|February|March|April|May|June|July|August|September|October|November|December)\s*[–—-]\s*(.+)$/i);
    if (topic) { topics.push({ year, month: MONTH_NAMES.indexOf(topic[1].toLowerCase()) + 1, topic: topic[2] }); continue; }
    const code = first.match(/^([A-Z]{2,3}\s?\d?)\s*(?:\([^)]*\))?\s*=\s*(.+)$/);
    if (code) { legend[wardKey(code[1])] = text(code[2]); continue; }
    if (!first || /^(notes|no hc|updated)/i.test(first)) continue;
    for (const m of months) {
      const ward = text(r[m.j]);
      if (ward) assignments.push({ name: first, phone: phoneCol >= 0 ? text(r[phoneCol]) : '', year: m.year, month: m.month, ward: wardKey(ward) });
    }
  }
  return { assignments, topics, legend, problems: [] };
}

// A month grid where the ward's turn is marked either by its code in the month cell (hospital
// blessings) or by an X on the ward's own row (rehab sacrament). Returns the ward's months.
export function parseWardTurns(tab, keys, what) {
  const hi = gridHeader(tab);
  if (hi < 0) return { turns: [], problems: [`"${tab.title}": no row of month names.`] };
  const year = tabYear(tab, hi);
  if (!year) return { turns: [], problems: [`"${tab.title}": the year is not in the tab name or title.`] };
  const months = monthColumns(tab, hi, year);
  const monthCols = new Set(months.map((m) => m.j));
  const turns = [];
  for (const row of tab.rows.slice(hi + 1)) {
    const r = row || [];
    const ours = r.some((c, j) => !monthCols.has(j) && cellIsWard(c, keys));
    const who = text(r[0]).split(/\s*--\s*/)[0];
    for (const m of months) {
      const v = text(r[m.j]);
      if (!v) continue;
      if (cellIsWard(v, keys) || (ours && /^x$/i.test(v))) turns.push({ year: m.year, month: m.month, what, who });
    }
  }
  return { turns, problems: [] };
}

// ---------- people (stake presidency and high council, stake callings, bishops) ----------

export function parsePeople(tab, { defaultCalling = '' } = {}) {
  let hi = headerRow(tab.rows, ['NAME', 'CALLING']);
  if (hi < 0) hi = headerRow(tab.rows, ['NAME', 'WARD']);
  if (hi < 0) return { people: [], problems: [`"${tab.title}": no header row with NAME.`] };
  const head = tab.rows[hi];
  const col = {
    name: column(head, /^NAME$/), calling: column(head, /^CALLING$/), phone: column(head, /CELL|PHONE/),
    email: column(head, /EMAIL/), ward: column(head, /^(ASSIGNED WARD|WARD)$/), assignment: column(head, /^ASSIGNMENTS?$/),
  };
  const get = (r, k) => (col[k] >= 0 ? text(r[col[k]]) : '');
  const people = [];
  for (const row of tab.rows.slice(hi + 1)) {
    const r = row || [];
    const name = get(r, 'name');
    if (!name) continue;
    if (/^(updated|key for|missionaries$)/i.test(name) || name.length > 60) continue;
    const phone = (get(r, 'phone').match(/\d/g) || []).length >= 7 ? get(r, 'phone') : '';
    const email = /@/.test(get(r, 'email')) ? get(r, 'email') : '';
    const calling = get(r, 'calling') || defaultCalling;
    // A person has a phone or an email; theme verses, building keys and notes have neither.
    if ((!phone && !email) || calling.length > 60) continue;
    people.push({ name, calling, phone, email, ward: get(r, 'ward'), assignment: get(r, 'assignment') });
  }
  return { people, problems: [] };
}

// ---------- the whole sheet ----------

// wardNames: how the ward is written in the stake sheet, e.g. ["MS6", "Morningside 6th"].
export function readStakeSheet(tabs, wardNames) {
  const problems = [];
  const find = (re) => tabs.filter((t) => re.test(t.title));
  const out = { events: [], hcAssignments: [], hcTopics: [], legend: {}, turns: [], leaders: [], stakeCallings: [], bishops: [], updated: [], problems };

  for (const t of find(/chrono/i)) {
    const r = parseChrono(t);
    out.events.push(...r.events); problems.push(...r.problems);
    const u = updatedNote(t); if (u) out.updated.push(`Calendar: ${u}`);
  }
  if (!find(/chrono/i).length) problems.push('No tab with "Chrono Calendar" in its name, so no stake events.');

  for (const t of find(/speaking/i)) {
    const r = parseHcSpeaking(t);
    out.hcAssignments.push(...r.assignments); out.hcTopics.push(...r.topics); Object.assign(out.legend, r.legend); problems.push(...r.problems);
  }
  if (!find(/speaking/i).length) problems.push('No tab with "Speaking" in its name, so no high council speaking assignments.');

  // The ward's keys: the names given in Settings plus their spelled-out names from the code legend.
  const keys = new Set(wardNames.map(wardKey).filter(Boolean));
  for (const [code, name] of Object.entries(out.legend)) if (keys.has(code)) keys.add(wardKey(name));
  out.wardKeys = [...keys];
  // A title prefix counts as a ward only if it is the ward's own key or a code in the legend, so an
  // event like "YSA - Dance" stays stake-wide.
  for (const e of out.events) if (e.ward && !keys.has(e.ward) && !(e.ward in out.legend)) e.ward = '';

  for (const [re, what] of [[/sacrament/i, 'Coral Desert Rehab sacrament'], [/hospital/i, 'Hospital blessings']]) {
    for (const t of find(re)) {
      const name = re.source === 'sacrament' ? (text((t.rows[0] || [])[0]).replace(/^\d{4}\s*/, '').replace(/\s*schedule.*$/i, '') || what) : what;
      const r = parseWardTurns(t, out.wardKeys, name);
      out.turns.push(...r.turns); problems.push(...r.problems);
    }
  }

  const leaderTab = tabs.find((t) => headerRow(t.rows, ['NAME', 'CALLING', /^ASSIGNED WARD$/]) >= 0);
  if (leaderTab) { const r = parsePeople(leaderTab); out.leaders = r.people; problems.push(...r.problems); const u = updatedNote(leaderTab); if (u) out.updated.push(`Stake presidency and high council: ${u}`); }
  else problems.push('No tab with NAME, CALLING and ASSIGNED WARD columns, so no stake presidency or high council list.');
  const callingTab = tabs.find((t) => t !== leaderTab && /calling/i.test(t.title));
  if (callingTab) { const r = parsePeople(callingTab); out.stakeCallings = r.people; problems.push(...r.problems); }
  const bishopTab = tabs.find((t) => /^bishops?\b/i.test(t.title));
  if (bishopTab) { const r = parsePeople(bishopTab, { defaultCalling: 'Bishop' }); out.bishops = r.people; problems.push(...r.problems); }

  out.events.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  return out;
}

// The ward's high council speakers by month: [{ year, month, name, phone, topic }].
export function hcVisits(stake) {
  const keys = stake.wardKeys || [];
  return stake.hcAssignments.filter((a) => keys.includes(a.ward)).map((a) => ({
    ...a, topic: (stake.hcTopics.find((t) => t.year === a.year && t.month === a.month) || {}).topic || '',
  })).sort((a, b) => a.year - b.year || a.month - b.month);
}

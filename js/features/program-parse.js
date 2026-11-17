// Reads a WardBullet sacrament meeting program pasted as text. WardBullet has no export, so the
// bishopric copies the program page (its Agenda or its Announcements) and pastes it here.
// A copy looks like this, one item per line (links may come through as "[text](url)"):
//   Sacrament Meeting / <ward> / 11/22/2026 / Agenda / Announcements /
//   Conducting / <name> / ... / Speaker / <name> / Speaker / <name> / Closing Hymn #94 / <title> / Benediction
// and on the Announcements tab, dated lines such as "12/10: Ward Christmas party 6pm".
// Nothing is guessed: speakers whose name does not match one member exactly are left for a person
// to choose, and anything unreadable is reported.

import { normName } from '../members.js';

// Lines of the program: links reduced to their text, list markers removed, blank lines dropped.
export function programLines(text) {
  return String(text || '').split(/\r?\n/)
    .map((l) => l.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^\s*(?:[*•-]\s+)+/, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const SPEAKER = /^(?:(?:youth|concluding|closing|primary|high council|stake)\s+)?speakers?$/i;
const LABELS = [
  SPEAKER,
  /^(?:conducting|presiding|music leader|music director|chorister|organist|pianist|accompanist|organist\/pianist)$/i,
  /^(?:opening|sacrament|intermediate|rest|closing)\s+(?:hymn|song)\b.*$/i,
  /^(?:invocation|benediction|opening prayer|closing prayer)$/i,
  /^(?:stake|ward)\s+business$/i, /^administration of the sacrament$/i, /^musical number\b.*$/i,
  /^(?:testimonies|bearing of testimonies|fast and testimony meeting)$/i,
  /^(?:agenda|announcements|sacrament meeting)$/i,
];
export function isLabel(line) { return LABELS.some((re) => re.test(line)); }

function iso(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return '';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// "6pm", "6:30 PM", "@ 3pm", "1-3 pm" (the start) -> "18:00". '' when there is no time.
export function timeIn(text) {
  const m = String(text).match(/(\d{1,2})(?::(\d{2}))?\s*(?:[-–]\s*\d{1,2}(?::\d{2})?\s*)?([ap])\.?\s?m\b\.?/i);
  if (!m) return '';
  let h = Number(m[1]);
  if (h < 1 || h > 12) return '';
  if (/p/i.test(m[3]) && h < 12) h += 12;
  if (/a/i.test(m[3]) && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${m[2] || '00'}`;
}

// { date, speakers: [{ label, name }], announcements: [{ date, time, title, line }], past, problems }
// past: dated announcements before the program's date (not offered for the calendar).
export function parseProgram(text) {
  const lines = programLines(text);
  const problems = [];
  let date = '';
  for (const l of lines.slice(0, 15)) {
    const m = l.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) { date = iso(Number(m[3]), Number(m[1]), Number(m[2])); break; }
  }
  if (!date) problems.push('No program date found (a line like 11/22/2026 near the top).');

  const speakers = [];
  lines.forEach((l, i) => {
    const inline = l.match(/^((?:(?:youth|concluding|closing|primary|high council|stake)\s+)?speakers?)\s*[:–—-]\s*(.+)$/i);
    if (inline) { speakers.push({ label: inline[1], name: inline[2].trim() }); return; }
    if (!SPEAKER.test(l)) return;
    // The names under a speaker label, up to the next label (usually one).
    for (let j = i + 1; j < lines.length && !isLabel(lines[j]) && !/^photo credit/i.test(lines[j]); j++) {
      speakers.push({ label: l, name: lines[j] });
    }
  });

  const announcements = [];
  const past = [];
  if (date) {
    const py = Number(date.slice(0, 4));
    for (const l of lines) {
      const m = l.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\s*[:–—-]\s*(.+)$/);
      if (!m) continue;
      let y = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : py;
      let d = iso(y, Number(m[1]), Number(m[2]));
      // No year given: a date more than a month before the program is next year's.
      if (d && !m[3] && d < addDaysIso(date, -31)) { y += 1; d = iso(y, Number(m[1]), Number(m[2])); }
      if (!d) { problems.push(`Could not read the date in "${l}".`); continue; }
      const time = timeIn(m[4]);
      const title = m[4].replace(/\s*@?\s*\d{1,2}(?::\d{2})?\s*(?:[-–]\s*\d{1,2}(?::\d{2})?\s*)?[ap]\.?\s?m\b\.?/i, '').replace(/[\s,;:.-]+$/, '').trim() || m[4];
      (d < date ? past : announcements).push({ date: d, time, title, line: l });
    }
  }
  return { date, speakers, announcements, past, problems };
}

function addDaysIso(isoDate, n) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Members a program name could be. exact: surname and first name both match (at most one is
// pre-chosen); others: the same surname (for "Sister Firwood", nicknames, or a second family member).
const TITLES = /^(?:brother|bro\.?|sister|sis\.?|elder|bishop|president|pres\.?)\s+/i;

export function matchSpeaker(name, members) {
  const titled = TITLES.test(name);
  const n = normName(name.replace(TITLES, '')).replace(/[^a-z' -]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = n.split(' ');
  const exact = [];
  const others = [];
  for (const m of members) {
    const [lastRaw, firstRaw = ''] = String(m.name).split(',');
    const last = normName(lastRaw).replace(/[^a-z' -]/g, ' ').replace(/\s+/g, ' ').trim();
    const firsts = normName(firstRaw).replace(/\([^)]*\)/g, ' ').replace(/[^a-z' ]/g, ' ').split(' ').filter(Boolean);
    const nick = (normName(firstRaw).match(/\(([^)]*)\)/) || [])[1];   // "Erika (Riki)"
    if (!last || !(n === last || n.endsWith(` ${last}`))) continue;
    const given = n === last ? '' : n.slice(0, n.length - last.length).trim().split(' ')[0];
    if (!titled && given && (given === firsts[0] || given === nick)) exact.push(m);
    else others.push(m);
  }
  return { exact, others };
}

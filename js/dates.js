// Date helpers. Every date in the app is an ISO string "YYYY-MM-DD" (no time, no time zone),
// so dates compare correctly as plain strings.

const MS_DAY = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad(n) { return String(n).padStart(2, '0'); }

export function isoFromParts(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }

export function todayISO(now = new Date()) {
  return isoFromParts(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function checked(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return '';
  return isoFromParts(y, m, d);
}

// Google Sheets stores dates as serial numbers: days since 30 Dec 1899.
export function serialToISO(serial) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * MS_DAY);
  return isoFromParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

// Accepts a Sheets serial number, "YYYY-MM-DD" (optionally followed by a time) or "M/D/YYYY".
// Returns "" when the value is empty or not a real date.
export function parseDate(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return Number.isFinite(v) ? serialToISO(v) : '';
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/);
  if (m) return checked(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return checked(y, +m[1], +m[2]);
  }
  return '';
}

function toUTC(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(iso, n) {
  const d = new Date(toUTC(iso) + n * MS_DAY);
  return isoFromParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

// Whole months; the day is clamped to the end of a shorter month (31 Mar - 1 month = 28/29 Feb).
export function addMonths(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + Math.round(months);
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return isoFromParts(ny, nm, Math.min(d, lastDay));
}

export function daysBetween(fromIso, toIso) {
  return Math.round((toUTC(toIso) - toUTC(fromIso)) / MS_DAY);
}

// The coming Sunday, or the same day when it is already Sunday.
export function nextSunday(iso) {
  const dow = new Date(toUTC(iso)).getUTCDay();
  return addDays(iso, (7 - dow) % 7);
}

export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function formatMonth(iso) {
  if (!iso) return '';
  const [y, m] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

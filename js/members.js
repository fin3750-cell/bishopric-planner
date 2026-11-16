// Pure member helpers shared by every feature: names, ages, categories and member-list import.
// Nothing here touches the page or the network, so it can be tested with Node.

import { daysBetween } from './dates.js';

export const CATEGORIES = [
  { value: '', label: 'None' },
  { value: 'ask_soon', label: 'Ask soon' },
  { value: 'not_now', label: 'Not now' },
  { value: 'do_not_ask', label: 'Do not ask' },
];

export const STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'moved', label: 'Moved' },
];

export function categoryLabel(value) {
  const c = CATEGORIES.find((x) => x.value === (value || ''));
  return c ? c.label : value;
}

// Lower case, accents removed, single spaces, "Last, First" spacing made consistent.
export function normName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .trim();
}

export function isTrue(v) {
  return v === true || String(v).trim().toUpperCase() === 'TRUE';
}

export function isActive(m) {
  return (m.status || 'active') !== 'moved';
}

// Age on `today`, from the age recorded on `age_as_of`. Birthdays are unknown, so this can be
// one year low for part of the year. Returns null when no age is recorded.
export function currentAge(m, today) {
  if (m.age === '' || m.age === null || m.age === undefined) return null;
  const age = Number(m.age);
  if (!Number.isFinite(age)) return null;
  if (!m.age_as_of) return age;
  const days = daysBetween(m.age_as_of, today);
  return days > 0 ? age + Math.floor(days / 365.25) : age;
}

export function ageGroup(age) {
  if (age === null) return 'unknown';
  if (age < 12) return '8-11';
  if (age < 18) return '12-17';
  return '18+';
}

// Parses member-list text: the Member List PDF's text, text copied from a member list page,
// or CSV. Each person's line is "Last, First <gender M/F> <age>", separated by spaces or tabs.
export function parseMemberList(text) {
  const rows = [];
  const skipped = [];
  let declared = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/ /g, ' ').trim();
    if (!line) continue;
    const count = line.match(/^Count:\s*(\d+)/i);
    if (count) { declared = Number(count[1]); continue; }
    const csv = line.match(/^"([^"]+,[^"]+)"\s*,\s*"?([MF])"?\s*,\s*"?(\d{1,3})"?\s*$/);
    const plain = line.match(/^(.+?,.+?)\s+([MF])\s+(\d{1,3})$/);
    const m = csv || plain;
    if (m) {
      rows.push({ name: m[1].replace(/\s+/g, ' ').trim(), gender: m[2], age: Number(m[3]) });
    } else {
      skipped.push(line);
    }
  }
  return { rows, skipped, declared };
}

function cameFromMemberList(m) {
  return /member list/i.test(m.source || '');
}

// Compares a parsed member list with the members already in the Sheet.
//  - updates:  people already in the Sheet (their age is refreshed)
//  - added:    people 8+ who are not in the Sheet. Someone exactly minAge probably just turned 8,
//              so they are not marked "new to ward" by default.
//  - missing:  active members who came from an earlier member list but are not on this one
//  - returned: people marked "moved" who are on the list again
// People under minAge who are not in the Sheet are ignored (the bishopric tracks 8 and older).
export function diffImport(members, parsedRows, minAge = 8) {
  const byName = new Map();
  for (const m of members) byName.set(normName(m.name), m);
  const seen = new Set();
  const updates = [];
  const added = [];
  const returned = [];
  const duplicates = [];
  let ignoredYoung = 0;
  for (const r of parsedRows) {
    const key = normName(r.name);
    if (seen.has(key)) { duplicates.push(r); continue; }
    seen.add(key);
    const m = byName.get(key);
    if (m) {
      updates.push({ member: m, age: r.age, gender: r.gender });
      if (!isActive(m)) returned.push(m);
      continue;
    }
    if (r.age < minAge) { ignoredYoung++; continue; }
    added.push({ ...r, newToWard: r.age !== minAge });
  }
  const missing = members.filter((m) => isActive(m) && cameFromMemberList(m) && !seen.has(normName(m.name)));
  return { updates, added, missing, returned, duplicates, ignoredYoung };
}

// Short random id, safe when three people add records at the same time.
export function makeId(prefix) {
  const rand = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, '0');
  return `${prefix}${Date.now().toString(36)}${rand}`;
}

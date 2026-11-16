// Pure rules for the speaker planner: who to ask, upcoming talks, talk history.

import { addMonths, daysBetween } from '../dates.js';
import { ageGroup, currentAge, isActive, isTrue, normName } from '../members.js';

// Last talk on or before today, next scheduled talk after today, and latest decline, per member.
export function summarize(members, talks, refusals, today) {
  const by = new Map();
  for (const m of members) by.set(m.id, { last: '', lastEstimated: false, next: '', count: 0, declined: '' });
  for (const t of talks) {
    if (isTrue(t.void) || !t.date || !by.has(t.member_id)) continue;
    const s = by.get(t.member_id);
    if (t.date <= today) {
      s.count++;
      if (t.date > s.last) { s.last = t.date; s.lastEstimated = isTrue(t.date_estimated); }
    } else if (!s.next || t.date < s.next) {
      s.next = t.date;
    }
  }
  for (const r of refusals) {
    if (isTrue(r.void) || !r.date || !by.has(r.member_id)) continue;
    const s = by.get(r.member_id);
    if (r.date > s.declined) s.declined = r.date;
  }
  return by;
}

// Categories shown at the bottom of Who to ask, grayed: the bishopric's judgment that the person
// shouldn't be asked ("do_not_ask", shown as "Shouldn't ask"), or that they won't accept.
export const BOTTOM_CATEGORIES = ['do_not_ask', 'wont_accept'];

// Who to ask, in order:
//   tier 0  "Ask soon" (for example new to the ward)
//   tier 1  no talk on record
//   tier 2  last talk before the look-back window, oldest first
//   tier 3  "Shouldn't ask" or "Won't accept": at the bottom, grayed (no talk first, then oldest)
// Left off the list: moved, "not now" until its date, under minAge, a talk already scheduled, or a
// talk within the window. A decline after the last talk is shown as a highlight; it does not move
// the person.
// With a search, people left off the list who match are returned in `others`, with the reason.
export function buildAskList({ members, talks, refusals, today, settings = {}, filters = {} }) {
  const windowYears = Number(settings.windowYears) > 0 ? Number(settings.windowYears) : 3;
  const minAge = Number.isFinite(Number(settings.minAge)) ? Number(settings.minAge) : 8;
  const cutoff = addMonths(today, -Math.round(windowYears * 12));
  const sums = summarize(members, talks, refusals, today);
  const hidden = { recent: 0, scheduled: 0, notNow: 0, moved: 0, young: 0 };
  const rows = [];
  const left = [];   // { member, reason, date } for people left off the list
  for (const m of members) {
    if (!m.id || !m.name) continue;
    const s = sums.get(m.id);
    const age = currentAge(m, today);
    const leave = (reason, date = '') => { hidden[reason]++; left.push({ member: m, reason, date, age }); };
    if (!isActive(m)) { leave('moved'); continue; }
    if (m.category === 'not_now' && (!m.category_until || m.category_until > today)) { leave('notNow', m.category_until || ''); continue; }
    if (age !== null && age < minAge) { leave('young'); continue; }
    if (s.next) { leave('scheduled', s.next); continue; }
    if (s.last && s.last >= cutoff) { leave('recent', s.last); continue; }
    const askSoon = m.category === 'ask_soon';
    const bottom = BOTTOM_CATEGORIES.includes(m.category) ? m.category : '';
    rows.push({
      member: m,
      age,
      group: ageGroup(age),
      tier: bottom ? 3 : askSoon ? 0 : (s.last ? 2 : 1),
      askSoon,
      bottom,
      isNew: Boolean(m.moved_in) && m.moved_in <= today && daysBetween(m.moved_in, today) <= 365,
      lastTalk: s.last,
      lastEstimated: s.lastEstimated,
      talkCount: s.count,
      declined: s.declined && (!s.last || s.declined > s.last) ? s.declined : '',
    });
  }
  const q = normName(filters.search || '');
  const keep = (m, group) =>
    (!filters.group || filters.group === 'all' || group === filters.group) &&
    (!filters.gender || filters.gender === 'all' || m.gender === filters.gender) &&
    (!q || normName(m.name).includes(q));
  const shown = rows.filter((r) => keep(r.member, r.group));
  shown.sort((a, b) =>
    a.tier - b.tier ||
    ((a.tier === 2 || a.tier === 3) ? a.lastTalk.localeCompare(b.lastTalk) : 0) ||
    a.member.name.localeCompare(b.member.name));
  const others = q
    ? left.filter((o) => keep(o.member, ageGroup(o.age))).sort((a, b) => a.member.name.localeCompare(b.member.name))
    : [];
  return { rows: shown, total: rows.length, bottomCount: rows.filter((r) => r.tier === 3).length, hidden, others, cutoff, windowYears };
}

export function upcomingTalks(talks, today) {
  return talks
    .filter((t) => !isTrue(t.void) && t.date && t.date > today)
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.member_name || a.name_as_shown).localeCompare(String(b.member_name || b.name_as_shown)));
}

export function pastTalks(talks, today) {
  return talks
    .filter((t) => !isTrue(t.void) && t.date && t.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date) || String(a.id).localeCompare(String(b.id)));
}

export function talksFor(memberId, talks) {
  return talks.filter((t) => t.member_id === memberId && !isTrue(t.void)).sort((a, b) => b.date.localeCompare(a.date));
}

export function refusalsFor(memberId, refusals) {
  return refusals.filter((r) => r.member_id === memberId && !isTrue(r.void)).sort((a, b) => b.date.localeCompare(a.date));
}

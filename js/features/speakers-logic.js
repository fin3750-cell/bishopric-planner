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

// Who to ask, in order:
//   tier 0  "Ask soon" (for example new to the ward)
//   tier 1  no talk on record
//   tier 2  last talk before the look-back window, oldest first
// Left off the list: moved, "do not ask", "not now" until its date, under minAge, a talk already
// scheduled, or a talk within the window. A decline after the last talk is shown as a highlight;
// it does not move the person.
export function buildAskList({ members, talks, refusals, today, settings = {}, filters = {} }) {
  const windowYears = Number(settings.windowYears) > 0 ? Number(settings.windowYears) : 3;
  const minAge = Number.isFinite(Number(settings.minAge)) ? Number(settings.minAge) : 8;
  const cutoff = addMonths(today, -Math.round(windowYears * 12));
  const sums = summarize(members, talks, refusals, today);
  const hidden = { recent: 0, scheduled: 0, doNotAsk: 0, notNow: 0, moved: 0, young: 0 };
  const rows = [];
  for (const m of members) {
    if (!m.id || !m.name) continue;
    const s = sums.get(m.id);
    const age = currentAge(m, today);
    if (!isActive(m)) { hidden.moved++; continue; }
    if (m.category === 'do_not_ask') { hidden.doNotAsk++; continue; }
    if (m.category === 'not_now' && (!m.category_until || m.category_until > today)) { hidden.notNow++; continue; }
    if (age !== null && age < minAge) { hidden.young++; continue; }
    if (s.next) { hidden.scheduled++; continue; }
    if (s.last && s.last >= cutoff) { hidden.recent++; continue; }
    const askSoon = m.category === 'ask_soon';
    rows.push({
      member: m,
      age,
      group: ageGroup(age),
      tier: askSoon ? 0 : (s.last ? 2 : 1),
      askSoon,
      isNew: Boolean(m.moved_in) && m.moved_in <= today && daysBetween(m.moved_in, today) <= 365,
      lastTalk: s.last,
      lastEstimated: s.lastEstimated,
      talkCount: s.count,
      declined: s.declined && (!s.last || s.declined > s.last) ? s.declined : '',
    });
  }
  const q = normName(filters.search || '');
  const shown = rows.filter((r) =>
    (!filters.group || filters.group === 'all' || r.group === filters.group) &&
    (!filters.gender || filters.gender === 'all' || r.member.gender === filters.gender) &&
    (!q || normName(r.member.name).includes(q)));
  shown.sort((a, b) =>
    a.tier - b.tier ||
    (a.tier === 2 ? a.lastTalk.localeCompare(b.lastTalk) : 0) ||
    a.member.name.localeCompare(b.member.name));
  return { rows: shown, total: rows.length, hidden, cutoff, windowYears };
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

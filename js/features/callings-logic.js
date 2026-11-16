// Pure rules for callings: the steps of a call and a release, open tasks, Sunday business,
// time in calling and who has no calling. Each row of the Callings tab is one person in one calling.

import { ageGroup, currentAge, isActive, isTrue } from '../members.js';

export const DATE_COLUMNS = ['proposed_on', 'extended_on', 'accepted_on', 'declined_on', 'sustained_on', 'set_apart_on',
  'recorded_on', 'release_proposed_on', 'release_informed_on', 'released_on', 'release_recorded_on'];

export const COLUMNS = ['id', 'member_id', 'member_name', 'organization', 'calling',
  'proposed_on', 'extend_by', 'extended_on', 'accepted_on', 'declined_on', 'sustained_on',
  'set_apart_by', 'set_apart_on', 'record_by', 'recorded_on',
  'release_proposed_on', 'release_by', 'release_informed_on', 'released_on', 'release_record_by', 'release_recorded_on',
  'source', 'notes', 'entered_by', 'entered_at', 'void'];

// Each step: the date column that marks it done and, if a person does it, the column holding their initials.
export const STEPS = {
  extend: { label: 'Ask (extend the call)', done: 'extended_on', by: 'extend_by' },
  answer: { label: 'Waiting for an answer', done: 'accepted_on' },
  sustain: { label: 'Sustain in sacrament meeting', done: 'sustained_on' },
  set_apart: { label: 'Set apart', done: 'set_apart_on', by: 'set_apart_by' },
  record: { label: 'Record in LCR', done: 'recorded_on', by: 'record_by' },
  release_tell: { label: 'Tell the member about the release', done: 'release_informed_on', by: 'release_by' },
  release_announce: { label: 'Release in sacrament meeting', done: 'released_on' },
  release_record: { label: 'Record the release in LCR', done: 'release_recorded_on', by: 'release_record_by' },
};

// Order used to group the "In progress" screen.
export const STEP_ORDER = ['extend', 'answer', 'sustain', 'set_apart', 'record', 'release_tell', 'release_announce', 'release_record'];

function task(c, step) {
  const s = STEPS[step];
  return { step, label: s.label, by: s.by ? String(c[s.by] || '').toUpperCase() : '', calling: c };
}

// phase: proposed | awaiting | to_sustain | serving | releasing | ended | declined | void
// tasks: what still has to happen, in order. A later date implies the earlier steps happened,
// so a calling imported as sustained is not shown as "to ask".
export function callingState(c) {
  if (isTrue(c.void)) return { phase: 'void', tasks: [] };
  if (c.declined_on) return { phase: 'declined', tasks: [] };
  if (c.release_proposed_on || c.release_informed_on || c.released_on || c.release_recorded_on) {
    const released = Boolean(c.released_on || c.release_recorded_on);
    const informed = Boolean(c.release_informed_on) || released;
    const tasks = [];
    if (!informed) tasks.push(task(c, 'release_tell'));
    else if (!released) tasks.push(task(c, 'release_announce'));
    if (released && !c.release_recorded_on) tasks.push(task(c, 'release_record'));
    return { phase: released && c.release_recorded_on ? 'ended' : 'releasing', tasks };
  }
  const sustained = Boolean(c.sustained_on);
  const accepted = Boolean(c.accepted_on) || sustained;
  const extended = Boolean(c.extended_on) || accepted;
  if (!extended) return { phase: 'proposed', tasks: [task(c, 'extend')] };
  if (!accepted) return { phase: 'awaiting', tasks: [task(c, 'answer')] };
  if (!sustained) return { phase: 'to_sustain', tasks: [task(c, 'sustain')] };
  const tasks = [];
  if (!c.set_apart_on) tasks.push(task(c, 'set_apart'));
  if (!c.recorded_on) tasks.push(task(c, 'record'));
  return { phase: 'serving', tasks };
}

// Holding the calling now: sustained and not yet released.
export function isCurrent(c) {
  const p = callingState(c).phase;
  return (p === 'serving' || p === 'releasing') && !c.released_on && !c.release_recorded_on;
}

// Proposed, asked or accepted but not yet sustained.
export function isPending(c) {
  return ['proposed', 'awaiting', 'to_sustain'].includes(callingState(c).phase);
}

// Whole months from a to b (b on or after a).
export function monthsBetween(a, b) {
  const [ya, ma, da] = a.split('-').map(Number);
  const [yb, mb, db] = b.split('-').map(Number);
  return Math.max(0, (yb * 12 + mb) - (ya * 12 + ma) - (db < da ? 1 : 0));
}

export function tenureMonths(c, today) {
  if (!c.sustained_on) return null;
  const end = c.released_on || today;
  return end < c.sustained_on ? 0 : monthsBetween(c.sustained_on, end);
}

export function formatTenure(months) {
  if (months === null) return '';
  if (months < 1) return 'under 1 month';
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y ? `${y} yr` : '', m ? `${m} mo` : ''].filter(Boolean).join(' ');
}

function live(callings) { return callings.filter((c) => !isTrue(c.void)); }

export function openTasks(callings) {
  const out = [];
  for (const c of live(callings)) out.push(...callingState(c).tasks);
  return out.sort((a, b) => STEP_ORDER.indexOf(a.step) - STEP_ORDER.indexOf(b.step) ||
    String(a.calling.organization).localeCompare(String(b.calling.organization)) ||
    String(a.calling.member_name).localeCompare(String(b.calling.member_name)));
}

// Tasks assigned to these initials, and tasks with nobody assigned (steps someone has to do).
export function myTasks(callings, initials) {
  const me = String(initials || '').trim().toUpperCase();
  const all = openTasks(callings).filter((t) => STEPS[t.step].by);
  return { mine: me ? all.filter((t) => t.by === me) : [], unassigned: all.filter((t) => !t.by) };
}

// What to read in sacrament meeting: releases first, then callings to sustain.
export function sundayBusiness(callings) {
  const tasks = openTasks(callings);
  return {
    releases: tasks.filter((t) => t.step === 'release_announce').map((t) => t.calling),
    sustainings: tasks.filter((t) => t.step === 'sustain').map((t) => t.calling),
  };
}

export function currentCallings(callings) {
  return live(callings).filter(isCurrent).sort((a, b) =>
    String(a.organization).localeCompare(String(b.organization)) ||
    String(a.calling).localeCompare(String(b.calling)) ||
    String(a.member_name).localeCompare(String(b.member_name)));
}

export function callingsFor(memberId, callings) {
  return live(callings).filter((c) => c.member_id === memberId)
    .sort((a, b) => String(b.sustained_on || b.proposed_on || '').localeCompare(String(a.sustained_on || a.proposed_on || '')));
}

// Active members of at least minAge (or unknown age) with no current or pending calling.
export function membersWithoutCalling(members, callings, today, minAge = 18) {
  const busy = new Set(live(callings).filter((c) => isCurrent(c) || isPending(c)).map((c) => c.member_id));
  return members.filter((m) => {
    if (!m.id || !isActive(m) || busy.has(m.id)) return false;
    const age = currentAge(m, today);
    return age === null || age >= minAge;
  }).map((m) => ({ member: m, age: currentAge(m, today), group: ageGroup(currentAge(m, today)) }))
    .sort((a, b) => a.member.name.localeCompare(b.member.name));
}

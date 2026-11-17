// Pure rules for callings: the stages of a call (proposed, bishop approved, assigned to contact,
// sustain, record in LCR, set apart), releases, to-dos, Sunday business, time in calling and who has
// no calling. Each row of the Callings tab is one person in one calling.

import { ageGroup, currentAge, isActive, isTrue, displayName, initialsFor } from '../members.js';

export const DATE_COLUMNS = ['proposed_on', 'approved_on', 'not_approved_on', 'extended_on', 'accepted_on', 'declined_on',
  'sustained_on', 'set_apart_on', 'recorded_on', 'release_proposed_on', 'release_informed_on', 'released_on', 'release_recorded_on'];

export const COLUMNS = ['id', 'member_id', 'member_name', 'organization', 'calling',
  'proposed_on', 'approved_on', 'approved_by', 'not_approved_on',
  'extend_by', 'extended_on', 'accepted_on', 'declined_on', 'sustained_on',
  'set_apart_by', 'set_apart_on', 'record_by', 'recorded_on',
  'release_proposed_on', 'release_by', 'release_informed_on', 'released_on', 'release_record_by', 'release_recorded_on',
  'source', 'notes', 'entered_by', 'entered_at', 'void'];

// Tasks tab: free to-dos ("Ask the Primary presidency for teacher names").
export const TODO_COLUMNS = ['id', 'description', 'assigned_to', 'due_on', 'done_on', 'done_by', 'entered_by', 'entered_at', 'void'];
export const TODO_DATES = ['due_on', 'done_on'];

// Each step: the date column that marks it done and, if a person does it, the column holding their initials.
export const STEPS = {
  approve: { label: 'Bishop approval', done: 'approved_on' },
  extend: { label: 'Ask (extend the call)', done: 'accepted_on', by: 'extend_by' },
  sustain: { label: 'Sustain', done: 'sustained_on' },
  record: { label: 'Record in LCR', done: 'recorded_on', by: 'record_by' },
  set_apart: { label: 'Set apart', done: 'set_apart_on', by: 'set_apart_by' },
  release_tell: { label: 'Tell the member about the release', done: 'release_informed_on', by: 'release_by' },
  release_announce: { label: 'Release in sacrament meeting', done: 'released_on' },
  release_record: { label: 'Record the release in LCR', done: 'release_recorded_on', by: 'release_record_by' },
};

export const STEP_ORDER = ['approve', 'extend', 'sustain', 'record', 'set_apart', 'release_tell', 'release_announce', 'release_record'];

// The sections of the "In progress" screen, in order. Each calling in progress is in exactly one.
export const STAGES = [
  { id: 'proposed', label: 'Proposed', hint: 'Waiting for the bishop to approve (open one to record it).' },
  { id: 'approved', label: 'Bishop Approved', hint: 'Choose who will contact them.' },
  { id: 'assigned', label: 'Assigned to Contact', hint: 'The person assigned contacts them, then taps Accepted or Declined (on My tasks).' },
  { id: 'sustain', label: 'Sustain', hint: 'Accepted. Sustain them on the Sunday screen.' },
  { id: 'record', label: 'Sustained/LCR Record', hint: 'Sustained. Record the calling in LCR.' },
  { id: 'release', label: 'Releases', hint: 'Tell the member, release in sacrament meeting, record in LCR.' },
  { id: 'set_apart', label: 'Needs set apart', hint: 'Sustained and recorded, not yet set apart.' },
];

// defaults: initials for a step when the calling names nobody, e.g. { record: 'KW' }: whoever
// records callings in LCR (see recorderFrom).
function task(c, step, defaults = {}) {
  const s = STEPS[step];
  const by = s.by ? String(c[s.by] || '').trim().toUpperCase() || String(defaults[step] || '').trim().toUpperCase() : '';
  return { step, label: s.label, by, calling: c };
}

// phase: proposed | approved | to_sustain | serving | releasing | ended | not_approved | declined | void
// tasks: what still has to happen, in order. A later date implies the earlier steps happened,
// so a calling imported as sustained is not shown as needing approval.
export function callingState(c, defaults = {}) {
  if (isTrue(c.void)) return { phase: 'void', tasks: [] };
  if (c.declined_on) return { phase: 'declined', tasks: [] };
  if (c.not_approved_on) return { phase: 'not_approved', tasks: [] };
  if (c.release_proposed_on || c.release_informed_on || c.released_on || c.release_recorded_on) {
    const released = Boolean(c.released_on || c.release_recorded_on);
    const informed = Boolean(c.release_informed_on) || released;
    const tasks = [];
    if (!informed) tasks.push(task(c, 'release_tell', defaults));
    else if (!released) tasks.push(task(c, 'release_announce', defaults));
    if (released && !c.release_recorded_on) tasks.push(task(c, 'release_record', defaults));
    return { phase: released && c.release_recorded_on ? 'ended' : 'releasing', tasks };
  }
  const sustained = Boolean(c.sustained_on);
  const accepted = Boolean(c.accepted_on) || sustained;
  // extended_on: a call recorded as asked before this version of the app had an approval step.
  const approved = Boolean(c.approved_on || c.extended_on) || accepted;
  if (!approved) return { phase: 'proposed', tasks: [task(c, 'approve', defaults)] };
  if (!accepted) return { phase: 'approved', tasks: [task(c, 'extend', defaults)] };
  if (!sustained) return { phase: 'to_sustain', tasks: [task(c, 'sustain', defaults)] };
  const tasks = [];
  if (!c.recorded_on) tasks.push(task(c, 'record', defaults));
  if (!c.set_apart_on) tasks.push(task(c, 'set_apart', defaults));
  return { phase: 'serving', tasks };
}

// Short word for a calling that is on its way (org chart badge).
export function pendingLabel(c) {
  const p = callingState(c).phase;
  if (p === 'proposed') return 'proposed';
  if (p === 'approved') return String(c.extend_by || '').trim() ? 'being asked' : 'approved';
  if (p === 'to_sustain') return 'accepted';
  return p;
}

// Who records callings in LCR: the saved setting, or else the one active person on the Bishopric
// list whose role is Executive Secretary. '' when neither is known.
export function recorderFrom(people, saved) {
  const v = String(saved || '').trim().toUpperCase();
  if (v) return v === 'NONE' ? '' : v;
  const sec = people.filter((p) => /executive secretary/i.test(String(p.role || '')));
  return sec.length === 1 ? String(sec[0].initials).trim().toUpperCase() : '';
}

// ---------- stages ----------

// Which "In progress" section a calling is in, or null when nothing is left to do (or it is closed).
export function stageOf(c) {
  const { phase, tasks } = callingState(c);
  if (phase === 'proposed') return 'proposed';
  if (phase === 'approved') return String(c.extend_by || '').trim() ? 'assigned' : 'approved';
  if (phase === 'to_sustain') return 'sustain';
  if (phase === 'releasing') return tasks.length ? 'release' : null;
  if (phase === 'serving') {
    if (tasks.some((t) => t.step === 'record')) return 'record';
    if (tasks.some((t) => t.step === 'set_apart')) return 'set_apart';
  }
  return null;
}

function byOrgThenName(a, b) {
  return String(a.organization).localeCompare(String(b.organization)) ||
    String(a.member_name).localeCompare(String(b.member_name));
}

// { stageId: [callings] } for every stage, each list sorted by organization, then name.
export function pipeline(callings) {
  const out = Object.fromEntries(STAGES.map((s) => [s.id, []]));
  for (const c of live(callings)) {
    const s = stageOf(c);
    if (s) out[s].push(c);
  }
  for (const list of Object.values(out)) list.sort(byOrgThenName);
  return out;
}

// ---------- to-dos ----------

// Open to-dos: not removed, not done. Earliest due date first; those with no due date last.
export function openTodos(todos) {
  return todos.filter((t) => !isTrue(t.void) && !t.done_on && String(t.description || '').trim())
    .map((t, i) => ({ t, i }))
    .sort((a, b) => (a.t.due_on ? 0 : 1) - (b.t.due_on ? 0 : 1) || String(a.t.due_on || '').localeCompare(String(b.t.due_on || '')) || a.i - b.i)
    .map((x) => x.t);
}

// Done in the last `days` days (newest first), so a box checked by mistake can be unchecked.
export function recentlyDone(todos, today, days = 30) {
  const [y, m, d] = today.split('-').map(Number);
  const cut = new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
  return todos.filter((t) => !isTrue(t.void) && t.done_on && t.done_on >= cut)
    .sort((a, b) => String(b.done_on).localeCompare(String(a.done_on)));
}

// Holding the calling now: sustained and not yet released.
export function isCurrent(c) {
  const p = callingState(c).phase;
  return (p === 'serving' || p === 'releasing') && !c.released_on && !c.release_recorded_on;
}

// Proposed, approved (being asked) or accepted but not yet sustained.
export function isPending(c) {
  return ['proposed', 'approved', 'to_sustain'].includes(callingState(c).phase);
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

export function openTasks(callings, defaults = {}) {
  const out = [];
  for (const c of live(callings)) out.push(...callingState(c, defaults).tasks);
  return out.sort((a, b) => STEP_ORDER.indexOf(a.step) - STEP_ORDER.indexOf(b.step) ||
    String(a.calling.organization).localeCompare(String(b.calling.organization)) ||
    String(a.calling.member_name).localeCompare(String(b.calling.member_name)));
}

// What one person has to do (initials compared without case):
//   asks:   approved callings this person was assigned to contact
//   steps:  record in LCR, set apart and release steps assigned to this person
//   todos:  open to-dos assigned to this person
//   unassignedTodos: open to-dos nobody has
export function myWork({ callings, todos = [], initials, defaults = {} }) {
  const me = String(initials || '').trim().toUpperCase();
  const tasks = openTasks(callings, defaults);
  const open = openTodos(todos);
  const who = (t) => String(t.assigned_to || '').trim().toUpperCase();
  return {
    asks: me ? tasks.filter((t) => t.step === 'extend' && t.by === me) : [],
    steps: me ? tasks.filter((t) => ['record', 'set_apart', 'release_tell', 'release_record'].includes(t.step) && t.by === me) : [],
    todos: me ? open.filter((t) => who(t) === me) : [],
    unassignedTodos: open.filter((t) => !who(t)),
  };
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

// The ward's bishopric and executive secretary, from current callings in the Bishopric organization
// (callings marked "Serving outside the ward" are skipped). Used to fill the Bishopric list.
const BISHOPRIC_ROLES = [
  ['Bishop', 'Bishop'],
  ['Bishopric First Counselor', 'First Counselor'],
  ['Bishopric Second Counselor', 'Second Counselor'],
  ['Ward Executive Secretary', 'Executive Secretary'],
];

export function bishopricFromCallings(callings) {
  const out = [];
  for (const [calling, role] of BISHOPRIC_ROLES) {
    for (const c of live(callings)) {
      if (c.calling !== calling || c.organization !== 'Bishopric' || !isCurrent(c)) continue;
      if (out.some((o) => o.member_id === c.member_id)) continue;
      out.push({ initials: initialsFor(c.member_name), name: displayName(c.member_name), role, member_id: c.member_id });
    }
  }
  // Two people with the same initials: add the second letter of the first name to the later one.
  const seen = new Map();
  for (const o of out) {
    if (seen.has(o.initials)) {
      const first = displayName(o.name).split(' ')[0] || '';
      o.initials = `${o.initials[0]}${(first[1] || '').toUpperCase()}${o.initials.slice(1)}`;
    }
    seen.set(o.initials, true);
  }
  return out;
}

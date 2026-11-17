// Run with:  node --test      (made-up names only)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  callingState, isCurrent, isPending, monthsBetween, tenureMonths, formatTenure,
  myWork, sundayBusiness, currentCallings, membersWithoutCalling, openTasks,
  stageOf, pipeline, recorderFrom, openTodos, recentlyDone, pendingLabel,
} from '../js/features/callings-logic.js';

const TODAY = '2026-11-16';
const steps = (c) => callingState(c).tasks.map((t) => t.step);

test('call steps move in order; a later date implies the earlier ones', () => {
  assert.deepEqual(steps({ proposed_on: '2026-11-01' }), ['approve']);
  assert.equal(callingState({ proposed_on: '2026-11-01' }).phase, 'proposed');
  assert.deepEqual(steps({ proposed_on: '2026-11-01', approved_on: '2026-11-02' }), ['extend']);
  assert.equal(callingState({ proposed_on: '2026-11-01', approved_on: '2026-11-02' }).phase, 'approved');
  // asked before the approval step existed: counts as approved
  assert.deepEqual(steps({ proposed_on: '2026-11-01', extended_on: '2026-11-03' }), ['extend']);
  assert.deepEqual(steps({ approved_on: '2026-11-02', accepted_on: '2026-11-04' }), ['sustain']);
  assert.deepEqual(steps({ accepted_on: '2026-11-04' }), ['sustain']);        // accepted implies approved
  // sustained -> record in LCR, then set apart
  assert.deepEqual(steps({ sustained_on: '2026-11-08' }), ['record', 'set_apart']);
  assert.deepEqual(steps({ sustained_on: '2026-11-08', recorded_on: '2026-11-09' }), ['set_apart']);
  assert.deepEqual(steps({ sustained_on: '2026-11-08', set_apart_on: '2026-11-08', recorded_on: '2026-11-09' }), []);
  assert.equal(callingState({ sustained_on: '2026-11-08', set_apart_on: '2026-11-08', recorded_on: '2026-11-09' }).phase, 'serving');
});

test('stages of the In progress screen', () => {
  const votes = undefined;   // stages no longer depend on votes
  assert.equal(stageOf({ id: 'p1', proposed_on: '2026-11-01' }, votes), 'proposed');
  assert.equal(stageOf({ id: 'a1', approved_on: '2026-11-02' }, votes), 'approved');
  assert.equal(stageOf({ id: 'a2', approved_on: '2026-11-02', extend_by: 'ts' }, votes), 'assigned');
  assert.equal(stageOf({ id: 's1', accepted_on: '2026-11-04', extend_by: 'TS' }, votes), 'sustain');
  assert.equal(stageOf({ id: 'r1', sustained_on: '2026-11-08' }, votes), 'record');          // not set apart either: shown once, under LCR record
  assert.equal(stageOf({ id: 'r2', sustained_on: '2026-11-08', set_apart_on: '2026-11-08' }, votes), 'record');
  assert.equal(stageOf({ id: 'x1', sustained_on: '2026-11-08', recorded_on: '2026-11-09' }, votes), 'set_apart');
  assert.equal(stageOf({ id: 'd1', sustained_on: '2026-11-08', recorded_on: '2026-11-09', set_apart_on: '2026-11-08' }, votes), null);
  assert.equal(stageOf({ id: 'e1', sustained_on: '2024-01-07', recorded_on: '2024-01-08', set_apart_on: '2024-01-07', release_proposed_on: '2026-11-01' }, votes), 'release');
  // a release in progress is under Releases even if the calling was never set apart
  assert.equal(stageOf({ id: 'e2', sustained_on: '2024-01-07', recorded_on: '2024-01-08', release_proposed_on: '2026-11-01' }, votes), 'release');
  assert.equal(stageOf({ id: 'n1', proposed_on: '2026-11-01', not_approved_on: '2026-11-03' }, votes), null);
  assert.equal(stageOf({ id: 'n2', approved_on: '2026-11-02', declined_on: '2026-11-05' }, votes), null);
  assert.equal(stageOf({ id: 'v1', proposed_on: '2026-11-01', void: true }, votes), null);
});

test('who records callings in LCR: the setting, or else the Executive Secretary', () => {
  const people = [{ initials: 'AA', role: 'Bishop' }, { initials: 'ts', role: 'First Counselor' }, { initials: 'DS', role: 'Executive Secretary' }];
  assert.equal(recorderFrom(people, ''), 'DS');
  assert.equal(recorderFrom(people, 'ts'), 'TS');                 // a saved choice wins
  assert.equal(recorderFrom(people, 'NONE'), '');                 // "Nobody by default"
  assert.equal(recorderFrom(people.slice(0, 2), ''), '');         // no executive secretary on the list
  assert.equal(recorderFrom([...people, { initials: 'XS', role: 'Executive Secretary' }], ''), '');   // two: no guess
  // the default fills the LCR step only when the calling names nobody
  const c = { sustained_on: '2026-11-08' };
  assert.deepEqual(callingState(c, { record: 'DS' }).tasks.map((t) => `${t.step}:${t.by}`), ['record:DS', 'set_apart:']);
  assert.deepEqual(callingState({ ...c, record_by: 'ts' }, { record: 'DS' }).tasks.map((t) => `${t.step}:${t.by}`), ['record:TS', 'set_apart:']);
});

test('pipeline groups every calling in progress into one stage', () => {
  const cs = [
    { id: '1', member_name: 'Birch, Ben', organization: 'Primary', proposed_on: '2026-11-01' },
    { id: '2', member_name: 'Arbor, Amy', organization: 'Primary', proposed_on: '2026-11-01' },
    { id: '3', member_name: 'Cedar, Cora', organization: 'Elders Quorum', proposed_on: '2026-11-01' },
    { id: '4', member_name: 'Dogwood, Dan', organization: 'Primary', sustained_on: '2020-01-05', recorded_on: '2020-01-06' },
    { id: '5', member_name: 'Elmwood, Eli', organization: 'Primary', proposed_on: '2026-11-01', void: true },
  ];
  const p = pipeline(cs);
  assert.deepEqual(p.proposed.map((c) => c.id), ['3', '2', '1']);   // organization, then name
  assert.deepEqual(p.set_apart.map((c) => c.id), ['4']);
  assert.deepEqual(Object.keys(p), ['proposed', 'approved', 'assigned', 'sustain', 'record', 'release', 'set_apart']);
});

test('to-dos: open ones by due date, recently done', () => {
  const todos = [
    { id: 't1', description: 'No due date', assigned_to: 'AA' },
    { id: 't2', description: 'Due later', assigned_to: 'ts', due_on: '2026-11-30' },
    { id: 't3', description: 'Due soon', assigned_to: '', due_on: '2026-11-18' },
    { id: 't4', description: 'Done', assigned_to: 'TS', done_on: '2026-11-10' },
    { id: 't5', description: 'Done long ago', assigned_to: 'TS', done_on: '2026-09-01' },
    { id: 't6', description: 'Removed', assigned_to: 'TS', void: true },
    { id: 't7', description: '', assigned_to: 'TS' },
  ];
  assert.deepEqual(openTodos(todos).map((t) => t.id), ['t3', 't2', 't1']);
  assert.deepEqual(recentlyDone(todos, TODAY).map((t) => t.id), ['t4']);
  assert.deepEqual(recentlyDone(todos, TODAY, 90).map((t) => t.id), ['t4', 't5']);
});

test('my work: asks, other steps (with the LCR default) and to-dos', () => {
  const cs = [
    { id: 'c1', member_name: 'Arbor, Amy', organization: 'Primary', proposed_on: '2026-11-01' },
    { id: 'c3', member_name: 'Cedar, Cora', organization: 'Primary', approved_on: '2026-11-02', extend_by: 'ts' },
    { id: 'c4', member_name: 'Dogwood, Dan', organization: 'Primary', approved_on: '2026-11-02', extend_by: 'AA' },
    { id: 'c5', member_name: 'Elmwood, Eli', organization: 'Primary', sustained_on: '2026-11-08', record_by: 'TS', set_apart_by: 'AA' },
    { id: 'c6', member_name: 'Firwood, Fay', organization: 'Primary', sustained_on: '2026-11-08' },   // nobody named for LCR
  ];
  const todos = [{ id: 't1', description: 'Mine', assigned_to: 'ts' }, { id: 't2', description: 'Nobody', assigned_to: '' }, { id: 't3', description: 'Theirs', assigned_to: 'AA' }];
  const w = myWork({ callings: cs, todos, initials: 'ts' });
  assert.equal(w.votes, undefined);
  assert.deepEqual(w.asks.map((t) => t.calling.id), ['c3']);
  assert.deepEqual(w.steps.map((t) => `${t.calling.id}:${t.step}`), ['c5:record']);
  assert.deepEqual(w.todos.map((t) => t.id), ['t1']);
  assert.deepEqual(w.unassignedTodos.map((t) => t.id), ['t2']);
  // the person who records callings in LCR gets every LCR step that names nobody
  const ds = myWork({ callings: cs, todos, initials: 'DS', defaults: { record: 'DS' } });
  assert.deepEqual(ds.steps.map((t) => `${t.calling.id}:${t.step}`), ['c6:record']);
  // no initials: only the to-dos nobody has
  const none = myWork({ callings: cs, todos, initials: '' });
  assert.deepEqual([none.asks.length, none.steps.length, none.todos.length, none.unassignedTodos.length], [0, 0, 0, 1]);
});

test('org chart badge for callings on their way', () => {
  assert.equal(pendingLabel({ proposed_on: '2026-11-01' }), 'proposed');
  assert.equal(pendingLabel({ approved_on: '2026-11-02' }), 'approved');
  assert.equal(pendingLabel({ approved_on: '2026-11-02', extend_by: 'TS' }), 'being asked');
  assert.equal(pendingLabel({ accepted_on: '2026-11-04' }), 'accepted');
  assert.equal(isPending({ proposed_on: '2026-11-01', not_approved_on: '2026-11-03' }), false);
});

test('declined and removed callings have no tasks', () => {
  assert.equal(callingState({ approved_on: '2026-11-03', declined_on: '2026-11-04' }).phase, 'declined');
  assert.equal(callingState({ proposed_on: '2026-11-01', not_approved_on: '2026-11-04' }).phase, 'not_approved');
  assert.deepEqual(steps({ proposed_on: '2026-11-01', not_approved_on: '2026-11-04' }), []);
  assert.deepEqual(steps({ extended_on: '2026-11-03', declined_on: '2026-11-04' }), []);
  assert.equal(callingState({ proposed_on: '2026-11-01', void: 'TRUE' }).phase, 'void');
});

test('release steps', () => {
  const base = { sustained_on: '2024-01-07', set_apart_on: '2024-01-07', recorded_on: '2024-01-08' };
  assert.deepEqual(steps({ ...base, release_proposed_on: '2026-11-01' }), ['release_tell']);
  assert.deepEqual(steps({ ...base, release_proposed_on: '2026-11-01', release_informed_on: '2026-11-02' }), ['release_announce']);
  assert.deepEqual(steps({ ...base, release_informed_on: '2026-11-02', released_on: '2026-11-08' }), ['release_record']);
  const ended = { ...base, released_on: '2026-11-08', release_recorded_on: '2026-11-09' };
  assert.equal(callingState(ended).phase, 'ended');
  assert.equal(isCurrent({ ...base, release_proposed_on: '2026-11-01' }), true);   // still serving until released
  assert.equal(isCurrent(ended), false);
});

test('current and pending', () => {
  assert.equal(isPending({ proposed_on: '2026-11-01' }), true);
  assert.equal(isCurrent({ proposed_on: '2026-11-01' }), false);
  assert.equal(isCurrent({ sustained_on: '2025-01-05' }), true);
});

test('time in calling', () => {
  assert.equal(monthsBetween('2024-01-07', '2026-11-16'), 34);
  assert.equal(monthsBetween('2026-10-20', '2026-11-16'), 0);
  assert.equal(tenureMonths({ sustained_on: '2024-01-07' }, TODAY), 34);
  assert.equal(tenureMonths({ sustained_on: '2024-01-07', released_on: '2025-01-07' }, TODAY), 12);
  assert.equal(tenureMonths({ proposed_on: '2026-11-01' }, TODAY), null);
  assert.equal(formatTenure(34), '2 yr 10 mo');
  assert.equal(formatTenure(12), '1 yr');
  assert.equal(formatTenure(5), '5 mo');
  assert.equal(formatTenure(0), 'under 1 month');
});

const callings = [
  { id: 'c1', member_id: 'a', member_name: 'Arbor, Amy', organization: 'Primary', calling: 'Teacher', proposed_on: '2026-11-01', approved_on: '2026-11-02', extend_by: 'kw' },
  { id: 'c2', member_id: 'b', member_name: 'Birch, Ben', organization: 'Sunday School', calling: 'Teacher', approved_on: '2026-11-02', accepted_on: '2026-11-05', extend_by: 'DS' },
  { id: 'c3', member_id: 'c', member_name: 'Cedar, Cora', organization: 'Relief Society', calling: 'Secretary', sustained_on: '2023-02-05', set_apart_on: '2023-02-05', recorded_on: '2023-02-06', release_informed_on: '2026-11-10', release_proposed_on: '2026-11-01' },
  { id: 'c4', member_id: 'd', member_name: 'Dogwood, Dan', organization: 'Elders Quorum', calling: 'Secretary', sustained_on: '2026-11-08', recorded_on: '2026-11-09' },
  { id: 'c5', member_id: 'e', member_name: 'Elmwood, Eli', organization: 'Primary', calling: 'Teacher', approved_on: '2026-10-01', declined_on: '2026-10-02' },
  { id: 'c6', member_id: 'f', member_name: 'Firwood, Fay', organization: 'Primary', calling: 'Pianist', proposed_on: '2026-11-01', void: true },
  { id: 'c7', member_id: 'g', member_name: 'Golf, Gus', organization: 'Primary', calling: 'Pianist', proposed_on: '2026-11-01', not_approved_on: '2026-11-03' },
];

test('Sunday business: releases and sustainings', () => {
  const s = sundayBusiness(callings);
  assert.deepEqual(s.releases.map((c) => c.id), ['c3']);
  assert.deepEqual(s.sustainings.map((c) => c.id), ['c2']);
});

test('open tasks are ordered by step', () => {
  assert.deepEqual(openTasks(callings).map((t) => `${t.calling.id}:${t.step}`), ['c1:extend', 'c2:sustain', 'c4:set_apart', 'c3:release_announce']);
});

test('current callings and members without a calling', () => {
  assert.deepEqual(currentCallings(callings).map((c) => c.id), ['c4', 'c3']);
  const members = [
    { id: 'a', name: 'Arbor, Amy', age: 40, age_as_of: TODAY, status: 'active' },     // pending call
    { id: 'c', name: 'Cedar, Cora', age: 50, age_as_of: TODAY, status: 'active' },    // current (release in progress)
    { id: 'e', name: 'Elmwood, Eli', age: 30, age_as_of: TODAY, status: 'active' },   // declined -> no calling
    { id: 'g', name: 'Golf, Gus', age: 15, age_as_of: TODAY, status: 'active' },      // under 18 (not approved -> no calling)
    { id: 'h', name: 'Hazel, Hal', age: 60, age_as_of: TODAY, status: 'moved' },
    { id: 'i', name: 'Ivy, Ida', age: '', status: 'active' },                          // age unknown -> listed
  ];
  assert.deepEqual(membersWithoutCalling(members, callings, TODAY, 18).map((r) => r.member.id), ['e', 'i']);
  assert.deepEqual(membersWithoutCalling(members, callings, TODAY, 12).map((r) => r.member.id), ['e', 'g', 'i']);
});

test('bishopric list from current callings', async () => {
  const { bishopricFromCallings } = await import('../js/features/callings-logic.js');
  const { initialsFor, displayName, activeBishopric } = await import('../js/members.js');
  assert.equal(initialsFor('Arbor, Amy Lynn'), 'AA');
  assert.equal(initialsFor('Núñez Cárdenas, José Luis'), 'JN');
  assert.equal(displayName('Arbor, Amy Lynn'), 'Amy Arbor');
  const cs = [
    { id: '1', member_id: 'a', member_name: 'Arbor, Amy', calling: 'Bishopric First Counselor', organization: 'Bishopric', sustained_on: '2025-09-28' },
    { id: '2', member_id: 'b', member_name: 'Birch, Ben', calling: 'Bishop', organization: 'Bishopric', sustained_on: '2025-09-28' },
    { id: '3', member_id: 'c', member_name: 'Cedar, Cal', calling: 'Bishop', organization: 'Serving outside the ward', sustained_on: '2025-05-25' },
    { id: '4', member_id: 'd', member_name: 'Dogwood, Dan', calling: 'Ward Executive Secretary', organization: 'Bishopric', sustained_on: '2026-04-12' },
    { id: '5', member_id: 'e', member_name: 'Elm, Edna', calling: 'Bishopric Second Counselor', organization: 'Bishopric', sustained_on: '2026-05-31' },
    { id: '6', member_id: 'f', member_name: 'Fir, Fred', calling: 'Bishopric Second Counselor', organization: 'Bishopric', sustained_on: '2020-01-05', released_on: '2024-01-07', release_recorded_on: '2024-01-08' },
    { id: '7', member_id: 'g', member_name: 'Elm, Eric', calling: 'Ward Clerk', organization: 'Bishopric', sustained_on: '2026-07-12' },
  ];
  assert.deepEqual(bishopricFromCallings(cs).map((b) => [b.initials, b.name, b.role]), [
    ['BB', 'Ben Birch', 'Bishop'],
    ['AA', 'Amy Arbor', 'First Counselor'],
    ['EE', 'Edna Elm', 'Second Counselor'],
    ['DD', 'Dan Dogwood', 'Executive Secretary'],
  ]);
  // same initials -> second letter of the first name added
  const twin = bishopricFromCallings([cs[1], { id: '8', member_id: 'h', member_name: 'Brown, Bill', calling: 'Ward Executive Secretary', organization: 'Bishopric', sustained_on: '2026-01-04' }]);
  assert.deepEqual(twin.map((b) => b.initials), ['BB', 'BIB']);
  assert.deepEqual(activeBishopric([{ initials: 'kw', active: true }, { initials: 'gh', active: 'FALSE' }, { initials: '' }]).map((r) => r.initials), ['KW']);
});

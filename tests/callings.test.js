// Run with:  node --test      (made-up names only)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  callingState, isCurrent, isPending, monthsBetween, tenureMonths, formatTenure,
  myTasks, sundayBusiness, currentCallings, membersWithoutCalling, openTasks,
} from '../js/features/callings-logic.js';

const TODAY = '2026-11-16';
const steps = (c) => callingState(c).tasks.map((t) => t.step);

test('call steps move in order; a later date implies the earlier ones', () => {
  assert.deepEqual(steps({ proposed_on: '2026-11-01' }), ['extend']);
  assert.equal(callingState({ proposed_on: '2026-11-01' }).phase, 'proposed');
  assert.deepEqual(steps({ proposed_on: '2026-11-01', extended_on: '2026-11-03' }), ['answer']);
  assert.deepEqual(steps({ extended_on: '2026-11-03', accepted_on: '2026-11-04' }), ['sustain']);
  // sustained -> set apart and record in LCR are both open, in either order
  assert.deepEqual(steps({ sustained_on: '2026-11-08' }), ['set_apart', 'record']);
  assert.deepEqual(steps({ sustained_on: '2026-11-08', recorded_on: '2026-11-09' }), ['set_apart']);
  assert.deepEqual(steps({ sustained_on: '2026-11-08', set_apart_on: '2026-11-08', recorded_on: '2026-11-09' }), []);
  assert.equal(callingState({ sustained_on: '2026-11-08', set_apart_on: '2026-11-08', recorded_on: '2026-11-09' }).phase, 'serving');
});

test('declined and removed callings have no tasks', () => {
  assert.equal(callingState({ extended_on: '2026-11-03', declined_on: '2026-11-04' }).phase, 'declined');
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
  { id: 'c1', member_id: 'a', member_name: 'Arbor, Amy', organization: 'Primary', calling: 'Teacher', proposed_on: '2026-11-01', extend_by: 'kw' },
  { id: 'c2', member_id: 'b', member_name: 'Birch, Ben', organization: 'Sunday School', calling: 'Teacher', extended_on: '2026-11-03', accepted_on: '2026-11-05', extend_by: 'DS' },
  { id: 'c3', member_id: 'c', member_name: 'Cedar, Cora', organization: 'Relief Society', calling: 'Secretary', sustained_on: '2023-02-05', set_apart_on: '2023-02-05', recorded_on: '2023-02-06', release_informed_on: '2026-11-10', release_proposed_on: '2026-11-01' },
  { id: 'c4', member_id: 'd', member_name: 'Dogwood, Dan', organization: 'Elders Quorum', calling: 'Secretary', sustained_on: '2026-11-08', recorded_on: '2026-11-09' },
  { id: 'c5', member_id: 'e', member_name: 'Elmwood, Eli', organization: 'Primary', calling: 'Teacher', extended_on: '2026-10-01', declined_on: '2026-10-02' },
  { id: 'c6', member_id: 'f', member_name: 'Firwood, Fay', organization: 'Primary', calling: 'Pianist', proposed_on: '2026-11-01', void: true },
];

test('my tasks and unassigned tasks', () => {
  const { mine, unassigned } = myTasks(callings, 'KW');
  assert.deepEqual(mine.map((t) => [t.calling.id, t.step]), [['c1', 'extend']]);   // initials compared without case
  // c4 still needs setting apart and nobody is assigned; c3's next step (release in sacrament meeting) has no assignee column
  assert.deepEqual(unassigned.map((t) => [t.calling.id, t.step]), [['c4', 'set_apart']]);
});

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
    { id: 'g', name: 'Golf, Gus', age: 15, age_as_of: TODAY, status: 'active' },      // under 18
    { id: 'h', name: 'Hazel, Hal', age: 60, age_as_of: TODAY, status: 'moved' },
    { id: 'i', name: 'Ivy, Ida', age: '', status: 'active' },                          // age unknown -> listed
  ];
  assert.deepEqual(membersWithoutCalling(members, callings, TODAY, 18).map((r) => r.member.id), ['e', 'i']);
  assert.deepEqual(membersWithoutCalling(members, callings, TODAY, 12).map((r) => r.member.id), ['e', 'g', 'i']);
});

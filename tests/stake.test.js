// Run with:  node --test      The stake sheet reader and the calendar rules (made-up names only).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readStakeSheet, hcVisits, wardKey, cellIsWard, timeOf, parseChrono } from '../js/features/stake-parse.js';
import { fastSundays, calendarItems, monthNotes, formatTime, comingUpRange, comingUpText } from '../js/features/calendar-logic.js';

import { STAKE_TABS, T } from './fixtures/stake-tabs.mjs';

test('ward names, cells and times', () => {
  assert.deepEqual(['MS-6', 'MS6th', 'MS 6', 'Morningside 6th', 'East Ridge'].map(wardKey), ['MS6', 'MS6', 'MS6', 'MORNINGSIDE6', 'EASTRIDGE']);
  assert.equal(cellIsWard('Ivo Marchbank -- EX6th', ['EX6']), true);
  assert.equal(cellIsWard('EX-6', ['EX6']), true);
  assert.equal(cellIsWard('EX-16', ['EX6']), false);
  assert.deepEqual([timeOf(T(19)), timeOf(T(7, 30)), timeOf('7:00 PM'), timeOf('12:15 AM'), timeOf('10:30:00'), timeOf('TBD'), timeOf('')],
    ['19:00', '07:30', '19:00', '00:15', '10:30', '', '']);
  assert.deepEqual([formatTime('19:00'), formatTime('00:15'), formatTime('12:00'), formatTime('')], ['7:00 PM', '12:15 AM', '12:00 PM', '']);
});

test('stake sheet: events, ward events, problems', () => {
  const s = readStakeSheet(STAKE_TABS, ['EX6']);
  assert.deepEqual(s.wardKeys, ['EX6', 'EXAMPLE6']);   // the legend adds the spelled-out name
  assert.deepEqual(s.events.map((e) => [e.date, e.time, e.title, e.ward]), [
    ['2027-01-02', '10:00', 'Stake Baptisms', ''],
    ['2027-01-13', '19:00', 'RR - Ward Conference Training Meeting', 'RR'],
    ['2027-01-17', '19:00', 'EX6 - Ward Conference', 'EX6'],
    ['2027-01-20', '18:00', 'YSA - Dance', ''],          // YSA is not a ward in the legend: stake-wide
    ['2027-04-04', '10:00', 'General Conference', ''],
  ]);
  assert.equal(s.problems.length, 2);
  assert.match(s.problems[0], /row 9: "YSA - Dance" says Thu, but 2027-01-20 is a wed/);
  assert.match(s.problems[1], /row 10: could not read the date of "Leadership meeting"/);
  assert.deepEqual(s.updated, ['Calendar: Updated 10-25-26', 'Stake presidency and high council: Updated 10-25-2026']);
});

test('stake sheet: high council visits, ward turns, people', () => {
  const s = readStakeSheet(STAKE_TABS, ['EX6']);
  assert.deepEqual(hcVisits(s).map((v) => [v.year, v.month, v.name, v.topic]), [
    [2027, 2, 'Bram Thistlewood', 'Stake Theme'], [2027, 3, 'Corin Copperpot', 'Faith in Christ'],
  ]);
  // hospital: the ward's code in the month cell, the second JAN under the 2028 year row; rehab: X on the ward's row
  assert.deepEqual(s.turns.map((t) => [t.year, t.month, t.what, t.who]), [
    [2027, 3, 'Example Rehab Sacrament Administration', 'Lark Brambleton'],
    [2027, 11, 'Example Rehab Sacrament Administration', 'Lark Brambleton'],
    [2027, 3, 'Hospital blessings', 'Ivo Marchbank'],
    [2028, 1, 'Hospital blessings', 'Ivo Marchbank'],
  ]);
  assert.deepEqual(s.leaders.map((p) => [p.name, p.calling, p.ward, Boolean(p.phone), p.email]), [
    ['President Orrin Quillfeather', 'Stake President', '', true, 'oq@example.invalid'],
    ['Bram Thistlewood', 'High Council', 'Example 6th', true, 'bt@example.invalid'],
    ['Corin Copperpot', 'High Council', 'Example 1st', true, ''],
  ]);   // missionaries, the theme verse and the "Updated" line are not people
  assert.deepEqual(s.bishops.map((p) => [p.name, p.calling, p.ward]), [['Lark Brambleton', 'Bishop', 'EX-6']]);   // building key left out
  assert.deepEqual(s.stakeCallings.map((p) => [p.name, p.calling]), [['Wren Halloway', 'Primary President']]);
});

test('stake sheet: missing parts are reported, not guessed', () => {
  const s = readStakeSheet([{ title: 'Something else', rows: [['hello']] }], ['EX6']);
  assert.deepEqual([s.events.length, s.leaders.length, s.turns.length], [0, 0, 0]);
  assert.equal(s.problems.length, 3);
  const noYear = parseChrono({ title: 'Stake Chrono Calendar', rows: [['Month', 'Day', 'Time', 'Event'], ['January'], ['', '2 (Sat)', '', 'X']] });
  assert.match(noYear.problems[0], /year is not in the tab name/);
});

test('fast Sundays: first Sunday; second in April and October; moved for stake conference', () => {
  assert.deepEqual(fastSundays('2026-11-16', '2027-05-31').map((f) => `${f.date}${f.moved ? ` (${f.moved})` : ''}`), [
    '2026-12-06', '2027-01-03', '2027-02-07', '2027-03-07', '2027-04-11 (General Conference)', '2027-05-02',
  ]);   // Nov 1 2026 is before the start date
  const stakeConf = [{ date: '2027-02-07', title: 'Example Stake Conference General Session' }];
  assert.deepEqual(fastSundays('2027-02-01', '2027-02-28', stakeConf), [{ date: '2027-02-14', moved: 'stake conference' }]);
  assert.deepEqual(fastSundays('2027-10-01', '2027-10-31').map((f) => f.date), ['2027-10-10']);
});

test('calendar items: hand events, stake, speakers, to-dos, fast Sundays; month notes', () => {
  const stake = readStakeSheet(STAKE_TABS, ['EX6']);
  const args = {
    from: '2027-01-01', to: '2027-01-31', stake,
    events: [{ id: 'e1', date: '2027-01-17', time: T(18, 30), title: 'Ward dinner' }, { id: 'e2', date: '2027-01-09', title: 'Removed', void: true }],
    talks: [{ date: '2027-01-10', member_id: 'm1', member_name: 'Arbor, Amy' }, { date: '2027-01-10', name_as_shown: 'Visiting Speaker' }, { date: '2027-02-07', member_id: 'm2', member_name: 'Birch, Ben' }],
    todos: [{ description: 'Order programs', assigned_to: 'ts', due_on: '2027-01-15' }, { description: 'Done one', due_on: '2027-01-16', done_on: '2027-01-14' }],
  };
  const list = (o) => calendarItems(o).map((i) => `${i.date} ${i.kind} ${i.time} ${i.title}${i.people ? `: ${i.people.map((p) => p.name).join(', ')}` : ''}${i.who ? ` (${i.who})` : ''}`.replace(/\s+/g, ' ').trim());
  assert.deepEqual(list(args), [
    '2027-01-02 stake 10:00 Stake Baptisms',
    '2027-01-03 fast Fast Sunday',
    '2027-01-10 speakers Speakers: Arbor, Amy, Visiting Speaker',
    '2027-01-15 todo Order programs (TS)',
    '2027-01-17 event 18:30 Ward dinner',
    '2027-01-17 ward 19:00 EX6 - Ward Conference',
    '2027-01-20 stake 18:00 YSA - Dance',
  ]);   // the other ward's event is hidden; removed events and finished to-dos are left out
  assert.ok(list({ ...args, otherWards: true }).includes('2027-01-13 other 19:00 RR - Ward Conference Training Meeting'));
  assert.deepEqual(monthNotes({ from: '2027-01-01', to: '2027-03-31', stake }).map((n) => `${n.year}-${n.month} ${n.kind} ${n.text}`), [
    '2027-2 hc High council speaker: Bram Thistlewood. Topic: Stake Theme',
    '2027-3 hc High council speaker: Corin Copperpot. Topic: Faith in Christ',
    '2027-3 turn Example Rehab Sacrament Administration (Lark Brambleton)',
    '2027-3 turn Hospital blessings (Ivo Marchbank)',
  ]);
  assert.deepEqual(calendarItems({ from: '2027-01-01', to: '2027-01-31' }).map((i) => i.kind), ['fast']);   // works with no stake sheet
});

test('coming up: date ranges and the copy text', () => {
  assert.deepEqual(comingUpRange('2026-11-16'), { from: '2026-11-16', to: '2026-12-16' });
  assert.deepEqual(comingUpRange('2026-11-16', 'weeks2'), { from: '2026-11-16', to: '2026-11-30' });
  assert.deepEqual(comingUpRange('2026-11-16', 'nextMonth'), { from: '2026-12-01', to: '2026-12-31' });
  assert.deepEqual(comingUpRange('2026-12-31', 'nextMonth'), { from: '2027-01-01', to: '2027-01-31' });
  assert.deepEqual(comingUpRange('2027-01-31'), { from: '2027-01-31', to: '2027-02-28' });   // no Feb 31: the last day of February

  const stake = readStakeSheet(STAKE_TABS, ['EX6']);
  const { from, to } = { from: '2027-01-01', to: '2027-02-28' };
  const items = calendarItems({
    from, to, stake,
    events: [{ id: 'e1', date: '2027-01-17', time: T(18, 30), title: 'Ward dinner', notes: 'Bring a side dish' }],
    talks: [{ date: '2027-01-10', member_id: 'm1', member_name: 'Arbor, Amy Lynn' }, { date: '2027-01-10', name_as_shown: 'Visiting Speaker' }],
    todos: [{ description: 'Order programs', assigned_to: 'ts', due_on: '2027-01-15' }],
  });
  const notes = monthNotes({ from, to, stake });
  const base = { events: true, fast: true, notes: true, speakers: false, todos: false };
  assert.equal(comingUpText({ items, notes, include: base }), [
    'February: High council speaker: Bram Thistlewood. Topic: Stake Theme',
    'Sat, Jan 2, 10:00 AM: Stake Baptisms',
    'Sun, Jan 3: Fast Sunday',
    'Sun, Jan 17, 6:30 PM: Ward dinner (Bring a side dish)',
    'Sun, Jan 17, 7:00 PM: Ward Conference (Our ward)',     // the ward's own code is dropped
    'Wed, Jan 20, 6:00 PM: YSA - Dance',
    'Sun, Feb 7: Fast Sunday',
  ].join('\n'));
  const all = comingUpText({ items, notes: [], include: { ...base, notes: false, speakers: true, todos: true } }).split('\n');
  assert.ok(all.includes('Sun, Jan 10: Speakers: Amy Arbor, Visiting Speaker'));   // "Last, First" written as "First Last"
  assert.ok(all.includes('Fri, Jan 15: Order programs (TS)'));
  assert.equal(comingUpText({ items, notes, include: { events: false, fast: false, notes: false, speakers: false, todos: false } }), '');
  // What the Coming up panel uses: general ward information only (ward items and stake events).
  assert.equal(comingUpText({ items, include: { events: true } }), [
    'Sat, Jan 2, 10:00 AM: Stake Baptisms',
    'Sun, Jan 17, 6:30 PM: Ward dinner (Bring a side dish)',
    'Sun, Jan 17, 7:00 PM: Ward Conference (Our ward)',
    'Wed, Jan 20, 6:00 PM: YSA - Dance',
  ].join('\n'));
});

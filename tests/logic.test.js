// Run with:  node --test
// All names below are made up. Never put real member data in this repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, serialToISO, addMonths, nextSunday, daysBetween, formatDate } from '../js/dates.js';
import { currentAge, parseMemberList, diffImport, normName, ageGroup } from '../js/members.js';
import { buildAskList, summarize, upcomingTalks, pastTalks } from '../js/features/speakers-logic.js';

const TODAY = '2026-11-16';

test('dates: Sheets serial numbers, ISO and US formats', () => {
  assert.equal(serialToISO(46334), '2026-11-08');          // 8 Nov 2026 in Google Sheets
  assert.equal(parseDate(46334), '2026-11-08');
  assert.equal(parseDate('2026-11-08'), '2026-11-08');
  assert.equal(parseDate('2026-11-08 14:30'), '2026-11-08');
  assert.equal(parseDate('11/8/2026'), '2026-11-08');
  assert.equal(parseDate('2/30/2026'), '');                // not a real date
  assert.equal(parseDate(''), '');
  assert.equal(parseDate('soon'), '');
});

test('dates: month arithmetic, Sundays, formatting', () => {
  assert.equal(addMonths('2026-11-16', -36), '2023-11-16');
  assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
  assert.equal(addMonths('2024-03-31', -1), '2024-02-29');
  assert.equal(nextSunday('2026-11-16'), '2026-11-22');    // Monday -> next Sunday
  assert.equal(nextSunday('2026-11-22'), '2026-11-22');    // already Sunday
  assert.equal(daysBetween('2026-11-14', '2026-11-16'), 2);
  assert.equal(formatDate('2026-11-08'), '8 Nov 2026');
});

test('members: current age grows from the recorded age', () => {
  assert.equal(currentAge({ age: 45, age_as_of: '2026-11-14' }, '2026-11-16'), 45);
  assert.equal(currentAge({ age: 45, age_as_of: '2026-11-14' }, '2027-11-15'), 46);
  assert.equal(currentAge({ age: '', age_as_of: '' }, TODAY), null);
  assert.equal(ageGroup(null), 'unknown');
  assert.equal(ageGroup(11), '8-11');
  assert.equal(ageGroup(12), '12-17');
  assert.equal(ageGroup(18), '18+');
  assert.equal(normName('  Núñez,José  Luis '), 'nunez, jose luis');
});

function member(id, name, extra = {}) {
  return { id, name, gender: 'F', age: 40, age_as_of: '2026-11-14', status: 'active', category: '', ...extra };
}

test('ask list: who is left off, and why', () => {
  const members = [
    member('a', 'Alpha, Ann'),                                   // never spoke -> listed
    member('b', 'Bravo, Bea'),                                   // spoke 2025 -> hidden (recent)
    member('c', 'Charlie, Cal', { gender: 'M' }),                // spoke 2022 -> listed, tier 2
    member('d', 'Delta, Dee', { category: 'do_not_ask' }),          // "Shouldn't ask" -> bottom, grayed
    member('e', 'Echo, Eve', { category: 'not_now', category_until: '2027-01-01' }),
    member('f', 'Fox, Fay', { category: 'not_now', category_until: '2026-11-01' }), // expired -> listed
    member('g', 'Golf, Gus', { status: 'moved' }),
    member('h', 'Hotel, Hal', { age: 7 }),
    member('i', 'India, Ida'),                                   // scheduled next Sunday -> hidden
    member('j', 'Juliet, Jo', { category: 'ask_soon', moved_in: '2026-10-01' }),
  ];
  const talks = [
    { id: 't1', member_id: 'b', date: '2025-06-01' },
    { id: 't2', member_id: 'c', date: '2022-05-01', date_estimated: true },
    { id: 't3', member_id: 'i', date: '2026-11-22' },
    { id: 't4', member_id: 'a', date: '2026-01-01', void: 'TRUE' },  // removed by mistake-fix
  ];
  const { rows, hidden, cutoff, others, bottomCount } = buildAskList({ members, talks, refusals: [], today: TODAY, settings: { windowYears: 3 } });
  assert.equal(cutoff, '2023-11-16');
  assert.deepEqual(rows.map((r) => r.member.id), ['j', 'a', 'f', 'c', 'd']);
  assert.deepEqual(hidden, { recent: 1, scheduled: 1, notNow: 1, moved: 1, young: 1 });
  assert.equal(rows.find((r) => r.member.id === 'd').bottom, 'do_not_ask');
  assert.equal(bottomCount, 1);
  assert.deepEqual(others, []);   // no search -> no "also matching" list
  const j = rows.find((r) => r.member.id === 'j');
  assert.equal(j.isNew, true);
  const c = rows.find((r) => r.member.id === 'c');
  assert.equal(c.lastTalk, '2022-05-01');
  assert.equal(c.lastEstimated, true);
});

test('ask list: tier 2 sorted oldest talk first; filters', () => {
  const members = [member('x', 'Xray, Xo', { gender: 'M' }), member('y', 'Yankee, Yu'), member('z', 'Zulu, Zed', { age: 14 })];
  const talks = [
    { id: '1', member_id: 'x', date: '2023-01-01' },
    { id: '2', member_id: 'y', date: '2021-01-01' },
    { id: '3', member_id: 'z', date: '2022-01-01' },
  ];
  const all = buildAskList({ members, talks, refusals: [], today: TODAY });
  assert.deepEqual(all.rows.map((r) => r.member.id), ['y', 'z', 'x']);
  const youth = buildAskList({ members, talks, refusals: [], today: TODAY, filters: { group: '12-17' } });
  assert.deepEqual(youth.rows.map((r) => r.member.id), ['z']);
  const men = buildAskList({ members, talks, refusals: [], today: TODAY, filters: { gender: 'M' } });
  assert.deepEqual(men.rows.map((r) => r.member.id), ['x']);
  const search = buildAskList({ members, talks, refusals: [], today: TODAY, filters: { search: 'yan' } });
  assert.deepEqual(search.rows.map((r) => r.member.id), ['y']);
});

test('ask list: a decline is highlighted only if it is after the last talk', () => {
  const members = [member('p', 'Papa, Pat'), member('q', 'Quebec, Quin')];
  const talks = [{ id: '1', member_id: 'q', date: '2021-03-01' }];
  const refusals = [
    { id: 'r1', member_id: 'p', date: '2026-10-04' },
    { id: 'r2', member_id: 'q', date: '2020-01-01' },     // before the talk -> not shown
  ];
  const { rows } = buildAskList({ members, talks, refusals, today: TODAY });
  assert.equal(rows.find((r) => r.member.id === 'p').declined, '2026-10-04');
  assert.equal(rows.find((r) => r.member.id === 'q').declined, '');
});

test('talk lists: upcoming and past, removed talks ignored', () => {
  const talks = [
    { id: '1', member_id: 'a', date: '2026-11-22' },
    { id: '2', member_id: 'b', date: '2026-11-29' },
    { id: '3', member_id: 'c', date: '2026-11-08' },
    { id: '4', member_id: 'd', date: '2026-12-06', void: true },
  ];
  assert.deepEqual(upcomingTalks(talks, TODAY).map((t) => t.id), ['1', '2']);
  assert.deepEqual(pastTalks(talks, TODAY).map((t) => t.id), ['3']);
  const s = summarize([{ id: 'a' }], talks, [], TODAY).get('a');
  assert.equal(s.next, '2026-11-22');
  assert.equal(s.count, 0);
});

const SAMPLE_LIST = `Member List
 Sample 1st Ward (000000)

  Name                                               Gender                                     Age

  Alpha, Ann                                         F                                          40

  Testerson, John M                                      M                                          45
\tNewcomer, Nina\tF\t33
"Youngling, Yara", F, 8
  Tiny, Tom                                          M                                          5
14 Nov 2026                For Church Use Only © 2026 by Intellectual Reserve, Inc. All rights reserved.   1
Count: 5
`;

test('import: parses the member list format, tabs and CSV', () => {
  const p = parseMemberList(SAMPLE_LIST);
  assert.equal(p.declared, 5);
  assert.deepEqual(p.rows, [
    { name: 'Alpha, Ann', gender: 'F', age: 40 },
    { name: 'Testerson, John M', gender: 'M', age: 45 },
    { name: 'Newcomer, Nina', gender: 'F', age: 33 },
    { name: 'Youngling, Yara', gender: 'F', age: 8 },
    { name: 'Tiny, Tom', gender: 'M', age: 5 },
  ]);
  assert.ok(p.skipped.some((l) => l.startsWith('Member List')));
});

test('import: new, just turned 8, missing, returned and ignored', () => {
  const members = [
    member('a', 'Alpha, Ann', { source: 'Member List PDF 14 Nov 2026' }),
    member('s', 'Testerson, John M', { source: 'Member List PDF 14 Nov 2026', status: 'moved' }),
    member('g', 'Gone, Gail', { source: 'Member List PDF 14 Nov 2026' }),
    member('w', 'Handadd, Will', { source: 'Added in review (lives in ward, not on PDF)' }),
  ];
  const d = diffImport(members, parseMemberList(SAMPLE_LIST).rows, 8);
  assert.deepEqual(d.updates.map((u) => u.member.id), ['a', 's']);
  assert.deepEqual(d.returned.map((m) => m.id), ['s']);
  assert.deepEqual(d.added.map((a) => [a.name, a.newToWard]), [['Newcomer, Nina', true], ['Youngling, Yara', false]]);
  assert.deepEqual(d.missing.map((m) => m.id), ['g']);   // Will was added by hand, so not flagged
  assert.equal(d.ignoredYoung, 1);
});

test('email matching for the Bishopric list', async () => {
  const { normEmail, bishopricForEmail } = await import('../js/members.js');
  assert.equal(normEmail(' Tess.Sample@Gmail.com '), 'tesssample@gmail.com');
  assert.equal(normEmail('t.s@example.org'), 't.s@example.org');          // dots only ignored for Gmail
  const rows = [
    { id: 'b1', initials: 'ts', name: 'Tess Sample', email: 'Tess.Sample@gmail.com', active: true },
    { id: 'b2', initials: 'AA', name: 'Amy Arbor', email: 'amy@example.org', active: 'FALSE' },
  ];
  assert.equal(bishopricForEmail(rows, 'tesssample@gmail.com').initials, 'TS');
  assert.equal(bishopricForEmail(rows, 'amy@example.org'), null);           // removed from the list
  assert.equal(bishopricForEmail(rows, ''), null);
});

test('ask list: "Shouldn\'t ask" and "Won\'t accept" at the bottom; search shows people left off', () => {
  const members = [
    member('a', 'Alpha, Ann'),
    member('w', 'Whiskey, Will', { category: 'wont_accept' }),             // no talk -> first of the bottom group
    member('x', 'Xray, Xia', { category: 'do_not_ask' }),                   // old talk -> after Will
    member('y', 'Yankee, Yul', { category: 'ask_soon' }),
    member('r', 'Recent, Rae'),                                             // spoke this year -> off the list
    member('s', 'Sched, Sam'),                                              // scheduled -> off the list
    member('n', 'Nownot, Nia', { category: 'not_now', category_until: '2027-03-01' }),
    member('m', 'Moved, Max', { status: 'moved' }),
    member('rw', 'Recent, Wren', { category: 'wont_accept' }),              // spoke recently: the recent rule wins
  ];
  const talks = [
    { id: '1', member_id: 'x', date: '2021-02-07' },
    { id: '2', member_id: 'r', date: '2026-03-01' },
    { id: '3', member_id: 's', date: '2026-11-22' },
    { id: '4', member_id: 'rw', date: '2026-06-07' },
  ];
  const all = buildAskList({ members, talks, refusals: [], today: TODAY });
  assert.deepEqual(all.rows.map((r) => [r.member.id, r.tier]), [['y', 0], ['a', 1], ['w', 3], ['x', 3]]);
  assert.equal(all.bottomCount, 2);
  const found = buildAskList({ members, talks, refusals: [], today: TODAY, filters: { search: 're' } });
  assert.deepEqual(found.rows.map((r) => r.member.id), []);
  assert.deepEqual(found.others.map((o) => [o.member.id, o.reason, o.date]), [['r', 'recent', '2026-03-01'], ['rw', 'recent', '2026-06-07']]);
  const sched = buildAskList({ members, talks, refusals: [], today: TODAY, filters: { search: 'sched' } });
  assert.deepEqual(sched.others.map((o) => [o.member.id, o.reason, o.date]), [['s', 'scheduled', '2026-11-22']]);
  const moved = buildAskList({ members, talks, refusals: [], today: TODAY, filters: { search: 'max' } });
  assert.deepEqual(moved.others.map((o) => [o.member.id, o.reason, o.date]), [['m', 'moved', '']]);
  const nn = buildAskList({ members, talks, refusals: [], today: TODAY, filters: { search: 'nownot' } });
  assert.deepEqual(nn.others.map((o) => [o.member.id, o.reason, o.date]), [['n', 'notNow', '2027-03-01']]);
});

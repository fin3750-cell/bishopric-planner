// Run with:  node --test      (made-up names only)
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCallingsText, parseCallingsCsv, diffCallingsImport } from '../js/features/callings-import.js';
import { organizationFor, sustainedIn, handbookFor, setApartByStake, OTHER, OUTSIDE } from '../js/features/callings-orgs.js';

const NAMES = ['Arbor, Amy', 'Birch, Ben', 'Cedar, Cora Lynn', 'Dogwood, Dan', 'Elmwood, Eli Jonathan Longname', 'Firwood, Fay'];

// Shaped like text copied from a printed LCR report: names before callings, page headers between,
// a calling wrapped onto two lines, a name wrapped onto two lines, and a line repeated across a page break.
const REPORT = `LCR Callings List
Description
Edit Report
Arbor, Amy Primary Teacher (24 Apr 2026/No)
Birch, Ben
Valiant Activities Leader (5 Nov 2023/No)
Primary Teacher (5 Nov 2023/No)
Primary Teacher (5 Nov 2023/No)
Search
Your report has been saved.
Preferred Name Callings with Date Sustained and Set Apart
Create a Report https://example.invalid/report
1 of 3 11/15/2026, 6:53 PM
Building Security (26 Oct 2025/No)
Cedar, Cora Lynn
Aaronic Priesthood Quorum Specialist - Sacrament Coordinator (6 Sep
2026/No)
Elmwood, Eli Jonathan
Longname
Relief Society Activity Coordinator (13 Sep 2026/No)
Dogwood, Dan
Temple Worker (6 Sep 2024/No)
Young Women First Counselor (23 Mar 2025/Yes)
Create a Report https://example.invalid/report
2 of 3 11/15/2026, 6:53 PM
Young Women First Counselor (23 Mar 2025/Yes)
Firwood, Fay Elders Quorum President (29 Jun 2025/Yes)
Count: 6
Return to Custom Reports
`;

test('report text: names, wrapped lines, page breaks', () => {
  const p = parseCallingsText(REPORT, NAMES);
  assert.deepEqual(p.issues, []);
  assert.equal(p.declared, 6);
  assert.equal(p.people, 6);
  const brief = p.rows.map((r) => `${r.name} | ${r.calling} | ${r.sustained} | ${r.setApart ? 'Y' : 'N'}${r.pageBreakDuplicate ? ' | DUP' : ''}`);
  assert.deepEqual(brief, [
    'Arbor, Amy | Primary Teacher | 2026-04-24 | N',
    'Birch, Ben | Valiant Activities Leader | 2023-11-05 | N',
    'Birch, Ben | Primary Teacher | 2023-11-05 | N',
    'Birch, Ben | Primary Teacher | 2023-11-05 | N',          // listed twice in the report itself: kept
    'Birch, Ben | Building Security | 2025-10-26 | N',         // continues after the page break
    'Cedar, Cora Lynn | Aaronic Priesthood Quorum Specialist - Sacrament Coordinator | 2026-09-06 | N',
    'Elmwood, Eli Jonathan Longname | Relief Society Activity Coordinator | 2026-09-13 | N',
    'Dogwood, Dan | Temple Worker | 2024-09-06 | N',
    'Dogwood, Dan | Young Women First Counselor | 2025-03-23 | Y',
    'Dogwood, Dan | Young Women First Counselor | 2025-03-23 | Y | DUP',  // same line on both pages
    'Firwood, Fay | Elders Quorum President | 2025-06-29 | Y',
  ]);
});

test('report text: unknown names are reported, not guessed', () => {
  const p = parseCallingsText('Nobody, Nora Primary Teacher (1 Jan 2026/No)\nPrimary Pianist (1 Jan 2026/No)', NAMES);
  assert.equal(p.rows.length, 0);
  assert.equal(p.issues.length, 2);
  assert.match(p.issues[0], /Name not found in Members/);
});

test('CSV import', () => {
  const p = parseCallingsCsv('name,calling,organization,sustained,set_apart\n"Arbor, Amy",Primary Teacher,Primary,2026-04-24,No\n"Firwood, Fay",Bishop,Serving outside the ward,5/25/2025,Yes\n"Birch, Ben",Ward Clerk,,not a date,no\n');
  assert.deepEqual(p.rows.map((r) => [r.name, r.calling, r.organization, r.sustained, r.setApart]), [
    ['Arbor, Amy', 'Primary Teacher', 'Primary', '2026-04-24', false],
    ['Firwood, Fay', 'Bishop', 'Serving outside the ward', '2025-05-25', true],
    ['Birch, Ben', 'Ward Clerk', '', '', false],
  ]);
  assert.deepEqual(p.issues, ['Row 4: "not a date" is not a date']);
  assert.deepEqual(parseCallingsCsv('who,what\nx,y').issues, ['The CSV needs "name" and "calling" columns.']);
});

test('organizations from calling names', () => {
  const org = (c) => organizationFor(c).organization;
  assert.equal(org('Primary Music Leader'), 'Primary');          // the organization in the name wins over "Music"
  assert.equal(org('Assistant Ward Music Leader'), 'Music');
  assert.equal(org('Bishopric Second Counselor'), 'Bishopric');
  assert.equal(org('Ward Assistant Clerk--Finance'), 'Bishopric');
  assert.equal(org('Deacons Quorum Adviser'), 'Aaronic Priesthood');
  assert.equal(org('Nursery Leader'), 'Primary');
  assert.equal(org('Valiant Activities Leader'), 'Primary');
  assert.equal(org('Resource Center Specialist'), 'Sunday School');
  assert.equal(org('Temple Ordinance Worker'), OUTSIDE);
  assert.equal(org('Stake Executive Secretary'), OUTSIDE);
  assert.equal(org('Patriarch'), OUTSIDE);
  assert.equal(org('Gospel Doctrine Teacher'), OTHER);           // not in the handbook: not guessed
  assert.equal(org('Special Needs Mutual'), OTHER);
});

test('handbook 30.8.1: where sustained and who sets apart', () => {
  assert.equal(sustainedIn('Relief Society Secretary'), 'sacrament');
  assert.equal(sustainedIn('Elders Quorum Secretary'), 'quorum');
  assert.equal(sustainedIn('Elders Quorum President'), 'sacrament');
  assert.equal(sustainedIn('Deacons Quorum President'), 'quorum');
  assert.equal(sustainedIn('Priests Quorum First Assistant'), 'quorum');
  assert.equal(sustainedIn('Temple Worker'), 'outside');
  assert.equal(sustainedIn('Bishop', OUTSIDE), 'outside');       // organization set to outside by the bishopric
  assert.equal(handbookFor('Primary President').setApartBy, 'Bishop');
  assert.equal(handbookFor('Primary Teacher').setApartBy, 'Bishop or an assigned counselor');
  assert.equal(handbookFor('Elders Quorum Teacher').setApartBy, 'Elders quorum president or an assigned counselor');
  assert.equal(handbookFor('Bishopric First Counselor').approvedBy, 'Stake presidency and high council');
  assert.equal(setApartByStake('Ward Clerk'), true);
  assert.equal(setApartByStake('Sunday School President'), false);
});

const MEMBERS = NAMES.map((name, i) => ({ id: `m${i}`, name, status: 'active' }));

test('diff: add, fill in, unchanged, no longer listed, unmatched, page duplicates', () => {
  const callings = [
    // proposed in the app, now sustained in LCR -> filled in
    { id: 'c1', member_id: 'm0', member_name: 'Arbor, Amy', calling: 'Primary Teacher', proposed_on: '2026-04-01', extended_on: '2026-04-05', accepted_on: '2026-04-06' },
    // already complete -> unchanged
    { id: 'c2', member_id: 'm5', member_name: 'Firwood, Fay', calling: 'Elders Quorum President', sustained_on: '2025-06-29', set_apart_on: '2025-06-29', recorded_on: '2025-07-01' },
    // current but not in the report -> listed for review
    { id: 'c3', member_id: 'm3', member_name: 'Dogwood, Dan', calling: 'Ward Clerk', sustained_on: '2020-01-05', recorded_on: '2020-01-06' },
  ];
  const rows = [
    ...parseCallingsText(REPORT, NAMES).rows,
    { name: 'Nobody, Nora', calling: 'Primary Teacher', sustained: '2026-01-01', setApart: false },
  ];
  const d = diffCallingsImport(callings, MEMBERS, rows, '2026-11-16');
  assert.deepEqual(d.update.map((u) => [u.calling.id, u.fields]), [['c1', { sustained_on: '2026-04-24', recorded_on: '2026-11-16' }]]);
  assert.deepEqual(d.unchanged.map((u) => u.calling.id), ['c2']);
  assert.deepEqual(d.notInReport.map((c) => c.id), ['c3']);
  assert.deepEqual(d.unmatched.map((r) => r.name), ['Nobody, Nora']);
  assert.deepEqual(d.pageDuplicates.map((r) => r.calling), ['Young Women First Counselor']);
  assert.equal(d.add.length, 8);   // Birch x4, Cedar, Elmwood, Dogwood x2
  const yw = d.add.find((a) => a.calling === 'Young Women First Counselor');
  assert.equal(yw.organization, 'Young Women');
  assert.equal(yw.set_apart_on, '2025-03-23');
  assert.equal(yw.recorded_on, '2026-11-16');
  assert.equal(d.add.filter((a) => a.member_id === 'm1' && a.calling === 'Primary Teacher').length, 2);
  // Importing the same report again changes nothing new
  const again = diffCallingsImport([...callings, ...d.add], MEMBERS, rows, '2026-11-16');
  assert.equal(again.add.length, 0);
});

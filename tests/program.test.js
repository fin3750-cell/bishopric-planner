// Run with:  node --test      Reading a pasted WardBullet program (made-up names, real layout).
import test from 'node:test';
import assert from 'node:assert/strict';
import { programLines, parseProgram, matchSpeaker, timeIn } from '../js/features/program-parse.js';

import { AGENDA, ANNOUNCEMENTS } from './fixtures/wardbullet.mjs';

test('program lines: links become their text, list markers go', () => {
  const lines = programLines(AGENDA);
  assert.deepEqual(lines.slice(0, 6), ['WardBullet', 'Web App', 'WardsEditorSettings', 'Website', "HomeHow it's free", 'Sacrament Meeting']);
  assert.ok(lines.includes('Example 6th Ward'));
});

test('agenda: the date and every speaker, nothing else', () => {
  const p = parseProgram(AGENDA);
  assert.equal(p.date, '2026-11-22');
  assert.deepEqual(p.speakers.map((s) => [s.label, s.name]), [
    ['Speaker', 'Cora Cedar'], ['Speaker', 'Sister Firwood'], ['Youth Speaker', 'Dan Dogwood'], ['Speaker', 'Visiting Example'],
  ]);   // the invocation has no name: the next line is a label, so nothing is taken
  assert.deepEqual([p.announcements, p.problems], [[], []]);
  // other layouts: "Speaker: name" on one line, and several names under "Speakers"
  assert.deepEqual(parseProgram('11/29/2026\nSpeaker: Ann Example\nSpeakers\nBen Example\nCal Example\nClosing Hymn #1').speakers.map((s) => s.name),
    ['Ann Example', 'Ben Example', 'Cal Example']);
});

test('announcements: dated lines become calendar items; past ones and bad dates are kept out', () => {
  const p = parseProgram(ANNOUNCEMENTS);
  assert.equal(p.date, '2026-11-15');
  assert.deepEqual(p.announcements.map((a) => [a.date, a.time, a.title]), [
    ['2026-12-06', '', 'Christmas Devotional'],
    ['2026-12-10', '18:00', 'Ward Christmas party'],
    ['2027-01-09', '09:30', 'New year service project'],   // January after a November program is next year
  ]);
  assert.deepEqual(p.past.map((a) => a.date), ['2026-11-01']);
  assert.deepEqual(p.problems, ['Could not read the date in "13/40: Not a date".']);
  assert.deepEqual(p.speakers, []);
  assert.match(parseProgram('Speaker\nAnn Example').problems[0], /No program date found/);
});

test('times in announcement text', () => {
  assert.deepEqual(['6pm', '6:30 PM', '@ 3pm', '1-3 pm', '9:30 a.m.', '12 pm', '12am', 'at 7', '13pm'].map(timeIn),
    ['18:00', '18:30', '15:00', '13:00', '09:30', '12:00', '00:00', '', '']);
});

test('matching program names to members', () => {
  const members = [
    { id: 'm1', name: 'Arbor, Amy' }, { id: 'm3', name: 'Cedar, Cora Lynn' }, { id: 'm4', name: 'Dogwood, Dan' },
    { id: 'm6', name: 'Firwood, Fay' }, { id: 'm7', name: 'Firwood, Finn' }, { id: 'm8', name: 'Van Example, Erika (Riki)' },
  ];
  const ids = (r) => [r.exact.map((m) => m.id), r.others.map((m) => m.id)];
  assert.deepEqual(ids(matchSpeaker('Cora Cedar', members)), [['m3'], []]);              // middle name in the list is fine
  assert.deepEqual(ids(matchSpeaker('Sister Firwood', members)), [[], ['m6', 'm7']]);    // a title and a surname: a person chooses
  assert.deepEqual(ids(matchSpeaker('Finn Firwood', members)), [['m7'], ['m6']]);
  assert.deepEqual(ids(matchSpeaker('Fred Firwood', members)), [[], ['m6', 'm7']]);       // not a first name on the list
  assert.deepEqual(ids(matchSpeaker('Riki Van Example', members)), [['m8'], []]);        // name in brackets, two-word surname
  assert.deepEqual(ids(matchSpeaker('Visiting Example', members)), [[], []]);
  assert.deepEqual(ids(matchSpeaker('Bishop Dogwood', members)), [[], ['m4']]);
});

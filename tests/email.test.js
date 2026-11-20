// Run with:  node --test      The monthly update email: reading the topics document and the draft (made-up names).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTopics, topicRows, topicsFor, topicMonths, defaultEmailMonth, emailDraft, dateIn, suggestedMessage, wordCount, monthOf } from '../js/features/email-logic.js';
import { TOPICS_PLAIN, TOPICS_MD } from './fixtures/topics.mjs';

test('dates in the topics document', () => {
  assert.deepEqual(['Nov 1, 2026', 'December 27, 2026', 'Sept 6, 2026', 'Feb 30, 2027', 'Nov 1', 'TBD'].map(dateIn),
    ['2026-11-01', '2026-12-27', '2026-09-06', '', '', '']);
});

test('topics document: months, themes, Sunday lessons, sacrament talks', () => {
  const p = parseTopics(TOPICS_PLAIN);
  assert.deepEqual(p.problems, []);
  assert.deepEqual(p.months.map((m) => [m.month, m.theme, m.lessons.length, m.talks.length]), [
    ['2026-11', 'Example Theme of Giving', 3, 2],
    ['2026-12', 'Light of the World (Example)', 3, 2],
    ['2027-01', 'Covenants (Example)', 1, 1],   // January after December is next year
  ]);
  const [nov, dec] = p.months;
  assert.deepEqual(nov.lessons[0], { sunday: '1st Sunday', date: '2026-11-01', title: 'A Generous Heart', speaker: 'Ann Example', note: '' });
  assert.deepEqual(nov.lessons[2], { sunday: '5th Sunday', date: '2026-11-29', title: 'Bishopric-directed combined meeting', speaker: '', note: '' });
  assert.deepEqual(dec.lessons[1], { sunday: '3rd Sunday', date: '2026-12-20', title: 'Christmas Program', speaker: '', note: 'no lessons or talks assigned' });
  assert.deepEqual(dec.talks, [{ title: 'Light and Life', speaker: 'Gus Sample' }, { title: 'Come unto Him', speaker: 'Ann Example' }]);
});

test('topics document as Drive exports it (bold, italics, escapes) reads the same', () => {
  const p = parseTopics(TOPICS_MD);
  assert.deepEqual(p.problems, []);
  assert.equal(p.months.length, 1);
  assert.equal(p.months[0].lessons[0].title, 'The Gospel Is for All!');
  assert.deepEqual(p.months[0].talks, [{ title: 'Light and Life', speaker: 'Gus Sample' }]);
});

test('topics document: problems are reported, not guessed', () => {
  const p = parseTopics('December — Example\n1st Sunday Lesson: No Date — Ann Example\n2nd Sunday Lesson: Wrong Day — Bo Sample — Dec 14, 2026\nSomething else\n');
  assert.equal(p.problems.length, 3);
  assert.match(p.problems[0], /no date at the end/);
  assert.match(p.problems[1], /2026-12-14 is not a Sunday/);   // reported, and the lesson is kept
  assert.match(p.problems[2], /could not read "Something else"/);
  assert.equal(p.months[0].lessons.length, 1);
  const noYear = parseTopics('March — Example\nSacrament Talks:\nA Talk — Ann Example\n');
  assert.deepEqual([noYear.months.length, noYear.problems.length], [0, 1]);
  assert.match(noYear.problems[0], /could not tell the year/);
  assert.match(parseTopics('hello').problems[0], /No months found/);
});

test('saved rows round-trip; a month replaced; which month by default', () => {
  let n = 0;
  const rows = topicRows(parseTopics(TOPICS_PLAIN).months, (pfx) => `${pfx}${++n}`, { entered_by: 'TS' });
  assert.equal(rows.length, 12);   // November 3 + 2, December 3 + 2, January 1 + 1
  assert.deepEqual(topicMonths(rows), ['2026-11', '2026-12', '2027-01']);
  const dec = topicsFor(rows, '2026-12');
  assert.equal(dec.theme, 'Light of the World (Example)');
  assert.deepEqual(dec.lessons.map((l) => l.date), ['2026-12-06', '2026-12-20', '2026-12-27']);
  assert.equal(topicsFor(rows.map((r) => ({ ...r, void: r.month === '2026-12' })), '2026-12'), null);
  assert.equal(topicsFor(rows, '2027-05'), null);
  // Google Sheets may turn the text "2026-12" into a date: a serial number, or an ISO date once read
  const serial = (iso) => (Date.UTC(...iso.split('-').map((x, i) => Number(x) - (i === 1 ? 1 : 0))) - Date.UTC(1899, 11, 30)) / 86400000;
  assert.deepEqual(['2026-12', serial('2026-12-01'), '2026-12-01', '12/1/2026', '', 'junk'].map(monthOf), ['2026-12', '2026-12', '2026-12', '2026-12', '', '']);
  const asDates = rows.map((r) => ({ ...r, month: serial(`${r.month}-01`) }));
  assert.equal(topicsFor(asDates, '2026-12').lessons.length, 3);
  assert.deepEqual(topicMonths(asDates), ['2026-11', '2026-12', '2027-01']);
  assert.deepEqual(['2026-11-01', '2026-11-19', '2026-11-20', '2026-12-31'].map(defaultEmailMonth), ['2026-11', '2026-11', '2026-12', '2027-01']);
});

test('the email draft: subject, message, calendar, theme, lessons, sign-off (no sacrament talks)', () => {
  let n = 0;
  const rows = topicRows(parseTopics(TOPICS_PLAIN).months, (pfx) => `${pfx}${++n}`);
  const items = [
    { kind: 'event', date: '2026-12-10', time: '18:00', title: 'Ward Christmas party', notes: 'From the WardBullet program of 15 Nov 2026' },
    { kind: 'ward', date: '2026-12-13', time: '19:00', title: 'EX6 - Ward Conference', notes: '' },
    { kind: 'fast', date: '2026-12-06', time: '', title: 'Fast Sunday', notes: '' },
    { kind: 'speakers', date: '2026-12-13', time: '', title: 'Speakers', people: [{ name: 'Arbor, Amy' }], notes: '' },
  ];
  const d = emailDraft({ ward: 'EX6', month: '2026-12', message: '  Merry Christmas to every family.  ', topics: topicsFor(rows, '2026-12'), items });
  assert.equal(d.subject, 'EX6 Bishopric Message - December');
  assert.equal(d.body, [
    'Merry Christmas to every family.',
    '',
    'Calendar',
    '- Thu, Dec 10, 6:00 PM: Ward Christmas party',
    '- Sun, Dec 13, 7:00 PM: Ward Conference',
    '',
    'December theme: Light of the World (Example)',
    '',
    'Sunday lessons',
    '- Sun, Dec 6: The Gospel Is for All — Ed Mock',
    '- Sun, Dec 20: Christmas Program (no lessons or talks assigned)',
    '- Sun, Dec 27: Joy Comes in the Morning — Fay Fixture',
    '',
    'The Bishopric',
  ].join('\n'));   // no fast Sunday or speakers in the calendar part; the ward's code is dropped from its own event
  const bare = emailDraft({ month: '2027-03', topics: null, items: [] });
  assert.deepEqual(bare, { subject: 'Bishopric Message - March', body: 'The Bishopric' });
});

test('the suggested message: about 50 words, from the theme and the first lesson', () => {
  let n = 0;
  const rows = topicRows(parseTopics(TOPICS_PLAIN).months, (pfx) => `${pfx}${++n}`);
  const nov = suggestedMessage('2026-11', topicsFor(rows, '2026-11'));
  assert.equal(nov, 'This November, our ward theme is “Example Theme of Giving.” Our Sunday lessons begin with “A Generous Heart” by Ann Example. Please read the talks before Sunday and come ready to share. We love you and are grateful to serve you.');
  assert.equal(wordCount(nov), 41);
  // a title already in quotes is not quoted twice
  const quoted = { theme: 'Example', lessons: [{ title: '“Open Hands”', speaker: 'Bo Sample' }], talks: [] };
  assert.match(suggestedMessage('2026-11', quoted), /begin with “Open Hands” by Bo Sample\./);
  assert.equal(suggestedMessage('2026-11', null), '');
  assert.equal(wordCount('  one two\nthree  '), 3);
});

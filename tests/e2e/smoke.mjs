// End-to-end browser test with fake Google sign-in and a fake, in-memory Sheet (made-up people).
// Needs Playwright with Chromium installed. Run from the repository root:
//   node tests/e2e/smoke.mjs [screenshot-folder]
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { createFakeSheet, FAKE_GIS } from './fake-google.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = process.cwd();
const SHOTS = process.argv[2] || '';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const serial = (iso) => (Date.UTC(...iso.split('-').map((n, i) => (i === 1 ? n - 1 : +n))) - Date.UTC(1899, 11, 30)) / 86400000;
const LIST_SRC = 'Member List PDF 14 Nov 2026';
const AS_OF = serial('2026-11-14');

// The same columns the real Sheet started with (the app must add the newer ones itself).
const sheet = createFakeSheet({
  Members: [
    ['id', 'name', 'gender', 'age', 'age_as_of', 'source', 'status', 'notes'],
    ['m1', 'Arbor, Amy', 'F', 40, AS_OF, LIST_SRC, 'active', ''],
    ['m2', 'Birch, Ben', 'M', 50, AS_OF, LIST_SRC, 'active', ''],
    ['m3', 'Cedar, Cora', 'F', 15, AS_OF, LIST_SRC, 'active', ''],
    ['m4', 'Dogwood, Dan', 'M', 70, AS_OF, LIST_SRC, 'active', ''],
    ['m5', 'Elmwood, Eli', 'M', 9, AS_OF, LIST_SRC, 'active', ''],
    ['m6', 'Firwood, Fay', 'F', 33, AS_OF, LIST_SRC, 'active', ''],
  ],
  Talks: [
    ['id', 'date', 'date_estimated', 'member_id', 'member_name', 'name_as_shown', 'ward_member', 'source', 'entered_by', 'entered_at', 'notes'],
    ['t1', serial('2025-03-02'), true, 'm2', 'Birch, Ben', 'Ben Birch', true, 'import', 'import', '', ''],
    ['t2', serial('2023-01-15'), true, 'm3', 'Cedar, Cora', 'Cora Cedar', true, 'import', 'import', '', ''],
    ['t3', serial('2026-11-08'), false, '', '', 'Visiting Speaker', false, 'import', 'import', '', 'not a ward member'],
  ],
  Refusals: [['id', 'date', 'member_id', 'member_name', 'note', 'entered_by', 'entered_at']],
  About: [['About this sheet']],
});

const server = http.createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(ROOT, path.endsWith('/') ? `${path}index.html` : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('dialog', (d) => d.accept());
await page.clock.setFixedTime(new Date('2026-11-16T12:00:00'));
await context.route('https://accounts.google.com/gsi/client', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_GIS }));
await context.route('https://sheets.googleapis.com/**', sheet.handle);
let fakeEmail = 'tess.sample@gmail.com';   // the Google account the fake sign-in reports
await context.route('https://www.googleapis.com/oauth2/v3/userinfo', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sub: '1', email: fakeEmail, email_verified: true }) }));
await context.addInitScript(() => {
  if (localStorage.getItem('bishopric-planner-settings')) return;   // keep what the app saved (reload tests)
  localStorage.setItem('bishopric-planner-settings', JSON.stringify({
    sheetId: 'fakeSheetId_1234567890abcdef', clientId: 'fake.apps.googleusercontent.com', initials: 'TS', windowYears: 3, minAge: 8,
  }));
});

const names = () => page.$$eval('#view .cards .name', (els) => els.map((e) => e.textContent));
const noSideScroll = async (label) => {
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(w <= 375, `${label}: page is ${w}px wide at 375px`);
};
const step = (s) => console.log(`ok - ${s}`);
const go = async (label, title = label) => {
  await page.getByRole('link', { name: label, exact: true }).click();
  await page.locator('#view .view-title', { hasText: title }).waitFor({ timeout: 5000 });
  const text = await page.textContent('#view');
  assert.ok(!/\[object |\bnull\b|\bundefined\b/.test(text), `${title} screen shows a code value: ${text}`);
};
// On a calling's page: the step row whose label is exactly `label`.
const stepRow = (label) => page.locator('#dlg li.step').filter({ has: page.locator('.step-label', { hasText: new RegExp(`^${label}$`) }) });
const stepDone = async (label) => {
  await stepRow(label).getByRole('button', { name: 'Done' }).click();
  await page.locator('#dlg li.step.done', { hasText: `✓ ${label}` }).first().waitFor({ timeout: 5000 });
};

// 1. Sign in and load
await page.goto(`${BASE}/#ask`);
await page.getByRole('button', { name: 'Sign in with Google' }).click();
await page.getByText('to consider').waitFor();
assert.deepEqual(await names(), ['Arbor, Amy', 'Dogwood, Dan', 'Elmwood, Eli', 'Firwood, Fay', 'Cedar, Cora']);
assert.ok((await page.textContent('#view .summary')).includes('1 spoke since Nov 2023'));
step('signed in; who-to-ask order is no-talk people first, then oldest talk');
for (const col of ['category', 'category_until', 'moved_in', 'last_in_list']) assert.ok(sheet.tabs.Members[0].includes(col), `Members gained ${col}`);
assert.ok(sheet.tabs.Talks[0].includes('void') && sheet.tabs.Refusals[0].includes('void'));
step('missing columns were added to the Sheet');
await noSideScroll('who to ask');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/1-ask.png`, fullPage: true });

// 2. Category: Do not ask
await page.getByRole('button', { name: /Firwood, Fay/ }).click();
await page.getByLabel('Category').selectOption('do_not_ask');
await page.getByRole('button', { name: 'Save' }).click();
await page.getByText('Saved').waitFor();
assert.ok(!(await names()).includes('Firwood, Fay'));
const mh = sheet.tabs.Members[0];
const ford = sheet.tabs.Members.find((r) => r[0] === 'm6');
assert.equal(ford[mh.indexOf('category')], 'do_not_ask');
step('"Do not ask" saved to the Sheet and removed from the list');

// 3. Decline highlight
await page.getByRole('button', { name: /Arbor, Amy/ }).click();
if (SHOTS) await page.screenshot({ path: `${SHOTS}/2-member.png`, fullPage: true });
await page.getByRole('button', { name: 'Record decline' }).click();
await page.getByText('Decline recorded').waitFor();
const adamsCard = page.locator('#view .card', { hasText: 'Arbor, Amy' });
assert.ok((await adamsCard.getAttribute('class')).includes('is-declined'));
assert.ok((await adamsCard.textContent()).includes('Declined 16 Nov 2026'));
assert.equal(sheet.tabs.Refusals.length, 2);
step('decline recorded, card highlighted with the date, person kept in place');

// 4. Schedule a talk for next Sunday
await page.getByRole('button', { name: /Dogwood, Dan/ }).click();
await page.getByRole('button', { name: 'Record talk' }).click();
await page.getByText('Scheduled for 22 Nov 2026').waitFor();
assert.ok(!(await names()).includes('Dogwood, Dan'));
await go('Upcoming');
await page.locator('#view .date-head', { hasText: '22 Nov 2026' }).waitFor({ timeout: 5000 })
  .catch(async () => { throw new Error(`Upcoming screen shows: ${await page.textContent('#view')}`); });
assert.ok((await page.textContent('#view')).includes('Dogwood, Dan'));
step('talk scheduled for 22 Nov 2026; shown under Upcoming and off the list');

// 5. History
await go('History');
const hist = await page.textContent('#view');
assert.ok(hist.includes('≈ 2 Mar 2025') && hist.includes('8 Nov 2026') && hist.includes('visitor'), `History shows: ${hist}`);
await noSideScroll('history');
step('history shows estimated dates with ≈ and visitor talks');

// 6. Import a new member list
await go('Import');
await page.getByLabel('Member list text').fill([
  'Arbor, Amy   F   40', 'Cedar, Cora   F   15', 'Dogwood, Dan   M   70', 'Elmwood, Eli   M   9', 'Firwood, Fay   F   33',
  'Newleaf, Nora   F   30', 'Eightly, Ella   F   8', 'Sprout, Sam   M   4', 'Count: 8',
].join('\n'));
await page.getByRole('button', { name: 'Check list' }).click();
const prev = await page.textContent('#view');
assert.ok(prev.includes('8 people read from the list (the list says 8)'));
assert.ok(prev.includes('5 already in the Sheet') && prev.includes('2 new, age 8+') && prev.includes('1 in the Sheet but not on this list'));
await noSideScroll('import preview');
await page.getByRole('button', { name: 'Apply changes' }).click();
await page.getByText('Member list applied').waitFor();
const rowOf = (name) => sheet.tabs.Members.find((r) => r[1] === name);
assert.equal(rowOf('Newleaf, Nora')[mh.indexOf('category')], 'ask_soon');
assert.equal(rowOf('Eightly, Ella')[mh.indexOf('category')], '');
assert.equal(rowOf('Birch, Ben')[mh.indexOf('status')], 'moved');
assert.equal(rowOf('Sprout, Sam'), undefined);
step('import: new person marked Ask soon, 8-year-old not, missing person marked moved, under-8 ignored');

// 7. New person is first on the list
await go('Speakers', 'Who to ask');
assert.equal((await names())[0], 'Newleaf, Nora');
assert.ok((await page.locator('#view .card').first().textContent()).includes('New to ward'));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/3-ask-after.png`, fullPage: true });
step('new member is at the top with "Ask soon" and "New to ward"');

// 8. Members screen filter shows "Do not ask"
await go('Members');
await page.locator('#view').getByLabel('Category').selectOption('do_not_ask');
assert.deepEqual(await names(), ['Firwood, Fay']);
await noSideScroll('members');
step('Members screen lists the "Do not ask" people');

// 9. Callings: the app creates the Callings tab; propose a calling and assign who will ask
await page.locator('#dlg').evaluate((d) => d.open && d.close());
await go('Callings', 'Organization chart');
assert.ok(sheet.tabs.Callings && sheet.tabs.Callings[0].includes('sustained_on'), 'Callings tab created with its columns');
assert.ok((await page.textContent('#view')).includes('No callings yet'));
await go('Current', 'Current callings');
await page.getByRole('button', { name: 'Propose a calling' }).click();
await page.locator('#dlg').getByLabel('Member').fill('Arbor, Amy');
await page.locator('#dlg').getByLabel('Organization').fill('Primary');
await page.locator('#dlg').getByLabel('Calling').fill('Teacher');
await page.locator('#dlg').getByLabel('Who will ask').fill('ts');
await page.getByRole('button', { name: 'Add to In progress' }).click();
await page.getByText('Proposed: Teacher for Arbor, Amy').waitFor();
const ch = sheet.tabs.Callings[0];
const call = () => sheet.tabs.Callings.find((r) => r[ch.indexOf('member_name')] === 'Arbor, Amy');
assert.equal(call()[ch.indexOf('extend_by')], 'TS');
step('Callings tab created; calling proposed with "who will ask" = TS');

// 10. My tasks shows it; ask and accept
await go('My tasks');
const tasksText = await page.textContent('#view');
assert.ok(tasksText.includes('Assigned to TS (1)') && tasksText.includes('Ask (extend the call)'), tasksText);
await page.locator('#view .card', { hasText: 'Arbor, Amy' }).click();
await stepDone('Asked');
await page.locator('#dlg').getByRole('button', { name: 'Accepted' }).click();
await page.locator('#dlg li.step.done', { hasText: '✓ Accepted' }).waitFor();
assert.equal(typeof call()[ch.indexOf('accepted_on')], 'number');
step('My tasks lists the call; asked and accepted recorded');
await page.locator('#dlg').evaluate((d) => d.close());

// 11. Sunday business: sustain
await go('Sunday');
assert.ok((await page.textContent('#view')).includes('To sustain (1)'));
await noSideScroll('sunday');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/4-sunday.png`, fullPage: true });
await page.getByRole('button', { name: 'Mark checked ones as done' }).click();
await page.getByText('1 marked done for 22 Nov 2026').waitFor();
assert.equal(call()[ch.indexOf('sustained_on')], serial('2026-11-22'));
step('Sunday business: sustained on 22 Nov 2026');

// 12. Current callings, set apart, record in LCR
await go('Current');
const cur = await page.textContent('#view');
assert.ok(cur.includes('Primary') && cur.includes('Teacher') && cur.includes('Set apart') && cur.includes('Record in LCR'), cur);
await page.locator('#view .card', { hasText: 'Teacher' }).click();
if (SHOTS) await page.screenshot({ path: `${SHOTS}/5-calling.png`, fullPage: true });
await stepDone('Set apart');
await stepDone('Recorded in LCR');
assert.ok((await page.textContent('#dlg')).includes('Serving'));
step('set apart and recorded in LCR; calling now "Serving"');

// 13. No calling list excludes her
await page.locator('#dlg').evaluate((d) => d.close());
await go('No calling');
const nc = await names();
assert.ok(!nc.includes('Arbor, Amy') && nc.includes('Dogwood, Dan'), nc.join(', '));
step('"No calling" excludes members with a calling');

// 14. Release: start, tell, read on Sunday, record
await go('Current');
await page.locator('#view .card', { hasText: 'Teacher' }).click();
await page.locator('#dlg').getByRole('button', { name: 'Start release' }).click();
await stepDone('Member told');
await page.locator('#dlg').evaluate((d) => d.close());
await go('Sunday');
assert.ok((await page.textContent('#view')).includes('Releases (1)'));
await page.getByRole('button', { name: 'Mark checked ones as done' }).click();
await page.getByText('1 marked done for 22 Nov 2026').waitFor();
await go('In progress');
assert.ok((await page.textContent('#view')).includes('Record the release in LCR (1)'));
await page.locator('#view .card', { hasText: 'Arbor, Amy' }).click();
await stepDone('Release recorded in LCR');
assert.ok((await page.textContent('#dlg')).includes('Released'));
await page.locator('#dlg').evaluate((d) => d.close());
await go('Current');
assert.ok((await page.textContent('#view')).includes('No current callings match') || (await page.textContent('#view')).includes('No callings yet'));
step('release told, read on Sunday, recorded; no longer a current calling');
await noSideScroll('callings');

// 15. LCR callings import (made-up report text)
await go('LCR import', 'Import the LCR callings report');
await page.getByLabel('Callings report text').fill([
  'LCR Callings List',
  'Cedar, Cora Primary Teacher (24 Apr 2026/No)',
  'Dogwood, Dan',
  'Elders Quorum President (29 Jun 2025/Yes)',
  'Elders Quorum Secretary (1 Feb 2026/No)',
  'Create a Report https://example.invalid/report',
  '1 of 2 11/15/2026, 6:53 PM',
  'Elders Quorum Secretary (1 Feb 2026/No)',
  'Firwood, Fay Temple Worker (6 Sep 2024/No)',
  'Newleaf, Nora Relief Society President (19 Jan 2025/Yes)',
  'Arbor, Amy Bishop (28 Sep 2025/Yes)',
  'Nobody, Nils Primary Pianist (1 Mar 2026/No)',
  'Count: 5',
].join('\n'));
await page.getByRole('button', { name: 'Check report' }).click();
const lcr = await page.textContent('#view');
assert.ok(lcr.includes('6 new callings to add'), lcr);
assert.ok(lcr.includes('1 lines repeated across a page break'), lcr);
assert.ok(lcr.includes('Name not found in Members'), lcr);
assert.ok(!/\[object |\bnull\b|\bundefined\b/.test(lcr), lcr);
await noSideScroll('lcr import preview');
await page.getByRole('button', { name: 'Apply changes' }).click();
await page.getByText('Callings report applied: 6 added, 0 updated').waitFor();
await page.locator('#view .view-title', { hasText: 'Organization chart' }).waitFor();
const imported = sheet.tabs.Callings.filter((r) => r[ch.indexOf('source')] && String(r[ch.indexOf('source')]).startsWith('LCR import'));
assert.equal(imported.length, 6);
const eqp = imported.find((r) => r[ch.indexOf('calling')] === 'Elders Quorum President');
assert.equal(eqp[ch.indexOf('organization')], 'Elders Quorum');
assert.equal(eqp[ch.indexOf('sustained_on')], serial('2025-06-29'));
assert.equal(eqp[ch.indexOf('set_apart_on')], serial('2025-06-29'));
assert.equal(eqp[ch.indexOf('recorded_on')], serial('2026-11-16'));
step('LCR import: 6 added, page-break repeat and unknown name held back, dates and organization set');

// 16. Organization chart
const chart = page.locator('#view');
const box = (name) => chart.locator('.org', { hasText: name }).first();
const eq = await box('Elders Quorum').textContent();
assert.ok(eq.includes('Elders Quorum President') && eq.includes('Dogwood, Dan') && eq.includes('No one called'), eq);
assert.ok(eq.includes('Elders Quorum Secretary') && eq.includes('1 yr 4 mo'), eq);   // sustained 29 Jun 2025 -> 16 months on 16 Nov 2026
assert.ok((await box('Relief Society').textContent()).includes('Newleaf, Nora'));
assert.ok((await box('Sunday School').textContent()).includes('No one called (optional)'));
const outside = await box('Serving outside the ward').textContent();
assert.ok(outside.includes('Temple Worker') && outside.includes('Firwood, Fay'), outside);
await noSideScroll('org chart');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/6-orgchart.png`, fullPage: true });
step('org chart: positions with holders, "No one called", optional positions, outside-the-ward section');

// 17. Change a calling's organization on its page
await box('Primary').getByRole('button', { name: /Cedar, Cora/ }).click();
assert.ok((await page.textContent('#dlg')).includes('Called and set apart by: Bishop or an assigned counselor'));
const dlgText = await page.textContent('#dlg');
assert.ok(dlgText.includes('✓ Asked (date not recorded)') && dlgText.includes('✓ Accepted (date not recorded)'), dlgText);
assert.equal(await stepRow('Set apart').getByRole('button', { name: 'Done' }).count(), 1);   // the report said not set apart
if (SHOTS) { await page.locator('#dlg .sub', { hasText: 'Organization and calling' }).scrollIntoViewIfNeeded(); await page.screenshot({ path: `${SHOTS}/8-calling-edit.png` }); }
await page.locator('#dlg').getByLabel('Organization').selectOption('Sunday School');
await page.locator('#dlg').getByRole('button', { name: 'Save', exact: true }).click();
await page.getByText('Saved').first().waitFor();
await page.locator('#dlg').evaluate((d) => d.close());
await go('Org chart', 'Organization chart');
assert.ok((await box('Sunday School').textContent()).includes('Cedar, Cora'));
step('calling page shows handbook guidance; organization changed to Sunday School');

// 18. A quorum-sustained calling goes to the quorum list on the Sunday screen
await go('In progress', 'Calls and releases in progress');
await page.getByRole('button', { name: 'Propose a calling' }).click();
await page.locator('#dlg').getByLabel('Member').fill('Elmwood, Eli');
await page.locator('#dlg').getByLabel('Calling').fill('Elders Quorum Teacher');
await page.locator('#dlg').getByLabel('Calling').dispatchEvent('change');
assert.equal(await page.locator('#dlg').getByLabel('Organization').inputValue(), 'Elders Quorum');
await page.getByRole('button', { name: 'Add to In progress' }).click();
await page.locator('#view .card', { hasText: 'Elmwood, Eli' }).click();
await stepDone('Asked');
await page.locator('#dlg').getByRole('button', { name: 'Accepted' }).click();
await page.locator('#dlg li.step.done', { hasText: '✓ Accepted' }).waitFor();
await page.locator('#dlg').evaluate((d) => d.close());
await go('Sunday', 'Sunday business');
const sun = await page.textContent('#view');
assert.ok(sun.includes('To sustain (0)') && sun.includes('In a quorum or Young Women meeting (1)') && sun.includes('quorum meeting'), sun);
step('Sunday: an elders quorum teacher is listed for the quorum meeting, not sacrament meeting');

// 19. Bishopric list: fill from the org chart, add someone by hand, pick your own initials
await go('Settings');
const bish = page.locator('#view section', { hasText: 'Bishopric list' });
await bish.getByRole('button', { name: 'Fill from org chart (1)' }).click();
await page.getByText('1 added').waitFor();
assert.ok((await page.textContent('#view')).includes('AA Amy Arbor · Bishop'));
await page.getByLabel('New initials').fill('ts');
await page.getByLabel('New name').fill('Tess Sample');
await page.getByLabel('New role').fill('First Counselor');
await page.locator('#view').getByRole('button', { name: 'Add', exact: true }).click();
await page.getByText('TS added').waitFor();
const bh = sheet.tabs.Bishopric[0];
assert.deepEqual(sheet.tabs.Bishopric.slice(1).map((r) => [r[bh.indexOf('initials')], r[bh.indexOf('name')], r[bh.indexOf('role')], r[bh.indexOf('active')]]),
  [['AA', 'Amy Arbor', 'Bishop', true], ['TS', 'Tess Sample', 'First Counselor', true]]);
assert.equal(await page.getByLabel('Your initials').inputValue(), 'TS');
const opts = await page.getByLabel('Your initials').locator('option').allTextContents();
assert.deepEqual(opts, ['Choose…', 'AA — Amy Arbor', 'TS — Tess Sample']);
await noSideScroll('settings');
const iniBox = await page.getByLabel('New initials').boundingBox();
assert.ok(iniBox.height < 60, `initials box is ${iniBox.height}px tall`);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/7-settings.png`, fullPage: true });
step('Bishopric list: filled from the org chart (Bishop), person added by hand, saved in the Sheet');

// 20. Menus of the list on My tasks and when proposing a calling
await go('Callings', 'Organization chart');
await go('My tasks');
assert.ok((await page.textContent('#view')).includes('Assigned to TS (Tess Sample)'));
await go('In progress', 'Calls and releases in progress');
await page.getByRole('button', { name: 'Propose a calling' }).click();
const whoOpts = await page.locator('#dlg').getByLabel('Who will ask').locator('option').allTextContents();
assert.deepEqual(whoOpts, ['Unassigned', 'AA — Amy Arbor (Bishop)', 'TS — Tess Sample (First Counselor)', 'Stake']);
await page.locator('#dlg').getByLabel('Member').fill('Dogwood, Dan');
await page.locator('#dlg').getByLabel('Organization').fill('Sunday School');
await page.locator('#dlg').getByLabel('Calling').fill('Sunday School Teacher');
await page.locator('#dlg').getByLabel('Who will ask').selectOption('AA');
await page.getByRole('button', { name: 'Add to In progress' }).click();
await page.getByText('Proposed: Sunday School Teacher for Dogwood, Dan').waitFor();
const ss = sheet.tabs.Callings.find((r) => r[ch.indexOf('calling')] === 'Sunday School Teacher');
assert.equal(ss[ch.indexOf('extend_by')], 'AA');
await page.locator('#view .card', { hasText: 'Dogwood, Dan' }).first().click();
assert.equal(await stepRow('Asked').getByRole('combobox').inputValue(), 'AA');
await page.locator('#dlg').evaluate((d) => d.close());
step('"Who will ask" and step assignees are menus of the Bishopric list');

// 21. "Which one are you?" links the signed-in Google account to a Bishopric list entry
await go('Settings');
await page.locator('#view').getByRole('button', { name: 'Which one are you?' }).click();
await page.locator('#dlg').getByRole('button', { name: 'TS — Tess Sample (First Counselor)' }).click();
await page.getByText('Welcome, Tess Sample').waitFor();
assert.equal(sheet.tabs.Bishopric.find((r) => r[bh.indexOf('initials')] === 'TS')[sheet.tabs.Bishopric[0].indexOf('email')], 'tess.sample@gmail.com');
assert.ok((await page.textContent('#view')).includes('You: TS — Tess Sample (recognized from your Google account tess.sample@gmail.com)'));
step('"Which one are you?" saved the Google account on the Bishopric list');

// 22. A new phone: no settings at all. The Sheet and client ID are built in, and the person is
//     recognized from their Google account (same Gmail address written without the dot).
await page.evaluate(() => localStorage.setItem('bishopric-planner-settings', JSON.stringify({})));
fakeEmail = 'TessSample@gmail.com';
await page.reload();
await page.locator('#view .view-title', { hasText: 'Settings' }).waitFor();
assert.ok((await page.getByLabel('Sheet link').inputValue()).includes('/spreadsheets/d/'), 'Sheet link is built in');
assert.ok(await page.getByLabel('Sheet link').isDisabled());
await go('Speakers', 'Who to ask');
await page.getByRole('button', { name: 'Sign in with Google' }).click({ timeout: 5000 })
  .catch(async (e) => { throw new Error(`No sign-in button at ${page.url()}. Screen: ${await page.evaluate(() => document.body.innerText)}`); });
await page.getByText('to consider').waitFor();
await go('Settings');
const fresh = await page.textContent('#view');
assert.ok(fresh.includes('You: TS — Tess Sample'), fresh);
assert.equal(await page.locator('#dlg[open]').count(), 0, 'no "Which one are you?" dialog for a known account');
assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('bishopric-planner-settings'))).initials, 'TS');
step('new phone: nothing to set up; signed in and recognized as TS from the Google account');

assert.deepEqual(errors, [], `browser errors:\n${errors.join('\n')}`);
step('no browser errors');
await browser.close();
server.close();
console.log(`\nAll browser checks passed (${sheet.log.length} fake Sheets API calls).`);

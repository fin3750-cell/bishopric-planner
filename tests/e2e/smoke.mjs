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
await context.addInitScript(() => {
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
const go = async (label) => {
  await page.getByRole('link', { name: label, exact: true }).click();
  await page.locator('#view .view-title', { hasText: label }).waitFor({ timeout: 5000 });
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
await go('Who to ask');
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

assert.deepEqual(errors, [], `browser errors:\n${errors.join('\n')}`);
step('no browser errors');
await browser.close();
server.close();
console.log(`\nAll browser checks passed (${sheet.log.length} fake Sheets API calls).`);

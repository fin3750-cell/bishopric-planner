// End-to-end browser test with fake Google sign-in and a fake, in-memory Sheet (made-up people).
// Needs Playwright with Chromium installed. Run from the repository root:
//   node tests/e2e/smoke.mjs [screenshot-folder]
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { createFakeSheet, FAKE_GIS } from './fake-google.mjs';
import { STAKE_TABS } from '../fixtures/stake-tabs.mjs';
import { AGENDA, ANNOUNCEMENTS } from '../fixtures/wardbullet.mjs';

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

// The stake's own Sheet (made-up), which the app only reads; and an id the signed-in person cannot open.
const STAKE_ID = 'fakeStakeSheet_1234567890abcdef';
const NO_ACCESS_ID = 'fakeNoAccessSheet_1234567890ab';
const stakeSheet = createFakeSheet(Object.fromEntries(STAKE_TABS.map((t) => [t.title, t.rows])), { title: 'Example Stake 2027' });

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
// DARK=1 runs the same checks with the phone in dark mode.
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1, serviceWorkers: 'block', colorScheme: process.env.DARK ? 'dark' : 'light' });
const page = await context.newPage();
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
// Confirm boxes: accepted, unless a test sets dismissNext. Their text is kept in `confirms`.
const confirms = [];
let dismissNext = false;
page.on('dialog', (d) => { confirms.push(d.message()); if (dismissNext) { dismissNext = false; d.dismiss(); } else d.accept(); });
await page.clock.setFixedTime(new Date('2026-11-16T12:00:00'));
await context.route('https://accounts.google.com/gsi/client', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_GIS }));
await context.route('https://sheets.googleapis.com/**', (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path.includes(NO_ACCESS_ID)) return route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":{"message":"The caller does not have permission"}}' });
  return (path.includes(STAKE_ID) ? stakeSheet : sheet).handle(route);
});
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

// 2. Category: Shouldn't ask -> stays on the list, at the bottom, grayed
await page.getByRole('button', { name: /Firwood, Fay/ }).click();
assert.deepEqual(await page.getByLabel('Category').locator('option').allTextContents(), ['None', 'Ask soon', 'Not now', "Shouldn't ask", "Won't accept"]);
await page.getByLabel('Category').selectOption('do_not_ask');
await page.getByRole('button', { name: 'Save' }).click();
await page.getByText('Saved').waitFor();
assert.equal((await names()).at(-1), 'Firwood, Fay');
const fayCard = page.locator('#view .card', { hasText: 'Firwood, Fay' });
assert.ok((await fayCard.getAttribute('class')).includes('is-muted') && (await fayCard.textContent()).includes("Shouldn't ask"));
assert.ok((await page.textContent('#view .summary')).includes("1 marked Shouldn't ask or Won't accept"));
const mh = sheet.tabs.Members[0];
const ford = sheet.tabs.Members.find((r) => r[0] === 'm6');
assert.equal(ford[mh.indexOf('category')], 'do_not_ask');
step('"Shouldn\'t ask" saved to the Sheet; person moved to the bottom, grayed');

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

// 5b. Search on Who to ask also finds people who are not on the list; "Won't accept" goes to the bottom
await go('Who to ask');
await page.getByLabel('Search name').fill('dogwood');
const searched = await page.textContent('#view');
assert.ok(searched.includes('Also matching, not on the list (1)') && searched.includes('Scheduled 22 Nov 2026'), searched);
await noSideScroll('who to ask search');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/9-search.png`, fullPage: true });
await page.locator('#view .card', { hasText: 'Dogwood, Dan' }).click();
assert.ok((await page.textContent('#dlg')).includes('(scheduled)'));
await page.locator('#dlg').evaluate((d) => d.close());
await page.getByLabel('Search name').fill('');
await page.getByRole('button', { name: /Elmwood, Eli/ }).click();
await page.getByLabel('Category').selectOption('wont_accept');
await page.getByRole('button', { name: 'Save' }).click();
await page.getByText('Saved').first().waitFor();
const order = await names();
assert.deepEqual(order.slice(-2), ['Elmwood, Eli', 'Firwood, Fay']);   // bottom group: no talk on record, by name
assert.ok((await page.locator('#view .card', { hasText: 'Elmwood, Eli' }).textContent()).includes("Won't accept"));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/10-bottom.png`, fullPage: true });
step('search finds a scheduled person with the reason; "Won\'t accept" joins the grayed bottom group');

// 5c. Everyone: every member colored by how long since they spoke; "Ask soon" (your pick) is yellow
await go('Everyone', 'Everyone, by color');
const chips = () => page.$$eval('#view .key-chip', (els) => els.map((e) => e.textContent));
assert.deepEqual(await chips(), ['Ask soon (your pick) (0)', 'No talk on record (1)', 'Spoke more than 3 years ago (1)', 'Spoke 2–3 years ago (0)',
  'Spoke 1–2 years ago (1)', 'Spoke within 1 year, or scheduled (1)', "Shouldn't ask / Won't accept (2)"]);
assert.deepEqual(await names(), ['Arbor, Amy', 'Birch, Ben', 'Cedar, Cora', 'Dogwood, Dan', 'Elmwood, Eli', 'Firwood, Fay']);
const tone = async (name) => (await page.locator('#view .card', { hasText: name }).getAttribute('class')).replace('card ', '');
assert.deepEqual([await tone('Arbor, Amy'), await tone('Birch, Ben'), await tone('Cedar, Cora'), await tone('Dogwood, Dan'), await tone('Elmwood, Eli'), await tone('Firwood, Fay')],
  ['tone-none', 'tone-green2', 'tone-older', 'tone-green1', 'tone-red', 'tone-red']);   // Cedar's only talk is from Jan 2023
assert.ok((await page.locator('#view .card', { hasText: 'Dogwood, Dan' }).textContent()).includes('Scheduled 22 Nov 2026'));
assert.ok((await page.locator('#view .card', { hasText: 'Arbor, Amy' }).textContent()).includes('Declined 16 Nov 2026'));
await page.locator('#view .key-chip', { hasText: "Shouldn't ask" }).click();
assert.deepEqual(await names(), ['Elmwood, Eli', 'Firwood, Fay']);
await page.locator('#view .key-chip', { hasText: "Shouldn't ask" }).click();
assert.equal((await names()).length, 6);
await page.getByLabel('Sort').selectOption('oldest');
assert.deepEqual(await names(), ['Arbor, Amy', 'Elmwood, Eli', 'Firwood, Fay', 'Cedar, Cora', 'Birch, Ben', 'Dogwood, Dan']);
await page.getByLabel('Sort').selectOption('name');
await page.locator('#view .card', { hasText: 'Arbor, Amy' }).click();
await page.getByLabel('Category').selectOption('ask_soon');
await page.getByRole('button', { name: 'Save' }).click();
await page.locator('#view .card.tone-yellow', { hasText: 'Arbor, Amy' }).waitFor({ timeout: 5000 });
assert.equal(sheet.tabs.Members.find((r) => r[0] === 'm1')[sheet.tabs.Members[0].indexOf('category')], 'ask_soon');
assert.equal((await chips())[0], 'Ask soon (your pick) (1)');
await noSideScroll('everyone');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/14-everyone.png`, fullPage: true });
await page.locator('#view .card', { hasText: 'Arbor, Amy' }).click();
await page.getByLabel('Category').selectOption('');
await page.getByRole('button', { name: 'Save' }).click();
await page.locator('#view .card.tone-none', { hasText: 'Arbor, Amy' }).waitFor();
step('Everyone: colors by last talk, red labels, scheduled and declined shown; key filters; "Ask soon" turns yellow');

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
await page.getByRole('button', { name: /Newleaf, Nora/ }).click();
await page.getByRole('button', { name: 'Record talk' }).click();
await page.getByText('Scheduled for 22 Nov 2026; "Ask soon" removed').waitFor();
assert.equal(rowOf('Newleaf, Nora')[mh.indexOf('category')], '');
assert.ok(!(await names()).includes('Newleaf, Nora'));
step('scheduling a talk for someone marked "Ask soon" removes the label');

// 8. Members screen filter shows "Do not ask"
await go('Members');
await page.locator('#view').getByLabel('Category').selectOption('do_not_ask');
assert.deepEqual(await names(), ['Firwood, Fay']);
await noSideScroll('members');
step('Members screen lists the "Do not ask" people');

// 8b. Bishopric list: add Tess Sample by hand
await page.locator('#dlg').evaluate((d) => d.open && d.close());
await go('Settings');
await page.getByLabel('New initials').fill('ts');
await page.getByLabel('New name').fill('Tess Sample');
await page.getByLabel('New role').fill('First Counselor');
await page.locator('#view').getByRole('button', { name: 'Add', exact: true }).click();
await page.getByText('TS added').waitFor();
step('Bishopric list: TS added by hand');

// 9. Callings: the app creates the Callings and Tasks tabs; propose a calling
await go('Callings', 'Organization chart');
assert.ok(sheet.tabs.Callings && sheet.tabs.Callings[0].includes('sustained_on') && sheet.tabs.Callings[0].includes('approved_on'), 'Callings tab created with its columns');
assert.ok(sheet.tabs.Tasks && sheet.tabs.Tasks[0].includes('assigned_to'), 'Tasks tab created');
assert.ok(!sheet.tabs.Votes && !sheet.tabs.Bishopric[0].includes('votes'), 'no Votes tab or votes column any more');
assert.ok((await page.textContent('#view')).includes('No callings yet'));
await go('Current', 'Current callings');
await page.getByRole('button', { name: 'Propose a calling' }).click();
assert.equal(await page.locator('#dlg').getByLabel('Who will ask').count(), 0, 'no "Who will ask" when proposing');
await page.locator('#dlg').getByLabel('Member').fill('Arbor, Amy');
await page.locator('#dlg').getByLabel('Organization').fill('Primary');
await page.locator('#dlg').getByLabel('Calling').fill('Teacher');
await page.getByRole('button', { name: 'Add to In progress' }).click();
await page.getByText('Proposed: Teacher for Arbor, Amy').waitFor();
const ch = sheet.tabs.Callings[0];
const call = () => sheet.tabs.Callings.find((r) => r[ch.indexOf('member_name')] === 'Arbor, Amy');
assert.equal(call()[ch.indexOf('proposed_on')], serial('2026-11-16'));
assert.ok(!call()[ch.indexOf('extend_by')]);
await go('In progress', 'Calls and releases in progress');
let ip = await page.textContent('#view');
assert.ok(ip.includes('Proposed (1)') && !ip.includes('vote') && ip.includes('Needs set apart (0)'), ip);
const heads = await page.$$eval('#view .stage-head', (els) => els.map((e) => e.textContent.replace(/ \(\d+\)$/, '')));
assert.deepEqual(heads, ['Proposed', 'Bishop Approved', 'Assigned to Contact', 'Sustain', 'Sustained/LCR Record', 'Releases', 'Needs set apart']);
assert.equal(await page.locator('#view details.stage').evaluate((d) => d.open), false, '"Needs set apart" starts closed');
await noSideScroll('in progress');
step('calling proposed; In progress shows the stages in order, "Needs set apart" last and closed');

// 10. The bishop approves (no vote), choose who asks, the asker records "Accepted"
await page.locator('#view .card', { hasText: 'Arbor, Amy' }).click();
assert.ok(!(await page.textContent('#dlg')).includes('vote'), 'no voting on the calling page');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/11-approve.png`, fullPage: true });
await page.locator('#dlg').getByRole('button', { name: 'Approved', exact: true }).click();
await page.locator('#dlg li.step.done', { hasText: '✓ Bishop approved' }).waitFor();
assert.equal(call()[ch.indexOf('approved_on')], serial('2026-11-16'));
assert.equal(call()[ch.indexOf('approved_by')], 'TS');
assert.equal(confirms.length, 0, 'approving asks no question');
await page.locator('#dlg').evaluate((d) => d.close());
await go('In progress', 'Calls and releases in progress');
assert.ok((await page.textContent('#view')).includes('Bishop Approved (1)'));
const whoMenu = page.getByLabel('Who will ask: Arbor, Amy');
assert.deepEqual(await whoMenu.locator('option').allTextContents(), ['Unassigned', 'TS — Tess Sample (First Counselor)', 'Stake']);
await whoMenu.selectOption('TS');
await page.getByText('Arbor, Amy: Tess Sample will ask').waitFor();
assert.equal(call()[ch.indexOf('extend_by')], 'TS');
ip = await page.textContent('#view');
assert.ok(ip.includes('Assigned to Contact (1)') && ip.includes('Tess Sample to ask') && ip.includes('Bishop Approved (0)'), ip);
step('bishop approved straight from Proposed; TS chosen to ask: now under Assigned to Contact');

// 10b. A free to-do, added under Assigned, shows on My tasks and is checked off there
await page.getByLabel('New task', { exact: true }).fill('Ask the Primary presidency for teacher names');
await page.getByLabel('New task: assigned to').selectOption('TS');
await page.getByLabel('New task: due date').fill('2026-11-20');
await page.getByRole('button', { name: 'Add task' }).click();
await page.getByText('Task added').waitFor();
const th = sheet.tabs.Tasks[0];
const todo = () => sheet.tabs.Tasks.find((r) => r[th.indexOf('description')] === 'Ask the Primary presidency for teacher names');
assert.equal(todo()[th.indexOf('assigned_to')], 'TS');
assert.equal(todo()[th.indexOf('due_on')], serial('2026-11-20'));
assert.ok((await page.textContent('#view')).includes('Other tasks (1)'));
await noSideScroll('in progress with a task');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/12-in-progress.png`, fullPage: true });
await go('My tasks');
const mt = await page.textContent('#view');
assert.ok(mt.includes('Calls to extend (1)') && mt.includes('Your to-dos (1)') && mt.includes('Due 20 Nov 2026') && !mt.includes('Votes'), mt);
await noSideScroll('my tasks');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/13-my-tasks.png`, fullPage: true });
await page.getByLabel('Done: Ask the Primary presidency for teacher names').check();
await page.getByText('Task done').waitFor();
assert.equal(todo()[th.indexOf('done_on')], serial('2026-11-16'));
assert.equal(todo()[th.indexOf('done_by')], 'TS');
assert.ok((await page.textContent('#view')).includes('Your to-dos (0)'));
await page.locator('#view .card-actions').getByRole('button', { name: 'Accepted' }).click();
await page.getByText('Arbor, Amy accepted: now under Sustain').waitFor();
assert.equal(call()[ch.indexOf('accepted_on')], serial('2026-11-16'));
assert.ok((await page.textContent('#view')).includes('Calls to extend (0)'));
step('to-do added with assignee and due date, checked off on My tasks; the asker tapped Accepted');

// 11. Sustain: listed under Sustain (sacrament meeting) and on the Sunday screen
await go('In progress', 'Calls and releases in progress');
ip = await page.textContent('#view');
assert.ok(ip.includes('Sustain (1)') && ip.includes('Sustain in sacrament meeting'), ip);
await go('Sunday');
assert.ok((await page.textContent('#view')).includes('To sustain (1)'));
await noSideScroll('sunday');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/4-sunday.png`, fullPage: true });
await page.getByRole('button', { name: 'Mark checked ones as done' }).click();
await page.getByText('1 marked done for 22 Nov 2026').waitFor();
assert.equal(call()[ch.indexOf('sustained_on')], serial('2026-11-22'));
step('Sunday business: sustained on 22 Nov 2026');

// 12. Sustained/LCR Record, then Needs set apart
await go('In progress', 'Calls and releases in progress');
ip = await page.textContent('#view');
assert.ok(ip.includes('Sustained/LCR Record (1)') && ip.includes('not set apart yet') && ip.includes('Needs set apart (0)'), ip);
await page.locator('#view .card', { hasText: 'Arbor, Amy' }).click();
if (SHOTS) await page.screenshot({ path: `${SHOTS}/5-calling.png`, fullPage: true });
await stepDone('Recorded in LCR');
await page.locator('#dlg').evaluate((d) => d.close());
ip = await page.textContent('#view');
assert.ok(ip.includes('Sustained/LCR Record (0)') && ip.includes('Needs set apart (1)'), ip);
await page.locator('#view details.stage summary').click();
await page.locator('#view details.stage .card', { hasText: 'Arbor, Amy' }).click();
await stepDone('Set apart');
assert.ok((await page.textContent('#dlg')).includes('Serving'));
await page.locator('#dlg').evaluate((d) => d.close());
assert.ok((await page.textContent('#view')).includes('Needs set apart (0)'));
assert.equal(await page.locator('#view details.stage').evaluate((d) => d.open), true, 'stays open after a change');
await go('Current');
assert.ok((await page.textContent('#view')).includes('Teacher'));
step('recorded in LCR (moved to Needs set apart), then set apart; calling now "Serving"');

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
assert.ok((await page.textContent('#view')).includes('Releases (1)') && (await page.textContent('#view')).includes('Record the release in LCR'));
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
assert.ok(dlgText.includes('✓ Bishop approved (date not recorded)') && dlgText.includes('✓ Accepted (date not recorded)'), dlgText);
assert.ok(!dlgText.includes('Your vote'), 'no voting on a calling that is already sustained');
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
await page.locator('#dlg').getByRole('button', { name: 'Approved', exact: true }).click();
await page.locator('#dlg li.step.done', { hasText: '✓ Bishop approved' }).waitFor();
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
const bh = sheet.tabs.Bishopric[0];
assert.deepEqual(sheet.tabs.Bishopric.slice(1).map((r) => [r[bh.indexOf('initials')], r[bh.indexOf('name')], r[bh.indexOf('role')], r[bh.indexOf('active')]]),
  [['TS', 'Tess Sample', 'First Counselor', true], ['AA', 'Amy Arbor', 'Bishop', true]]);
assert.equal(await page.getByLabel('Your initials').inputValue(), 'TS');
const opts = await page.getByLabel('Your initials').locator('option').allTextContents();
assert.deepEqual(opts, ['Choose…', 'TS — Tess Sample', 'AA — Amy Arbor']);
await noSideScroll('settings');
const iniBox = await page.getByLabel('New initials').boundingBox();
assert.ok(iniBox.height < 60, `initials box is ${iniBox.height}px tall`);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/7-settings.png`, fullPage: true });
step('Bishopric list: filled from the org chart (Bishop), saved in the Sheet');

// 20. Not approved, undone, then approved; choose who asks from the Bishopric list
await go('Callings', 'Organization chart');
await go('My tasks');
assert.ok((await page.textContent('#view')).includes('For TS (Tess Sample)'));
await go('In progress', 'Calls and releases in progress');
await page.getByRole('button', { name: 'Propose a calling' }).click();
await page.locator('#dlg').getByLabel('Member').fill('Dogwood, Dan');
await page.locator('#dlg').getByLabel('Organization').fill('Sunday School');
await page.locator('#dlg').getByLabel('Calling').fill('Sunday School Teacher');
await page.getByRole('button', { name: 'Add to In progress' }).click();
await page.getByText('Proposed: Sunday School Teacher for Dogwood, Dan').waitFor();
const ss = () => sheet.tabs.Callings.find((r) => r[ch.indexOf('calling')] === 'Sunday School Teacher');
await page.locator('#view .card', { hasText: 'Sunday School Teacher' }).click();
await page.locator('#dlg').getByRole('button', { name: 'Not approved' }).click();
await page.locator('#dlg li.step.done', { hasText: '✓ Not approved by the bishop' }).waitFor();
assert.equal(confirms.at(-1), 'Record that the bishop did not approve this calling? It closes and stays in the Sheet.');
assert.equal(ss()[ch.indexOf('not_approved_on')], serial('2026-11-16'));
await page.locator('#dlg').evaluate((d) => d.close());
assert.ok(!(await page.textContent('#view')).includes('Sunday School Teacher'), 'a calling that was not approved leaves In progress');
// Undo it from the member's page
await go('Members');
await page.locator('#view').getByLabel('Category').selectOption('any');
await page.locator('#view .card', { hasText: 'Dogwood, Dan' }).click();
assert.ok((await page.textContent('#dlg')).includes('Not approved'));
await page.locator('#dlg').getByRole('button', { name: /Sunday School Teacher/ }).click();
await page.locator('#dlg li.step.done', { hasText: '✓ Not approved by the bishop' }).getByRole('button', { name: 'Undo' }).click();
await page.locator('#dlg').getByRole('button', { name: 'Approved', exact: true }).click();
await page.locator('#dlg li.step.done', { hasText: '✓ Bishop approved' }).waitFor();
assert.ok(!ss()[ch.indexOf('not_approved_on')] && ss()[ch.indexOf('approved_by')] === 'TS');
await page.locator('#dlg').evaluate((d) => d.close());
await go('Callings', 'Organization chart');
await go('In progress', 'Calls and releases in progress');
const whoMenu2 = page.getByLabel('Who will ask: Dogwood, Dan');
assert.deepEqual(await whoMenu2.locator('option').allTextContents(), ['Unassigned', 'TS — Tess Sample (First Counselor)', 'AA — Amy Arbor (Bishop)', 'Stake']);
await whoMenu2.selectOption('AA');
await page.getByText('Dogwood, Dan: Amy Arbor will ask').waitFor();
assert.equal(ss()[ch.indexOf('extend_by')], 'AA');
assert.ok((await page.textContent('#view')).includes('Amy Arbor to ask'));
await go('My tasks');
assert.ok((await page.textContent('#view')).includes('Calls to extend (0)'), 'assigned to AA, not to TS');
step('not approved, undone, approved; AA chosen to ask from the Bishopric list');

// 20b. Recording in LCR goes to the Executive Secretary unless Settings names someone else
await go('Settings');
await page.getByLabel('New initials').fill('ez');
await page.getByLabel('New name').fill('Ezra Example');
await page.getByLabel('New role').fill('Executive Secretary');
await page.locator('#view').getByRole('button', { name: 'Add', exact: true }).click();
await page.getByText('EZ added').waitFor();
assert.equal(await page.getByLabel('Records callings in LCR').inputValue(), 'EZ');
assert.ok((await page.textContent('#view')).includes('Not chosen yet, so the Executive Secretary on the Bishopric list is used.'));
await go('Callings', 'Organization chart');
await go('Sunday', 'Sunday business');
await page.getByRole('button', { name: 'Mark checked ones as done' }).click();
await page.getByText('1 marked done for 22 Nov 2026').waitFor();   // the elders quorum teacher, presented in the quorum
await go('In progress', 'Calls and releases in progress');
const lcrCard = page.locator('#view .card', { hasText: 'Elmwood, Eli' });
assert.ok((await page.textContent('#view')).includes('Sustained/LCR Record (1)'));
assert.ok((await lcrCard.textContent()).includes('EZ'), await lcrCard.textContent());
await go('My tasks');
assert.ok((await page.textContent('#view')).includes('Other steps assigned to you (0)'));
await go('Settings');
await page.getByLabel('Records callings in LCR').selectOption('TS');
await page.getByText('TS records callings in LCR').waitFor();
assert.equal((sheet.tabs.Settings.find((r) => r[0] === 'record_by') || [])[1], 'TS');
await go('Callings', 'Organization chart');
await go('My tasks');
const mine = await page.textContent('#view');
assert.ok(mine.includes('Other steps assigned to you (1)') && mine.includes('Record in LCR') && mine.includes('Elmwood, Eli'), mine);
await page.locator('#view .card', { hasText: 'Elmwood, Eli' }).click();
assert.equal(await stepRow('Recorded in LCR').getByRole('combobox').inputValue(), 'TS');
await page.locator('#dlg').evaluate((d) => d.close());
step('LCR recording: the Executive Secretary by default, then the person chosen in Settings, on their My tasks');

// 21. "Which one are you?" links the signed-in Google account to a Bishopric list entry
await go('Settings');
await page.locator('#view').getByRole('button', { name: 'Which one are you?' }).click();
await page.locator('#dlg').getByRole('button', { name: 'TS — Tess Sample (First Counselor)' }).click();
await page.getByText('Welcome, Tess Sample').waitFor();
assert.equal(sheet.tabs.Bishopric.find((r) => r[bh.indexOf('initials')] === 'TS')[sheet.tabs.Bishopric[0].indexOf('email')], 'tess.sample@gmail.com');
assert.ok((await page.textContent('#view')).includes('You: TS — Tess Sample (recognized from your Google account tess.sample@gmail.com)'));
step('"Which one are you?" saved the Google account on the Bishopric list');

await go('Settings');

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

// 23. Stake calendar Sheet: saved once in Settings, for everyone
await go('Settings');
await page.getByLabel('Stake Sheet link').fill(`https://docs.google.com/spreadsheets/d/${STAKE_ID}/edit`);
await page.getByLabel('Our ward in the stake Sheet').fill('EX6');
await page.getByRole('button', { name: 'Save for everyone' }).click();
await page.getByText('Stake Sheet saved for everyone').waitFor();
const setting = (key) => (sheet.tabs.Settings.find((r) => r[0] === key) || [])[1];
assert.ok(String(setting('stake_sheet')).includes(STAKE_ID));
assert.equal(setting('stake_ward'), 'EX6');
step('stake Sheet link and ward saved in the planner Sheet\'s Settings tab');

// 24. Calendar: stake events read live, our ward's events, speakers, fast Sundays, month notes, problems
await go('Calendar');
await page.getByText('Stake Sheet: Example Stake 2027').waitFor({ timeout: 5000 });
let cal = await page.textContent('#view');
for (const want of ['November 2026', 'Sun 22 Nov 2026', 'Dogwood, Dan', 'Newleaf, Nora', 'Sun 6 Dec 2026', 'Fast Sunday',
  'Stake Baptisms', '10:00 AM', 'EX6 - Ward Conference', 'Our ward', 'YSA - Dance',
  'High council speaker: Bram Thistlewood. Topic: Stake Theme', 'Example Rehab Sacrament Administration (Lark Brambleton)', 'Hospital blessings (Ivo Marchbank)',
  'Sun 11 Apr 2027', 'Second Sunday: the first Sunday is General Conference.', 'Calendar: Updated 10-25-26',
  '2 lines in the stake Sheet could not be read as expected']) {
  assert.ok(cal.includes(want), `Calendar is missing "${want}"`);
}
assert.ok(!cal.includes('RR - Ward Conference'), 'another ward\'s event is hidden by default');
await page.getByLabel('Other wards\' stake events').check();
assert.ok((await page.textContent('#view')).includes('RR - Ward Conference Training Meeting'));
await page.getByLabel('Other wards\' stake events').uncheck();
await page.getByRole('button', { name: 'Add item' }).click();
await page.getByLabel('Event date').fill('2026-12-12');
await page.getByLabel('Event time').fill('18:30');
await page.getByLabel('Event title').fill('Ward Christmas party');
await page.getByRole('button', { name: 'Add to calendar' }).click();
await page.getByText('Added: Ward Christmas party, 12 Dec 2026').waitFor();
const party = page.locator('#view .cal-item', { hasText: 'Ward Christmas party' });
assert.ok((await party.textContent()).includes('6:30 PM'));
assert.ok(sheet.tabs.Events && sheet.tabs.Events.some((r) => r.includes('Ward Christmas party')));
// Coming up: ward and stake events only (no fast Sundays, speakers, high council or other wards)
const comingUp = () => page.getByLabel('Coming up text').inputValue();
assert.ok((await page.textContent('#view .coming-up h3')).includes('16 Nov 2026 to 16 Dec 2026'));
assert.equal(await comingUp(), 'Sat, Dec 12, 6:30 PM: Ward Christmas party');
assert.equal(await page.locator('#view .coming-up input[type=checkbox]').count(), 0);
await page.locator('#view .coming-up').getByRole('button', { name: 'Copy' }).click();
await page.getByText('Copied 1 line').waitFor();
assert.equal(await page.evaluate(() => navigator.clipboard.readText()), await comingUp());
await page.getByLabel('Coming up dates').selectOption('weeks2');
assert.equal(await comingUp(), 'Nothing on the calendar for these dates.');
assert.ok(await page.locator('#view .coming-up').getByRole('button', { name: 'Copy' }).isDisabled());
await page.getByLabel('Coming up dates').selectOption('nextMonth');
assert.ok((await page.textContent('#view .coming-up h3')).includes('1 Dec 2026 to 31 Dec 2026'));
assert.equal(await comingUp(), 'Sat, Dec 12, 6:30 PM: Ward Christmas party');
await page.getByLabel('Coming up dates').selectOption('month');
await noSideScroll('calendar');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/15-calendar.png`, fullPage: true });
await party.getByRole('button', { name: 'Remove' }).click();
await page.getByText('Event removed').waitFor();
assert.ok(!(await page.textContent('#view')).includes('Ward Christmas party'));
step('Calendar: stake and ward events, speakers, fast Sundays, high council and assignments by month; item added and removed; Coming up text copied');

// 25. Stake directory: presidency, high council (ours marked, months speaking here), bishops, tap to call
await go('Stake', 'Stake directory');
const dir = await page.textContent('#view');
for (const want of ['Stake presidency and clerks (1)', 'High council (2)', 'Speaks in our ward: Feb 2027', 'Assigned high councilor: Bram Thistlewood',
  'Stake organizations (1)', 'Bishops (1)', 'Feb 2027: Bram Thistlewood speaks (Stake Theme)']) {
  assert.ok(dir.includes(want), `Stake screen is missing "${want}": ${dir}`);
}
const bram = page.locator('#view .person', { hasText: 'Bram Thistlewood' });
assert.ok((await bram.textContent()).includes('Our ward'));
assert.equal(await bram.getByRole('link', { name: '555-010-0002' }).getAttribute('href'), 'tel:5550100002');
assert.equal(await bram.getByRole('link', { name: 'bt@example.invalid' }).getAttribute('href'), 'mailto:bt@example.invalid');
await noSideScroll('stake');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/16-stake.png`, fullPage: true });
assert.ok(stakeSheet.log.length > 0 && stakeSheet.log.every((l) => l.startsWith('GET ')), `the stake Sheet was only read: ${stakeSheet.log.join(', ')}`);
step('Stake directory with tap-to-call; the stake Sheet was only read, never written');

// 26. A stake Sheet the person cannot open: a clear message, not a broken screen
const errorsBefore26 = errors.length;
await go('Settings');
await page.getByLabel('Stake Sheet link').fill(`https://docs.google.com/spreadsheets/d/${NO_ACCESS_ID}/edit`);
await page.getByRole('button', { name: 'Save for everyone' }).click();
await page.getByText('Stake Sheet saved for everyone').waitFor();
await go('Calendar');
await page.getByText('Could not read the stake Sheet').waitFor({ timeout: 5000 });
cal = await page.textContent('#view');
assert.ok(cal.includes('The caller does not have permission') && cal.includes('needs at least view access') && cal.includes('Fast Sunday'), cal);
// Chrome logs the refused request itself; that one is expected here. Anything else still fails.
const extra = errors.splice(errorsBefore26);
errors.push(...extra.filter((e) => !/status of 403 \(Forbidden\)/.test(e)));
await go('Settings');                                       // the working stake Sheet again for the steps after
await page.getByLabel('Stake Sheet link').fill(`https://docs.google.com/spreadsheets/d/${STAKE_ID}/edit`);
await page.getByRole('button', { name: 'Save for everyone' }).click();
await page.getByText('Stake Sheet saved for everyone').waitFor();
step('no access to the stake Sheet: the calendar says so and still shows the rest');

// 27. WardBullet program pasted: speakers become talks after review, dated announcements become calendar items
await go('Speakers', 'Who to ask');
await go('WardBullet', 'Import a WardBullet program');
await page.getByLabel('WardBullet program text').fill(AGENDA);
await page.getByRole('button', { name: 'Read program' }).click();
let wb = await page.textContent('#view .program-result');
assert.ok(wb.includes('Program: Sun, 22 Nov 2026') && wb.includes('Speakers (4)'), wb);
assert.equal(await page.getByLabel('Who is Cora Cedar').inputValue(), 'm3');                  // exact match chosen
assert.equal(await page.getByLabel('Who is Sister Firwood').inputValue(), '');                 // a person must choose
assert.deepEqual(await page.getByLabel('Who is Sister Firwood').locator('option').allTextContents(),
  ['Choose who this is…', 'Firwood, Fay', 'Visitor (not in the member list)', "Don't record"]);
assert.equal(await page.getByLabel('Who is Dan Dogwood').count(), 0);                          // already has a talk that Sunday
assert.ok(wb.includes('Already recorded'));
assert.equal(await page.getByLabel('Who is Visiting Example').inputValue(), 'visitor');
assert.ok(!wb.includes('Amy Arbor'), 'the organist is not taken for a speaker');
await noSideScroll('wardbullet import');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/17-wardbullet.png`, fullPage: true });
const talksBefore = sheet.tabs.Talks.length;
await page.locator('#view .program-result').getByRole('button', { name: 'Save' }).click();
await page.getByText('Choose who "Sister Firwood" is, or pick Visitor or Don\'t record.').waitFor();
assert.equal(sheet.tabs.Talks.length, talksBefore, 'nothing saved before the choice');
await page.getByLabel('Who is Sister Firwood').selectOption('m6');
await page.locator('#view .program-result').getByRole('button', { name: 'Save' }).click();
await page.getByText('Saved: 3 talks').waitFor();
const tk = sheet.tabs.Talks[0];
const added = sheet.tabs.Talks.slice(talksBefore).map((r) => [r[tk.indexOf('date')] === serial('2026-11-22'), r[tk.indexOf('member_id')], r[tk.indexOf('name_as_shown')], r[tk.indexOf('ward_member')], r[tk.indexOf('date_estimated')]]);
assert.deepEqual(added, [[true, 'm3', 'Cora Cedar', true, false], [true, 'm6', 'Sister Firwood', true, false], [true, '', 'Visiting Example', false, false]]);
assert.equal(await page.getByLabel('WardBullet program text').inputValue(), '', 'the box is cleared after saving');
// the same program again: everyone is already recorded
await page.getByLabel('WardBullet program text').fill(AGENDA);
await page.getByRole('button', { name: 'Read program' }).click();
assert.equal(await page.locator('#view .program-result select').count(), 0);
// announcements: future dated lines, the year rolling into January; a past one and a bad date reported
await page.getByLabel('WardBullet program text').fill(ANNOUNCEMENTS);
await page.getByRole('button', { name: 'Read program' }).click();
wb = await page.textContent('#view .program-result');
for (const want of ['Calendar items from the announcements (3)', 'Sun, 6 Dec 2026: Christmas Devotional', 'Thu, 10 Dec 2026, 6:00 PM: Ward Christmas party',
  'Sat, 9 Jan 2027, 9:30 AM: New year service project', '1 dated announcement before 15 Nov 2026 left out.', 'Could not read the date in "13/40: Not a date".', 'Speakers (0)']) {
  assert.ok(wb.includes(want), `missing "${want}": ${wb}`);
}
await page.getByLabel('Add to calendar: New year service project').uncheck();
await page.locator('#view .program-result').getByRole('button', { name: 'Save' }).click();
await page.getByText('Saved: 2 calendar items').waitFor();
const ev = sheet.tabs.Events[0];
const evRows = sheet.tabs.Events.filter((r) => String(r[ev.indexOf('notes')]).startsWith('From the WardBullet program'));
assert.deepEqual(evRows.map((r) => [r[ev.indexOf('title')], r[ev.indexOf('date')] === serial(r[ev.indexOf('title')] === 'Christmas Devotional' ? '2026-12-06' : '2026-12-10')]),
  [['Christmas Devotional', true], ['Ward Christmas party', true]]);
await page.getByLabel('WardBullet program text').fill(ANNOUNCEMENTS);
await page.getByRole('button', { name: 'Read program' }).click();
wb = await page.textContent('#view .program-result');
assert.equal((wb.match(/Already on the calendar/g) || []).length, 2, wb);
assert.equal(await page.getByLabel('Add to calendar: New year service project').count(), 1);
step('WardBullet program: speakers reviewed and recorded (visitor, choice, already recorded); dated announcements added once');

// 28. Limited access: a person on the list sees only Callings, Calendar and Members (names and ages)
await go('Settings');
await page.getByLabel('Limited access name').fill('Juno Limited');
await page.getByLabel('Limited access Google account').fill('juno.limited@example.invalid');
await page.getByRole('button', { name: 'Add to limited access' }).click();
await page.getByText('Juno Limited added').waitFor();
const ah = sheet.tabs.Access[0];
assert.deepEqual(sheet.tabs.Access.slice(1).map((r) => [r[ah.indexOf('name')], r[ah.indexOf('email')], r[ah.indexOf('active')]]), [['Juno Limited', 'juno.limited@example.invalid', true]]);
const signInAs = async (email, tab) => {
  await page.evaluate(() => localStorage.setItem('bishopric-planner-settings', JSON.stringify({})));
  fakeEmail = email;
  await page.reload();
  await page.getByRole('link', { name: tab, exact: true }).click();
  await page.getByRole('button', { name: 'Sign in with Google' }).click();
  await page.getByText(/^Loaded \d+ members$/).waitFor();
};
const tabsShown = async () => [await page.$$eval('#tabs .tab-row:first-child .tab', (els) => els.map((e) => e.textContent)),
  await page.$$eval('#tabs .sub-tabs .tab', (els) => els.map((e) => e.textContent))];
await signInAs('juno.limited@example.invalid', 'Callings');
await page.locator('#view .view-title', { hasText: 'Organization chart' }).waitFor();
assert.deepEqual(await tabsShown(), [['Callings', 'Calendar', 'Members'], ['Org chart', 'Current', 'No calling']]);
assert.equal(await page.locator('#view .badge.new').count(), 0, 'no callings on their way on the org chart');
assert.ok(await page.locator('#view .holder').count() > 0);
assert.equal(await page.locator('#view button.holder').count(), 0, 'holders cannot be opened');
assert.ok((await page.textContent('#view .app-footer')).includes('Juno Limited'));
await page.evaluate(() => { location.hash = 'pipeline'; });                      // a hidden screen
await page.locator('#view .view-title', { hasText: 'Organization chart' }).waitFor();
await go('Current', 'Current callings');
assert.equal(await page.locator('#view button.card').count(), 0, 'current callings cannot be opened');
assert.ok(!(await page.textContent('#view')).includes('Record in LCR'), 'no step badges');
await go('Members');
assert.equal(await page.locator('#view select').count(), 0, 'no category filter');
const people = await page.textContent('#view');
assert.ok(people.includes('Firwood, Fay') && people.includes('Age 33') && !people.includes("Shouldn't ask") && !people.includes("Won't accept") && !people.includes('Moved'), people);
await noSideScroll('limited members');
await page.locator('#view .card', { hasText: 'Firwood, Fay' }).click();
const page2 = await page.textContent('#dlg');
assert.ok(page2.includes('Age 33 (about)') && page2.includes('Current callings') && !page2.includes('Record talk') && !page2.includes('Category'), page2);
await page.locator('#dlg').getByRole('button', { name: 'Propose a calling' }).click();
await page.locator('#dlg').getByLabel('Organization').fill('Primary');
await page.locator('#dlg').getByLabel('Calling').fill('Primary Pianist');
await page.getByRole('button', { name: 'Send to the bishopric' }).click();
await page.getByText('Sent to the bishopric: Primary Pianist for Firwood, Fay').waitFor();
const pianist = sheet.tabs.Callings.find((r) => r[ch.indexOf('calling')] === 'Primary Pianist');
assert.equal(pianist[ch.indexOf('entered_by')], 'Juno Limited');
await go('Calendar');
assert.equal(await page.locator('#view .cal-item.kind-speakers').count(), 0, 'no speakers on the limited calendar');
await page.getByRole('button', { name: 'Add item' }).click();
await page.getByLabel('Event date').fill('2026-11-29');
await page.getByLabel('Event time').fill('19:00');
await page.getByLabel('Event title').fill('Ward council meeting');
await page.getByRole('button', { name: 'Add to calendar' }).click();
await page.getByText('Added: Ward council meeting, 29 Nov 2026').waitFor();
assert.equal(await page.locator('#view .cal-item', { hasText: 'Ward council meeting' }).getByRole('button', { name: 'Remove' }).count(), 1);
assert.equal(await page.locator('#view .cal-item', { hasText: 'Christmas Devotional' }).getByRole('button', { name: 'Remove' }).count(), 0, 'cannot remove items others added');
const evh = sheet.tabs.Events[0];
assert.equal(sheet.tabs.Events.find((r) => r[evh.indexOf('title')] === 'Ward council meeting')[evh.indexOf('entered_by')], 'Juno Limited');
await noSideScroll('limited calendar');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/18-limited.png`, fullPage: true });
step('limited access: only Callings, Calendar and Members; names and ages; proposal sent; own calendar item removable');

// 28b. An account on neither list while the Limited access list is in use: limited, with "Which one are you?"
await signInAs('stranger@example.invalid', 'Members');
await page.locator('#dlg[open]').waitFor();          // "Which one are you?" (some bishopric entries have no account yet)
await page.locator('#dlg').getByRole('button', { name: 'Not now' }).click();
assert.deepEqual((await tabsShown())[0], ['Callings', 'Calendar', 'Members']);
assert.ok((await page.textContent('#view')).includes('This account is not on the Bishopric or Limited access list'));
step('an account on neither list sees the limited app and can still say which bishopric member it is');

// 28c. Back as a bishopric member: the full app, and the proposal is under In progress with who sent it
await signInAs('tess.sample@gmail.com', 'Callings');
assert.deepEqual((await tabsShown())[0], ['Speakers', 'Callings', 'Calendar', 'Members', 'Import', 'Settings']);
await go('In progress', 'Calls and releases in progress');
const proposedCard = await page.locator('#view .card', { hasText: 'Primary Pianist' }).textContent();
assert.ok(proposedCard.includes('Firwood, Fay') && proposedCard.includes('by Juno Limited'), proposedCard);
step('back in the full app, the limited person\'s proposal shows under Proposed with their name');

// 29. Privacy policy: linked at the bottom of every screen, its own page at privacy/, readable on a phone
const policyLink = page.locator('footer.site-footer a', { hasText: 'Privacy policy' });
assert.equal(await policyLink.getAttribute('href'), 'privacy/');
await policyLink.click();
await page.waitForURL(`${BASE}/privacy/`);
await page.locator('h2', { hasText: 'Privacy policy' }).waitFor();
const policy = await page.textContent('main');
for (const s of ['Google Sheets', 'Your email address', 'What is saved on your device', 'Limited Use requirements', 'No analytics']) {
  assert.ok(policy.includes(s), `privacy policy is missing "${s}"`);
}
assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), process.env.DARK ? 'rgb(18, 22, 29)' : 'rgb(245, 246, 248)', 'the policy page uses the app\'s styles');
await noSideScroll('privacy policy');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/19-privacy.png`, fullPage: true });
await page.getByRole('link', { name: 'Back to the app' }).click();
await page.waitForURL(`${BASE}/`);
const termsLink = page.locator('footer.site-footer a', { hasText: 'Terms of service' });
assert.equal(await termsLink.getAttribute('href'), 'terms/');
await termsLink.click();
await page.waitForURL(`${BASE}/terms/`);
await page.locator('h2', { hasText: 'Terms of service' }).waitFor();
const terms = await page.textContent('main');
for (const s of ['Who may use it', 'for Church use only', 'without any warranty', "Google's Terms of Service"]) {
  assert.ok(terms.includes(s), `terms of service is missing "${s}"`);
}
await noSideScroll('terms of service');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/20-terms.png`, fullPage: true });
await page.getByRole('link', { name: 'privacy policy' }).click();     // the terms link to the policy
await page.waitForURL(`${BASE}/privacy/`);
await page.getByRole('link', { name: 'Back to the app' }).click();
await page.waitForURL(`${BASE}/`);
await page.locator('footer.site-footer').waitFor();
step('privacy policy at privacy/ and terms of service at terms/, linked from the app, no sideways scrolling');

assert.deepEqual(errors, [], `browser errors:\n${errors.join('\n')}`);
step('no browser errors');
await browser.close();
server.close();
console.log(`\nAll browser checks passed (${sheet.log.length} fake Sheets API calls).`);

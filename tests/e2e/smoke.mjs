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
assert.deepEqual(await chips(), ['Ask soon (your pick) (0)', 'No talk in 3 years (2)', 'Spoke 2–3 years ago (0)', 'Spoke 1–2 years ago (1)',
  'Spoke within 1 year, or scheduled (1)', "Shouldn't ask / Won't accept (2)"]);
assert.deepEqual(await names(), ['Arbor, Amy', 'Birch, Ben', 'Cedar, Cora', 'Dogwood, Dan', 'Elmwood, Eli', 'Firwood, Fay']);
const tone = async (name) => (await page.locator('#view .card', { hasText: name }).getAttribute('class')).replace('card ', '');
assert.deepEqual([await tone('Arbor, Amy'), await tone('Birch, Ben'), await tone('Cedar, Cora'), await tone('Dogwood, Dan'), await tone('Elmwood, Eli'), await tone('Firwood, Fay')],
  ['tone-none', 'tone-green2', 'tone-none', 'tone-green1', 'tone-red', 'tone-red']);
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

// 8b. Bishopric list: add Tess Sample by hand (she votes on callings unless unchecked)
await page.locator('#dlg').evaluate((d) => d.open && d.close());
await go('Settings');
await page.getByLabel('New initials').fill('ts');
await page.getByLabel('New name').fill('Tess Sample');
await page.getByLabel('New role').fill('First Counselor');
await page.locator('#view').getByRole('button', { name: 'Add', exact: true }).click();
await page.getByText('TS added').waitFor();
assert.equal(await page.getByLabel('TS votes on callings').isChecked(), true);
step('Bishopric list: TS added by hand; "Votes" is checked');

// 9. Callings: the app creates the Callings, Votes and Tasks tabs; propose a calling
await go('Callings', 'Organization chart');
assert.ok(sheet.tabs.Callings && sheet.tabs.Callings[0].includes('sustained_on') && sheet.tabs.Callings[0].includes('approved_on'), 'Callings tab created with its columns');
assert.ok(sheet.tabs.Votes && sheet.tabs.Votes[0].includes('voter') && sheet.tabs.Tasks && sheet.tabs.Tasks[0].includes('assigned_to'), 'Votes and Tasks tabs created');
assert.ok(sheet.tabs.Bishopric[0].includes('votes'), 'Bishopric gained the votes column');
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
assert.ok(ip.includes('Proposed (1)') && ip.includes('Your vote needed') && ip.includes('Vote (0)') && ip.includes('Needs set apart (0)'), ip);
const heads = await page.$$eval('#view .stage-head', (els) => els.map((e) => e.textContent.replace(/ \(\d+\)$/, '')));
assert.deepEqual(heads, ['Proposed', 'Vote', 'Bishop Approved', 'Assigned', 'Sustain', 'Sustained/LCR Record', 'Releases', 'Needs set apart']);
assert.equal(await page.locator('#view details.stage').evaluate((d) => d.open), false, '"Needs set apart" starts closed');
await noSideScroll('in progress');
step('calling proposed; In progress shows the stages in order, "Needs set apart" last and closed');

// 10. Vote (My tasks), bishop approves, choose who asks, the asker records "Accepted"
await go('My tasks');
assert.ok((await page.textContent('#view')).includes('Votes waiting for you (1)'));
await page.locator('#view .card', { hasText: 'Arbor, Amy' }).click();
await page.locator('#dlg').getByRole('button', { name: 'Support', exact: true }).click();
await page.getByText('Vote saved: Support').waitFor();
const vh = sheet.tabs.Votes[0];
assert.deepEqual(sheet.tabs.Votes.slice(1).map((r) => [r[vh.indexOf('voter')], r[vh.indexOf('vote')], r[vh.indexOf('calling_id')] === call()[ch.indexOf('id')]]), [['TS', 'support', true]]);
assert.ok((await page.textContent('#dlg')).includes('All votes are in: bishop to decide'));
assert.equal(await page.locator('#dlg').getByRole('button', { name: '✓ Support' }).getAttribute('aria-pressed'), 'true');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/11-vote.png`, fullPage: true });
await page.locator('#dlg').getByRole('button', { name: 'Approved', exact: true }).click();
await page.locator('#dlg li.step.done', { hasText: '✓ Bishop approved' }).waitFor();
assert.equal(call()[ch.indexOf('approved_on')], serial('2026-11-16'));
assert.equal(call()[ch.indexOf('approved_by')], 'TS');
assert.equal(confirms.length, 0, 'no "not everyone voted" question when all votes are in');
await page.locator('#dlg').evaluate((d) => d.close());
await go('In progress', 'Calls and releases in progress');
assert.ok((await page.textContent('#view')).includes('Bishop Approved (1)'));
const whoMenu = page.getByLabel('Who will ask: Arbor, Amy');
assert.deepEqual(await whoMenu.locator('option').allTextContents(), ['Unassigned', 'TS — Tess Sample (First Counselor)', 'Stake']);
await whoMenu.selectOption('TS');
await page.getByText('Arbor, Amy: Tess Sample will ask').waitFor();
assert.equal(call()[ch.indexOf('extend_by')], 'TS');
ip = await page.textContent('#view');
assert.ok(ip.includes('Assigned (1)') && ip.includes('Tess Sample to ask') && ip.includes('Bishop Approved (0)'), ip);
step('TS voted Support (Votes tab); bishop approved; TS chosen to ask: now under Assigned');

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
assert.ok(mt.includes('Calls to extend (1)') && mt.includes('Your to-dos (1)') && mt.includes('Due 20 Nov 2026') && mt.includes('Votes waiting for you (0)'), mt);
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
await page.locator('#dlg').getByRole('button', { name: 'Support', exact: true }).click();
await page.getByText('Vote saved: Support').waitFor();
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
const aaVotes = () => sheet.tabs.Bishopric.find((r) => r[bh.indexOf('initials')] === 'AA')[bh.indexOf('votes')];
await page.getByLabel('AA votes on callings').uncheck();
await page.getByText('AA does not vote on callings').waitFor();
assert.equal(aaVotes(), false);
await page.getByLabel('AA votes on callings').check();
await page.getByText('AA votes on callings').first().waitFor();
assert.equal(aaVotes(), true);
await noSideScroll('settings');
const iniBox = await page.getByLabel('New initials').boundingBox();
assert.ok(iniBox.height < 60, `initials box is ${iniBox.height}px tall`);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/7-settings.png`, fullPage: true });
step('Bishopric list: filled from the org chart (Bishop), saved in the Sheet; "Votes" unchecked and checked again');

// 20. Two voters: TS votes, AA has not; approving early asks first
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
await page.locator('#dlg').getByRole('button', { name: 'Support', exact: true }).click();
await page.getByText('Vote saved: Support').waitFor();
assert.ok((await page.textContent('#dlg')).includes('Support: TS · Waiting for: AA'));
dismissNext = true;
await page.locator('#dlg').getByRole('button', { name: 'Approved', exact: true }).click();
assert.equal(confirms.at(-1), "Still waiting for AA to vote. Record the bishop's approval anyway?");
assert.ok(!ss()[ch.indexOf('approved_on')], 'not approved after answering Cancel');
await page.locator('#dlg').evaluate((d) => d.close());
ip = await page.textContent('#view');
assert.ok(ip.includes('Vote (1)') && ip.includes('Support: TS · Waiting for: AA'), ip);
step('two voters: the card shows who is still to vote; approving early asks first');

// 21. "Which one are you?" links the signed-in Google account to a Bishopric list entry
await go('Settings');
await page.locator('#view').getByRole('button', { name: 'Which one are you?' }).click();
await page.locator('#dlg').getByRole('button', { name: 'TS — Tess Sample (First Counselor)' }).click();
await page.getByText('Welcome, Tess Sample').waitFor();
assert.equal(sheet.tabs.Bishopric.find((r) => r[bh.indexOf('initials')] === 'TS')[sheet.tabs.Bishopric[0].indexOf('email')], 'tess.sample@gmail.com');
assert.ok((await page.textContent('#view')).includes('You: TS — Tess Sample (recognized from your Google account tess.sample@gmail.com)'));
step('"Which one are you?" saved the Google account on the Bishopric list');

// 21b. AA votes "Don't support" on another phone; the bishop does not approve, then undoes it;
//      AA changes to Support; approved; AA is chosen to ask
const addVote = (vote) => {
  const row = vh.map(() => '');
  Object.assign(row, { [vh.indexOf('id')]: 'v-aa', [vh.indexOf('calling_id')]: ss()[ch.indexOf('id')], [vh.indexOf('voter')]: 'AA', [vh.indexOf('vote')]: vote });
  sheet.tabs.Votes.push(row);
};
addVote('oppose');
await page.locator('#view').getByRole('button', { name: 'Reload data' }).click();
await page.getByText('Loaded 8 members').waitFor();
await go('Callings', 'Organization chart');
await go('In progress', 'Calls and releases in progress');
ip = await page.textContent('#view');
assert.ok(ip.includes("Support: TS · Don't support: AA") && ip.includes("1 don't support") && ip.includes('Votes in'), ip);
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
await page.locator('#dlg').getByRole('button', { name: 'Approved', exact: true }).waitFor();
assert.ok(!ss()[ch.indexOf('not_approved_on')] && !ss()[ch.indexOf('approved_by')]);
await page.locator('#dlg').evaluate((d) => d.close());
sheet.tabs.Votes.find((r) => r[vh.indexOf('id')] === 'v-aa')[vh.indexOf('vote')] = 'support';
await go('Settings');
await page.locator('#view').getByRole('button', { name: 'Reload data' }).click();
await page.getByText('Loaded 8 members').waitFor();
await go('Callings', 'Organization chart');
await go('In progress', 'Calls and releases in progress');
assert.ok((await page.textContent('#view')).includes('Support: TS, AA'));
const before = confirms.length;
await page.locator('#view .card', { hasText: 'Sunday School Teacher' }).click();
await page.locator('#dlg').getByRole('button', { name: 'Approved', exact: true }).click();
await page.locator('#dlg li.step.done', { hasText: '✓ Bishop approved' }).waitFor();
assert.equal(confirms.length, before, 'no question once every voter has voted');
await page.locator('#dlg').evaluate((d) => d.close());
const whoMenu2 = page.getByLabel('Who will ask: Dogwood, Dan');
assert.deepEqual(await whoMenu2.locator('option').allTextContents(), ['Unassigned', 'TS — Tess Sample (First Counselor)', 'AA — Amy Arbor (Bishop)', 'Stake']);
await whoMenu2.selectOption('AA');
await page.getByText('Dogwood, Dan: Amy Arbor will ask').waitFor();
assert.equal(ss()[ch.indexOf('extend_by')], 'AA');
assert.ok((await page.textContent('#view')).includes('Amy Arbor to ask'));
await go('My tasks');
assert.ok((await page.textContent('#view')).includes('Calls to extend (0)'), 'assigned to AA, not to TS');
step('AA\'s vote from another phone shows after Reload; not approved, undone, approved; AA chosen to ask');
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
step('no access to the stake Sheet: the calendar says so and still shows the rest');

assert.deepEqual(errors, [], `browser errors:\n${errors.join('\n')}`);
step('no browser errors');
await browser.close();
server.close();
console.log(`\nAll browser checks passed (${sheet.log.length} fake Sheets API calls).`);

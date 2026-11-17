// Browser test of how a new version reaches people, with the service worker on. No Sheet is
// opened, so no data is involved. The server answers like GitHub Pages: files may be reused for 10 minutes
// (Cache-Control: max-age=600) and carry an ETag. Run from the repository root:
//   node tests/e2e/update.mjs
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = process.cwd();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

// What is "published": a test version number in config.js, and an extra line in sw.js.
const published = { version: '', swNote: '' };
const requests = [];

const server = http.createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(ROOT, path.endsWith('/') ? `${path}index.html` : path);
  try {
    let body = await readFile(file);
    if (path.endsWith('/config.js') && published.version) {
      body = Buffer.from(body.toString().replace(/APP_VERSION = '[^']*'/, `APP_VERSION = '${published.version}'`));
    }
    if (path.endsWith('/sw.js') && published.swNote) body = Buffer.concat([body, Buffer.from(`\n// ${published.swNote}\n`)]);
    const etag = `"${createHash('sha1').update(body).digest('hex')}"`;
    requests.push(`${path} ${req.headers['if-none-match'] ? 'revalidate' : 'get'}`);
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': 'max-age=600' }); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'max-age=600', ETag: etag });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// No request interception here: Playwright turns the browser's HTTP cache off whenever routing is
// on, and this test is about that cache. Google's sign-in script is pointed at nowhere instead
// (no network); the app reports that and still shows the Settings screen.
const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP accounts.google.com 127.0.0.1:9'] });
const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1 });   // service workers allowed
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
const step = (s) => console.log(`ok - ${s}`);
const versionShown = async () => (await page.locator('#view .hint', { hasText: /^Version / }).textContent()).match(/^Version (\S+)\./)[1];

// 1. First visit: the worker installs and takes over the page; no update bar on a first visit.
await page.goto(`${BASE}/#settings`);
await page.locator('#view .hint', { hasText: /^Version / }).waitFor();
await page.evaluate(async () => { await navigator.serviceWorker.ready; });
await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 5000 });
const original = await versionShown();
assert.equal(await page.locator('#update-bar').count(), 0, 'no update bar on a first visit');
step(`first visit shows version ${original}; the service worker controls the page`);

// 2. A new version is published (config.js changes). Opening the app again (a new visit, as when
//    a phone app is closed and reopened, not a browser Reload) must show it, even though the
//    server said the old file could be reused for 10 minutes.
published.version = '9.9.9-test';
requests.length = 0;
await page.goto('about:blank');
await page.goto(`${BASE}/#settings`);
await page.locator('#view .hint', { hasText: /^Version / }).waitFor();
console.log(`   requests on reopening: ${requests.join(', ') || '(none: all from the browser\'s saved copies)'}`);
assert.equal(await versionShown(), '9.9.9-test', `reopened, the app still shows ${await versionShown()}: it used the 10-minute copy`);
step('a new version shows the next time the app is opened, without waiting 10 minutes');

// 3. A new version is published while the app is open (like a phone app resumed from the
//    background): coming back to it offers a reload instead of reloading by itself.
published.version = '9.9.10-test';
published.swNote = 'a new release';
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await page.locator('#update-bar', { hasText: 'A new version of the app is ready.' }).waitFor({ timeout: 10000 });
assert.equal(await versionShown(), '9.9.9-test', 'nothing reloads by itself');
await page.locator('#update-bar').getByRole('button', { name: 'Reload' }).click();
await page.locator('#view .hint', { hasText: /^Version 9\.9\.10-test/ }).waitFor({ timeout: 10000 });
assert.equal(await page.locator('#update-bar').count(), 0);
step('a release while the app is open: "A new version of the app is ready" bar; Reload shows it');

// 4. Offline: the last copy still opens.
await context.setOffline(true);
await page.reload();
await page.locator('#view .hint', { hasText: /^Version / }).waitFor();
await context.setOffline(false);
step('offline, the app still opens from the saved copy');

assert.deepEqual(errors, [], `browser errors:\n${errors.join('\n')}`);
step('no browser errors');
await browser.close();
server.close();
console.log('\nAll update checks passed.');

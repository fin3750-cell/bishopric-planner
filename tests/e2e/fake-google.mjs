// A stand-in for Google sign-in and the Google Sheets API, for browser tests only.
// It keeps a spreadsheet in memory and answers the few API calls the app makes.
// All data here is made up.

const SERIAL_EPOCH = Date.UTC(1899, 11, 30);

function isoToSerial(s) {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/);
  if (!m) return null;
  const days = (Date.UTC(+m[1], +m[2] - 1, +m[3]) - SERIAL_EPOCH) / 86400000;
  return m[4] ? days + (+m[4] * 60 + +m[5]) / 1440 : days;
}

// Mimics valueInputOption=USER_ENTERED for the values the app sends.
function userEntered(v) {
  if (typeof v !== 'string') return v;
  if (v.startsWith("'")) return v.slice(1);
  if (v === 'TRUE') return true;
  if (v === 'FALSE') return false;
  const serial = isoToSerial(v);
  if (serial !== null) return serial;
  if (v !== '' && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

function colIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseRange(a1) {
  const m = a1.match(/^'((?:[^']|'')+)'!([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?$/);
  if (!m) throw new Error(`fake sheets: cannot parse range ${a1}`);
  return { tab: m[1].replace(/''/g, "'"), c1: colIndex(m[2]), r1: m[3] ? +m[3] - 1 : 0, c2: m[4] ? colIndex(m[4]) : colIndex(m[2]), r2: m[5] ? +m[5] - 1 : Infinity };
}

export function createFakeSheet(initialTabs) {
  const tabs = JSON.parse(JSON.stringify(initialTabs)); // { title: [[row], ...] }
  const log = [];
  function cells(tab) { if (!tabs[tab]) throw new Error(`no tab ${tab}`); return tabs[tab]; }
  function setCell(tab, r, c, v) {
    const rows = cells(tab);
    while (rows.length <= r) rows.push([]);
    while (rows[r].length <= c) rows[r].push('');
    rows[r][c] = userEntered(v);
  }
  function getRange(a1) {
    const { tab, c1, r1, c2, r2 } = parseRange(a1);
    const rows = cells(tab);
    const out = [];
    for (let r = r1; r < rows.length && r <= r2; r++) {
      const row = rows[r].slice(c1, c2 + 1);
      while (row.length && (row[row.length - 1] === '' || row[row.length - 1] === undefined)) row.pop();
      out.push(row);
    }
    while (out.length && out[out.length - 1].length === 0) out.pop();
    return out;
  }
  async function handle(route) {
    const req = route.request();
    const url = new URL(req.url());
    const path = decodeURIComponent(url.pathname.replace(/^\/v4\/spreadsheets\/[^/:]+/, ''));
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    if (req.headers().authorization !== 'Bearer fake-token') {
      return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":{"message":"bad token"}}' });
    }
    log.push(`${req.method()} ${path}`);
    let json;
    if (req.method() === 'GET' && path === '') {
      json = { sheets: Object.keys(tabs).map((title) => ({ properties: { title } })) };
    } else if (req.method() === 'POST' && path === ':batchUpdate') {
      for (const r of body.requests) if (r.addSheet) tabs[r.addSheet.properties.title] = [];
      json = {};
    } else if (req.method() === 'GET' && path === '/values:batchGet') {
      json = { valueRanges: url.searchParams.getAll('ranges').map((r) => ({ range: r, values: getRange(r) })) };
    } else if (req.method() === 'POST' && path.endsWith(':append')) {
      const { tab } = parseRange(path.slice('/values/'.length, -':append'.length));
      const rows = cells(tab);
      for (const row of body.values) rows.push(row.map(userEntered));
      json = {};
    } else if (req.method() === 'POST' && path === '/values:batchUpdate') {
      for (const d of body.data) {
        const { tab, c1, r1 } = parseRange(d.range);
        d.values.forEach((row, i) => row.forEach((v, j) => setCell(tab, r1 + i, c1 + j, v)));
      }
      json = {};
    } else {
      return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: `fake: unhandled ${req.method()} ${path}` } }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
  }
  return { tabs, log, handle };
}

// Replaces https://accounts.google.com/gsi/client with a script that "signs in" at once.
export const FAKE_GIS = `
window.google = { accounts: { oauth2: {
  initTokenClient(cfg) { return { requestAccessToken() { setTimeout(() => cfg.callback({ access_token: 'fake-token', expires_in: 3600, scope: cfg.scope }), 10); } }; },
  hasGrantedAllScopes(resp, ...scopes) { return scopes.every((s) => String(resp.scope || '').split(' ').includes(s)); },
  revoke(_t, done) { if (done) done(); }
} } };`;

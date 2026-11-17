// Thin wrapper over the Google Sheets API (v4). Every request carries the signed-in user's
// access token, so Google only allows what that person's sharing on the Sheet allows.

const API = 'https://sheets.googleapis.com/v4/spreadsheets';

export class AuthError extends Error {}

export function quoteTab(title) {
  return `'${String(title).replace(/'/g, "''")}'`;
}

export function columnLetter(index) { // 0 -> A, 25 -> Z, 26 -> AA
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Accepts a full Google Sheets link or a bare spreadsheet id.
export function spreadsheetIdFrom(input) {
  const s = String(input || '').trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  return /^[a-zA-Z0-9-_]{20,}$/.test(s) ? s : '';
}

export class SheetsApi {
  constructor(spreadsheetId, getToken) {
    this.id = spreadsheetId;
    this.getToken = getToken;
  }

  async request(method, path, body) {
    const token = this.getToken();
    if (!token) throw new AuthError('Not signed in');
    const res = await fetch(`${API}/${encodeURIComponent(this.id)}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) throw new AuthError('Your Google sign-in expired');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.error && data.error.message ? data.error.message : `HTTP ${res.status}`;
      if (res.status === 403 || res.status === 404) {
        throw new Error(`Google refused access to the Sheet (${msg}). Check that the Sheet link is right and that it is shared with your Google account.`);
      }
      throw new Error(`Google Sheets error: ${msg}`);
    }
    return data;
  }

  // Each tab: { title, sheetId, columnCount }. A new tab has 26 columns (A to Z); Google refuses
  // to write past a tab's last column, so columns are added first (addColumns).
  tabs() {
    return this.request('GET', '?fields=sheets.properties')
      .then((d) => (d.sheets || []).map((s) => ({
        title: s.properties.title,
        sheetId: s.properties.sheetId,
        columnCount: (s.properties.gridProperties && s.properties.gridProperties.columnCount) || 0,
      })));
  }

  addTab(title) {
    return this.request('POST', ':batchUpdate', { requests: [{ addSheet: { properties: { title } } }] });
  }

  // adds: [{ sheetId, count }] -> that many empty columns added after each tab's last column.
  addColumns(adds) {
    return this.request('POST', ':batchUpdate', {
      requests: adds.map((a) => ({ appendDimension: { sheetId: a.sheetId, dimension: 'COLUMNS', length: a.count } })),
    });
  }

  // Dates come back as serial numbers and booleans as true/false, whatever the cell's display format.
  batchGet(ranges) {
    const q = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&');
    return this.request('GET', `/values:batchGet?${q}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER&majorDimension=ROWS`)
      .then((d) => (d.valueRanges || []).map((v) => v.values || []));
  }

  append(tab, rows) {
    return this.request('POST', `/values/${encodeURIComponent(`${quoteTab(tab)}!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { values: rows });
  }

  batchUpdateValues(data) {
    return this.request('POST', '/values:batchUpdate', { valueInputOption: 'USER_ENTERED', data });
  }
}

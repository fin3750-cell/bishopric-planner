// The app's copy of the Sheet. Each tab is a table of records keyed by its header row, so columns
// can be in any order. Features declare the tabs and columns they need; missing ones are added.

import { parseDate } from './dates.js';
import { columnLetter, quoteTab } from './sheets.js';

// Core tables. Features add their own with registerTables().
const SCHEMA = {
  Members: {
    columns: ['id', 'name', 'gender', 'age', 'age_as_of', 'source', 'status', 'notes',
      'category', 'category_until', 'moved_in', 'last_in_list'],
    dates: ['age_as_of', 'category_until', 'moved_in', 'last_in_list'],
  },
  // The people who can be assigned steps (initials used across the app).
  Bishopric: {
    columns: ['id', 'initials', 'name', 'role', 'member_id', 'active'],
    dates: [],
  },
};

export function registerTables(tables) {
  for (const [name, def] of Object.entries(tables)) {
    if (!SCHEMA[name]) SCHEMA[name] = { columns: [], dates: [] };
    for (const c of def.columns) if (!SCHEMA[name].columns.includes(c)) SCHEMA[name].columns.push(c);
    for (const c of def.dates || []) if (!SCHEMA[name].dates.includes(c)) SCHEMA[name].dates.push(c);
  }
}

// A value as it should be sent to Sheets with USER_ENTERED input:
// ISO dates become real dates, booleans TRUE/FALSE, and text that starts with = + - @ is kept as text.
export function toCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return v;
  const s = String(v);
  if (/^[=+\-@]/.test(s)) return `'${s}`;
  return s;
}

function fromCell(v, isDate) {
  if (isDate) return parseDate(v);
  if (v === null || v === undefined) return '';
  return typeof v === 'string' ? v.trim() : v;
}

export class Store {
  constructor(api) {
    this.api = api;
    this.tables = {}; // name -> { headers: [], records: [] }
  }

  records(name) { return this.tables[name] ? this.tables[name].records : []; }

  async load() {
    const titles = await this.api.tabTitles();
    for (const name of Object.keys(SCHEMA)) {
      if (!titles.includes(name)) await this.api.addTab(name);
    }
    const names = Object.keys(SCHEMA);
    const values = await this.api.batchGet(names.map((n) => `${quoteTab(n)}!A1:ZZ`));
    const headerFixes = [];
    names.forEach((name, i) => {
      const rows = values[i];
      const headers = (rows[0] || []).map((h) => String(h).trim());
      const missing = SCHEMA[name].columns.filter((c) => !headers.includes(c));
      if (missing.length) {
        headerFixes.push({ range: `${quoteTab(name)}!${columnLetter(headers.length)}1`, values: [missing] });
        headers.push(...missing);
      }
      const dateCols = new Set(SCHEMA[name].dates);
      const records = [];
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        if (!row || row.every((c) => c === '' || c === null)) continue;
        const rec = {};
        headers.forEach((h, c) => { if (h) rec[h] = fromCell(row[c], dateCols.has(h)); });
        records.push(rec);
      }
      this.tables[name] = { headers, records };
    });
    if (headerFixes.length) await this.api.batchUpdateValues(headerFixes);
  }

  async add(name, objs) {
    const t = this.tables[name];
    await this.api.append(name, objs.map((o) => t.headers.map((h) => toCell(o[h]))));
    t.records.push(...objs.map((o) => ({ ...o })));
  }

  // changes: [{ id, fields: { column: value } }]. The id column is re-read first, so a row that
  // someone moved or sorted in the Sheet is still found by its id rather than by its old position.
  async update(name, changes) {
    const t = this.tables[name];
    const idCol = t.headers.indexOf('id');
    if (idCol < 0) throw new Error(`The ${name} tab has no "id" column.`);
    const L = columnLetter(idCol);
    const [ids] = await this.api.batchGet([`${quoteTab(name)}!${L}:${L}`]);
    const rowOf = new Map();
    ids.forEach((r, i) => { if (r[0] !== undefined && r[0] !== '') rowOf.set(String(r[0]), i + 1); });
    const data = [];
    for (const ch of changes) {
      const row = rowOf.get(String(ch.id));
      if (!row) throw new Error(`Could not find ${ch.id} in the ${name} tab. Reload and try again.`);
      for (const [field, value] of Object.entries(ch.fields)) {
        const col = t.headers.indexOf(field);
        if (col < 0) throw new Error(`The ${name} tab has no "${field}" column.`);
        data.push({ range: `${quoteTab(name)}!${columnLetter(col)}${row}`, values: [[toCell(value)]] });
      }
    }
    if (data.length) await this.api.batchUpdateValues(data);
    for (const ch of changes) {
      const rec = t.records.find((r) => String(r.id) === String(ch.id));
      if (rec) Object.assign(rec, ch.fields);
    }
  }
}

// Run with:  node --test      Loading the Sheet: missing tabs, columns and headers are added.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, registerTables } from '../js/store.js';
import { COLUMNS, DATE_COLUMNS, VOTE_COLUMNS, VOTE_DATES, TODO_COLUMNS, TODO_DATES } from '../js/features/callings-logic.js';

registerTables({
  Callings: { columns: COLUMNS, dates: DATE_COLUMNS },
  Votes: { columns: VOTE_COLUMNS, dates: VOTE_DATES },
  Tasks: { columns: TODO_COLUMNS, dates: TODO_DATES },
});

const letterIndex = (s) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

// In-memory stand-in for SheetsApi with Google's rule: no writing past a tab's last column.
function fakeApi(start) {
  const tabs = new Map(Object.entries(start).map(([title, t], i) => [title, { sheetId: i + 1, columnCount: t.columnCount, rows: t.rows }]));
  const calls = [];
  return {
    calls,
    async tabs() { calls.push('tabs'); return [...tabs].map(([title, t]) => ({ title, sheetId: t.sheetId, columnCount: t.columnCount })); },
    async addTab(title) { calls.push(`addTab ${title}`); tabs.set(title, { sheetId: tabs.size + 1, columnCount: 26, rows: [] }); },
    async addColumns(adds) {
      calls.push(`addColumns ${adds.map((a) => `${a.sheetId}+${a.count}`).join(',')}`);
      for (const a of adds) [...tabs.values()].find((t) => t.sheetId === a.sheetId).columnCount += a.count;
    },
    async batchGet(ranges) { return ranges.map((r) => tabs.get(r.match(/^'(.+)'!/)[1]).rows.map((row) => row.slice())); },
    async batchUpdateValues(data) {
      calls.push(`write ${data.map((d) => d.range).join(',')}`);
      const parsed = data.map((d) => { const m = d.range.match(/^'(.+)'!([A-Z]+)(\d+)$/); return { t: tabs.get(m[1]), title: m[1], c: letterIndex(m[2]), r: +m[3] - 1, values: d.values }; });
      for (const p of parsed) {
        if (p.c + p.values[0].length > p.t.columnCount) throw new Error(`Range ('${p.title}'!...) exceeds grid limits. Max columns: ${p.t.columnCount}`);
      }
      for (const p of parsed) p.values[0].forEach((v, j) => { const row = p.t.rows[p.r] || (p.t.rows[p.r] = []); row[p.c + j] = v; });
    },
    get: (title) => tabs.get(title),
  };
}

// The Sheet as it was when version 0.7.0 first loaded: Callings has the 26 old columns (A to Z)
// and no room for more; Bishopric has 7 columns.
const OLD_CALLINGS = ['id', 'member_id', 'member_name', 'organization', 'calling', 'proposed_on', 'extend_by', 'extended_on', 'accepted_on',
  'declined_on', 'sustained_on', 'set_apart_by', 'set_apart_on', 'record_by', 'recorded_on', 'release_proposed_on', 'release_by',
  'release_informed_on', 'released_on', 'release_record_by', 'release_recorded_on', 'source', 'notes', 'entered_by', 'entered_at', 'void'];

test('load widens a full tab before adding its new headers', async () => {
  assert.equal(OLD_CALLINGS.length, 26);
  const api = fakeApi({
    Members: { columnCount: 26, rows: [['id', 'name', 'gender', 'age', 'age_as_of', 'source', 'status', 'notes', 'category', 'category_until', 'moved_in', 'last_in_list']] },
    Bishopric: { columnCount: 26, rows: [['id', 'initials', 'name', 'role', 'member_id', 'active', 'email'], ['b1', 'AA', 'Amy Arbor', 'Bishop', '', true, '']] },
    Callings: { columnCount: 26, rows: [OLD_CALLINGS, ['c1', 'm1', 'Arbor, Amy', 'Primary', 'Primary Teacher', '', '', '', '', '', 46000]] },
  });
  const store = new Store(api);
  await store.load();
  const callings = api.get('Callings');
  assert.equal(callings.columnCount, 29);
  assert.deepEqual(callings.rows[0].slice(26), ['approved_on', 'approved_by', 'not_approved_on']);
  assert.deepEqual(api.get('Bishopric').rows[0].slice(7), ['votes']);
  assert.deepEqual(api.get('Votes').rows[0], VOTE_COLUMNS);
  assert.deepEqual(api.get('Tasks').rows[0], TODO_COLUMNS);
  assert.equal(store.records('Callings')[0].sustained_on, '2025-12-09');   // existing data read as before
  // The second load finds everything in place: no tabs, columns or headers added.
  const before = api.calls.length;
  await new Store(api).load();
  assert.deepEqual(api.calls.slice(before), ['tabs']);
});

test('a new tab with more than 26 columns is widened too', async () => {
  const api = fakeApi({ Members: { columnCount: 26, rows: [] }, Bishopric: { columnCount: 26, rows: [] } });
  await new Store(api).load();
  assert.equal(api.get('Callings').columnCount, COLUMNS.length);
  assert.deepEqual(api.get('Callings').rows[0], COLUMNS);
  assert.ok(COLUMNS.length > 26);
});

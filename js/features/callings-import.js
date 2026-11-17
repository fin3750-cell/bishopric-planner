// Reading an LCR callings report (text copied from the report, or a CSV) and comparing it with the
// Callings tab. Pure functions: no page, no network.
//
// Report lines look like "Calling Name (5 Nov 2023/Yes)": the date sustained and whether the person
// was set apart. A person's name comes before their callings, either on its own line or at the start
// of the first calling's line.

import { normName, makeId } from '../members.js';
import { parseDate } from '../dates.js';
import { organizationFor } from './callings-orgs.js';
import { callingState, isCurrent } from './callings-logic.js';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const CALLING = /^(.*?)\s*\((\d{1,2}) ([A-Za-z]{3}) (\d{4})\s*\/\s*(Yes|No)\)\s*$/;
// Page headers and footers of a printed report, and the report page's own labels.
const PAGE_BREAK = [/^Create a Report\b/i, /^\d+ of \d+\b/];
const LABELS = [/^LCR Callings List$/i, /^Description$/i, /^Your report has been saved/i, /^Search$/i, /^Edit Report$/i,
  /^Preferred Name\b/i, /^Return to Custom Reports$/i];

function pad(n) { return String(n).padStart(2, '0'); }

// Splits "Last, First Calling Name" into a known member name and the rest, trying the longest name first.
function splitKnownName(words, byNorm) {
  for (let i = words.length; i >= 2; i--) {
    const name = byNorm.get(normName(words.slice(0, i).join(' ')));
    if (name) return { name, rest: words.slice(i).join(' ') };
  }
  return null;
}

// memberNames: the names in the Members tab ("Last, First Middle"). They are used to tell where a
// name ends and a calling begins when both are on one line.
export function parseCallingsText(text, memberNames) {
  const byNorm = new Map(memberNames.map((n) => [normName(n), n]));
  const rows = [];
  const issues = [];
  let declared = null;
  let person = null;
  let pending = '';
  let expectTail = '';
  let afterBreak = false;
  let last = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    for (const cell of raw.split('\t')) {
      let line = cell.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
      if (!line) continue;
      if (PAGE_BREAK.some((re) => re.test(line))) { afterBreak = true; continue; }
      if (LABELS.some((re) => re.test(line))) continue;
      const count = line.match(/^Count:\s*(\d+)$/i);
      if (count) { declared = Number(count[1]); continue; }
      if (pending) { line = `${pending} ${line}`; pending = ''; }
      const m = line.match(CALLING);
      if (!m) {
        if (line.includes('(') && !line.includes(')')) { pending = line; continue; }   // calling wrapped onto the next line
        const exact = byNorm.get(normName(line));
        if (exact) { person = exact; expectTail = ''; afterBreak = false; continue; }
        if (expectTail && normName(line) === expectTail) { expectTail = ''; continue; }  // rest of a wrapped name
        const starts = [...byNorm.keys()].filter((k) => k.startsWith(`${normName(line)} `));
        if (starts.length === 1 && line.includes(',')) {
          person = byNorm.get(starts[0]);
          expectTail = starts[0].slice(normName(line).length + 1);
          afterBreak = false;
          continue;
        }
        issues.push(`Not understood: "${line}"`);
        continue;
      }
      let calling = m[1].trim();
      const split = splitKnownName(calling.split(' '), byNorm);
      if (split) {
        person = split.name; calling = split.rest; expectTail = ''; afterBreak = false;
      } else if (/^[^,()]+,\s/.test(calling)) {
        issues.push(`Name not found in Members: "${line}"`);
        person = null;
        continue;
      }
      if (!person) { issues.push(`No name before: "${line}"`); continue; }
      const month = MONTHS[m[3].toLowerCase()];
      if (!month || !calling) { issues.push(`Not understood: "${line}"`); continue; }
      const row = { name: person, calling, sustained: `${m[4]}-${pad(month)}-${pad(Number(m[2]))}`, setApart: m[5].toLowerCase() === 'yes' };
      // A line repeated right after a page break is usually the same line printed on both pages.
      if (afterBreak && last && last.name === row.name && last.calling === row.calling &&
          last.sustained === row.sustained && last.setApart === row.setApart) row.pageBreakDuplicate = true;
      rows.push(row);
      last = row;
      afterBreak = false;
    }
  }
  if (pending) issues.push(`Not understood: "${pending}"`);
  return { rows, issues, declared, people: new Set(rows.map((r) => r.name)).size };
}

// Minimal CSV reader: commas, double quotes, "" inside quotes.
function csvRows(text) {
  const out = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false; else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) out.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) out.push(row);
  return out;
}

// CSV with a header row: name, calling, and optionally organization, sustained, set_apart.
export function parseCallingsCsv(text) {
  const all = csvRows(text);
  if (!all.length) return { rows: [], issues: ['The file is empty.'] };
  const head = all[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const col = (name) => head.indexOf(name);
  const [iName, iCalling, iOrg, iSus, iSet] = ['name', 'calling', 'organization', 'sustained', 'set_apart'].map(col);
  if (iName < 0 || iCalling < 0) return { rows: [], issues: ['The CSV needs "name" and "calling" columns.'] };
  const rows = [];
  const issues = [];
  all.slice(1).forEach((r, i) => {
    const name = (r[iName] || '').trim();
    const calling = (r[iCalling] || '').trim();
    if (!name || !calling) { issues.push(`Row ${i + 2}: missing name or calling`); return; }
    const sustained = iSus >= 0 ? parseDate((r[iSus] || '').trim()) : '';
    if (iSus >= 0 && (r[iSus] || '').trim() && !sustained) issues.push(`Row ${i + 2}: "${r[iSus]}" is not a date`);
    rows.push({
      name, calling, sustained,
      organization: iOrg >= 0 ? (r[iOrg] || '').trim() : '',
      setApart: iSet >= 0 ? /^(yes|true|1|y)$/i.test((r[iSet] || '').trim()) : false,
    });
  });
  return { rows, issues, declared: null, people: new Set(rows.map((r) => r.name)).size };
}

// Compares report rows with the Callings tab.
//   add:         callings not in the Sheet (added as sustained and recorded in LCR)
//   update:      callings in the Sheet with dates the report can fill in
//   unchanged:   callings already complete in the Sheet
//   notInReport: current callings in the Sheet that the report no longer lists
//   unmatched:   rows whose name is not in the Members tab
//   pageDuplicates: lines repeated across a page break (left out unless the user includes them)
export function diffCallingsImport(callings, members, rows, today) {
  const memberByNorm = new Map(members.filter((m) => m.id).map((m) => [normName(m.name), m]));
  const live = callings.filter((c) => {
    const p = callingState(c).phase;
    return p !== 'void' && p !== 'declined' && p !== 'not_approved' && p !== 'ended';
  });
  const used = new Set();
  const add = [];
  const update = [];
  const unchanged = [];
  const unmatched = [];
  const pageDuplicates = [];
  for (const r of rows) {
    if (r.pageBreakDuplicate) { pageDuplicates.push(r); continue; }
    const m = memberByNorm.get(normName(r.name));
    if (!m) { unmatched.push(r); continue; }
    const same = live.filter((c) => !used.has(c.id) && c.member_id === m.id && normName(c.calling) === normName(r.calling));
    const match = same.find((c) => r.sustained && c.sustained_on === r.sustained) ||
      same.find((c) => !c.sustained_on) || same.find((c) => isCurrent(c));
    if (match) {
      used.add(match.id);
      const fields = {};
      if (!match.sustained_on && r.sustained) fields.sustained_on = r.sustained;
      if (r.setApart && !match.set_apart_on) fields.set_apart_on = r.sustained || today;
      if (!match.recorded_on) fields.recorded_on = today;
      if (Object.keys(fields).length) update.push({ calling: match, row: r, fields });
      else unchanged.push({ calling: match, row: r });
      continue;
    }
    add.push({
      id: makeId('c'), member_id: m.id, member_name: m.name,
      organization: r.organization || organizationFor(r.calling).organization, calling: r.calling,
      sustained_on: r.sustained, set_apart_on: r.setApart ? r.sustained : '', recorded_on: today,
      source: `LCR import ${today}`, notes: r.setApart ? 'Set-apart date not in the LCR report; sustained date used.' : '',
    });
  }
  const notInReport = live.filter((c) => isCurrent(c) && !used.has(c.id));
  return { add, update, unchanged, notInReport, unmatched, pageDuplicates };
}

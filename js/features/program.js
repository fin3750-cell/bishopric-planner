// WardBullet program import (Speakers > WardBullet). WardBullet has no export, so a program is
// copied from its page and pasted here. The speakers become talks on the program's date and dated
// announcements become Calendar items. Nothing is saved until the person reviews it and taps Save;
// a speaker without an exact member match waits for a person to choose.

import { formatDate } from '../dates.js';
import { makeId, isActive, isTrue } from '../members.js';
import { h, add, clear, select, busy, toast } from '../ui.js';
import { parseProgram, matchSpeaker } from './program-parse.js';
import { formatTime } from './calendar-logic.js';

const view = { text: '' };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dayDate(iso) { return `${DAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()]}, ${formatDate(iso)}`; }
function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

// Same title, ignoring case, spaces and punctuation, or one contained in the other ("Ward Christmas
// Party" and "Ward Christmas party 6pm").
function sameTitle(a, b) {
  const x = String(a || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const y = String(b || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!x || !y) return false;
  return x === y || (Math.min(x.length, y.length) >= 6 && (x.includes(y) || y.includes(x)));
}

function renderProgram(root, ctx) {
  const box = h('textarea', { rows: 6, 'aria-label': 'WardBullet program text', placeholder: 'Paste the program here' });
  box.value = view.text;
  const out = h('div', { class: 'program-result' });
  const read = h('button', { text: 'Read program' });
  read.addEventListener('click', () => { view.text = box.value; draw(); });
  add(root,
    h('p', { class: 'hint', text: 'In WardBullet, open the program page. With Agenda open it has the speakers; with Announcements open it has dated items for the Calendar. Select all, copy, paste here and tap Read program. Nothing is saved until you tap Save.' }),
    box, h('div', { class: 'toolbar' }, read), out);
  draw();

  function draw() {
    clear(out);
    if (!view.text.trim()) return;
    const p = parseProgram(view.text);
    const problems = p.problems.length ? h('ul', { class: 'plain error' }, p.problems.map((t) => h('li', { text: t }))) : null;
    if (!p.date) { add(out, problems); return; }
    const members = ctx.store.records('Members').filter((m) => m.id && isActive(m));
    const talks = ctx.store.records('Talks').filter((t) => !isTrue(t.void) && t.date === p.date);
    const events = ctx.store.records('Events').filter((e) => !isTrue(e.void));
    const recorded = (memberId) => talks.some((t) => t.member_id === memberId);
    // The same program line saved before (a visitor, or "Sister Firwood" matched to a member).
    const sameLine = (name) => talks.some((t) => sameTitle(t.name_as_shown, name));

    // Speakers: an exact match is chosen; same-surname matches wait for a choice; no match is a visitor.
    const speakers = p.speakers.map((s) => {
      const r = matchSpeaker(s.name, members);
      const def = r.exact.length === 1 ? r.exact[0].id : (r.exact.length || r.others.length) ? '' : 'visitor';
      const done = sameLine(s.name) || (def && def !== 'visitor' && recorded(def));
      if (done) return { s, sel: null, row: h('li', { class: 'row' }, h('span', {}, h('strong', { text: s.name }), ` · ${s.label}`), h('span', { class: 'badge muted', text: 'Already recorded' })) };
      const opts = [
        ...(def === '' ? [{ value: '', label: 'Choose who this is…' }] : []),
        ...[...r.exact, ...r.others].map((m) => ({ value: m.id, label: `${m.name}${recorded(m.id) ? ' (already recorded)' : ''}` })),
        { value: 'visitor', label: 'Visitor (not in the member list)' },
        { value: 'skip', label: 'Don\'t record' },
      ];
      const sel = select(opts, def, { 'aria-label': `Who is ${s.name}` });
      return { s, sel, row: h('li', { class: 'row' }, h('span', {}, h('strong', { text: s.name }), ` · ${s.label}`), sel) };
    });

    // Dated announcements for the Calendar, except ones already there.
    const items = p.announcements.map((a) => {
      const dup = events.some((e) => e.date === a.date && sameTitle(e.title, a.title));
      const box2 = dup ? null : h('input', { type: 'checkbox', checked: true, 'aria-label': `Add to calendar: ${a.title}` });
      const when = `${dayDate(a.date)}${a.time ? `, ${formatTime(a.time)}` : ''}`;
      return { a, box: box2, row: h('li', { class: 'row' },
        dup ? h('span', {}, `${when}: `, h('strong', { text: a.title })) : h('label', { class: 'check' }, box2, h('span', {}, `${when}: `, h('strong', { text: a.title }))),
        dup ? h('span', { class: 'badge muted', text: 'Already on the calendar' }) : null) };
    });

    const save = h('button', { text: 'Save' });
    save.addEventListener('click', () => busy(save, async () => {
      const waiting = speakers.find((x) => x.sel && x.sel.value === '');
      if (waiting) throw new Error(`Choose who "${waiting.s.name}" is, or pick Visitor or Don't record.`);
      const byId = new Map(members.map((m) => [m.id, m]));
      const talkRows = [];
      const seen = new Set();
      for (const x of speakers) {
        if (!x.sel || x.sel.value === 'skip') continue;
        const base = { date: p.date, date_estimated: false, source: `WardBullet program ${formatDate(p.date)}`, entered_by: ctx.settings.initials, entered_at: ctx.stamp() };
        if (x.sel.value === 'visitor') {
          talkRows.push({ id: makeId('t'), ...base, member_id: '', member_name: '', name_as_shown: x.s.name, ward_member: false, notes: 'Visitor (not in the member list)' });
          continue;
        }
        const m = byId.get(x.sel.value);
        if (!m || recorded(m.id) || seen.has(m.id)) continue;
        seen.add(m.id);
        talkRows.push({ id: makeId('t'), ...base, member_id: m.id, member_name: m.name, name_as_shown: x.s.name, ward_member: true, notes: '' });
      }
      const eventRows = items.filter((x) => x.box && x.box.checked).map((x) => ({
        id: makeId('ev'), date: x.a.date, time: x.a.time, title: x.a.title, notes: `From the WardBullet program of ${formatDate(p.date)}`,
        entered_by: ctx.settings.initials, entered_at: ctx.stamp(),
      }));
      if (!talkRows.length && !eventRows.length) throw new Error('Nothing to save.');
      if (talkRows.length) await ctx.store.add('Talks', talkRows);
      // As with Record talk: someone marked "Ask soon" has now spoken, so the label comes off.
      const askSoon = talkRows.filter((t) => t.member_id && byId.get(t.member_id).category === 'ask_soon');
      if (askSoon.length) await ctx.store.update('Members', askSoon.map((t) => ({ id: t.member_id, fields: { category: '', category_until: '' } })));
      if (eventRows.length) await ctx.store.add('Events', eventRows);
      toast(`Saved: ${[talkRows.length ? plural(talkRows.length, 'talk') : '', eventRows.length ? plural(eventRows.length, 'calendar item') : ''].filter(Boolean).join(', ')}`);
      view.text = '';
      ctx.refresh();
    }).catch(() => {}));

    add(out,
      h('h3', { class: 'stage-head', text: `Program: ${dayDate(p.date)}` }),
      problems,
      h('h4', { text: `Speakers (${speakers.length})` }),
      speakers.length ? h('ul', { class: 'rows' }, speakers.map((x) => x.row)) : h('p', { class: 'empty', text: 'No speakers in this text. Copy the program with Agenda open to get them.' }),
      h('h4', { text: `Calendar items from the announcements (${items.length})` }),
      items.length ? h('ul', { class: 'rows' }, items.map((x) => x.row)) : h('p', { class: 'empty', text: 'No dated announcements (lines like "12/10: Ward Christmas party 6pm").' }),
      p.past.length ? h('p', { class: 'hint', text: `${plural(p.past.length, 'dated announcement')} before ${formatDate(p.date)} left out.` }) : null,
      h('div', { class: 'toolbar' }, save));
  }
}

export const programFeature = {
  id: 'program',
  group: 'Speakers',
  tables: {},
  views: [{ id: 'wardbullet', label: 'WardBullet', title: 'Import a WardBullet program', render: renderProgram }],
};

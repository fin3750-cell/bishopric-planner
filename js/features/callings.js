// Callings feature: current callings and time in calling, calls and releases in progress,
// Sunday business (releases and sustainings), each person's assigned tasks, and members with no calling.

import { formatDate, nextSunday } from '../dates.js';
import { makeId, normName, isActive } from '../members.js';
import { h, add, clear, field, select, busy, toast, openDialog } from '../ui.js';
import {
  COLUMNS, DATE_COLUMNS, STEPS, STEP_ORDER, callingState, isCurrent, tenureMonths, formatTenure,
  openTasks, myTasks, sundayBusiness, currentCallings, callingsFor, membersWithoutCalling,
} from './callings-logic.js';

const tables = { Callings: { columns: COLUMNS, dates: DATE_COLUMNS } };

// Suggestions only; organizations and callings already in the Sheet are added to these lists.
const DEFAULT_ORGS = ['Bishopric', 'Elders Quorum', 'Relief Society', 'Young Women', 'Aaronic Priesthood', 'Primary',
  'Sunday School', 'Music', 'Ward Mission', 'Temple and Family History', 'Activities', 'Other'];

const PHASE_TEXT = {
  proposed: 'Proposed, not yet asked', awaiting: 'Asked, waiting for an answer', to_sustain: 'Accepted, to sustain',
  serving: 'Serving', releasing: 'Release in progress', ended: 'Released', declined: 'Declined', void: 'Removed',
};

const view = { search: '', sort: 'org', minAge: '18' };

function callings(ctx) { return ctx.store.records('Callings'); }

function uniq(values) { return [...new Set(values.map((v) => String(v || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)); }

function datalist(id, values) { return h('datalist', { id }, values.map((v) => h('option', { value: v }))); }

function initialsList(ctx) {
  const all = callings(ctx).flatMap((c) => ['extend_by', 'set_apart_by', 'record_by', 'release_by', 'release_record_by'].map((k) => c[k]));
  const talks = ctx.store.records('Talks').map((t) => t.entered_by).filter((v) => v && v !== 'import');
  return uniq([ctx.settings.initials, ...all, ...talks].map((v) => String(v || '').toUpperCase()));
}

function sundayDefault(ctx) { return nextSunday(ctx.today()); }

async function save(ctx, id, fields) {
  await ctx.store.update('Callings', [{ id, fields }]);
}

function titleOf(c) { return `${c.calling || 'Calling'} — ${c.member_name || '(no name)'}`; }

// ---------- calling page ----------

export function openCalling(id, ctx) {
  const c = callings(ctx).find((x) => x.id === id);
  if (!c) { toast('That calling is not in the Sheet.', 'error'); return; }
  const today = ctx.today();
  const reopen = () => { ctx.refresh(); openCalling(id, ctx); };
  openDialog(titleOf(c), (close) => {
    const state = callingState(c);
    const tenure = tenureMonths(c, today);
    const rows = [];
    const stepRow = (label, dateField, byField, defaultDate, extra) => {
      if (c[dateField]) {
        const undo = h('button', { class: 'small secondary', text: 'Undo' });
        undo.addEventListener('click', () => {
          if (!window.confirm(`Clear "${label}" (${formatDate(c[dateField])})?`)) return;
          busy(undo, async () => { await save(ctx, c.id, { [dateField]: '' }); reopen(); }).catch(() => {});
        });
        return h('li', { class: 'row step done' },
          h('span', {}, h('strong', { text: `✓ ${label}` }), ` ${formatDate(c[dateField])}${byField && c[byField] ? ` · ${String(c[byField]).toUpperCase()}` : ''}`),
          undo);
      }
      const date = h('input', { type: 'date', value: defaultDate, 'aria-label': `${label} date` });
      const done = h('button', { class: 'small', text: 'Done' });
      done.addEventListener('click', () => busy(done, async () => {
        if (!date.value) throw new Error('Choose a date.');
        await save(ctx, c.id, { [dateField]: date.value });
        reopen();
      }).catch(() => {}));
      let by = null;
      if (byField) {
        by = h('input', { type: 'text', value: String(c[byField] || '').toUpperCase(), list: 'initials-list', maxlength: 6, placeholder: 'Who', 'aria-label': `${label}: assigned to`, class: 'initials' });
        by.addEventListener('change', () => {
          save(ctx, c.id, { [byField]: by.value.trim().toUpperCase() })
            .then(() => { toast(by.value.trim() ? `Assigned to ${by.value.trim().toUpperCase()}` : 'Unassigned'); ctx.refresh(); })
            .catch((e) => ctx.fail(e));
        });
      }
      return h('li', { class: 'row step' }, h('span', { class: 'step-label', text: label }),
        h('span', { class: 'step-controls' }, by, date, extra || done));
    };

    rows.push(stepRow('Proposed', 'proposed_on', null, today));
    rows.push(stepRow('Asked', 'extended_on', 'extend_by', today));
    if (c.declined_on) {
      rows.push(stepRow('Declined', 'declined_on', null, today));
    } else if (c.accepted_on || c.sustained_on) {
      rows.push(stepRow('Accepted', 'accepted_on', null, today));
    } else {
      const date = h('input', { type: 'date', value: today, 'aria-label': 'Answer date' });
      const yes = h('button', { class: 'small', text: 'Accepted' });
      const no = h('button', { class: 'small warn', text: 'Declined' });
      yes.addEventListener('click', () => busy(yes, async () => { await save(ctx, c.id, { accepted_on: date.value || today }); reopen(); }).catch(() => {}));
      no.addEventListener('click', () => busy(no, async () => { await save(ctx, c.id, { declined_on: date.value || today }); reopen(); }).catch(() => {}));
      rows.push(h('li', { class: 'row step' }, h('span', { class: 'step-label', text: 'Answer' }), h('span', { class: 'step-controls' }, date, yes, no)));
    }
    if (!c.declined_on) {
      rows.push(stepRow('Sustained', 'sustained_on', null, sundayDefault(ctx)));
      rows.push(stepRow('Set apart', 'set_apart_on', 'set_apart_by', today));
      rows.push(stepRow('Recorded in LCR', 'recorded_on', 'record_by', today));
    }
    const releaseStarted = c.release_proposed_on || c.release_informed_on || c.released_on || c.release_recorded_on;
    const releaseRows = releaseStarted ? [
      stepRow('Release decided', 'release_proposed_on', null, today),
      stepRow('Member told', 'release_informed_on', 'release_by', today),
      stepRow('Released in sacrament meeting', 'released_on', null, sundayDefault(ctx)),
      stepRow('Release recorded in LCR', 'release_recorded_on', 'release_record_by', today),
    ] : [];

    const notes = h('textarea', { rows: 2, 'aria-label': 'Notes' });
    notes.value = c.notes || '';
    const saveNotes = h('button', { class: 'small secondary', text: 'Save note' });
    saveNotes.addEventListener('click', () => busy(saveNotes, async () => { await save(ctx, c.id, { notes: notes.value.trim() }); toast('Note saved'); ctx.refresh(); }).catch(() => {}));

    const actions = [];
    if (isCurrent(c) && !releaseStarted) {
      const rel = h('button', { class: 'secondary', text: 'Start release' });
      rel.addEventListener('click', () => busy(rel, async () => { await save(ctx, c.id, { release_proposed_on: today }); reopen(); }).catch(() => {}));
      actions.push(rel);
    }
    const remove = h('button', { class: 'secondary', text: 'Remove' });
    remove.addEventListener('click', () => {
      if (!window.confirm('Remove this calling record? It stays in the Sheet, marked as removed.')) return;
      busy(remove, async () => { await save(ctx, c.id, { void: true }); toast('Removed'); close(); ctx.refresh(); }).catch(() => {});
    });
    actions.push(remove);

    return [
      h('p', { class: 'meta', text: [c.organization, PHASE_TEXT[state.phase], tenure !== null ? `${formatTenure(tenure)} in calling` : ''].filter(Boolean).join(' · ') }),
      c.member_id ? h('button', { class: 'link', text: `Open ${c.member_name}'s page`, onclick: () => { close(); ctx.openMember(c.member_id); } }) : null,
      h('section', { class: 'sub' }, h('h3', { text: 'Call' }), h('ul', { class: 'rows' }, rows)),
      releaseRows.length ? h('section', { class: 'sub' }, h('h3', { text: 'Release' }), h('ul', { class: 'rows' }, releaseRows)) : null,
      h('section', { class: 'sub' }, h('h3', { text: 'Notes' }), notes, saveNotes),
      h('div', { class: 'toolbar' }, actions),
      datalist('initials-list', initialsList(ctx)),
    ];
  });
}

// ---------- propose a calling ----------

export function proposeCalling(ctx, memberId) {
  const members = ctx.store.records('Members').filter((m) => m.id && isActive(m));
  const preset = members.find((m) => m.id === memberId);
  openDialog('Propose a calling', (close) => {
    const who = h('input', { type: 'text', list: 'member-list', value: preset ? preset.name : '', placeholder: 'Last, First', autocomplete: 'off', 'aria-label': 'Member' });
    const org = h('input', { type: 'text', list: 'org-list', placeholder: 'Organization', autocomplete: 'off', 'aria-label': 'Organization' });
    const calling = h('input', { type: 'text', list: 'calling-list', placeholder: 'Calling', autocomplete: 'off', 'aria-label': 'Calling' });
    const by = h('input', { type: 'text', list: 'initials-list', maxlength: 6, placeholder: 'Initials', 'aria-label': 'Who will ask', class: 'initials' });
    const notes = h('input', { type: 'text', placeholder: 'Note (optional)', 'aria-label': 'Note' });
    const create = h('button', { text: 'Add to In progress' });
    create.addEventListener('click', () => busy(create, async () => {
      const m = members.find((x) => normName(x.name) === normName(who.value));
      if (!m) throw new Error('Choose the member from the list (type part of the name).');
      if (!org.value.trim() || !calling.value.trim()) throw new Error('Enter the organization and the calling.');
      await ctx.store.add('Callings', [{
        id: makeId('c'), member_id: m.id, member_name: m.name, organization: org.value.trim(), calling: calling.value.trim(),
        proposed_on: ctx.today(), extend_by: by.value.trim().toUpperCase(), source: 'app', notes: notes.value.trim(),
        entered_by: ctx.settings.initials, entered_at: ctx.stamp(),
      }]);
      toast(`Proposed: ${calling.value.trim()} for ${m.name}`);
      close(); ctx.refresh();
    }).catch(() => {}));
    const all = callings(ctx);
    return [
      field('Member', who), field('Organization', org), field('Calling', calling),
      field('Who will ask?', by, 'Initials of the bishopric member who will extend the call.'),
      field('Note', notes), create,
      datalist('member-list', members.map((m) => m.name).sort((a, b) => a.localeCompare(b))),
      datalist('org-list', uniq([...DEFAULT_ORGS, ...all.map((c) => c.organization)])),
      datalist('calling-list', uniq(all.map((c) => c.calling))),
      datalist('initials-list', initialsList(ctx)),
    ];
  });
}

// ---------- screens ----------

function proposeButton(ctx) { return h('button', { text: 'Propose a calling', onclick: () => proposeCalling(ctx) }); }

function taskBadges(c) {
  return callingState(c).tasks.map((t) => h('span', { class: `badge ${t.step.startsWith('release') ? 'declined' : 'soon'}`, text: `${t.label}${t.by ? ` · ${t.by}` : ''}` }));
}

function renderCurrent(root, ctx) {
  const today = ctx.today();
  const listEl = h('div', {});
  const draw = () => {
    clear(listEl);
    const q = normName(view.search);
    let items = currentCallings(callings(ctx)).filter((c) => !q || normName(`${c.member_name} ${c.calling} ${c.organization}`).includes(q));
    if (!items.length) {
      listEl.append(h('p', { class: 'empty', text: callings(ctx).length ? 'No current callings match.' : 'No callings yet. Import the LCR callings report on the Import screen, or propose a calling.' }));
      return;
    }
    if (view.sort === 'tenure') {
      items = items.slice().sort((a, b) => (tenureMonths(b, today) ?? -1) - (tenureMonths(a, today) ?? -1));
      listEl.append(h('ul', { class: 'cards' }, items.map((c) => card(c))));
      return;
    }
    let org = null;
    let ul = null;
    for (const c of items) {
      if (c.organization !== org) {
        org = c.organization;
        ul = h('ul', { class: 'cards' });
        listEl.append(h('h3', { class: 'date-head', text: org || '(no organization)' }), ul);
      }
      ul.append(card(c));
    }
  };
  const card = (c) => h('li', {}, h('button', { class: 'card', onclick: () => openCalling(c.id, ctx) },
    h('span', { class: 'card-top' }, h('span', { class: 'name', text: c.calling }), taskBadges(c)),
    h('span', { class: 'meta', text: [c.member_name, view.sort === 'tenure' ? c.organization : '', formatTenure(tenureMonths(c, today))].filter(Boolean).join(' · ') })));
  const search = h('input', { type: 'search', placeholder: 'Search name or calling', value: view.search, 'aria-label': 'Search' });
  search.addEventListener('input', () => { view.search = search.value; draw(); });
  const sort = select([{ value: 'org', label: 'By organization' }, { value: 'tenure', label: 'Longest serving first' }], view.sort, { 'aria-label': 'Sort' });
  sort.addEventListener('change', () => { view.sort = sort.value; draw(); });
  root.append(h('div', { class: 'toolbar' }, search, sort, proposeButton(ctx)),
    h('p', { class: 'hint', text: 'Time in calling counts from the date sustained.' }), listEl);
  draw();
}

function taskRow(t, ctx, showBy = true) {
  const c = t.calling;
  return h('li', {}, h('button', { class: 'card', onclick: () => openCalling(c.id, ctx) },
    h('span', { class: 'card-top' }, h('span', { class: 'name', text: c.member_name }),
      showBy && t.by ? h('span', { class: 'badge new', text: t.by }) : null),
    h('span', { class: 'meta', text: `${c.calling}${c.organization ? ` · ${c.organization}` : ''}` })));
}

function renderPipeline(root, ctx) {
  const tasks = openTasks(callings(ctx));
  root.append(h('div', { class: 'toolbar' }, proposeButton(ctx)),
    h('p', { class: 'hint', text: 'Every call and release that still has a step to do, grouped by its next step. Tap one to record a step or assign it.' }));
  if (!tasks.length) { root.append(h('p', { class: 'empty', text: 'Nothing in progress.' })); return; }
  for (const step of STEP_ORDER) {
    const group = tasks.filter((t) => t.step === step);
    if (!group.length) continue;
    root.append(h('h3', { class: 'date-head', text: `${STEPS[step].label} (${group.length})` }), h('ul', { class: 'cards' }, group.map((t) => taskRow(t, ctx))));
  }
}

function renderSunday(root, ctx) {
  const { releases, sustainings } = sundayBusiness(callings(ctx));
  const date = h('input', { type: 'date', value: sundayDefault(ctx), 'aria-label': 'Sunday' });
  const pick = (c) => ({ c, box: h('input', { type: 'checkbox', checked: true }) });
  const rel = releases.map(pick);
  const sus = sustainings.map(pick);
  const line = ({ c, box }) => h('li', { class: 'row' }, h('label', { class: 'check' }, box, ` ${c.member_name} — ${c.calling}${c.organization ? ` (${c.organization})` : ''}`));
  const mark = h('button', { text: 'Mark checked ones as done' });
  mark.addEventListener('click', () => busy(mark, async () => {
    if (!date.value) throw new Error('Choose the Sunday.');
    const changes = [
      ...rel.filter((x) => x.box.checked).map(({ c }) => ({ id: c.id, fields: { released_on: date.value } })),
      ...sus.filter((x) => x.box.checked).map(({ c }) => ({ id: c.id, fields: { sustained_on: date.value } })),
    ];
    if (!changes.length) throw new Error('Nothing is checked.');
    await ctx.store.update('Callings', changes);
    toast(`${changes.length} marked done for ${formatDate(date.value)}`);
    ctx.refresh();
  }).catch(() => {}));
  add(root,
    h('p', { class: 'hint', text: 'Business for sacrament meeting: releases are read first, then callings to sustain. A release appears here once the member has been told; a calling once it has been accepted.' }),
    field('Sunday', date),
    h('h3', { text: `Releases (${rel.length})` }),
    rel.length ? h('ul', { class: 'rows' }, rel.map(line)) : h('p', { class: 'empty', text: 'No releases to read.' }),
    h('h3', { text: `To sustain (${sus.length})` }),
    sus.length ? h('ul', { class: 'rows' }, sus.map(line)) : h('p', { class: 'empty', text: 'No callings to sustain.' }),
    rel.length || sus.length ? mark : null);
}

function renderTasks(root, ctx) {
  const me = String(ctx.settings.initials || '').toUpperCase();
  if (!me) {
    root.append(h('div', { class: 'panel' }, h('p', { text: 'Add your initials on the Settings screen to see the steps assigned to you.' }), h('a', { class: 'button', href: '#settings', text: 'Open Settings' })));
  }
  const { mine, unassigned } = myTasks(callings(ctx), me);
  const group = (title, list, emptyText, showBy) => [
    h('h3', { class: 'date-head', text: `${title} (${list.length})` }),
    list.length ? h('ul', { class: 'cards' }, list.map((t) => h('li', {}, h('button', { class: 'card', onclick: () => openCalling(t.calling.id, ctx) },
      h('span', { class: 'card-top' }, h('span', { class: 'name', text: STEPS[t.step].label }), showBy && t.by ? h('span', { class: 'badge new', text: t.by }) : null),
      h('span', { class: 'meta', text: `${t.calling.member_name} · ${t.calling.calling}` }))))) : h('p', { class: 'empty', text: emptyText }),
  ];
  add(root,
    h('p', { class: 'hint', text: 'Steps someone has to do: ask, set apart, record in LCR, tell a member about a release. Assign them on each calling\'s page.' }),
    me ? group(`Assigned to ${me}`, mine, 'Nothing assigned to you.', false) : null,
    group('Not assigned yet', unassigned, 'Every step has someone assigned.', false));
}

function renderNoCalling(root, ctx) {
  const listEl = h('ul', { class: 'cards' });
  const countEl = h('p', { class: 'summary' });
  const draw = () => {
    const rows = membersWithoutCalling(ctx.store.records('Members'), callings(ctx), ctx.today(), Number(view.minAge))
      .filter((r) => !view.search || normName(r.member.name).includes(normName(view.search)));
    countEl.textContent = `${rows.length} ${rows.length === 1 ? 'person' : 'people'} with no current or proposed calling`;
    clear(listEl);
    for (const r of rows) {
      listEl.append(h('li', {}, h('button', { class: 'card', onclick: () => ctx.openMember(r.member.id) },
        h('span', { class: 'name', text: r.member.name }),
        h('span', { class: 'meta', text: [r.age === null ? 'Age unknown' : `Age ${r.age}`, r.member.gender].filter(Boolean).join(' · ') }))));
    }
  };
  const minAge = select([{ value: '18', label: 'Adults (18+)' }, { value: '12', label: 'Youth and adults (12+)' }], view.minAge, { 'aria-label': 'Ages' });
  minAge.addEventListener('change', () => { view.minAge = minAge.value; draw(); });
  const search = h('input', { type: 'search', placeholder: 'Search name', value: view.search, 'aria-label': 'Search name' });
  search.addEventListener('input', () => { view.search = search.value; draw(); });
  root.append(h('div', { class: 'toolbar' }, search, minAge),
    h('p', { class: 'hint', text: 'Active members with no current calling and none in progress. Only as complete as the Callings tab: import the LCR callings report first.' }),
    countEl, listEl);
  draw();
}

// ---------- member page section ----------

function memberSections(m, ctx, close) {
  const today = ctx.today();
  const list = callingsFor(m.id, callings(ctx));
  return [h('section', { class: 'sub' },
    h('h3', { text: 'Callings' }),
    list.length ? h('ul', { class: 'rows' }, list.map((c) => h('li', { class: 'row' },
      h('button', { class: 'link', text: `${c.calling}${c.organization ? ` (${c.organization})` : ''}`, onclick: () => { close(); openCalling(c.id, ctx); } }),
      h('span', { class: 'meta', text: [PHASE_TEXT[callingState(c).phase], formatTenure(tenureMonths(c, today))].filter(Boolean).join(' · ') }))))
      : h('p', { class: 'empty', text: 'No callings on record.' }),
    h('button', { class: 'secondary', text: 'Propose a calling', onclick: () => { close(); proposeCalling(ctx, m.id); } }))];
}

export const callingsFeature = {
  id: 'callings',
  group: 'Callings',
  tables,
  views: [
    { id: 'callings', label: 'Current', title: 'Current callings', render: renderCurrent },
    { id: 'pipeline', label: 'In progress', title: 'Calls and releases in progress', render: renderPipeline },
    { id: 'sunday', label: 'Sunday', title: 'Sunday business', render: renderSunday },
    { id: 'tasks', label: 'My tasks', title: 'My tasks', render: renderTasks },
    { id: 'nocalling', label: 'No calling', title: 'Members with no calling', render: renderNoCalling },
  ],
  memberSections,
};

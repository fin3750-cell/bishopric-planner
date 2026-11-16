// Callings feature: current callings and time in calling, calls and releases in progress,
// Sunday business (releases and sustainings), each person's assigned tasks, and members with no calling.

import { formatDate, nextSunday } from '../dates.js';
import { makeId, normName, isActive } from '../members.js';
import { h, add, clear, field, select, busy, toast, openDialog } from '../ui.js';
import {
  COLUMNS, DATE_COLUMNS, STEPS, STEP_ORDER, callingState, isCurrent, tenureMonths, formatTenure,
  openTasks, myTasks, sundayBusiness, currentCallings, callingsFor, membersWithoutCalling, bishopricFromCallings,
} from './callings-logic.js';
import { ORG_NAMES, organizationFor, sustainedIn, handbookFor, setApartByStake } from './callings-orgs.js';
import { renderOrgChart } from './callings-orgchart.js';
import { renderLcrImport } from './callings-lcr.js';

const tables = { Callings: { columns: COLUMNS, dates: DATE_COLUMNS } };

function orgRank(org) { const i = ORG_NAMES.indexOf(org); return i < 0 ? ORG_NAMES.length - 2.5 : i; }

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

// Who does a step: a menu of the Bishopric list (Settings), or typed initials if the list is empty.
// Either way the element has .value and fires "change".
function whoControl(ctx, current, label) {
  const cur = String(current || '').trim().toUpperCase();
  const people = ctx.bishopric();
  if (!people.length) {
    return h('input', { type: 'text', value: cur, list: 'initials-list', maxlength: 6, placeholder: 'Who', 'aria-label': label, class: 'initials' });
  }
  const opts = [{ value: '', label: 'Unassigned' },
    ...people.map((p) => ({ value: p.initials, label: `${p.initials} — ${p.name}${p.role ? ` (${p.role})` : ''}` }))];
  if (cur && !opts.some((o) => o.value === cur)) opts.push({ value: cur, label: cur });
  if (!opts.some((o) => o.value === 'STAKE')) opts.push({ value: 'STAKE', label: 'Stake' });
  return select(opts, cur, { 'aria-label': label, class: 'who' });
}

function personName(ctx, initials) {
  const p = ctx.bishopric().find((x) => x.initials === String(initials || '').toUpperCase());
  return p ? p.name : '';
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
    // A later step implies the earlier ones (for example an imported calling that is already sustained).
    const IMPLIED = {
      proposed_on: ['extended_on', 'accepted_on', 'sustained_on'], extended_on: ['accepted_on', 'sustained_on'], accepted_on: ['sustained_on'],
      release_proposed_on: ['release_informed_on', 'released_on', 'release_recorded_on'], release_informed_on: ['released_on', 'release_recorded_on'],
      released_on: ['release_recorded_on'],
    };
    const stepRow = (label, dateField, byField, defaultDate, extra) => {
      if (!c[dateField] && (IMPLIED[dateField] || []).some((f) => c[f])) {
        return h('li', { class: 'row step done' }, h('span', {}, h('strong', { text: `✓ ${label}` }), ' (date not recorded)'));
      }
      if (c[dateField]) {
        const undo = h('button', { class: 'small secondary', text: 'Undo' });
        undo.addEventListener('click', () => {
          if (!window.confirm(`Clear "${label}" (${formatDate(c[dateField])})?`)) return;
          busy(undo, async () => { await save(ctx, c.id, { [dateField]: '' }); reopen(); }).catch(() => {});
        });
        return h('li', { class: 'row step done' },
          h('span', {}, h('strong', { text: `✓ ${label}` }), ` ${formatDate(c[dateField])}${byField && c[byField] ? ` · ${personName(ctx, c[byField]) || String(c[byField]).toUpperCase()}` : ''}`),
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
        by = whoControl(ctx, c[byField], `${label}: assigned to`);
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

    // Organization and calling name can be corrected (for example after an LCR import).
    const orgOptions = ORG_NAMES.includes(c.organization) || !c.organization ? ORG_NAMES : [...ORG_NAMES, c.organization];
    const orgSel = select(orgOptions.map((o) => ({ value: o, label: o })), c.organization || organizationFor(c.calling).organization, { 'aria-label': 'Organization' });
    const nameIn = h('input', { type: 'text', value: c.calling || '', 'aria-label': 'Calling name' });
    const saveEdit = h('button', { class: 'small secondary', text: 'Save' });
    saveEdit.addEventListener('click', () => busy(saveEdit, async () => {
      if (!nameIn.value.trim()) throw new Error('The calling needs a name.');
      await save(ctx, c.id, { organization: orgSel.value, calling: nameIn.value.trim() });
      toast('Saved'); reopen();
    }).catch(() => {}));
    const hb = handbookFor(c.calling, c.organization);

    return [
      h('p', { class: 'meta', text: [c.organization, PHASE_TEXT[state.phase], tenure !== null ? `${formatTenure(tenure)} in calling` : ''].filter(Boolean).join(' · ') }),
      c.member_id ? h('button', { class: 'link', text: `Open ${c.member_name}'s page`, onclick: () => { close(); ctx.openMember(c.member_id); } }) : null,
      h('p', { class: 'hint handbook' }, hb.sustained, hb.approvedBy ? ` · Approved by: ${hb.approvedBy}` : '', hb.setApartBy ? ` · Called and set apart by: ${hb.setApartBy}` : '', ' (General Handbook 30.8.1)'),
      h('section', { class: 'sub' }, h('h3', { text: 'Call' }), h('ul', { class: 'rows' }, rows)),
      releaseRows.length ? h('section', { class: 'sub' }, h('h3', { text: 'Release' }), h('ul', { class: 'rows' }, releaseRows)) : null,
      h('section', { class: 'sub' }, h('h3', { text: 'Organization and calling' }),
        h('div', { class: 'inline-form' }, field('Organization', orgSel), field('Calling', nameIn), saveEdit)),
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
    const by = whoControl(ctx, '', 'Who will ask');
    const notes = h('input', { type: 'text', placeholder: 'Note (optional)', 'aria-label': 'Note' });
    calling.addEventListener('change', () => { if (!org.value.trim()) org.value = organizationFor(calling.value).organization; });
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
      field('Who will ask?', by, ctx.bishopric().length ? 'The bishopric member who will extend the call.' : 'Initials of the bishopric member who will extend the call. Add the bishopric list in Settings to choose from a menu.'),
      field('Note', notes), create,
      datalist('member-list', members.map((m) => m.name).sort((a, b) => a.localeCompare(b))),
      datalist('org-list', [...ORG_NAMES, ...uniq(all.map((c) => c.organization)).filter((o) => !ORG_NAMES.includes(o))]),
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
    let items = currentCallings(callings(ctx)).filter((c) => !q || normName(`${c.member_name} ${c.calling} ${c.organization}`).includes(q))
      .sort((a, b) => orgRank(a.organization) - orgRank(b.organization));
    if (!items.length) {
      listEl.append(h('p', { class: 'empty', text: callings(ctx).length ? 'No current callings match.' : 'No callings yet. Import the LCR callings report (LCR import), or propose a calling.' }));
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
  const business = sundayBusiness(callings(ctx));
  // Handbook 30.8.1: most callings are sustained by ward members in sacrament meeting; some are
  // presented in a quorum or Young Women meeting; stake and temple callings are not sustained in the ward.
  const where = (c) => sustainedIn(c.calling, c.organization);
  const releases = business.releases.filter((c) => where(c) === 'sacrament');
  const sustainings = business.sustainings.filter((c) => where(c) === 'sacrament');
  const elsewhere = [...business.releases, ...business.sustainings].filter((c) => where(c) === 'quorum' || where(c) === 'class');
  const date = h('input', { type: 'date', value: sundayDefault(ctx), 'aria-label': 'Sunday' });
  const pick = (c) => ({ c, box: h('input', { type: 'checkbox', checked: true }) });
  const rel = releases.map(pick);
  const sus = sustainings.map(pick);
  const els = elsewhere.map(pick);
  const isRelease = (c) => business.releases.includes(c);
  const line = ({ c, box }) => h('li', { class: 'row' }, h('label', { class: 'check' }, box, ` ${c.member_name} — ${c.calling}${c.organization ? ` (${c.organization})` : ''}`));
  const elsewhereLine = ({ c, box }) => h('li', { class: 'row' }, h('label', { class: 'check' }, box,
    ` ${isRelease(c) ? 'Release' : 'Sustain'}: ${c.member_name} — ${c.calling} (${where(c) === 'class' ? 'Young Women meeting' : 'quorum meeting'})`));
  const mark = h('button', { text: 'Mark checked ones as done' });
  mark.addEventListener('click', () => busy(mark, async () => {
    if (!date.value) throw new Error('Choose the Sunday.');
    const changes = [
      ...rel.filter((x) => x.box.checked).map(({ c }) => ({ id: c.id, fields: { released_on: date.value } })),
      ...sus.filter((x) => x.box.checked).map(({ c }) => ({ id: c.id, fields: { sustained_on: date.value } })),
      ...els.filter((x) => x.box.checked).map(({ c }) => ({ id: c.id, fields: isRelease(c) ? { released_on: date.value } : { sustained_on: date.value } })),
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
    els.length ? h('h3', { text: `In a quorum or Young Women meeting (${els.length})` }) : null,
    els.length ? h('p', { class: 'hint', text: 'These are presented to the quorum or age group, not in sacrament meeting (General Handbook 30.8.1).' }) : null,
    els.length ? h('ul', { class: 'rows' }, els.map(elsewhereLine)) : null,
    rel.length || sus.length || els.length ? mark : null);
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
      h('span', { class: 'card-top' }, h('span', { class: 'name', text: STEPS[t.step].label }), showBy && t.by ? h('span', { class: 'badge new', text: t.by }) : null,
        t.step === 'set_apart' && setApartByStake(t.calling.calling, t.calling.organization) ? h('span', { class: 'badge muted', text: 'stake sets apart' }) : null),
      h('span', { class: 'meta', text: `${t.calling.member_name} · ${t.calling.calling}` }))))) : h('p', { class: 'empty', text: emptyText }),
  ];
  add(root,
    h('p', { class: 'hint', text: 'Steps someone has to do: ask, set apart, record in LCR, tell a member about a release. Assign them on each calling\'s page.' }),
    me ? group(`Assigned to ${me}${personName(ctx, me) ? ` (${personName(ctx, me)})` : ''}`, mine, 'Nothing assigned to you.', false) : null,
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
    { id: 'orgchart', label: 'Org chart', title: 'Organization chart', render: (root, ctx) => renderOrgChart(root, ctx, { openCalling }) },
    { id: 'callings', label: 'Current', title: 'Current callings', render: renderCurrent },
    { id: 'pipeline', label: 'In progress', title: 'Calls and releases in progress', render: renderPipeline },
    { id: 'sunday', label: 'Sunday', title: 'Sunday business', render: renderSunday },
    { id: 'tasks', label: 'My tasks', title: 'My tasks', render: renderTasks },
    { id: 'nocalling', label: 'No calling', title: 'Members with no calling', render: renderNoCalling },
    { id: 'lcrimport', label: 'LCR import', title: 'Import the LCR callings report', render: (root, ctx) => renderLcrImport(root, ctx, { go: ctx.go }) },
  ],
  memberSections,
  // Settings > Bishopric: suggest the ward's bishopric and executive secretary from current callings.
  suggestBishopric: (ctx) => bishopricFromCallings(callings(ctx)),
};

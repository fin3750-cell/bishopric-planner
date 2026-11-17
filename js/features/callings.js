// Callings feature: current callings and time in calling, the stages of a call (proposed, bishop
// approved, assigned to contact, sustain, record in LCR, set apart) and releases, to-dos, Sunday
// business, each person's tasks, and members with no calling.

import { formatDate, nextSunday } from '../dates.js';
import { makeId, normName, isActive, isTrue } from '../members.js';
import { h, add, clear, field, select, busy, toast, openDialog } from '../ui.js';
import {
  COLUMNS, DATE_COLUMNS, TODO_COLUMNS, TODO_DATES, STAGES,
  callingState, isCurrent, tenureMonths, formatTenure, myWork, sundayBusiness, currentCallings, callingsFor,
  membersWithoutCalling, bishopricFromCallings, recorderFrom, pipeline, openTodos, recentlyDone,
} from './callings-logic.js';
import { ORG_NAMES, organizationFor, sustainedIn, handbookFor, setApartByStake } from './callings-orgs.js';
import { renderOrgChart } from './callings-orgchart.js';
import { renderLcrImport } from './callings-lcr.js';

const tables = {
  Callings: { columns: COLUMNS, dates: DATE_COLUMNS },
  Tasks: { columns: TODO_COLUMNS, dates: TODO_DATES },
};

function orgRank(org) { const i = ORG_NAMES.indexOf(org); return i < 0 ? ORG_NAMES.length - 2.5 : i; }

const PHASE_TEXT = {
  proposed: 'Proposed, waiting for the bishop', approved: 'Approved, to be asked', to_sustain: 'Accepted, to sustain',
  serving: 'Serving', releasing: 'Release in progress', ended: 'Released', not_approved: 'Not approved', declined: 'Declined', void: 'Removed',
};

const view = { search: '', sort: 'org', minAge: '18', setApartOpen: false, doneOpen: false };

function callings(ctx) { return ctx.store.records('Callings'); }
function todos(ctx) { return ctx.store.records('Tasks'); }
// Who records callings in LCR when a calling names nobody (Settings), and the defaults for steps.
function recorder(ctx) { return recorderFrom(ctx.bishopric(), ctx.shared.get('record_by')); }
function stepDefaults(ctx) { return { record: recorder(ctx) }; }
function myInitials(ctx) { return String(ctx.settings.initials || '').trim().toUpperCase(); }

function uniq(values) { return [...new Set(values.map((v) => String(v || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)); }

function datalist(id, values) { return h('datalist', { id }, values.map((v) => h('option', { value: v }))); }

function initialsList(ctx) {
  const all = callings(ctx).flatMap((c) => ['extend_by', 'set_apart_by', 'record_by', 'release_by', 'release_record_by'].map((k) => c[k]));
  const talks = ctx.store.records('Talks').map((t) => t.entered_by).filter((v) => v && v !== 'import');
  return uniq([ctx.settings.initials, ...all, ...talks].map((v) => String(v || '').toUpperCase()));
}

// Who does a step: a menu of the Bishopric list (Settings), or typed initials if the list is empty.
// Either way the element has .value and fires "change". "Stake" is offered for calling steps only.
function whoControl(ctx, current, label, { stake = true } = {}) {
  const cur = String(current || '').trim().toUpperCase();
  const people = ctx.bishopric();
  if (!people.length) {
    return h('input', { type: 'text', value: cur, list: 'initials-list', maxlength: 6, placeholder: 'Who', 'aria-label': label, class: 'initials' });
  }
  const opts = [{ value: '', label: 'Unassigned' },
    ...people.map((p) => ({ value: p.initials, label: `${p.initials} — ${p.name}${p.role ? ` (${p.role})` : ''}` }))];
  if (cur && !opts.some((o) => o.value === cur)) opts.push({ value: cur, label: cur });
  if (stake && !opts.some((o) => o.value === 'STAKE')) opts.push({ value: 'STAKE', label: 'Stake' });
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

function nameOrInitials(ctx, initials) { return personName(ctx, initials) || String(initials || '').toUpperCase(); }

// ---------- calling page ----------

export function openCalling(id, ctx) {
  const c = callings(ctx).find((x) => x.id === id);
  if (!c) { toast('That calling is not in the Sheet.', 'error'); return; }
  const today = ctx.today();
  const reopen = () => { ctx.refresh(); openCalling(id, ctx); };
  openDialog(titleOf(c), (close) => {
    const state = callingState(c);
    const phase = state.phase;
    const tenure = tenureMonths(c, today);
    const rows = [];
    // A later step implies the earlier ones (for example an imported calling that is already sustained).
    const LATER = ['extended_on', 'accepted_on', 'declined_on', 'sustained_on'];
    const IMPLIED = {
      proposed_on: ['approved_on', 'not_approved_on', ...LATER], approved_on: LATER, extended_on: ['accepted_on', 'sustained_on'],
      accepted_on: ['sustained_on'],
      release_proposed_on: ['release_informed_on', 'released_on', 'release_recorded_on'], release_informed_on: ['released_on', 'release_recorded_on'],
      released_on: ['release_recorded_on'],
    };
    // opts: by (column with initials), byPrefix (text before the name), defaultDate, clear (more columns Undo empties)
    const stepRow = (label, dateField, opts = {}) => {
      const { by: byField = null, byPrefix = '', defaultDate = today, clear: alsoClear = [], defaultBy = '' } = opts;
      if (!c[dateField] && (IMPLIED[dateField] || []).some((f) => c[f])) {
        return h('li', { class: 'row step done' }, h('span', {}, h('strong', { text: `✓ ${label}` }), ' (date not recorded)'));
      }
      if (c[dateField]) {
        const undo = h('button', { class: 'small secondary', text: 'Undo' });
        undo.addEventListener('click', () => {
          if (!window.confirm(`Clear "${label}" (${formatDate(c[dateField])})?`)) return;
          busy(undo, async () => { await save(ctx, c.id, Object.fromEntries([dateField, ...alsoClear].map((f) => [f, '']))); reopen(); }).catch(() => {});
        });
        return h('li', { class: 'row step done' },
          h('span', {}, h('strong', { text: `✓ ${label}` }), ` ${formatDate(c[dateField])}${byField && c[byField] ? ` · ${byPrefix}${nameOrInitials(ctx, c[byField])}` : ''}`),
          undo);
      }
      const date = h('input', { type: 'date', value: defaultDate, 'aria-label': `${label} date` });
      const done = h('button', { class: 'small', text: 'Done' });
      done.addEventListener('click', () => busy(done, async () => {
        if (!date.value) throw new Error('Choose a date.');
        await save(ctx, c.id, { [dateField]: date.value });
        reopen();
      }).catch(() => {}));
      let who = null;
      if (byField) {
        who = whoControl(ctx, c[byField] || defaultBy, `${label}: assigned to`);
        who.addEventListener('change', () => {
          save(ctx, c.id, { [byField]: who.value.trim().toUpperCase() })
            .then(() => { toast(who.value.trim() ? `Assigned to ${who.value.trim().toUpperCase()}` : 'Unassigned'); ctx.refresh(); })
            .catch((e) => ctx.fail(e));
        });
      }
      return h('li', { class: 'row step' }, h('span', { class: 'step-label', text: label }),
        h('span', { class: 'step-controls' }, who, date, done));
    };
    const custom = (label, ...controls) => h('li', { class: 'row step' }, h('span', { class: 'step-label', text: label }), h('span', { class: 'step-controls' }, controls));

    rows.push(stepRow('Proposed', 'proposed_on'));

    // The bishop's decision.
    if (phase === 'proposed') {
      const date = h('input', { type: 'date', value: today, 'aria-label': 'Bishop approval date' });
      const yes = h('button', { class: 'small', text: 'Approved' });
      const no = h('button', { class: 'small warn', text: 'Not approved' });
      yes.addEventListener('click', () => busy(yes, async () => {
        await save(ctx, c.id, { approved_on: date.value || today, approved_by: myInitials(ctx) }); reopen();
      }).catch(() => {}));
      no.addEventListener('click', () => {
        if (!window.confirm('Record that the bishop did not approve this calling? It closes and stays in the Sheet.')) return;
        busy(no, async () => { await save(ctx, c.id, { not_approved_on: date.value || today, approved_by: myInitials(ctx) }); reopen(); }).catch(() => {});
      });
      rows.push(custom('Bishop approval', date, yes, no));
    } else {
      if (phase === 'not_approved') rows.push(stepRow('Not approved by the bishop', 'not_approved_on', { by: 'approved_by', byPrefix: 'recorded by ', clear: ['approved_by'] }));
      else rows.push(stepRow('Bishop approved', 'approved_on', { by: 'approved_by', byPrefix: 'recorded by ', clear: ['approved_by'] }));
    }

    // Asking: choose who asks, then record the answer.
    if (c.extended_on) rows.push(stepRow('Asked', 'extended_on', { by: 'extend_by' }));
    if (phase === 'approved') {
      const who = whoControl(ctx, c.extend_by, 'Who will ask');
      who.addEventListener('change', () => {
        save(ctx, c.id, { extend_by: who.value.trim().toUpperCase() })
          .then(() => { toast(who.value.trim() ? `Assigned to ${who.value.trim().toUpperCase()}` : 'Unassigned'); ctx.refresh(); })
          .catch((e) => ctx.fail(e));
      });
      rows.push(custom('Who will ask', who));
      const date = h('input', { type: 'date', value: today, 'aria-label': 'Answer date' });
      const yes = h('button', { class: 'small', text: 'Accepted' });
      const no = h('button', { class: 'small warn', text: 'Declined' });
      yes.addEventListener('click', () => busy(yes, async () => { await save(ctx, c.id, { accepted_on: date.value || today }); reopen(); }).catch(() => {}));
      no.addEventListener('click', () => busy(no, async () => { await save(ctx, c.id, { declined_on: date.value || today }); reopen(); }).catch(() => {}));
      rows.push(custom('Answer', date, yes, no));
    } else if (c.declined_on) {
      rows.push(stepRow('Declined', 'declined_on', { by: 'extend_by', byPrefix: 'asked by ' }));
    } else if (phase !== 'proposed' && phase !== 'not_approved') {
      rows.push(stepRow('Accepted', 'accepted_on', { by: 'extend_by', byPrefix: 'asked by ' }));
      rows.push(stepRow('Sustained', 'sustained_on', { defaultDate: sundayDefault(ctx) }));
      rows.push(stepRow('Recorded in LCR', 'recorded_on', { by: 'record_by', defaultBy: recorder(ctx) }));
      rows.push(stepRow('Set apart', 'set_apart_on', { by: 'set_apart_by' }));
    }
    const releaseStarted = c.release_proposed_on || c.release_informed_on || c.released_on || c.release_recorded_on;
    const releaseRows = releaseStarted ? [
      stepRow('Release decided', 'release_proposed_on'),
      stepRow('Member told', 'release_informed_on', { by: 'release_by' }),
      stepRow('Released in sacrament meeting', 'released_on', { defaultDate: sundayDefault(ctx) }),
      stepRow('Release recorded in LCR', 'release_recorded_on', { by: 'release_record_by' }),
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
      h('p', { class: 'meta', text: [c.organization, PHASE_TEXT[phase], tenure !== null ? `${formatTenure(tenure)} in calling` : ''].filter(Boolean).join(' · ') }),
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
    const notes = h('input', { type: 'text', placeholder: 'Note (optional)', 'aria-label': 'Note' });
    calling.addEventListener('change', () => { if (!org.value.trim()) org.value = organizationFor(calling.value).organization; });
    const create = h('button', { text: 'Add to In progress' });
    create.addEventListener('click', () => busy(create, async () => {
      const m = members.find((x) => normName(x.name) === normName(who.value));
      if (!m) throw new Error('Choose the member from the list (type part of the name).');
      if (!org.value.trim() || !calling.value.trim()) throw new Error('Enter the organization and the calling.');
      await ctx.store.add('Callings', [{
        id: makeId('c'), member_id: m.id, member_name: m.name, organization: org.value.trim(), calling: calling.value.trim(),
        proposed_on: ctx.today(), source: 'app', notes: notes.value.trim(),
        entered_by: ctx.settings.initials, entered_at: ctx.stamp(),
      }]);
      toast(`Proposed: ${calling.value.trim()} for ${m.name}`);
      close(); ctx.refresh();
    }).catch(() => {}));
    const all = callings(ctx);
    return [
      field('Member', who), field('Organization', org), field('Calling', calling),
      field('Note', notes),
      h('p', { class: 'hint', text: 'It starts under Proposed. After the bishop\'s approval, choose who will ask.' }),
      create,
      datalist('member-list', members.map((m) => m.name).sort((a, b) => a.localeCompare(b))),
      datalist('org-list', [...ORG_NAMES, ...uniq(all.map((c) => c.organization)).filter((o) => !ORG_NAMES.includes(o))]),
      datalist('calling-list', uniq(all.map((c) => c.calling))),
      datalist('initials-list', initialsList(ctx)),
    ];
  });
}

// ---------- screens ----------

function proposeButton(ctx) { return h('button', { text: 'Propose a calling', onclick: () => proposeCalling(ctx) }); }

function taskBadges(c, ctx) {
  return callingState(c, stepDefaults(ctx)).tasks.map((t) => h('span', { class: `badge ${t.step.startsWith('release') ? 'declined' : 'soon'}`, text: `${t.label}${t.by ? ` · ${t.by}` : ''}` }));
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
    h('span', { class: 'card-top' }, h('span', { class: 'name', text: c.calling }), taskBadges(c, ctx)),
    h('span', { class: 'meta', text: [c.member_name, view.sort === 'tenure' ? c.organization : '', formatTenure(tenureMonths(c, today))].filter(Boolean).join(' · ') })));
  const search = h('input', { type: 'search', placeholder: 'Search name or calling', value: view.search, 'aria-label': 'Search' });
  search.addEventListener('input', () => { view.search = search.value; draw(); });
  const sort = select([{ value: 'org', label: 'By organization' }, { value: 'tenure', label: 'Longest serving first' }], view.sort, { 'aria-label': 'Sort' });
  sort.addEventListener('change', () => { view.sort = sort.value; draw(); });
  root.append(h('div', { class: 'toolbar' }, search, sort, proposeButton(ctx)),
    h('p', { class: 'hint', text: 'Time in calling counts from the date sustained.' }), listEl);
  draw();
}

// ---------- In progress: one section per stage ----------

function where(c) { return sustainedIn(c.calling, c.organization); }

const WHERE_TEXT = {
  sacrament: 'Sustain in sacrament meeting',
  quorum: 'Present in the quorum meeting',
  class: 'Present in the Young Women meeting',
  outside: 'Not sustained in the ward: record the date on its page',
};

// A calling card that opens the calling's page. `below` holds controls under the card (not inside
// the button, so a menu or button there does not open the page).
function callingCard(ctx, c, { meta = '', badges = [], below = null } = {}) {
  return h('li', {}, h('button', { class: 'card', onclick: () => openCalling(c.id, ctx) },
    h('span', { class: 'card-top' }, h('span', { class: 'name', text: c.member_name }), badges),
    h('span', { class: 'meta', text: `${c.calling}${c.organization ? ` · ${c.organization}` : ''}` }),
    meta ? h('span', { class: 'meta', text: meta }) : null),
  below ? h('div', { class: 'card-actions' }, below) : null);
}

function stageItem(ctx, stage, c) {
  const badge = (text, cls = 'new') => h('span', { class: `badge ${cls}`, text });
  switch (stage) {
    case 'proposed':
      return callingCard(ctx, c, { meta: c.proposed_on ? `Proposed ${formatDate(c.proposed_on)}` : '' });
    case 'approved': {
      const who = whoControl(ctx, '', `Who will ask: ${c.member_name}`);
      who.addEventListener('change', () => {
        if (!who.value.trim()) return;
        save(ctx, c.id, { extend_by: who.value.trim().toUpperCase() })
          .then(() => { toast(`${c.member_name}: ${nameOrInitials(ctx, who.value)} will ask`); ctx.refresh(); })
          .catch((e) => ctx.fail(e));
      });
      return callingCard(ctx, c, { meta: c.approved_on ? `Approved ${formatDate(c.approved_on)}` : '', below: [h('span', { class: 'meta', text: 'Who will ask:' }), who] });
    }
    case 'assigned':
      return callingCard(ctx, c, { meta: `${nameOrInitials(ctx, c.extend_by)} to ask`, badges: [badge(String(c.extend_by).trim().toUpperCase())] });
    case 'sustain':
      return callingCard(ctx, c, { meta: WHERE_TEXT[where(c)] });
    case 'record':
      return callingCard(ctx, c, {
        meta: c.sustained_on ? `Sustained ${formatDate(c.sustained_on)}` : '',
        badges: [(c.record_by || recorder(ctx)) ? badge(String(c.record_by || recorder(ctx)).toUpperCase()) : null, !c.set_apart_on ? badge('not set apart yet', 'muted') : null],
      });
    case 'release':
      return callingCard(ctx, c, { badges: callingState(c).tasks.map((t) => badge(`${t.label}${t.by ? ` · ${t.by}` : ''}`, 'declined')) });
    case 'set_apart':
      return callingCard(ctx, c, {
        meta: c.sustained_on ? `Sustained ${formatDate(c.sustained_on)}` : '',
        badges: [c.set_apart_by ? badge(String(c.set_apart_by).toUpperCase()) : null,
          setApartByStake(c.calling, c.organization) ? badge('stake sets apart', 'muted') : null],
      });
    default:
      return callingCard(ctx, c);
  }
}

function renderPipeline(root, ctx) {
  const groups = pipeline(callings(ctx));
  add(root, h('div', { class: 'toolbar' }, proposeButton(ctx)),
    h('p', { class: 'hint', text: 'Each call moves down these sections in order. Tap a name to open it and record the next step.' }));
  for (const stage of STAGES) {
    const list = groups[stage.id];
    const body = [
      list.length ? h('p', { class: 'hint', text: stage.hint }) : null,
      list.length ? h('ul', { class: 'cards' }, list.map((c) => stageItem(ctx, stage.id, c))) : h('p', { class: 'empty', text: 'None.' }),
      stage.id === 'sustain' && list.length ? h('a', { class: 'button secondary-link', href: '#sunday', text: 'Open Sunday business' }) : null,
      stage.id === 'assigned' ? todosBlock(ctx) : null,
    ];
    if (stage.id === 'set_apart') {
      // Long list (many imported callings were never marked set apart): closed unless opened.
      const det = h('details', { class: 'stage' }, h('summary', { class: 'stage-head', text: `${stage.label} (${list.length})` }), body);
      det.open = view.setApartOpen;
      det.addEventListener('toggle', () => { view.setApartOpen = det.open; });
      root.append(det);
    } else {
      root.append(h('section', { class: 'stage' }, h('h3', { class: 'stage-head', text: `${stage.label} (${list.length})` }), body));
    }
  }
}

// ---------- to-dos ----------

async function saveTodo(ctx, id, fields) { await ctx.store.update('Tasks', [{ id, fields }]); }

function todoRow(ctx, t) {
  const today = ctx.today();
  const box = h('input', { type: 'checkbox', checked: Boolean(t.done_on), 'aria-label': `Done: ${t.description}` });
  box.addEventListener('change', () => {
    const fields = box.checked ? { done_on: today, done_by: myInitials(ctx) } : { done_on: '', done_by: '' };
    saveTodo(ctx, t.id, fields).then(() => { toast(box.checked ? 'Task done' : 'Task reopened'); ctx.refresh(); })
      .catch((e) => { box.checked = !box.checked; ctx.fail(e); });
  });
  const who = whoControl(ctx, t.assigned_to, `Assigned to: ${t.description}`, { stake: false });
  who.addEventListener('change', () => {
    saveTodo(ctx, t.id, { assigned_to: who.value.trim().toUpperCase() })
      .then(() => { toast(who.value.trim() ? `Task assigned to ${who.value.trim().toUpperCase()}` : 'Task unassigned'); ctx.refresh(); })
      .catch((e) => ctx.fail(e));
  });
  const late = t.due_on && !t.done_on && t.due_on < today;
  const info = t.done_on ? `Done ${formatDate(t.done_on)}${t.done_by ? ` · ${t.done_by}` : ''}` : t.due_on ? `Due ${formatDate(t.due_on)}` : '';
  return h('li', { class: 'row todo' },
    h('label', { class: 'check' }, box, h('span', { text: t.description })),
    h('span', { class: 'step-controls' }, info ? h('span', { class: late ? 'badge declined' : 'meta', text: late ? `Overdue: ${info}` : info }) : null, t.done_on ? null : who));
}

function addTodoForm(ctx) {
  const desc = h('input', { type: 'text', placeholder: 'e.g. Ask the Primary presidency for teacher names', 'aria-label': 'New task' });
  const who = whoControl(ctx, '', 'New task: assigned to', { stake: false });
  const due = h('input', { type: 'date', 'aria-label': 'New task: due date' });
  const btn = h('button', { class: 'secondary', text: 'Add task' });
  btn.addEventListener('click', () => busy(btn, async () => {
    if (!desc.value.trim()) throw new Error('Describe the task.');
    await ctx.store.add('Tasks', [{
      id: makeId('td'), description: desc.value.trim(), assigned_to: who.value.trim().toUpperCase(), due_on: due.value,
      entered_by: myInitials(ctx), entered_at: ctx.stamp(),
    }]);
    toast('Task added');
    ctx.refresh();
  }).catch(() => {}));
  return h('div', { class: 'inline-form' }, field('Task', desc), field('Assigned to', who), field('Due (optional)', due), btn);
}

function todosBlock(ctx) {
  const open = openTodos(todos(ctx));
  const done = recentlyDone(todos(ctx), ctx.today());
  const det = done.length ? h('details', { class: 'done-list' }, h('summary', { text: `Done in the last 30 days (${done.length})` }),
    h('ul', { class: 'rows' }, done.map((t) => todoRow(ctx, t)))) : null;
  if (det) { det.open = view.doneOpen; det.addEventListener('toggle', () => { view.doneOpen = det.open; }); }
  return h('div', { class: 'todos' },
    h('h4', { text: `Other tasks (${open.length})` }),
    open.length ? h('ul', { class: 'rows' }, open.map((t) => todoRow(ctx, t))) : h('p', { class: 'empty', text: 'No other tasks.' }),
    addTodoForm(ctx), det);
}

// ---------- My tasks ----------

function renderTasks(root, ctx) {
  const me = myInitials(ctx);
  if (!me) {
    root.append(h('div', { class: 'panel' }, h('p', { text: 'Add your initials on the Settings screen to see what is assigned to you.' }), h('a', { class: 'button', href: '#settings', text: 'Open Settings' })));
  }
  const w = myWork({ callings: callings(ctx), todos: todos(ctx), initials: me, defaults: stepDefaults(ctx) });
  const section = (title, items, emptyText, wrap = 'cards') => [
    h('h3', { class: 'stage-head', text: `${title} (${items.length})` }),
    items.length ? h('ul', { class: wrap }, items) : h('p', { class: 'empty', text: emptyText }),
  ];
  const askItem = (t) => {
    const c = t.calling;
    const yes = h('button', { class: 'small', text: 'Accepted' });
    const no = h('button', { class: 'small warn', text: 'Declined' });
    yes.addEventListener('click', () => busy(yes, async () => {
      await save(ctx, c.id, { accepted_on: ctx.today() }); toast(`${c.member_name} accepted: now under Sustain`); ctx.refresh();
    }).catch(() => {}));
    no.addEventListener('click', () => {
      if (!window.confirm(`Record that ${c.member_name} declined? The calling closes and stays in the Sheet.`)) return;
      busy(no, async () => { await save(ctx, c.id, { declined_on: ctx.today() }); toast('Declined recorded'); ctx.refresh(); }).catch(() => {});
    });
    return callingCard(ctx, c, { meta: c.approved_on ? `Approved ${formatDate(c.approved_on)}` : '', below: [h('span', { class: 'meta', text: 'Answer:' }), yes, no] });
  };
  const stepItem = (t) => callingCard(ctx, t.calling, {
    badges: [h('span', { class: 'badge soon', text: t.label }),
      t.step === 'set_apart' && setApartByStake(t.calling.calling, t.calling.organization) ? h('span', { class: 'badge muted', text: 'stake sets apart' }) : null],
  });
  add(root,
    h('p', { class: 'hint', text: `${me ? `For ${me}${personName(ctx, me) ? ` (${personName(ctx, me)})` : ''}. ` : ''}The calls you were assigned to extend, your to-dos and other steps assigned to you (recording callings in LCR, setting apart, releases). Add a to-do under In progress, Assigned to Contact.` }),
    me ? section('Calls to extend', w.asks.map(askItem), 'No calls assigned to you.') : null,
    me ? section('Your to-dos', w.todos.map((t) => todoRow(ctx, t)), 'No to-dos assigned to you.', 'rows') : null,
    me ? section('Other steps assigned to you', w.steps.map(stepItem), 'Nothing else assigned to you.') : null,
    w.unassignedTodos.length ? section('To-dos nobody has yet', w.unassignedTodos.map((t) => todoRow(ctx, t)), '', 'rows') : null);
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

// Settings: who records callings in LCR. Saved in the Sheet (Settings tab), the same for everyone.
function settingsSections(ctx) {
  const people = ctx.bishopric();
  const saved = ctx.shared.get('record_by');
  const current = recorder(ctx);
  const opts = [...people.map((p) => ({ value: p.initials, label: `${p.initials} — ${p.name}${p.role ? ` (${p.role})` : ''}` })),
    { value: 'NONE', label: 'Nobody by default' }];
  const value = saved.toUpperCase() === 'NONE' ? 'NONE' : current;
  if (!value) opts.unshift({ value: '', label: 'Choose…' });
  else if (!opts.some((o) => o.value === value)) opts.unshift({ value, label: value });   // someone no longer on the list
  const sel = select(opts, value, { 'aria-label': 'Records callings in LCR' });
  sel.addEventListener('change', () => {
    if (!sel.value) return;
    ctx.shared.set('record_by', sel.value)
      .then(() => { toast(sel.value === 'NONE' ? 'Recording in LCR is not assigned by default' : `${sel.value} records callings in LCR`); ctx.refresh(); })
      .catch((e) => ctx.fail(e));
  });
  return [h('section', { class: 'sub' },
    h('h3', { text: 'Records callings in LCR' }),
    field('Records callings in LCR', sel, saved
      ? 'Every calling waiting to be recorded in LCR is assigned to this person (on their My tasks) unless its own page names someone else.'
      : 'Not chosen yet, so the Executive Secretary on the Bishopric list is used. Every calling waiting to be recorded in LCR is assigned to this person unless its own page names someone else.'))];
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
  settingsSections,
};

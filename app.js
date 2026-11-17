// Bishopric Planner: app start-up, sign-in, tabs and screen switching.

import { FEATURES } from './js/features/index.js';
import { registerTables, Store } from './js/store.js';
import { SheetsApi, AuthError } from './js/sheets.js';
import { initAuth, signIn, signOut, currentToken, signedInEmail } from './js/auth.js';
import { loadSettings, saveSettings } from './js/settings.js';
import { activeBishopric, bishopricForEmail } from './js/members.js';
import { todayISO, addDays, nextSunday } from './js/dates.js';
import { h, clear, toast, openDialog, busy } from './js/ui.js';
import { renderMembers, openMember } from './js/views/members.js';
import { renderImport } from './js/views/import.js';
import { renderSettings } from './js/views/settings.js';

for (const f of FEATURES) registerTables(f.tables);

// Each view belongs to a group. The top row of tabs shows the groups; the second row shows the
// screens of the current group when it has more than one.
const VIEWS = [
  ...FEATURES.flatMap((f) => f.views.map((v) => ({ ...v, group: f.group, needsData: true }))),
  { id: 'members', label: 'Members', group: 'Members', render: renderMembers, needsData: true },
  { id: 'import', label: 'Import', group: 'Import', render: renderImport, needsData: true },
  { id: 'settings', label: 'Settings', group: 'Settings', render: renderSettings, needsData: false },
];
const GROUPS = [...new Set(VIEWS.map((v) => v.group))];

// me: the signed-in Google account and, once matched, their Bishopric list entry.
const state = { settings: loadSettings(), store: null, authReady: null, loading: false, me: { email: '', person: null } };

function pad(n) { return String(n).padStart(2, '0'); }

const ctx = {
  get settings() { return state.settings; },
  get store() { return state.store; },
  features: FEATURES,
  today: () => todayISO(),
  lastSunday: () => { const t = todayISO(); const s = nextSunday(t); return s === t ? t : addDays(s, -7); },
  stamp: () => { const d = new Date(); return `${todayISO(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; },
  openMember: (id) => openMember(id, ctx),
  refresh: () => render(),
  go: (id) => { if (location.hash === `#${id}`) render(); else location.hash = id; },
  fail: (e) => handleError(e),
  signedIn: () => Boolean(state.store),
  bishopric: () => (state.store ? activeBishopric(state.store.records('Bishopric')) : []),
  // Settings saved in the Sheet's Settings tab, the same for everyone.
  shared: {
    get: (key) => {
      const row = state.store ? state.store.records('Settings').find((r) => String(r.id) === key) : null;
      return row ? String(row.value ?? '').trim() : '';
    },
    set: async (key, value) => {
      const fields = { value, updated_by: state.settings.initials || '', updated_at: ctx.stamp() };
      if (state.store.records('Settings').some((r) => String(r.id) === key)) await state.store.update('Settings', [{ id: key, fields }]);
      else await state.store.add('Settings', [{ id: key, ...fields }]);
    },
  },
  me: () => state.me,
  askWhoYouAre: () => askWhoYouAre(),
  reload: () => loadData().catch(handleError),
  signOut: () => { signOut(); state.store = null; state.me = { email: '', person: null }; toast('Signed out'); render(); },
  applySettings: (next) => {
    const changed = next.sheetId !== state.settings.sheetId || next.clientId !== state.settings.clientId;
    state.settings = next;
    if (changed) { state.store = null; startAuth(); }
    toast('Settings saved');
    ctx.go('ask');
  },
};

function startAuth() {
  state.authReady = state.settings.clientId ? initAuth(state.settings.clientId) : null;
  if (state.authReady) state.authReady.catch((e) => toast(e.message, 'error'));
}

function handleError(e) {
  if (e instanceof AuthError) {
    toast('Your Google sign-in expired. Tap "Sign in" at the top, then try again.', 'error');
  } else {
    toast(e && e.message ? e.message : String(e), 'error');
  }
  renderHeader();
}

async function loadData() {
  state.loading = true;
  render();
  try {
    const api = new SheetsApi(state.settings.sheetId, currentToken);
    const store = new Store(api);
    await store.load();
    state.store = store;
    toast(`Loaded ${store.records('Members').length} members`);
  } finally {
    state.loading = false;
    render();
  }
  await identify();
}

// Recognize the signed-in person from their Google account. A match sets their initials on this
// device. With no match yet, ask once which Bishopric list entry they are and save their account there.
async function identify() {
  const email = await signedInEmail();
  state.me = { email, person: null };
  if (!email || !state.store) return;
  const person = bishopricForEmail(state.store.records('Bishopric'), email);
  if (person) {
    state.me.person = person;
    if (state.settings.initials !== person.initials) {
      state.settings = { ...state.settings, initials: person.initials };
      saveSettings(state.settings);
    }
    render();
    return;
  }
  if (ctx.bishopric().some((p) => !p.email)) askWhoYouAre();
}

function askWhoYouAre() {
  const email = state.me.email;
  if (!email || !state.store) return;
  const unclaimed = ctx.bishopric().filter((p) => !p.email);
  if (!unclaimed.length) { toast('Everyone on the Bishopric list already has a Google account saved.', 'error'); return; }
  openDialog('Which one are you?', (close) => [
    h('p', { text: `You are signed in as ${email}. Choose your name once; the app will recognize this Google account on any device after that.` }),
    h('ul', { class: 'rows' }, unclaimed.map((p) => {
      const b = h('button', { class: 'secondary', text: `${p.initials} — ${p.name}${p.role ? ` (${p.role})` : ''}` });
      b.addEventListener('click', () => busy(b, async () => {
        await state.store.update('Bishopric', [{ id: p.id, fields: { email } }]);
        state.me.person = { ...p, email };
        state.settings = { ...state.settings, initials: p.initials };
        saveSettings(state.settings);
        toast(`Welcome, ${p.name}`);
        close(); render();
      }).catch(() => {}));
      return h('li', { class: 'row' }, b);
    })),
    h('button', { class: 'small secondary', text: 'Not now', onclick: close }),
  ]);
}

async function doSignIn() {
  if (!state.authReady) { toast('Add the Google client ID in Settings first.', 'error'); return; }
  try {
    await state.authReady;
    await signIn();
    if (!state.store) await loadData(); else renderHeader();
  } catch (e) {
    handleError(e);
  }
}

function renderHeader() {
  const btn = document.getElementById('signin');
  const needs = state.settings.clientId && state.settings.sheetId && !currentToken();
  btn.hidden = !needs;
  btn.textContent = state.store ? 'Sign in again' : 'Sign in';
}

function currentView() {
  const id = (location.hash || '#ask').slice(1);
  return VIEWS.find((v) => v.id === id) || VIEWS[0];
}

function render() {
  const view = currentView();
  const nav = clear(document.getElementById('tabs'));
  const primary = h('div', { class: 'tab-row' });
  for (const g of GROUPS) {
    const first = VIEWS.find((v) => v.group === g);
    primary.append(h('a', { href: `#${first.id}`, class: g === view.group ? 'tab active' : 'tab', 'aria-current': g === view.group ? 'true' : false, text: g }));
  }
  nav.append(primary);
  const siblings = VIEWS.filter((v) => v.group === view.group);
  if (siblings.length > 1) {
    nav.append(h('div', { class: 'tab-row sub-tabs' }, siblings.map((v) =>
      h('a', { href: `#${v.id}`, class: v.id === view.id ? 'tab active' : 'tab', 'aria-current': v.id === view.id ? 'page' : false, text: v.label }))));
  }
  renderHeader();
  const main = clear(document.getElementById('view'));
  main.append(h('h2', { class: 'view-title', text: view.title || view.label }));
  if (view.needsData && !state.store) {
    if (state.loading) { main.append(h('p', { class: 'summary', text: 'Loading the Sheet…' })); return; }
    if (!state.settings.sheetId || !state.settings.clientId) {
      main.append(h('div', { class: 'panel' },
        h('p', { text: 'First add the Google Sheet link and the Google client ID on the Settings screen.' }),
        h('a', { class: 'button', href: '#settings', text: 'Open Settings' })));
      return;
    }
    main.append(h('div', { class: 'panel' },
      h('p', { text: 'Sign in with the Google account the Sheet is shared with.' }),
      h('button', { text: 'Sign in with Google', onclick: doSignIn })));
    return;
  }
  try {
    view.render(main, ctx);
  } catch (e) {
    main.append(h('p', { class: 'error', text: `This screen could not be shown: ${e.message}` }));
    console.error(e);
  }
}

document.getElementById('signin').addEventListener('click', doSignIn);
window.addEventListener('hashchange', render);
window.addEventListener('unhandledrejection', (ev) => handleError(ev.reason));
setInterval(renderHeader, 60000);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

startAuth();
render();

// Bishopric Planner: app start-up, sign-in, tabs and screen switching.

import { FEATURES } from './js/features/index.js';
import { registerTables, Store } from './js/store.js';
import { SheetsApi, AuthError } from './js/sheets.js';
import { initAuth, signIn, signOut, currentToken, signedInEmail } from './js/auth.js';
import { loadSettings, saveSettings } from './js/settings.js';
import { activeBishopric, bishopricForEmail, accessForEmail, isTrue } from './js/members.js';
import { APP_VERSION } from './config.js';
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
  { id: 'members', label: 'Members', group: 'Members', render: renderMembers, needsData: true, limited: true },
  { id: 'import', label: 'Import', group: 'Import', render: renderImport, needsData: true },
  { id: 'settings', label: 'Settings', group: 'Settings', render: renderSettings, needsData: false },
];
// me: the signed-in Google account, their Bishopric list entry once matched, and what they see:
// access 'full', or 'limited' (only the screens marked limited: true; see identify()).
const state = { settings: loadSettings(), store: null, authReady: null, loading: false, me: { email: '', person: null, access: 'full', limited: null } };

function visibleViews() { return state.store && state.me.access === 'limited' ? VIEWS.filter((v) => v.limited) : VIEWS; }

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
  limited: () => Boolean(state.store) && state.me.access === 'limited',
  // Who did something, as saved in entered_by: initials, or a limited person's name.
  who: () => (state.me.access === 'limited' ? (state.me.limited ? state.me.limited.name : state.me.email) : state.settings.initials),
  askWhoYouAre: () => askWhoYouAre(),
  reload: () => loadData().catch(handleError),
  signOut: () => { signOut(); state.store = null; state.me = { email: '', person: null, access: 'full', limited: null }; toast('Signed out'); render(); },
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
    await identify();
    toast(`Loaded ${store.records('Members').length} members`);
  } finally {
    state.loading = false;
    render();
  }
  if (state.me.askWho) askWhoYouAre();
}

// Recognize the signed-in person from their Google account.
//   On the Bishopric list: the full app; their initials are set on this device.
//   On the Limited access list: the limited app.
//   Neither: the full app while the Limited access list is empty (as before it existed); otherwise
//   the limited app. Either way, if a Bishopric entry has no account yet, ask "Which one are you?".
async function identify() {
  const email = await signedInEmail();
  state.me = { email, person: null, access: 'full', limited: null, askWho: false };
  if (!email || !state.store) return;
  const person = bishopricForEmail(state.store.records('Bishopric'), email);
  if (person) {
    state.me.person = person;
    if (state.settings.initials !== person.initials) {
      state.settings = { ...state.settings, initials: person.initials };
      saveSettings(state.settings);
    }
    return;
  }
  const accessRows = state.store.records('Access');
  const limited = accessForEmail(accessRows, email);
  if (limited) { Object.assign(state.me, { access: 'limited', limited }); return; }
  const listInUse = accessRows.some((r) => r.email && !isTrue(r.void) && String(r.active).toUpperCase() !== 'FALSE');
  if (listInUse) state.me.access = 'limited';
  state.me.askWho = ctx.bishopric().some((p) => !p.email);
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
        Object.assign(state.me, { person: { ...p, email }, access: 'full', limited: null, askWho: false });
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

// The app opens on the Calendar (for the bishopric and limited access alike) unless the address names a screen.
function currentView() {
  const id = (location.hash || '#calendar').slice(1);
  const views = visibleViews();
  return views.find((v) => v.id === id) || views[0];
}

function render() {
  document.body.classList.toggle('signed-in', Boolean(state.store));
  const view = currentView();
  const views = visibleViews();
  const nav = clear(document.getElementById('tabs'));
  const primary = h('div', { class: 'tab-row' });
  for (const g of [...new Set(views.map((v) => v.group))]) {
    const first = views.find((v) => v.group === g);
    primary.append(h('a', { href: `#${first.id}`, class: g === view.group ? 'tab active' : 'tab', 'aria-current': g === view.group ? 'true' : false, text: g }));
  }
  nav.append(primary);
  const siblings = views.filter((v) => v.group === view.group);
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
  // Signed in with an account on neither list while the Limited access list is in use.
  if (state.store && state.me.access === 'limited' && !state.me.limited && state.me.email) {
    main.append(h('div', { class: 'panel' }, h('p', { text: `Signed in as ${state.me.email}. This account is not on the Bishopric or Limited access list, so the app shows only some screens.` }),
      state.me.askWho ? h('button', { text: 'Which one are you?', onclick: () => askWhoYouAre() }) : null));
  }
  try {
    view.render(main, ctx);
  } catch (e) {
    main.append(h('p', { class: 'error', text: `This screen could not be shown: ${e.message}` }));
    console.error(e);
  }
  // The limited app has no Settings screen: reload and sign out live here.
  if (state.store && state.me.access === 'limited') {
    main.append(h('p', { class: 'hint app-footer' }, `Version ${APP_VERSION}${state.me.limited ? ` · ${state.me.limited.name}` : ''} · `,
      h('button', { class: 'link', text: 'Reload data', onclick: () => ctx.reload() }), ' · ',
      h('button', { class: 'link', text: 'Sign out', onclick: () => ctx.signOut() })));
  }
}

document.getElementById('signin').addEventListener('click', doSignIn);
window.addEventListener('hashchange', render);
window.addEventListener('unhandledrejection', (ev) => handleError(ev.reason));
setInterval(renderHeader, 60000);

// Updates. Opening the app always gets the newest files (see sw.js). If a new version is published
// while the app is open (for example a phone app brought back from the background), a bar offers
// a reload; it does not reload by itself, so nothing being typed is lost.
function showUpdateBar() {
  if (document.getElementById('update-bar')) return;
  const bar = h('div', { id: 'update-bar', class: 'update-bar', role: 'status' },
    h('span', { text: 'A new version of the app is ready.' }),
    h('button', { class: 'small', text: 'Reload', onclick: () => location.reload() }));
  document.body.insertBefore(bar, document.body.firstChild);
}

if ('serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);   // false on the very first visit
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) showUpdateBar(); });
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch(() => {});
}

startAuth();
render();

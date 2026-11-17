// Settings saved on this device (Sheet link, sign-in client ID, initials, look-back window), and the
// Bishopric list, which is saved in the Sheet so all of the bishopric share it.

import { APP_VERSION, CLIENT_ID, SHEET_ID } from '../../config.js';
import { spreadsheetIdFrom } from '../sheets.js';
import { saveSettings } from '../settings.js';
import { makeId } from '../members.js';
import { h, add, field, select, busy, toast } from '../ui.js';

export function renderSettings(root, ctx) {
  const s = ctx.settings;
  const people = ctx.signedIn() ? ctx.bishopric() : [];
  const sheet = h('input', { type: 'url', value: s.sheetId ? `https://docs.google.com/spreadsheets/d/${s.sheetId}/edit` : '', placeholder: 'https://docs.google.com/spreadsheets/d/…', 'aria-label': 'Sheet link', disabled: Boolean(SHEET_ID) });
  const client = h('input', { type: 'text', value: s.clientId || '', placeholder: '….apps.googleusercontent.com', 'aria-label': 'Google client ID', disabled: Boolean(CLIENT_ID) });
  // Recognized from the Google account: initials are fixed. Otherwise pick from the list, or type them.
  const me = ctx.me();
  const mine = String(s.initials || '').toUpperCase();
  const initials = me.person
    ? h('input', { type: 'text', value: me.person.initials, disabled: true, 'aria-label': 'Your initials' })
    : people.length
    ? select([{ value: '', label: 'Choose…' },
      ...people.map((p) => ({ value: p.initials, label: `${p.initials} — ${p.name}` })),
      ...(mine && !people.some((p) => p.initials === mine) ? [{ value: mine, label: mine }] : [])], mine, { 'aria-label': 'Your initials' })
    : h('input', { type: 'text', value: s.initials || '', maxlength: 6, placeholder: 'e.g. KW', 'aria-label': 'Your initials' });
  const windowYears = h('input', { type: 'number', min: 1, max: 10, step: 0.5, value: s.windowYears, 'aria-label': 'Look-back years' });
  const minAge = h('input', { type: 'number', min: 0, max: 18, step: 1, value: s.minAge, 'aria-label': 'Minimum age' });
  const save = h('button', { text: 'Save settings' });
  save.addEventListener('click', () => {
    const id = spreadsheetIdFrom(sheet.value);
    if (!id) { toast('Paste the full link to the Google Sheet.', 'error'); return; }
    const next = {
      ...s,
      sheetId: id,
      clientId: CLIENT_ID || client.value.trim(),
      initials: initials.value.trim().toUpperCase(),
      windowYears: Number(windowYears.value) > 0 ? Number(windowYears.value) : 3,
      minAge: Number.isFinite(Number(minAge.value)) ? Number(minAge.value) : 8,
    };
    if (!saveSettings(next)) toast('This browser would not save settings (private mode?). They will last until you close the app.', 'error');
    ctx.applySettings(next);
  });
  add(root,
    field('Google Sheet link', sheet, SHEET_ID ? 'Set in the app. Only people the Sheet is shared with can open it.' : 'The bishopric\'s planner Sheet. Only people it is shared with can open it.'),
    field('Google client ID', client, CLIENT_ID ? 'Set in the app.' : 'From Google Cloud Console. Not a secret.'),
    field('Your initials', initials, me.person
      ? `You: ${me.person.initials} — ${me.person.name} (recognized from your Google account ${me.email}).`
      : people.length ? 'Steps assigned to you show on My tasks. Saved with each talk or decline you record.' : 'Saved with each talk or decline you record.'),
    me.email && !me.person && people.some((p) => !p.email)
      ? h('div', { class: 'panel' }, h('p', { text: `Signed in as ${me.email}, which is not linked to anyone on the Bishopric list yet.` }),
        h('button', { text: 'Which one are you?', onclick: () => ctx.askWhoYouAre() }))
      : null,
    field('Look-back window (years)', windowYears, 'People with a talk inside this window are left off "Who to ask".'),
    field('Minimum age', minAge),
    h('div', { class: 'toolbar' }, save,
      ctx.signedIn() ? h('button', { class: 'secondary', text: 'Reload data', onclick: () => ctx.reload() }) : null,
      ctx.signedIn() ? h('button', { class: 'secondary', text: 'Sign out', onclick: () => ctx.signOut() }) : null),
    ctx.signedIn() ? bishopricSection(ctx) : h('p', { class: 'hint', text: 'Sign in to see and edit the Bishopric list.' }),
    ctx.signedIn() ? ctx.features.flatMap((f) => (f.settingsSections ? f.settingsSections(ctx) : [])) : null,
    h('p', { class: 'hint', text: `Version ${APP_VERSION}. Settings are saved on this device only. Member data is read from the Sheet each time and is not stored on the device.` }));
}

function bishopricSection(ctx) {
  const people = ctx.bishopric();
  const rows = ctx.store.records('Bishopric');
  const list = h('ul', { class: 'rows' }, people.map((p) => {
    const remove = h('button', { class: 'small secondary', text: 'Remove' });
    remove.addEventListener('click', () => {
      if (!window.confirm(`Take ${p.name || p.initials} off the Bishopric list? Steps already assigned to ${p.initials} keep those initials.`)) return;
      busy(remove, async () => { await ctx.store.update('Bishopric', [{ id: p.id, fields: { active: false } }]); toast('Removed'); ctx.refresh(); }).catch(() => {});
    });
    // Votes on proposed callings unless unchecked (the "votes" column is FALSE).
    const votes = h('input', { type: 'checkbox', checked: String(p.votes ?? '').trim().toUpperCase() !== 'FALSE', 'aria-label': `${p.initials} votes on callings` });
    votes.addEventListener('change', () => {
      ctx.store.update('Bishopric', [{ id: p.id, fields: { votes: votes.checked } }])
        .then(() => { toast(votes.checked ? `${p.initials} votes on callings` : `${p.initials} does not vote on callings`); ctx.refresh(); })
        .catch((e) => { votes.checked = !votes.checked; ctx.fail(e); });
    });
    return h('li', { class: 'row' }, h('span', {}, h('strong', { text: p.initials }), ` ${p.name}${p.role ? ` · ${p.role}` : ''}`,
      h('span', { class: 'meta small', text: p.email ? ` · ${p.email}` : ' · Google account not linked yet' })),
    h('span', { class: 'step-controls' }, h('label', { class: 'check' }, votes, 'Votes'), remove));
  }));

  // Suggestions from current callings (Bishop, counselors, executive secretary), not already listed.
  const suggest = ctx.features.flatMap((f) => (f.suggestBishopric ? f.suggestBishopric(ctx) : []))
    .filter((sg) => !people.some((p) => p.initials === sg.initials || (sg.member_id && p.member_id === sg.member_id)));
  const fill = h('button', { text: `Fill from org chart (${suggest.length})`, disabled: !suggest.length });
  fill.addEventListener('click', () => busy(fill, async () => {
    await ctx.store.add('Bishopric', suggest.map((sg) => ({ id: makeId('b'), ...sg, active: true })));
    toast(`${suggest.length} added`);
    ctx.refresh();
  }).catch(() => {}));

  const ini = h('input', { type: 'text', maxlength: 6, placeholder: 'KW', 'aria-label': 'New initials', class: 'initials' });
  const name = h('input', { type: 'text', placeholder: 'First Last', 'aria-label': 'New name' });
  const role = h('input', { type: 'text', placeholder: 'Role (optional)', 'aria-label': 'New role' });
  const email = h('input', { type: 'email', placeholder: 'Google account (optional)', 'aria-label': 'New email' });
  const addBtn = h('button', { class: 'secondary', text: 'Add' });
  addBtn.addEventListener('click', () => busy(addBtn, async () => {
    const i = ini.value.trim().toUpperCase();
    if (!i || !name.value.trim()) throw new Error('Enter initials and a name.');
    if (people.some((p) => p.initials === i)) throw new Error(`${i} is already on the list.`);
    // Someone removed earlier with the same initials is turned back on instead of added twice.
    const old = rows.find((r) => String(r.initials).toUpperCase() === i);
    const em = email.value.trim();
    if (old) await ctx.store.update('Bishopric', [{ id: old.id, fields: { active: true, name: name.value.trim(), role: role.value.trim(), email: em } }]);
    else await ctx.store.add('Bishopric', [{ id: makeId('b'), initials: i, name: name.value.trim(), role: role.value.trim(), member_id: '', active: true, email: em }]);
    toast(`${i} added`);
    ctx.refresh();
  }).catch(() => {}));

  return h('section', { class: 'sub' },
    h('h3', { text: 'Bishopric list' }),
    h('p', { class: 'hint', text: 'The people who can be assigned steps (asking, setting apart, recording in LCR). Saved in the Sheet, so everyone sees the same list. "Fill from org chart" adds the current bishop, counselors and executive secretary from the Callings tab. Each person\'s Google account is linked the first time they sign in ("Which one are you?"), so the app recognizes them on any device. "Votes": checked for each person who votes on proposed callings; uncheck anyone who does not.' }),
    people.length ? list : h('p', { class: 'empty', text: 'No one on the list yet.' }),
    h('div', { class: 'toolbar' }, fill),
    h('div', { class: 'inline-form' }, field('Initials', ini), field('Name', name), field('Role', role), field('Google account', email), addBtn));
}

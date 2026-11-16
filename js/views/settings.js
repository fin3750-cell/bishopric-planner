// Settings saved on this device: Sheet link, sign-in client ID, initials, look-back window.

import { APP_VERSION, CLIENT_ID } from '../../config.js';
import { spreadsheetIdFrom } from '../sheets.js';
import { saveSettings } from '../settings.js';
import { h, field, toast } from '../ui.js';

export function renderSettings(root, ctx) {
  const s = ctx.settings;
  const sheet = h('input', { type: 'url', value: s.sheetId ? `https://docs.google.com/spreadsheets/d/${s.sheetId}/edit` : '', placeholder: 'https://docs.google.com/spreadsheets/d/…', 'aria-label': 'Sheet link' });
  const client = h('input', { type: 'text', value: s.clientId || '', placeholder: '….apps.googleusercontent.com', 'aria-label': 'Google client ID', disabled: Boolean(CLIENT_ID) });
  const initials = h('input', { type: 'text', value: s.initials || '', maxlength: 6, placeholder: 'e.g. KW', 'aria-label': 'Your initials' });
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
  root.append(
    field('Google Sheet link', sheet, 'The shared "Speaker Planner Data" Sheet. Only people it is shared with can open it.'),
    field('Google client ID', client, CLIENT_ID ? 'Set in the app.' : 'From Google Cloud Console. Not a secret.'),
    field('Your initials', initials, 'Saved with each talk or decline you record.'),
    field('Look-back window (years)', windowYears, 'People with a talk inside this window are left off "Who to ask".'),
    field('Minimum age', minAge),
    h('div', { class: 'toolbar' }, save,
      ctx.signedIn() ? h('button', { class: 'secondary', text: 'Reload data', onclick: () => ctx.reload() }) : null,
      ctx.signedIn() ? h('button', { class: 'secondary', text: 'Sign out', onclick: () => ctx.signOut() }) : null),
    h('p', { class: 'hint', text: `Version ${APP_VERSION}. Settings are saved on this device only. Member data is read from the Sheet each time and is not stored on the device.` }));
}

// Per-device settings, saved in this browser only. No member data is saved here.
import { CLIENT_ID } from '../config.js';

const KEY = 'bishopric-planner-settings';
const DEFAULTS = { sheetId: '', clientId: '', initials: '', windowYears: 3, minAge: 8 };

export function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { saved = {}; }
  const s = { ...DEFAULTS, ...saved };
  if (!s.clientId && CLIENT_ID) s.clientId = CLIENT_ID;
  return s;
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch { return false; }
}

// Per-device settings, saved in this browser only. No member data is saved here.
import { CLIENT_ID, SHEET_ID } from '../config.js';

const KEY = 'bishopric-planner-settings';
const DEFAULTS = { sheetId: '', clientId: '', initials: '', windowYears: 3, minAge: 8 };

export function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { saved = {}; }
  const s = { ...DEFAULTS, ...saved };
  if (CLIENT_ID) s.clientId = CLIENT_ID; // the app's own client ID and Sheet always win over values saved on the device
  if (SHEET_ID) s.sheetId = SHEET_ID;
  return s;
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch { return false; }
}

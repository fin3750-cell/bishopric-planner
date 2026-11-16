// Google sign-in with Google Identity Services (token model). The access token lasts about an hour
// and is kept only in memory, never saved on the device.

const GIS_SRC = 'https://accounts.google.com/gsi/client';
export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
// The person's email address, used only to recognize which bishopric member is signed in.
export const EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';
const USERINFO = 'https://www.googleapis.com/oauth2/v3/userinfo';

let token = '';
let emailGranted = false;
let expiresAt = 0;
let client = null;
let pending = null;

function loadScript() {
  if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Google sign-in. Check the internet connection.'));
    document.head.appendChild(s);
  });
}

export async function initAuth(clientId) {
  await loadScript();
  client = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: `${SHEETS_SCOPE} ${EMAIL_SCOPE}`,
    callback: (resp) => {
      const p = pending;
      pending = null;
      if (!p) return;
      if (resp.error) { p.reject(new Error(`Google sign-in failed: ${resp.error}`)); return; }
      // Google lets people untick permissions. Sheets access is required; the email is optional.
      const oauth2 = window.google.accounts.oauth2;
      const granted = (s) => (typeof oauth2.hasGrantedAllScopes === 'function' ? oauth2.hasGrantedAllScopes(resp, s) : true);
      if (!granted(SHEETS_SCOPE)) {
        p.reject(new Error('The app needs permission to use Google Sheets. Sign in again and leave that box checked.'));
        return;
      }
      emailGranted = granted(EMAIL_SCOPE);
      token = resp.access_token;
      expiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
      p.resolve(token);
    },
    error_callback: (err) => {
      const p = pending;
      pending = null;
      if (p) p.reject(new Error(err && err.type === 'popup_closed' ? 'Sign-in window was closed.' : 'Google sign-in did not finish.'));
    },
  });
}

// Must be called from a tap or click, because it opens Google's sign-in window.
export function signIn() {
  if (!client) return Promise.reject(new Error('Sign-in is not ready yet.'));
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    client.requestAccessToken({ prompt: '' });
  });
}

// The signed-in person's email address, or '' if they did not allow it or it could not be read.
export async function signedInEmail() {
  if (!token || !emailGranted) return '';
  try {
    const res = await fetch(USERINFO, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return '';
    const info = await res.json();
    return info.email && info.email_verified !== false ? String(info.email) : '';
  } catch {
    return '';
  }
}

export function currentToken() {
  return token && Date.now() < expiresAt - 60000 ? token : '';
}

export function signOut() {
  if (token && window.google && window.google.accounts && window.google.accounts.oauth2) {
    window.google.accounts.oauth2.revoke(token, () => {});
  }
  token = '';
  expiresAt = 0;
  emailGranted = false;
}

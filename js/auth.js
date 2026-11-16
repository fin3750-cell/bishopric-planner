// Google sign-in with Google Identity Services (token model). The access token lasts about an hour
// and is kept only in memory, never saved on the device.

const GIS_SRC = 'https://accounts.google.com/gsi/client';
export const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

let token = '';
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
    scope: SCOPE,
    callback: (resp) => {
      const p = pending;
      pending = null;
      if (!p) return;
      if (resp.error) { p.reject(new Error(`Google sign-in failed: ${resp.error}`)); return; }
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

export function currentToken() {
  return token && Date.now() < expiresAt - 60000 ? token : '';
}

export function signOut() {
  if (token && window.google && window.google.accounts && window.google.accounts.oauth2) {
    window.google.accounts.oauth2.revoke(token, () => {});
  }
  token = '';
  expiresAt = 0;
}

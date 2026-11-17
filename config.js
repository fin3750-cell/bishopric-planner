// Google OAuth client ID for this app (Google Cloud Console > Clients > Web application).
// A client ID is not a secret: it only says which app is asking. Access to the Sheet still
// depends on each person's own Google sign-in and on how the Sheet is shared.
// If this is left empty, each person can paste the ID on the Settings screen instead.
export const CLIENT_ID = '791712061235-r9b1lvopgfgmsle8crtovsmburr1vjmc.apps.googleusercontent.com';

// The bishopric's planner Sheet ("Bishopric Planner Data"). Knowing this id gives no access:
// Google only lets accounts the Sheet is shared with open it.
export const SHEET_ID = '1-BUQa5ej4zfCu6DJMgrR6kbxOrCNZxBmnpJEx0OvPdY';

export const APP_VERSION = '0.9.0';

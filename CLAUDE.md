# Instructions for Claude: Bishopric Planner

A PWA for a bishopric to plan sacrament meeting speakers and track callings (calls, releases, time in calling).
The data lives in a shared Google Sheet. README.md describes the setup, the Sheet's columns and
how to add a feature.

## Rules that matter most

- **Never put member data in this repository:** no names, ages, talks or notes in code, tests,
  fixtures, commits, PR text or screenshots. Tests use made-up names only. The member list is
  "For Church Use Only".
- The app runs in the browser and talks only to Google sign-in (including its userinfo endpoint, for
  the signed-in email) and the Google Sheets API. Do not add analytics, CDNs, web fonts or other
  outside services.
- Keep it plain HTML, CSS and JavaScript modules: no framework, no build step, no npm dependencies.
  Use relative paths, because the site is served from `https://<user>.github.io/bishopric-planner/`.
- Set text with `textContent` (the `h()` helper in `js/ui.js`), never `innerHTML`, because names
  and notes come from the Sheet.
- Find Sheet columns by header name, never by position. To change a row, find it by its `id`
  (`Store.update` re-reads the id column first), because the Sheet can be sorted by hand.
- Don't delete rows. Mark mistakes with `void` = TRUE.
- Names of real people, including the bishopric, belong in the Sheet (for example the Bishopric tab),
  never in code or config.
- The stake's Sheet (Calendar feature) is only read, never written. Its link is the shared
  `stake_sheet` setting, not code. `js/features/stake-parse.js` finds each part by tab name and
  header words and reports what it can't read; keep it that way so a new year's Sheet needs no
  code change.
- Church guidance (organizations, who sustains and sets apart) lives in `js/features/callings-orgs.js`
  with the General Handbook section for each rule. Don't add rules from memory: read the handbook
  section first and cite it there.
- `privacy/index.html` is the public privacy policy that Google's sign-in settings link to. When a
  change adds a Google permission, saves something new on the device or talks to a new service,
  update the policy and its "Last updated" date in the same change. `terms/index.html` is the terms
  of service. Neither page may name real people.

## Working on it

- Put rules in pure modules (`js/members.js`, `js/dates.js`, `js/features/*-logic.js`) and test
  them with `node --test`.
- Run `node tests/e2e/smoke.mjs` (Playwright with Chromium) before pushing. It uses a fake Google
  and a fake in-memory Sheet. When `sw.js` or the update code in `app.js` changes, also run
  `node tests/e2e/update.mjs` (service worker on, GitHub Pages-style caching).
- When you add or rename a file, update `SHELL` in `sw.js` and raise the `CACHE` version so phones
  pick up the change.
- New features go in `js/features/` with `{ id, group, tables, views, memberSections, settingsSections }`, then get
  registered in `js/features/index.js`.
- Append page content with `h()` or `add()` from `js/ui.js`, not the browser's `el.append()` with
  lists or null: `append` prints them as text ("[object …]", "null").
- The user teaches college finance, reads code, and wants verified results. Say when something is
  a guess or untested, for example sign-in in an iPhone home-screen app.

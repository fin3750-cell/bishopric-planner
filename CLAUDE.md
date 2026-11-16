# Instructions for Claude: Bishopric Planner

A PWA for a bishopric (three people) to plan sacrament meeting speakers, with callings planned next.
The data lives in a shared Google Sheet. README.md describes the setup, the Sheet's columns and
how to add a feature.

## Rules that matter most

- **Never put member data in this repository:** no names, ages, talks or notes in code, tests,
  fixtures, commits, PR text or screenshots. Tests use made-up names only. The member list is
  "For Church Use Only".
- The app runs in the browser and talks only to Google sign-in and the Google Sheets API. Do not add
  analytics, CDNs, web fonts or other outside services.
- Keep it plain HTML, CSS and JavaScript modules: no framework, no build step, no npm dependencies.
  Use relative paths, because the site is served from `https://<user>.github.io/bishopric-planner/`.
- Set text with `textContent` (the `h()` helper in `js/ui.js`), never `innerHTML`, because names
  and notes come from the Sheet.
- Find Sheet columns by header name, never by position. To change a row, find it by its `id`
  (`Store.update` re-reads the id column first), because the Sheet can be sorted by hand.
- Don't delete rows. Mark mistakes with `void` = TRUE.

## Working on it

- Put rules in pure modules (`js/members.js`, `js/dates.js`, `js/features/*-logic.js`) and test
  them with `node --test`.
- Run `node tests/e2e/smoke.mjs` (Playwright with Chromium) before pushing. It uses a fake Google
  and a fake in-memory Sheet.
- When you add or rename a file, update `SHELL` in `sw.js` and raise the `CACHE` version so phones
  pick up the change.
- New features go in `js/features/` with `{ id, tables, views, memberSections }`, then get
  registered in `js/features/index.js`.
- The user teaches college finance, reads code, and wants verified results. Say when something is
  a guess or untested, for example sign-in in an iPhone home-screen app.

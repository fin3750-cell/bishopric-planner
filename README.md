# Bishopric Planner

An installable web app (PWA) for a bishopric to plan sacrament meeting speakers and callings. It
works from a Google Sheet shared by the bishopric. The tabs along the top are **Speakers**,
**Callings**, **Members**, **Import** and **Settings**.

**Speakers**

- **Who to ask:** members who have not spoken within the look-back window (default 3 years).
  "Ask soon" people come first, then people with no talk on record, then the people whose last
  talk was longest ago.
- **Upcoming:** talks scheduled for future Sundays.
- **History:** past talks, including visitors.
- **Members:** everyone, with a planning category: *Ask soon*, *Not now (until a date)*,
  *Do not ask* or *Moved*.
- **Import:** a fresh member list, compared with the Sheet. New people are flagged "New to ward"
  and people who are no longer listed are flagged as moved, for you to confirm.

Declines are recorded with a date. A decline made after a person's last talk highlights them in
amber on the list. The decline does not hide them.

**Callings**
- **Current:** who holds each calling and for how long, counted from the date sustained. Grouped
  by organization, or sorted longest-serving first.
- **In progress:** every call and release that still has a step to do, grouped by its next step.
- **Sunday:** business for sacrament meeting. Releases to read come first (once the member has been
  told), then callings to sustain (once accepted). Mark them done for that Sunday in one tap.
- **My tasks:** the steps assigned to your initials, plus steps nobody has been assigned yet.
- **No calling:** active members (adults, or 12+) with no current or proposed calling.

The steps tracked for a call are: proposed → asked → accepted or declined → sustained → set apart
and recorded in LCR (in either order). For a release: decided → member told → released in
sacrament meeting → recorded in LCR. Asking, setting apart, recording in LCR and telling a member
about a release can each be assigned to someone's initials.

The app is built so more features can be added (see [Adding a feature](#adding-a-feature)).

## Privacy and data

- **No member data is in this repository.** Names, ages and talks live only in the shared Google
  Sheet. `.gitignore` blocks data files (CSV, XLSX, PDF, video), but still check before every commit.
- **Who can see the data:** the Sheet's sharing settings decide that. Each person signs in with
  their own Google account, and the app reads and writes the Sheet as that person.
- **Nothing is stored on the device except settings:** the Sheet link, client ID, initials and
  look-back window. Member data is loaded from the Sheet each time the app opens and is not kept on
  the device. The service worker caches only the app's own files.
- The member list is marked *For Church Use Only*. Share the Sheet only with the bishopric.
- Notes are visible to everyone with access to the Sheet. Keep them brief and kind.

## One-time setup

1. **Sheet.** Share the "Speaker Planner Data" Google Sheet with the other members of the bishopric
   as **Editors**.
2. **Google sign-in (OAuth client ID).** At <https://console.cloud.google.com>:
   1. Create a project, for example "Bishopric Planner".
   2. Enable the **Google Sheets API**.
   3. Set up the consent screen (Google Auth Platform). Choose an **External** audience and leave the
      publishing status as **Testing**. Add the Google account of **everyone the Sheet is shared
      with** as a **test user**. Anyone not on that list cannot sign in.
   4. Create an **OAuth client**: type **Web application**. Under Authorized JavaScript origins, add
      `https://fin3750-cell.github.io`.
   5. Copy the **Client ID** into `config.js` (`CLIENT_ID`), or paste it on each phone's Settings
      screen. A client ID is not a secret.

   Google's console labels change from time to time, so these steps may be worded slightly
   differently. While the app is in "Testing", Google shows a "Google hasn't verified this app"
   screen at the first sign-in. Choose **Continue**.
3. **GitHub Pages.** In the repository's settings, open **Pages**, set the source to **Deploy from a
   branch**, choose branch `main` and folder `/ (root)`, and save. The app will be at
   `https://fin3750-cell.github.io/bishopric-planner/`. A new version can take up to 10 minutes to appear.
4. **On each phone.** Open the app's address. On **Settings**, paste the Sheet link (and the client
   ID if `config.js` doesn't have it), add your initials, and save. Then choose **Sign in with
   Google**. To install it, use Share → **Add to Home Screen** (iPhone) or **Install app** (Android).

## Using it

- **Ask someone:** on *Who to ask*, tap a name.
  - If they accept, choose the Sunday and tap **Record talk**. A future date schedules the talk, and
    the person moves to *Upcoming*.
  - If they decline, tap **Record decline**.
- **Categories:** tap a name, choose a category and save.
  - *Not now* needs an "until" date. The person comes back on the list on that date.
  - *Do not ask* and *Moved* people never appear on *Who to ask*. To see them, use the Members
    screen's filter.
- **Visitors:** on *History*, add talks by stake leaders, missionaries and other visitors.
- **Mistakes:** **Remove** marks a talk, decline or calling as removed (`void` = TRUE in the Sheet).
  The row stays in the Sheet for history. On a calling's page, **Undo** clears one step's date.
- **A new calling:** tap **Propose a calling** (on the Callings screens or a member's page), then
  choose the member, organization and calling, and who will ask. It then appears under In progress
  and in that person's My tasks.
  - Open it to record each step as it happens.
  - Once it is accepted it shows on the Sunday screen. Tap **Mark checked ones as done** after
    sacrament meeting.
  - After sustaining, record **Set apart** and **Recorded in LCR**.
- **A release:** open the current calling and tap **Start release**. Record when the member is told;
  the release then appears on the Sunday screen. Afterwards, record it in LCR.
- **Monthly:** open the Member List and copy all its text (or save it as a text file). Paste it on
  *Import*, choose **Check list**, review the changes and **Apply**.
  - Everyone already in the Sheet gets their age refreshed.
  - People 8 or older who are new are added, checked as "new to ward". Someone exactly 8 probably
    just turned 8, so they start unchecked.
  - People under 8 are not added.
- **Sign-in:** a Google sign-in lasts about an hour. When it expires, tap **Sign in again** at the top.

## The Sheet

The app finds columns by their header name, so the column order doesn't matter. If a column or tab
it needs is missing, the app adds it when it loads.

| Tab | Columns |
|---|---|
| Members | id, name ("Last, First"), gender, age, age_as_of, source, status (active/moved), notes, category (ask_soon/not_now/do_not_ask), category_until, moved_in, last_in_list |
| Talks | id, date, date_estimated, member_id, member_name, name_as_shown, ward_member, source, entered_by, entered_at, notes, void |
| Refusals | id, date, member_id, member_name, note, entered_by, entered_at, void |
| Callings | id, member_id, member_name, organization, calling, proposed_on, extend_by, extended_on, accepted_on, declined_on, sustained_on, set_apart_by, set_apart_on, record_by, recorded_on, release_proposed_on, release_by, release_informed_on, released_on, release_record_by, release_recorded_on, source, notes, entered_by, entered_at, void |

Each Callings row is one person in one calling, from proposal to release. A later step implies the
earlier ones, so a calling entered as already sustained is not listed as "to ask".

Notes on the data:

- **Imported history:** talks from the old WardBullet list (about Aug 2024 to Nov 2026) have
  `date_estimated` = TRUE. Their dates assume 2 speakers per Sunday, with no talks on the first
  Sunday of a month or on the second Sunday of April and October. The app shows these with "≈" or
  as a month only.
- **Ages** grow by one each year from `age_as_of`. Birthdays aren't known, so an age can be one year
  low for part of the year.

## Development

There is no build step and there are no dependencies: the app is plain HTML, CSS and JavaScript
modules.

- **Unit tests:** `node --test`. These cover the rules (who to ask, dates, import parsing and
  comparison) and use made-up names only.
- **Browser test:** `node tests/e2e/smoke.mjs`. It needs Playwright with Chromium. It signs in to a
  fake Google and a fake in-memory Sheet, then records a talk, a decline and a category, imports a
  list, and checks the layout at 375 px wide.
- **Local preview:** `python3 -m http.server 8000`, then open <http://localhost:8000>. Google sign-in
  only works locally if `http://localhost:8000` is added as an authorized origin.

Layout:

```
index.html, styles.css, app.js     page, styling, start-up and tabs
config.js                          OAuth client ID, app version
sw.js, manifest.webmanifest, icons PWA files
js/auth.js                         Google sign-in (token kept in memory only)
js/sheets.js                       Google Sheets API calls
js/store.js                        tabs as tables of records; adds missing tabs and columns
js/members.js, js/dates.js         pure helpers (tested)
js/views/                          Members, Import and Settings screens
js/features/                       one module per feature (speakers, callings) and its *-logic.js rules
```

### Adding a feature

Create `js/features/<name>.js` exporting `{ id, group, tables, views, memberSections }`, using
`speakers.js` or `callings.js` as the pattern, and add it to `js/features/index.js`.

- `tables` declares the tabs and columns the feature needs. They are created in the Sheet
  automatically.
- `views` adds screens.
- `memberSections` adds sections to a member's page.

Put the feature's rules in a separate pure file with Node tests, as `speakers-logic.js` does. Add
any new files to `SHELL` in `sw.js` and raise the `CACHE` version.

## Roadmap

- **Import current callings from LCR:** load who holds each calling and the date sustained, so time
  in calling is right from the start. It will be built from a real copy of the LCR report.
- **Releases to consider:** an option to highlight callings held longer than a chosen number of years.

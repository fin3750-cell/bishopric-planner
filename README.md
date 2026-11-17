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
  *Shouldn't ask*, *Won't accept*, or status *Moved*.
- **Import:** a fresh member list, compared with the Sheet. New people are flagged "New to ward"
  and people who are no longer listed are flagged as moved, for you to confirm.

Declines are recorded with a date. A decline made after a person's last talk highlights them in
amber on the list. The decline does not hide them.

**Callings**
- **Org chart:** each ward organization with its standard positions and who holds them, then the
  organization's other callings. Positions no one holds show "No one called" in gray, and
  positions the handbook calls only if needed are marked "(optional)". Stake and temple callings,
  and callings the bishopric marked as serving in another unit, are under "Serving outside the ward".
- **Current:** who holds each calling and for how long, counted from the date sustained. Grouped
  by organization, or sorted longest-serving first.
- **In progress:** one screen with a section for each stage of a call, in order, each with a count:
  **Proposed** (no votes yet), **Vote** (votes so far, and who is still to vote), **Bishop
  Approved** (choose who will ask), **Assigned** (being asked), **Sustain** (accepted; where each is
  sustained, from the Sunday rules), **Sustained/LCR Record**, **Releases**, and **Needs set apart**
  last, closed until you open it. Each calling is in one section only. The Assigned section also
  holds the free to-dos ("Other tasks"), with a form anyone can use to add one.
- **Sunday:** business for sacrament meeting. Releases to read come first (once the member has been
  told), then callings to sustain (once accepted). Mark them done for that Sunday in one tap.
- **My tasks:** your votes still to cast, the calls you were assigned to extend (with **Accepted** /
  **Declined**), your to-dos (with a Done box), other steps assigned to you (record in LCR, set
  apart, releases), and to-dos nobody has yet.
- **No calling:** active members (adults, or 12+) with no current or proposed calling.
- **LCR import:** paste the LCR callings report (each calling with its date sustained and Set
  Apart Yes/No), or choose a CSV. You review what will change before it is saved.
- **Sunday:** callings presented in a quorum or Young Women meeting are listed separately from
  sacrament meeting business.

**Bishopric list (Settings).** The people who can be assigned steps, with their initials, name and
role. It's saved in the Sheet's Bishopric tab, so everyone shares one list. **Fill from org chart**
adds the current bishop, counselors and executive secretary from the Callings tab; others can be
added by hand. Once the list exists, "Your initials" and every "Who" box are menus of these names
(plus "Stake" for calling steps), and My tasks shows the name with the initials. Remove sets
`active` = FALSE. **Votes** is checked for everyone who votes on proposed callings; uncheck anyone
who does not (the `votes` column is then FALSE).

The steps tracked for a call are: proposed → each person on the voting list votes (Support or
Don't support) → the bishop approves or does not → someone is chosen to ask → accepted or declined
→ sustained → recorded in LCR → set apart. For a release: decided → member told → released in
sacrament meeting → recorded in LCR. Asking, setting apart, recording in LCR and telling a member
about a release can each be assigned to someone's initials.

The app is built so more features can be added (see [Adding a feature](#adding-a-feature)).

## Privacy and data

- **No member data is in this repository.** Names, ages and talks live only in the shared Google
  Sheet. `.gitignore` blocks data files (CSV, XLSX, PDF, video), but still check before every commit.
- **Who can see the data:** the Sheet's sharing settings decide that. Each person signs in with
  their own Google account, and the app reads and writes the Sheet as that person.
- **What sign-in asks for:** permission for Google Sheets, plus the person's email address. The email
  is used only to recognize who is signed in (matched against the Bishopric tab). If someone declines
  it, they pick their initials in Settings instead.
- **The Sheet's id is in `config.js`** (a public file). The id alone gives no access: Google only lets
  accounts the Sheet is shared with open it.
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
   5. Copy the **Client ID** into `config.js` (`CLIENT_ID`). This is done: the app's client ID is set,
      so nobody needs to paste it in Settings. A client ID is not a secret.

   Google's console labels change from time to time, so these steps may be worded slightly
   differently. While the app is in "Testing", Google shows a "Google hasn't verified this app"
   screen at the first sign-in. Choose **Continue**.
3. **GitHub Pages.** In the repository's settings, open **Pages**, set the source to **Deploy from a
   branch**, choose branch `main` and folder `/ (root)`, and save. The app will be at
   `https://fin3750-cell.github.io/bishopric-planner/`. A new version can take up to 10 minutes to appear.
4. **On each phone.** Open the app's address and choose **Sign in with Google**. The Sheet and the
   client ID are built into the app (`config.js`), so there is nothing to type.
   - **The first time** someone signs in, the app asks **"Which one are you?"** and saves their Google
     account on the Bishopric list. After that it recognizes them on any device and sets their
     initials.
   - **To install it,** use Share → **Add to Home Screen** (iPhone) or **Install app** (Android). On an
     iPhone the home-screen app keeps its own storage, separate from Safari, so sign in from the
     installed app.

## Using it

- **Ask someone:** on *Who to ask*, tap a name.
  - If they accept, choose the Sunday and tap **Record talk**. A future date schedules the talk, and
    the person moves to *Upcoming*.
  - If they decline, tap **Record decline**.
- **Categories:** tap a name, choose a category and save.
  - *Not now* needs an "until" date. The person comes back on the list on that date.
  - *Shouldn't ask* (the bishopric's judgment) and *Won't accept* (they have said no, or are very
    unlikely to) stay on *Who to ask*, grayed at the bottom with their label. *Moved* people never
    appear. To see everyone with a category, use the Members screen's filter.
- **Someone who already spoke:** search on *Who to ask*. Matching people who aren't on the list
  appear under "Also matching, not on the list", with the reason (for example "Spoke 8 Nov 2026" or
  "Scheduled 22 Nov 2026"). Tap one to schedule them anyway.
- **Visitors:** on *History*, add talks by stake leaders, missionaries and other visitors.
- **Mistakes:** **Remove** marks a talk, decline or calling as removed (`void` = TRUE in the Sheet).
  The row stays in the Sheet for history. On a calling's page, **Undo** clears one step's date.
- **A new calling:** tap **Propose a calling** (on the Callings screens or a member's page), then
  choose the member, organization and calling. It appears under **Proposed** on In progress, and
  under "Votes waiting for you" on each voter's My tasks.
  - **Vote:** open it and tap **Support** or **Don't support**. You record only your own vote; tap
    your vote again to clear it. A vote from another phone shows after **Reload data** (Settings).
  - **Bishop approval:** tap **Approved** or **Not approved**. If someone on the voting list has not
    voted, the app asks before recording an approval. Not approved closes the calling.
  - **Who will ask:** under Bishop Approved, choose the person. It moves to Assigned and to that
    person's My tasks, where they tap **Accepted** (it moves to Sustain and the Sunday screen) or
    **Declined** (it closes and stays in the Sheet).
  - Tap **Mark checked ones as done** on the Sunday screen after sacrament meeting.
  - After sustaining, record **Recorded in LCR** and **Set apart** on the calling's page.
- **Other tasks:** under In progress → Assigned, type the task, choose who has it and, if you want,
  a due date, then tap **Add task**. It shows on that person's My tasks; check **Done** when finished.
  Tasks done in the last 30 days are listed under the form, so a box checked by mistake can be
  unchecked.
- **The LCR callings report:** run it in LCR, copy all its text, paste it on **Callings → LCR import**
  and tap **Check report**.
  - New callings are added as sustained and recorded in LCR.
  - "Set apart: Yes" uses the sustained date, because the report has no set-apart date.
  - Callings already in the Sheet only get missing dates filled in, so the same report can be
    imported again safely.
  - A line repeated at a page break is left out unless you check it.
  - Names not in Members are listed and not imported.
  - Current callings missing from the report can be marked released.
  - The organization comes from the calling's name. You can change it on the calling's page.
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
| Members | id, name ("Last, First"), gender, age, age_as_of, source, status (active/moved), notes, category (ask_soon / not_now / do_not_ask = "Shouldn't ask" / wont_accept), category_until, moved_in, last_in_list |
| Talks | id, date, date_estimated, member_id, member_name, name_as_shown, ward_member, source, entered_by, entered_at, notes, void |
| Refusals | id, date, member_id, member_name, note, entered_by, entered_at, void |
| Bishopric | id, initials, name, role, member_id, active, email (Google account, linked at first sign-in), votes (FALSE = does not vote on callings) |
| Callings | id, member_id, member_name, organization, calling, proposed_on, approved_on, approved_by (who recorded the bishop's decision), not_approved_on, extend_by, extended_on, accepted_on, declined_on, sustained_on, set_apart_by, set_apart_on, record_by, recorded_on, release_proposed_on, release_by, release_informed_on, released_on, release_record_by, release_recorded_on, source, notes, entered_by, entered_at, void |
| Votes | id, calling_id, voter (initials), vote (support / oppose), voted_on, entered_at, void |
| Tasks | id, description, assigned_to, due_on, done_on, done_by, entered_by, entered_at, void |

Each Callings row is one person in one calling, from proposal to release. A later step implies the
earlier ones, so a calling entered as already sustained is not listed as needing a vote. Callings
recorded as asked (`extended_on`) before the approval step existed count as approved. Each person
has one Votes row per calling; changing a vote updates that row.

**Handbook guidance.** The organization chart's standard positions, where each calling is sustained
(sacrament meeting, or a quorum or Young Women meeting), and who approves and sets apart each
calling come from the General Handbook, section 30.8.1 "Ward Callings". Sections 8.3.4, 9.3.3,
12.1.3, 13.2.2 and 13.7.2 are also used, for optional secretaries and counselors, the nursery and the
resource center. The sections are cited in `js/features/callings-orgs.js`. They were read on
16 Nov 2026, so check them again if the handbook is updated.

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
js/features/                       one module per feature (speakers, callings), with pure rules in
                                   *-logic.js, callings-orgs.js (handbook) and callings-import.js
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

- **Releases to consider:** an option to highlight callings held longer than a chosen number of years.
- **Monthly callings check:** remind the bishopric to import the LCR callings report and the member
  list.

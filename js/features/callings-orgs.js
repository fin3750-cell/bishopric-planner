// Ward organizations for the organization chart, and handbook guidance for each kind of calling.
//
// Source: General Handbook, chapter 30 "Callings in the Church", section 30.8.1 "Ward Callings"
// (who approves, who sustains, who calls and sets apart), plus 8.3.4 (elders quorum secretary),
// 9.3.3 (Relief Society secretary), 12.1.3 (nursery is part of Primary), 13.2.2 (Sunday School
// counselors and secretary are optional) and 13.7.2 (the Sunday School president oversees the
// resource center). https://www.churchofjesuschrist.org/study/manual/general-handbook — read 16 Nov 2026.
// Section 30.8 also says a ward does not need to fill every calling in the chart.

export const OTHER = 'Other ward callings';
export const OUTSIDE = 'Serving outside the ward';

// Standard positions shown in each box of the chart, even when no one holds them.
// `optional` marks positions the handbook says are called only if needed.
export const ORGS = [
  { name: 'Bishopric', positions: [
    { calling: 'Bishop' }, { calling: 'Bishopric First Counselor' }, { calling: 'Bishopric Second Counselor' },
    { calling: 'Ward Executive Secretary' }, { calling: 'Ward Clerk' }] },
  { name: 'Elders Quorum', positions: [
    { calling: 'Elders Quorum President' }, { calling: 'Elders Quorum First Counselor' }, { calling: 'Elders Quorum Second Counselor' },
    { calling: 'Elders Quorum Secretary', optional: true }] },
  { name: 'Relief Society', positions: [
    { calling: 'Relief Society President' }, { calling: 'Relief Society First Counselor' }, { calling: 'Relief Society Second Counselor' },
    { calling: 'Relief Society Secretary', optional: true }] },
  { name: 'Aaronic Priesthood', positions: [
    { calling: 'Priests Quorum President', note: 'the bishop' }, { calling: 'Priests Quorum First Assistant', optional: true },
    { calling: 'Teachers Quorum President', optional: true }, { calling: 'Deacons Quorum President', optional: true }] },
  { name: 'Young Women', positions: [
    { calling: 'Young Women President' }, { calling: 'Young Women First Counselor' }, { calling: 'Young Women Second Counselor' },
    { calling: 'Young Women Secretary', optional: true }] },
  { name: 'Primary', positions: [
    { calling: 'Primary President' }, { calling: 'Primary First Counselor' }, { calling: 'Primary Second Counselor' },
    { calling: 'Primary Secretary', optional: true }] },
  { name: 'Sunday School', positions: [
    { calling: 'Sunday School President' }, { calling: 'Sunday School First Counselor', optional: true },
    { calling: 'Sunday School Second Counselor', optional: true }, { calling: 'Sunday School Secretary', optional: true }] },
  { name: 'Ward Mission', positions: [{ calling: 'Ward Mission Leader', optional: true }] },
  { name: 'Temple and Family History', positions: [] },
  { name: 'Music', positions: [] },
  { name: 'Welfare and Self-Reliance', positions: [] },
  { name: OTHER, positions: [] },
  { name: OUTSIDE, positions: [] },
];

export const ORG_NAMES = ORGS.map((o) => o.name);

// [pattern, organization, why]. First match wins, so an organization named in the calling
// ("Primary Music Leader") is found before the general Music rule.
const RULES = [
  [/^Stake\b|^Patriarch$/i, OUTSIDE, 'stake calling'],
  [/\bTemple (Worker|Ordinance Worker|Sealer|Presidency)\b|^Saint George Temple\b|\bMatron\b/i, OUTSIDE, 'temple calling'],
  [/^(Bishop|Bishopric .+|Ward (Assistant )?Clerk.*|Ward (Assistant )?Executive Secretary)$/i, 'Bishopric', 'calling name'],
  [/^Elders Quorum\b/i, 'Elders Quorum', 'calling name'],
  [/^Relief Society\b/i, 'Relief Society', 'calling name'],
  [/^Young Women\b/i, 'Young Women', 'calling name'],
  [/^(Priests|Teachers|Deacons) Quorum\b|^Aaronic Priesthood\b/i, 'Aaronic Priesthood', 'calling name'],
  [/^Primary\b/i, 'Primary', 'calling name'],
  [/^Nursery\b/i, 'Primary', 'handbook 12.1.3'],
  [/^(Valiant|Activities Day)\b/i, 'Primary', 'bishopric choice'],
  [/^Sunday School\b/i, 'Sunday School', 'calling name'],
  [/^Resource Center\b/i, 'Sunday School', 'handbook 13.7.2'],
  [/^Ward Mission(ary| Leader)\b/i, 'Ward Mission', 'calling name'],
  [/^Ward Temple and Family History\b/i, 'Temple and Family History', 'calling name'],
  [/^Welfare and Self-Reliance\b/i, 'Welfare and Self-Reliance', 'calling name'],
  [/\bMusic\b|^Choir\b|\bOrganist\b|\bChorister\b/i, 'Music', 'calling name'],
];

export function organizationFor(calling) {
  const name = String(calling || '').trim();
  for (const [re, org, why] of RULES) if (re.test(name)) return { organization: org, why };
  return { organization: OTHER, why: 'not identified; change it if needed' };
}

const isPresident = (c) => /^(Relief Society|Young Women|Primary|Sunday School) President$/i.test(c);
const isOrgCounselor = (c) => /^(Relief Society|Young Women|Primary|Sunday School) (First|Second) Counselor$/i.test(c);

// Where a call or release is presented, per 30.8.1 "Sustained by":
//   sacrament: ward members, in sacrament meeting
//   quorum:    quorum members, in a quorum meeting
//   class:     Young Women age-group members, in a Young Women meeting
//   outside:   a stake or temple calling, not sustained in the ward
export function sustainedIn(calling, organization) {
  const c = String(calling || '').trim();
  if (organization === OUTSIDE || organizationFor(c).organization === OUTSIDE) return 'outside';
  if (/^Elders Quorum\b/i.test(c) && !/^Elders Quorum (President|First Counselor|Second Counselor)$/i.test(c)) return 'quorum';
  if (/^Priests Quorum (First|Second) Assistant$/i.test(c)) return 'quorum';
  if (/^(Teachers|Deacons) Quorum (President|First Counselor|Second Counselor|Secretary)$/i.test(c)) return 'quorum';
  if (/^Young Women\b.*\b(Class|Age[- ]?Group)\b.*\b(President|Counselor|Secretary)\b/i.test(c)) return 'class';
  return 'sacrament';
}

export const SUSTAINED_IN_TEXT = {
  sacrament: 'Sustained by ward members in sacrament meeting',
  quorum: 'Presented to quorum members in a quorum meeting',
  class: 'Presented to the age group in a Young Women meeting',
  outside: 'A stake or temple calling, not sustained in the ward',
};

// Approved by / called and set apart by, per 30.8.1. Empty for callings outside the ward.
export function handbookFor(calling, organization) {
  const c = String(calling || '').trim();
  const outside = organization === OUTSIDE || organizationFor(c).organization === OUTSIDE;
  if (outside) return { approvedBy: '', setApartBy: '', sustained: SUSTAINED_IN_TEXT.outside };
  let approvedBy = 'Bishopric';
  let setApartBy = 'Bishop or an assigned counselor';
  if (/^Bishop$/i.test(c)) { approvedBy = 'First Presidency and Quorum of the Twelve'; setApartBy = 'Stake president'; }
  else if (/^Bishopric (First|Second) Counselor$/i.test(c)) { approvedBy = 'Stake presidency and high council'; setApartBy = 'Stake president or an assigned counselor'; }
  else if (/^Ward (Assistant )?(Clerk|Executive Secretary)\b/i.test(c)) { approvedBy = 'Stake presidency and high council'; setApartBy = 'Stake president, an assigned counselor or a high councilor'; }
  else if (/^Elders Quorum President$/i.test(c)) { approvedBy = 'Stake presidency and high council'; setApartBy = 'Stake president'; }
  else if (/^Elders Quorum (First|Second) Counselor$/i.test(c)) { approvedBy = 'Stake presidency and high council'; setApartBy = 'Stake president, an assigned counselor or a high councilor'; }
  else if (/^Elders Quorum\b/i.test(c)) { setApartBy = 'Elders quorum president or an assigned counselor'; }
  else if (isPresident(c)) { setApartBy = 'Bishop'; }
  else if (isOrgCounselor(c)) { setApartBy = 'Bishop or an assigned counselor'; }
  else if (/^Priests Quorum (First|Second) Assistant$/i.test(c) || /^(Teachers|Deacons) Quorum President$/i.test(c)) { setApartBy = 'Bishop'; }
  return { approvedBy, setApartBy, sustained: SUSTAINED_IN_TEXT[sustainedIn(c, organization)] };
}

// True when the stake, not the ward bishopric, sets the person apart (so it is not a ward task).
export function setApartByStake(calling, organization) {
  return /^Stake president/.test(handbookFor(calling, organization).setApartBy);
}

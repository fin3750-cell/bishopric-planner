// Made-up stake Sheet laid out like the real one (title rows, header rows, notes). Fake names and phones.
export const T = (h, m = 0) => (h * 60 + m) / 1440;   // a time as the Sheets API returns it (fraction of a day)

export const STAKE_TABS = [
  { title: 'Stake - EXAMPLE STAKE PRESIDENCY', rows: [
    ['2027 EXAMPLE STAKE PRESIDENCY & HIGH COUNCIL'], [], [],
    ['NAME', 'CALLING', 'ADDRESS', 'CELL NUMBER', 'EMAIL ADDRESS', 'ASSIGNED WARD', 'ASSIGNMENT', 'KEY'],
    ['President Orrin Quillfeather', 'Stake President', '1 Example St', '555-010-0001', 'oq@example.invalid', '', 'Reporting', 'S'],
    ['Bram Thistlewood', 'High Council', '2 Example St', '555-010-0002', 'bt@example.invalid', 'Example 6th', 'Young Men', 'A'],
    ['Corin Copperpot', 'High Council', '3 Example St', '555-010-0003', '', 'Example 1st', 'Primary', 'M'],
    [], ['Missionaries', 'Missionaries', 'Elders', '555-010-0009'],
    ['Example Stake Theme', 'A verse that is much longer than any calling name would ever be, so it is not a person.', '', 'OR'],
    ['Updated 10-25-2026'],
  ] },
  { title: 'Bishops - EXAMPLE STAKE BISHOPS', rows: [
    ['Bishops'], [], [], ['NAME', 'WARD', 'ADDRESS', '', 'CELL NUMBER', 'EMAIL ADDRESS', 'BUILDING'],
    ['Lark Brambleton', 'EX-6', '4 Example St', '', '555-010-0004', 'lb@example.invalid', 'SC'],
    ['Key for Buildings'], ['SC', 'Stake Center'],
  ] },
  { title: '2027 Stake Chrono Calendar', rows: [
    ['2027 Stake Chrono Calendar'], [], ['Updated 10-25-26'], ['Month', 'Day', 'Time', 'Event', 'Notes'],
    ['January'],
    ['', '2 (Sat)', T(10), 'Stake Baptisms'],
    ['', '13 (Wed)', T(19), 'RR - Ward Conference Training Meeting'],
    ['', '17 (Sun)', '7:00 PM', 'EX6 - Ward Conference', 'Our ward'],
    ['', '20 (Thu)', T(18), 'YSA - Dance'],                // Jan 20 2027 is a Wednesday: reported, date kept
    ['', 'TBD', T(9), 'Leadership meeting'],                // no day: reported, left out
    ['April'],
    ['', '4 (Sun)', T(10), 'General Conference'],
  ] },
  { title: 'HC Speaking Assignments - 2027', rows: [
    ['2027 HIGH COUNCIL SPEAKING ASSIGNMENTS'], [], [],
    ['NAME', 'CELL NUMBER', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
    ['Bram Thistlewood', '555-010-0002', '', 'EX6', 'EX1'],
    ['Corin Copperpot', '555-010-0003', '', 'EX1', 'EX6'],
    [], ['February –  Stake Theme'], ['March – Faith in Christ'],
    ['NO HC SPEAKING ASSIGNMENTS IN: January'], ['NOTES:'], ['EX1 = Example 1st'], ['EX6 = Example 6th'], ['RR = River Example'],
  ] },
  { title: 'Hospital Blessings -- Ward Assignments 2027', rows: [
    ['Example Stake Hospital Blessing Schedule'], [], ['2027 // WARD // MONTH // YEAR'],
    ['', '', 2027, '', '', '', '', '', '', '', '', '', '', '', 2028],
    ['NAME (Elders Quorum President)', 'CELL NUMBER', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC', 'JAN', 'FEB'],
    ['Ivo Marchbank -- EX6th', '555-010-0005', '', '', 'EX6', '', '', '', '', '', '', '', '', '', 'EX6'],
    ['Pell Ashgrove -- EX1st', '555-010-0006', '', '', '', 'EX1'],
  ] },
  { title: 'Coral Desert Sacrament Assignments', rows: [
    ['2027 Example Rehab Sacrament Administration Schedule'], [], [],
    ['BISHOP', 'WARD', 'ADDRESS', 'CELL', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
    ['Lark Brambleton', 'EX-6', '4 Example St', '555-010-0004', '', '', 'X', '', '', '', '', '', '', '', 'X'],
    ['Someone Else', 'EX-1', '5 Example St', '555-010-0007', 'X'],
  ] },
  { title: 'Stake Callings - EXAMPLE STAKE', rows: [
    ['2027 EXAMPLE STAKE ORGANIZATION CALLINGS'], [], [], ['NAME', 'CALLING', 'CELL NUMBER', 'EMAIL ADDRESS'],
    ['Wren Halloway', 'Primary President', '555-010-0008', 'wh@example.invalid'],
  ] },
];

// Organization chart: each ward organization with its standard positions (from the General Handbook,
// see callings-orgs.js) and everyone currently serving or in the middle of being called.

import { normName } from '../members.js';
import { h, add } from '../ui.js';
import { ORGS, ORG_NAMES, OTHER, OUTSIDE } from './callings-orgs.js';
import { pendingLabel, isCurrent, isPending, tenureMonths, formatTenure } from './callings-logic.js';

function holderButton(c, today, openCalling, ctx) {
  return h('button', { class: 'holder', onclick: () => openCalling(c.id, ctx) },
    h('span', { class: 'holder-name', text: c.member_name }),
    isPending(c) ? h('span', { class: 'badge new', text: pendingLabel(c) }) : null,
    isCurrent(c) && c.sustained_on ? h('span', { class: 'meta', text: formatTenure(tenureMonths(c, today)) }) : null);
}

export function renderOrgChart(root, ctx, { openCalling }) {
  const today = ctx.today();
  const active = ctx.store.records('Callings').filter((c) => isCurrent(c) || isPending(c));
  const byOrg = new Map();
  for (const c of active) {
    const org = c.organization || OTHER;
    if (!byOrg.has(org)) byOrg.set(org, []);
    byOrg.get(org).push(c);
  }
  // Organizations typed by hand that are not in the standard list go just before "Other ward callings".
  const extra = [...byOrg.keys()].filter((o) => !ORG_NAMES.includes(o)).sort();
  const orgs = [...ORGS.filter((o) => o.name !== OTHER && o.name !== OUTSIDE),
    ...extra.map((name) => ({ name, positions: [] })),
    ...ORGS.filter((o) => o.name === OTHER || o.name === OUTSIDE)];

  add(root, h('p', { class: 'hint', text: 'Standard positions come from the General Handbook (30.8 and chapters 8–13). "No one called" is shown in gray: the handbook says a ward does not need to fill every calling, and positions marked optional are called only if needed. Tap a name to open the calling.' }));
  if (!active.length) {
    add(root, h('p', { class: 'empty', text: 'No callings yet. Import the LCR callings report (LCR import) or propose a calling.' }));
  }
  for (const org of orgs) {
    const list = (byOrg.get(org.name) || []).slice().sort((a, b) => a.member_name.localeCompare(b.member_name));
    if (!list.length && !org.positions.length) continue;
    const taken = new Set();
    const rows = org.positions.map((p) => {
      const holders = list.filter((c) => normName(c.calling) === normName(p.calling));
      holders.forEach((c) => taken.add(c.id));
      return h('li', { class: 'pos' },
        h('span', { class: 'pos-title', text: `${p.calling}${p.note ? ` (${p.note})` : ''}` }),
        holders.length
          ? h('span', { class: 'holders' }, holders.map((c) => holderButton(c, today, openCalling, ctx)))
          : h('span', { class: 'vacant', text: p.optional ? 'No one called (optional)' : 'No one called' }));
    });
    const others = new Map();
    for (const c of list) {
      if (taken.has(c.id)) continue;
      if (!others.has(c.calling)) others.set(c.calling, []);
      others.get(c.calling).push(c);
    }
    const otherRows = [...others.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([calling, cs]) =>
      h('li', { class: 'pos' },
        h('span', { class: 'pos-title', text: cs.length > 1 ? `${calling} (${cs.length})` : calling }),
        h('span', { class: 'holders' }, cs.map((c) => holderButton(c, today, openCalling, ctx)))));
    const body = [h('ul', { class: 'positions' }, rows, otherRows)];
    const title = `${org.name} · ${list.length}`;
    if (org.name === OUTSIDE) {
      add(root, h('details', { class: 'panel org' }, h('summary', { text: title }),
        h('p', { class: 'hint', text: 'Stake and temple callings, and callings the bishopric marked as serving in another unit. They count as a calling on "No calling", but are not sustained in this ward.' }), body));
    } else {
      add(root, h('section', { class: 'panel org' }, h('h3', { class: 'org-title', text: title }), body));
    }
  }
}

// Monthly update email (Calendar > "<ward> Update Email"), for the bishopric only (no `limited`
// flag). It drafts the ward email for a month: the bishopric's short message, the month's topics
// (theme, Sunday lessons, sacrament meeting talks) and the ward and stake calendar items. The app
// sends nothing: the subject and the text are copied into the ward's own email.
// The topics come from the bishopric's topics document, pasted here once per batch of months and
// saved in the Sheet's Topics tab. Pasting months again replaces those months (old rows marked void).

import { addMonths } from '../dates.js';
import { makeId } from '../members.js';
import { h, add, clear, field, select, busy, toast } from '../ui.js';
import { calendarItems } from './calendar-logic.js';
import { stakeId, stakeData, loadStake, wardNames, monthEnd } from './calendar.js';
import { TOPIC_COLUMNS, parseTopics, topicRows, topicsFor, topicMonths, monthLabel, defaultEmailMonth, emailDraft } from './email-logic.js';

const view = { month: '', message: '', paste: '' };

function wardCode(ctx) { return wardNames(ctx)[0] || ''; }
function emailLabel(ctx) { return `${wardCode(ctx) ? `${wardCode(ctx)} ` : ''}Update Email`; }

function copyButton(label, getText, what) {
  const btn = h('button', { class: 'small', text: label });
  btn.addEventListener('click', () => {
    const text = getText();
    const done = () => toast(`Copied the ${what}`);
    const fail = () => toast(`Select the ${what} and copy it from the box.`, 'error');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fail);
    else fail();
  });
  return btn;
}

function renderEmail(root, ctx) {
  const today = ctx.today();
  if (!view.month) view.month = defaultEmailMonth(today);
  const topicRowsAll = ctx.store.records('Topics');
  const months = [...new Set([0, 1, 2].map((i) => addMonths(`${today.slice(0, 7)}-01`, i).slice(0, 7)).concat(view.month))].sort();
  const monthSel = select(months.map((m) => ({ value: m, label: monthLabel(m) })), view.month, { 'aria-label': 'Email month' });
  monthSel.addEventListener('change', () => { view.month = monthSel.value; ctx.refresh(); });

  const message = h('textarea', { rows: 4, 'aria-label': 'Short message', placeholder: 'A short message from the bishopric (it goes at the top)' });
  message.value = view.message;
  const out = h('div');
  message.addEventListener('input', () => { view.message = message.value; draw(); });

  // The stake calendar is read the same way as on the Calendar screen.
  let stakeNote = null;
  if (stakeId(ctx) && !stakeData(ctx)) { loadStake(ctx); stakeNote = h('p', { class: 'summary', text: 'Reading the stake Sheet… stake events will appear when it is read.' }); }

  add(root,
    h('p', { class: 'hint', text: 'A draft of the monthly email to the ward. Pick the month, write a short message, then copy the subject and the text into your email. Nothing is sent from here.' }),
    h('div', { class: 'toolbar' }, field('Month', monthSel)),
    field('Short message', message),
    stakeNote,
    out,
    topicsSection(ctx, topicRowsAll));
  draw();

  function draw() {
    clear(out);
    const [y, m] = view.month.split('-').map(Number);
    const from = `${view.month}-01`;
    const items = calendarItems({ from, to: monthEnd(y, m), stake: stakeData(ctx), events: ctx.store.records('Events') });
    const topics = topicsFor(topicRowsAll, view.month);
    const draft = emailDraft({ ward: wardCode(ctx), month: view.month, message: view.message, topics, items });
    const subject = h('input', { type: 'text', readonly: true, value: draft.subject, 'aria-label': 'Email subject' });
    const body = h('textarea', { readonly: true, rows: Math.min(40, Math.max(8, Math.round(draft.body.split('\n').length * 1.6))), 'aria-label': 'Email text' });
    body.value = draft.body;
    add(out,
      topics ? null : h('p', { class: 'error', text: `No topics saved for ${monthLabel(view.month)}. Paste the topics document under "Monthly topics" below.` }),
      h('div', { class: 'email-line' }, field('Subject', subject), copyButton('Copy subject', () => draft.subject, 'subject')),
      field('Email text', body),
      h('div', { class: 'toolbar' }, copyButton('Copy email text', () => draft.body, 'email text')));
  }
}

// Paste the topics document, check what was read, save it.
function topicsSection(ctx, rows) {
  const saved = topicMonths(rows);
  const det = h('details', { class: 'panel' });
  det.open = !saved.length || Boolean(view.paste);
  const box = h('textarea', { rows: 6, 'aria-label': 'Topics document text', placeholder: 'Paste the whole topics document here' });
  box.value = view.paste;
  const result = h('div');
  const read = h('button', { class: 'secondary', text: 'Read topics' });
  read.addEventListener('click', () => { view.paste = box.value; show(); });
  add(det,
    h('summary', { text: saved.length ? `Monthly topics: ${monthLabel(saved[0])} to ${monthLabel(saved[saved.length - 1])} saved` : 'Monthly topics: none saved yet' }),
    h('p', { class: 'hint', text: 'Open the topics document in Google Docs, select all, copy, paste it here and tap Read topics. Months already saved are replaced by the new ones.' }),
    box, h('div', { class: 'toolbar' }, read), result);
  if (view.paste) show();
  return det;

  function show() {
    clear(result);
    const p = parseTopics(view.paste);
    const save = h('button', { text: `Save ${p.months.length} ${p.months.length === 1 ? 'month' : 'months'}`, disabled: !p.months.length });
    save.addEventListener('click', () => busy(save, async () => {
      const replaced = rows.filter((r) => String(r.void).toUpperCase() !== 'TRUE' && p.months.some((m) => m.month === String(r.month)));
      if (replaced.length) await ctx.store.update('Topics', replaced.map((r) => ({ id: r.id, fields: { void: true } })));
      await ctx.store.add('Topics', topicRows(p.months, makeId, { entered_by: ctx.who(), entered_at: ctx.stamp() }));
      toast(`Saved topics for ${p.months.length} ${p.months.length === 1 ? 'month' : 'months'}`);
      view.paste = '';
      ctx.refresh();
    }).catch(() => {}));
    add(result,
      p.problems.length ? h('ul', { class: 'plain error' }, p.problems.map((t) => h('li', { text: t }))) : null,
      p.months.length ? h('ul', { class: 'rows' }, p.months.map((m) => h('li', { class: 'row' },
        h('span', {}, h('strong', { text: monthLabel(m.month) }), ` · ${m.theme}`,
          h('span', { class: 'meta small', text: ` · ${m.lessons.length} Sundays, ${m.talks.length} sacrament talks` }))))) : null,
      h('div', { class: 'toolbar' }, save));
  }
}

export const emailFeature = {
  id: 'email',
  group: 'Calendar',
  tables: { Topics: { columns: TOPIC_COLUMNS, dates: ['date'] } },
  views: [{ id: 'email', label: emailLabel, title: (ctx) => `${emailLabel(ctx)}: ${monthLabel(view.month || defaultEmailMonth(ctx.today()))}`, render: renderEmail }],
};

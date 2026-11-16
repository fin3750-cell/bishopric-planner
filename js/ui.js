// Small DOM helpers. Text is always set with textContent, never innerHTML, so a name or note
// from the Sheet can never run as code in the page.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  return add(el, children);
}

// Appends children to an element: nested lists are unpacked and null/undefined/false are skipped.
// Use this instead of the browser's el.append(), which would print them as text.
export function add(el, ...children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

let toastTimer = null;
export function toast(message, kind = 'info') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, kind === 'error' ? 7000 : 3000);
}

// Opens the shared <dialog>. `build(close)` returns the dialog's content.
export function openDialog(title, build) {
  const dlg = document.getElementById('dlg');
  const close = () => { if (dlg.open) dlg.close(); };
  clear(dlg).append(
    h('div', { class: 'dlg-head' },
      h('h2', { text: title }),
      h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close, text: '×' })),
    h('div', { class: 'dlg-body' }, build(close)),
  );
  if (!dlg.open) dlg.showModal();
  return close;
}

// Runs an async save, disabling the button meanwhile and reporting errors.
export async function busy(button, fn) {
  const label = button ? button.textContent : '';
  if (button) { button.disabled = true; button.textContent = 'Saving…'; }
  try {
    return await fn();
  } catch (e) {
    toast(e.message || String(e), 'error');
    throw e;
  } finally {
    if (button) { button.disabled = false; button.textContent = label; }
  }
}

export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label', text: label }), input,
    hint ? h('span', { class: 'hint', text: hint }) : null);
}

export function select(options, value, attrs = {}) {
  return h('select', attrs, options.map((o) => h('option', { value: o.value, selected: o.value === value, text: o.label })));
}

'use strict';
/* CV admin: a small schema-driven editor. To add a field to a built-in section, add it to the
   matching `fields` list below (and to lib/cvstore.js sanitize + public/app.js render). To add
   a brand-new block without touching code, use the "Custom sections" tab. */

function h(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k);
  return n;
}

const app = document.getElementById('app');
const state = { cv: null, csrf: null, user: null, tab: 'basics', dirty: false, status: '', statusKind: '', errors: null };
const BUILTIN_NAMES = { profile: 'Professional Profile', experience: 'Experience', skills: 'Skills', projects: 'Projects', education: 'Education', languages: 'Languages' };

async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (state.csrf && method !== 'GET') opts.headers['X-CSRF-Token'] = state.csrf;
  if (body instanceof Blob) { opts.headers['Content-Type'] = body.type; opts.body = body; }
  else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(url, opts);
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) throw Object.assign(new Error((data && data.error) || res.statusText), { status: res.status, data });
  return data;
}

function ensure(cv) {
  for (const k of ['highlights', 'skills', 'experience', 'projects', 'education', 'languages', 'customSections', 'layout']) if (!Array.isArray(cv[k])) cv[k] = [];
  cv.settings = Object.assign({ showHighlights: true, photoInPdf: false }, cv.settings);
  for (const k of ['name', 'title', 'tagline', 'location', 'email', 'phone', 'linkedin', 'github', 'rightToWork', 'profile', 'photo']) if (typeof cv[k] !== 'string') cv[k] = '';
  return cv;
}

const touch = () => { state.dirty = true; if (state.status) { state.status = ''; paintStatus(); } };
const refresh = () => { const y = window.scrollY; renderEditor(); window.scrollTo(0, y); };
const move = (list, i, d) => { const j = i + d; if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; touch(); refresh(); };
const rid = () => 'x-' + Math.random().toString(16).slice(2, 10);

// ---------- generic field renderer ----------
function errFor(path) { return state.errors && state.errors[path] ? h('span', { class: 'err' }, state.errors[path]) : null; }

function renderField(o, f, path) {
  const bind = el => { el.value = o[f.key] ?? ''; el.addEventListener('input', () => { o[f.key] = el.value; touch(); }); return el; };
  switch (f.type) {
    case 'text': case 'url': case 'email':
      return h('label', { class: 'f' }, f.label, bind(h('input', { type: 'text', placeholder: f.placeholder || '' })), errFor(path));
    case 'textarea':
      return h('label', { class: 'f' }, f.label, bind(h('textarea', { rows: f.rows || 4 })), errFor(path));
    case 'bool': {
      const cb = h('input', { type: 'checkbox' }); cb.checked = !!o[f.key];
      cb.addEventListener('change', () => { o[f.key] = cb.checked; touch(); });
      return h('label', { class: 'check' }, cb, f.label);
    }
    case 'select': {
      const sel = h('select', {}, f.options.map(([v, t]) => h('option', { value: v }, t)));
      sel.value = o[f.key]; sel.addEventListener('change', () => { o[f.key] = sel.value; touch(); refresh(); });
      return h('label', { class: 'f' }, f.label, sel);
    }
    case 'strings': {
      const list = (o[f.key] = o[f.key] || []);
      return h('div', { class: 'list' }, h('p', { class: 'group-title' }, f.label),
        list.map((v, i) => {
          const input = f.long ? h('textarea', { rows: 2 }) : h('input', { type: 'text' });
          input.value = v; input.addEventListener('input', () => { list[i] = input.value; touch(); });
          return h('div', { class: 'row' }, input,
            h('button', { class: 'btn sm', type: 'button', title: 'Move up', onclick: () => move(list, i, -1) }, '↑'),
            h('button', { class: 'btn sm', type: 'button', title: 'Move down', onclick: () => move(list, i, 1) }, '↓'),
            h('button', { class: 'btn sm danger', type: 'button', title: 'Remove', onclick: () => { list.splice(i, 1); touch(); refresh(); } }, '✕'));
        }),
        h('button', { class: 'btn sm add', type: 'button', onclick: () => { list.push(''); touch(); refresh(); } }, `+ Add ${f.itemName || 'item'}`));
    }
    case 'array': {
      const list = (o[f.key] = o[f.key] || []);
      return h('div', { class: 'list' }, f.label && h('p', { class: 'group-title' }, f.label),
        list.length === 0 && h('p', { class: 'empty' }, 'Nothing here yet.'),
        list.map((item, i) => h('div', { class: 'item' },
          h('div', { class: 'item-head' }, h('strong', {}, (f.itemTitle && f.itemTitle(item)) || `${f.itemName} ${i + 1}`),
            h('button', { class: 'btn sm', type: 'button', onclick: () => move(list, i, -1) }, '↑'),
            h('button', { class: 'btn sm', type: 'button', onclick: () => move(list, i, 1) }, '↓'),
            h('button', { class: 'btn sm danger', type: 'button', onclick: () => { if (confirm('Remove this item?')) { list.splice(i, 1); touch(); refresh(); } } }, 'Remove')),
          renderFields(item, f.fields, `${path}.${i}`))),
        h('button', { class: 'btn add', type: 'button', onclick: () => { list.push(f.blank()); touch(); refresh(); } }, `+ Add ${f.itemName}`));
    }
  }
  return null;
}

function renderFields(o, fields, path = '') {
  return h('div', { class: 'fields' }, fields.filter(f => !f.showIf || f.showIf(o)).map(f => renderField(o, f, path ? `${path}.${f.key}` : f.key)));
}

// ---------- schemas ----------
const T = (key, label, extra) => ({ key, label, type: 'text', ...extra });
const FIELDS = {
  basics: [T('name', 'Full name'), T('title', 'Job title'), T('tagline', 'Tagline (skills summary)'), T('location', 'Location'),
    T('email', 'Email'), T('phone', 'Phone'), T('linkedin', 'LinkedIn URL'), T('github', 'GitHub URL or username', { placeholder: 'github.com/username' }), T('rightToWork', 'Right-to-work statement')],
  experience: [{
    key: 'experience', type: 'array', itemName: 'job', itemTitle: j => [j.role, j.company].filter(Boolean).join(' — '),
    blank: () => ({ role: '', company: '', location: '', period: '', bullets: [] }),
    fields: [T('role', 'Role'), T('company', 'Company'), T('location', 'Location'), T('period', 'Period', { placeholder: '01/2025 – Present' }),
      { key: 'bullets', label: 'Achievements / responsibilities', type: 'strings', long: true, itemName: 'bullet' }]
  }],
  skills: [{
    key: 'skills', type: 'array', itemName: 'skill group', itemTitle: s => s.group,
    blank: () => ({ group: '', items: [] }),
    fields: [T('group', 'Group name'), { key: 'items', label: 'Skills', type: 'strings', itemName: 'skill' }]
  }],
  projects: [{
    key: 'projects', type: 'array', itemName: 'project', itemTitle: p => p.name,
    blank: () => ({ name: '', stack: [], description: '', link: '' }),
    fields: [T('name', 'Project name'), { key: 'stack', label: 'Tech stack', type: 'strings', itemName: 'technology' },
      { key: 'description', label: 'Description', type: 'textarea', rows: 3 }, T('link', 'Link (optional)')]
  }],
  education: [{
    key: 'education', type: 'array', itemName: 'qualification', itemTitle: e => e.title,
    blank: () => ({ title: '', institution: '', year: '' }),
    fields: [T('title', 'Qualification'), T('institution', 'Institution'), T('year', 'Year')]
  }],
  languages: [{
    key: 'languages', type: 'array', itemName: 'language', itemTitle: l => l.name,
    blank: () => ({ name: '', level: '' }), fields: [T('name', 'Language'), T('level', 'Level')]
  }],
  custom: [{
    key: 'customSections', type: 'array', itemName: 'section', itemTitle: s => s.title,
    blank: () => ({ id: rid(), title: 'New section', kind: 'text', text: '', bullets: [], entries: [] }),
    fields: [T('title', 'Section title'),
      { key: 'kind', label: 'Layout', type: 'select', options: [['text', 'Paragraph'], ['bullets', 'Bullet list'], ['entries', 'Entries (title, subtitle, period, bullets)']] },
      { key: 'text', label: 'Text', type: 'textarea', rows: 5, showIf: s => s.kind === 'text' },
      { key: 'bullets', label: 'Bullets', type: 'strings', long: true, itemName: 'bullet', showIf: s => s.kind === 'bullets' },
      { key: 'entries', type: 'array', itemName: 'entry', itemTitle: e => e.title, showIf: s => s.kind === 'entries',
        blank: () => ({ title: '', subtitle: '', period: '', description: '', link: '', bullets: [] }),
        fields: [T('title', 'Title'), T('subtitle', 'Subtitle'), T('period', 'Period / date'),
          { key: 'description', label: 'Description', type: 'textarea', rows: 3 }, T('link', 'Link (optional)'),
          { key: 'bullets', label: 'Bullets', type: 'strings', long: true, itemName: 'bullet' }] }]
  }]
};

// ---------- tabs ----------
function panel(title, hint, ...body) { return h('div', { class: 'panel' }, h('h2', {}, title), hint && h('p', { class: 'hint' }, hint), ...body); }

function photoBlock() {
  const cv = state.cv;
  const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true });
  file.addEventListener('change', async () => {
    const f = file.files[0]; if (!f) return;
    try { cv.photo = (await api('POST', '/api/admin/photo', f)).photo; setStatus('Photo uploaded ✓', 'ok'); refresh(); } catch (e) { setStatus(e.message, 'bad'); }
  });
  return h('div', { class: 'photo' },
    cv.photo ? h('img', { src: cv.photo, alt: 'Profile photo' }) : h('div', { class: 'empty' }, 'No photo'),
    h('div', {}, h('button', { class: 'btn', type: 'button', onclick: () => file.click() }, cv.photo ? 'Replace photo' : 'Upload photo'), ' ',
      cv.photo && h('button', { class: 'btn danger', type: 'button', onclick: async () => { try { await api('DELETE', '/api/admin/photo'); cv.photo = ''; refresh(); } catch (e) { setStatus(e.message, 'bad'); } } }, 'Remove'),
      h('p', { class: 'hint' }, 'JPEG, PNG or WebP, up to 2 MB. Uploads apply immediately.')), file);
}

function layoutTab() {
  const cv = state.cv;
  const ids = [...Object.keys(BUILTIN_NAMES), ...cv.customSections.map(s => s.id)];
  cv.layout = cv.layout.filter(l => ids.includes(l.id));
  for (const id of ids) if (!cv.layout.some(l => l.id === id)) cv.layout.push({ id, visible: true, title: '' });
  const name = id => BUILTIN_NAMES[id] || (cv.customSections.find(s => s.id === id) || {}).title || id;
  return panel('Layout', 'Choose which sections appear on the website and in the PDF, their order, and optionally rename them.',
    cv.layout.map((l, i) => {
      const cb = h('input', { type: 'checkbox' }); cb.checked = l.visible; cb.addEventListener('change', () => { l.visible = cb.checked; touch(); });
      const t = h('input', { type: 'text', placeholder: name(l.id) }); t.value = l.title; t.addEventListener('input', () => { l.title = t.value; touch(); });
      return h('div', { class: 'layout-row' }, cb, h('strong', {}, name(l.id)), t,
        h('span', {}, h('button', { class: 'btn sm', type: 'button', onclick: () => move(cv.layout, i, -1) }, '↑'), ' ', h('button', { class: 'btn sm', type: 'button', onclick: () => move(cv.layout, i, 1) }, '↓')));
    }));
}

function messagesTab() {
  const box = h('div', {}, h('p', { class: 'empty' }, 'Loading…'));
  api('GET', '/api/admin/messages').then(list => {
    box.replaceChildren(...(list.length ? list.map(m => h('div', { class: 'msg' },
      h('header', {}, h('strong', {}, m.name), h('a', { href: `mailto:${m.email}` }, m.email), h('span', {}, new Date(m.receivedAt).toLocaleString('en-GB'))),
      h('p', {}, m.message),
      h('button', { class: 'btn sm danger', type: 'button', onclick: async () => { if (!confirm('Delete this message?')) return; await api('DELETE', `/api/admin/messages/${m.id}`); refresh(); } }, 'Delete'))) : [h('p', { class: 'empty' }, 'No messages yet.')]));
  }).catch(e => box.replaceChildren(h('p', { class: 'err' }, e.message)));
  return panel('Contact messages', 'Messages sent through the contact form on the public site.', box);
}

function historyTab() {
  const box = h('div', {}, h('p', { class: 'empty' }, 'Loading…'));
  api('GET', '/api/admin/versions').then(list => {
    box.replaceChildren(...(list.length ? list.map(v => h('div', { class: 'layout-row', style: 'grid-template-columns:1fr auto' },
      h('span', {}, new Date(v.savedAt).toLocaleString('en-GB'), ' ', h('span', { class: 'empty' }, `(${(v.size / 1024).toFixed(1)} KB)`)),
      h('button', { class: 'btn sm', type: 'button', onclick: async () => {
        if (state.dirty && !confirm('You have unsaved changes that will be lost. Restore anyway?')) return;
        if (!confirm('Restore this version? The current one is kept in history.')) return;
        try { state.cv = ensure(await api('POST', `/api/admin/versions/${encodeURIComponent(v.id)}/restore`)); state.dirty = false; setStatus('Version restored ✓', 'ok'); refresh(); } catch (e) { setStatus(e.message, 'bad'); }
      } }, 'Restore'))) : [h('p', { class: 'empty' }, 'No earlier versions yet — one is saved each time you save changes.')]));
  }).catch(e => box.replaceChildren(h('p', { class: 'err' }, e.message)));
  const imp = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  imp.addEventListener('change', async () => {
    try { state.cv = ensure(JSON.parse(await imp.files[0].text())); touch(); setStatus('Imported — review the tabs, then press Save.', 'ok'); refresh(); } catch { setStatus('That file is not valid JSON.', 'bad'); }
  });
  return panel('History & backup', 'Every save keeps the previous version (last 30). You can also export or import the CV as JSON.',
    h('p', {}, h('a', { class: 'btn', href: '/api/admin/export', download: 'cv.json' }, '⬇ Export JSON'), ' ',
      h('button', { class: 'btn', type: 'button', onclick: () => imp.click() }, '⬆ Import JSON'), imp), box);
}

const TABS = [
  { id: 'basics', label: 'Basics', render: () => panel('Basics', 'Contact details and headline shown at the top.', photoBlock(), h('br'), renderFields(state.cv, FIELDS.basics), h('br'), renderFields(state.cv.settings, [{ key: 'photoInPdf', label: 'Include photo in the PDF (not recommended for ATS)', type: 'bool' }]) ) },
  { id: 'profile', label: 'Profile & highlights', render: () => panel('Profile & highlights', 'The summary paragraph and the headline numbers shown below the hero.',
    renderFields(state.cv, [{ key: 'profile', label: 'Professional profile', type: 'textarea', rows: 8 }]), h('br'),
    renderFields(state.cv.settings, [{ key: 'showHighlights', label: 'Show highlights on the website', type: 'bool' }]), h('br'),
    renderFields(state.cv, [{ key: 'highlights', label: 'Highlights (max 8)', type: 'array', itemName: 'highlight', itemTitle: x => `${x.value} ${x.label}`, blank: () => ({ value: '', label: '' }), fields: [T('value', 'Value', { placeholder: '2:1' }), T('label', 'Label', { placeholder: 'BSc Computer Science' })] }])) },
  { id: 'experience', label: 'Experience', render: () => panel('Experience', null, renderFields(state.cv, FIELDS.experience)) },
  { id: 'skills', label: 'Skills', render: () => panel('Skills', null, renderFields(state.cv, FIELDS.skills)) },
  { id: 'projects', label: 'Projects', render: () => panel('Projects', null, renderFields(state.cv, FIELDS.projects)) },
  { id: 'education', label: 'Education', render: () => panel('Education', null, renderFields(state.cv, FIELDS.education)) },
  { id: 'languages', label: 'Languages', render: () => panel('Languages', null, renderFields(state.cv, FIELDS.languages)) },
  { id: 'custom', label: 'Custom sections', render: () => panel('Custom sections', 'Need a block the CV does not have yet — certifications, volunteering, awards, references? Create it here, then position it in Layout.', renderFields(state.cv, FIELDS.custom)) },
  { id: 'layout', label: 'Layout', render: layoutTab },
  { id: 'messages', label: 'Messages', render: messagesTab },
  { id: 'history', label: 'History & backup', render: historyTab }
];

// ---------- shell ----------
function setStatus(text, kind = '') { state.status = text; state.statusKind = kind; paintStatus(); }
function paintStatus() { const s = document.getElementById('status'); if (s) { s.textContent = state.status; s.className = `status ${state.statusKind}`; } }

async function save() {
  const btn = document.getElementById('saveBtn'); btn.disabled = true;
  try {
    state.cv = ensure(await api('PUT', '/api/admin/cv', state.cv));
    state.dirty = false; state.errors = null; setStatus('Saved ✓ — site and PDF updated', 'ok'); refresh();
  } catch (e) {
    if (e.status === 401) return showLogin('Your session expired. Please sign in again.');
    state.errors = (e.data && e.data.errors) || null; setStatus(e.message, 'bad'); refresh();
  } finally { btn.disabled = false; }
}

async function logout() { try { await api('POST', '/api/admin/logout'); } catch { /* ignore */ } state.csrf = null; showLogin(); }

function renderEditor() {
  const tab = TABS.find(t => t.id === state.tab) || TABS[0];
  const errs = state.errors && Object.entries(state.errors);
  app.replaceChildren(
    h('div', { class: 'topbar' }, h('h1', {}, 'CV Admin'), h('span', { id: 'status', class: `status ${state.statusKind}` }, state.status),
      h('a', { href: '/', target: '_blank', rel: 'noopener' }, 'View site ↗'),
      h('button', { id: 'saveBtn', class: 'btn primary', type: 'button', onclick: save }, 'Save changes'),
      h('button', { class: 'btn', type: 'button', onclick: logout }, 'Sign out')),
    h('div', { class: 'layout' },
      h('div', { class: 'tabs' }, TABS.map(t => h('button', { type: 'button', class: t.id === state.tab ? 'active' : '', onclick: () => { state.tab = t.id; refresh(); } }, t.label))),
      h('div', {}, errs && errs.length ? h('div', { class: 'errors' }, 'Could not save:', h('ul', {}, errs.map(([k, v]) => h('li', {}, `${k}: ${v}`)))) : null, tab.render())));
}

function showLogin(note = '') {
  const user = h('input', { type: 'text', autocomplete: 'username', required: true, autofocus: true });
  const pass = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const msg = h('p', { class: 'err' }, note);
  const form = h('form', { class: 'login' }, h('h1', {}, 'CV Admin'), h('p', {}, 'Sign in to edit the CV.'),
    h('div', { class: 'fields' }, h('label', { class: 'f' }, 'Username', user), h('label', { class: 'f' }, 'Password', pass), msg,
      h('button', { class: 'btn primary', type: 'submit' }, 'Sign in')));
  form.addEventListener('submit', async ev => {
    ev.preventDefault(); msg.textContent = '';
    try {
      const r = await api('POST', '/api/admin/login', { username: user.value, password: pass.value });
      state.csrf = r.csrf; state.user = r.user; await start();
    } catch (e) { msg.textContent = e.message; pass.value = ''; }
  });
  app.replaceChildren(form);
}

async function start() {
  state.cv = ensure(await api('GET', '/api/admin/cv'));
  state.dirty = false; renderEditor();
}

window.addEventListener('beforeunload', e => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });

(async () => {
  try {
    const me = await api('GET', '/api/admin/me');
    state.csrf = me.csrf; state.user = me.user; await start();
  } catch (e) {
    if (e.status === 503) app.replaceChildren(h('div', { class: 'login' }, h('h1', {}, 'Admin not set up'), h('p', {}, e.message)));
    else showLogin();
  }
})();

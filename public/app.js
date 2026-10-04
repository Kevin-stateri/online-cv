'use strict';
const $ = id => document.getElementById(id);
const PRINT = new URLSearchParams(location.search).has('print');
const SAFE_URL = /^(https?:\/\/|mailto:|tel:)/i;
const TITLES = {
  profile: 'Professional Profile', experience: 'Professional Experience', skills: 'Technical Skills',
  projects: 'Projects', education: 'Education & Qualifications', languages: 'Languages'
};

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) k === 'class' ? (n.className = v) : n.setAttribute(k, v);
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k);
  return n;
}
const chips = (items, cls = '') => el('div', { class: `chips ${cls}`.trim() }, items.map(i => el('span', { class: 'chip' }, i)));
const link = (href, text) => SAFE_URL.test(href) ? el('a', { href, target: '_blank', rel: 'noopener' }, text) : null;

// Each renderer returns the section body, or null when there is nothing to show.
const RENDER = {
  profile: cv => cv.profile && el('p', { class: 'profile-text' }, cv.profile),
  experience: cv => cv.experience.length && el('div', { class: 'timeline' }, cv.experience.map(x =>
    el('article', { class: 'job' },
      el('div', { class: 'job-head' },
        el('div', {}, el('h3', {}, x.role), el('p', { class: 'company' }, [x.company, x.location].filter(Boolean).join(' — '))),
        x.period && el('span', { class: 'period' }, x.period)),
      x.bullets.length && el('ul', {}, x.bullets.map(b => el('li', {}, b)))))),
  skills: cv => cv.skills.length && el('div', { class: 'skill-grid' }, cv.skills.map(s =>
    el('div', { class: 'skill-card' }, el('h3', {}, s.group), chips(s.items)))),
  projects: cv => cv.projects.length && el('div', { class: 'card-grid' }, cv.projects.map(p =>
    el('article', { class: 'card' }, p.stack.length && chips(p.stack, 'small'), el('h3', {}, p.name),
      p.description && el('p', {}, p.description), p.link && el('p', { class: 'more' }, link(p.link, p.link))))),
  education: cv => cv.education.length && el('div', {}, cv.education.map(e =>
    el('div', { class: 'edu' }, el('h3', {}, e.title), el('p', {}, [e.institution, e.year].filter(Boolean).join(' · '))))),
  languages: cv => cv.languages.length && el('div', { class: 'lang-list' }, cv.languages.map(l =>
    el('div', { class: 'lang' }, el('strong', {}, l.name), l.level && el('span', {}, l.level))))
};

function renderCustom(s) {
  if (s.kind === 'bullets') return s.bullets.length && el('ul', { class: 'plain-list' }, s.bullets.map(b => el('li', {}, b)));
  if (s.kind === 'entries') return s.entries.length && el('div', { class: 'timeline' }, s.entries.map(e =>
    el('article', { class: 'job' },
      el('div', { class: 'job-head' },
        el('div', {}, el('h3', {}, e.title), e.subtitle && el('p', { class: 'company' }, e.subtitle)),
        e.period && el('span', { class: 'period' }, e.period)),
      e.description && el('p', { class: 'entry-text' }, e.description),
      e.bullets.length && el('ul', {}, e.bullets.map(b => el('li', {}, b))),
      e.link && el('p', { class: 'more' }, link(e.link, e.link)))));
  return s.text && el('p', { class: 'profile-text' }, s.text);
}

function render(cv) {
  document.title = `${cv.name} — ${cv.title}`;
  $('name').textContent = cv.name;
  $('title').textContent = cv.title;
  $('tagline').textContent = cv.tagline;
  $('location').textContent = cv.location ? `📍 ${cv.location}` : '';
  $('heroProfile').textContent = cv.profile ? cv.profile.split('. ')[0].replace(/\.$/, '') + '.' : '';
  $('contactEmail').textContent = cv.email;

  if (cv.photo && (!PRINT || cv.settings.photoInPdf)) { $('avatar').src = cv.photo; $('avatar').alt = `Photo of ${cv.name}`; $('avatar').hidden = false; }

  const badges = $('badges');
  if (cv.rightToWork) badges.append(el('span', { class: 'badge ok' }, '✓ ' + cv.rightToWork));
  badges.append(el('span', { class: 'badge' }, 'Open to remote roles'));

  const contact = $('contactList');
  if (cv.email) contact.append(el('li', {}, el('a', { href: `mailto:${cv.email}` }, cv.email)));
  if (cv.phone) contact.append(el('li', {}, el('a', { href: `tel:${cv.phone.replace(/\s/g, '')}` }, cv.phone)));
  for (const url of [cv.linkedin, cv.github]) {
    if (url && SAFE_URL.test(url)) contact.append(el('li', {}, link(url, url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))));
  }

  const stats = $('stats');
  if (cv.settings.showHighlights && cv.highlights.length) {
    cv.highlights.forEach(h => stats.append(el('div', { class: 'stat' }, el('strong', {}, h.value), el('span', {}, h.label))));
  } else stats.closest('section').remove();

  const custom = Object.fromEntries(cv.customSections.map(s => [s.id, s]));
  const nav = $('nav');
  for (const item of cv.layout) {
    if (!item.visible) continue;
    const cs = custom[item.id];
    const body = cs ? renderCustom(cs) : RENDER[item.id] && RENDER[item.id](cv);
    if (!body) continue;
    const title = item.title || (cs ? cs.title : TITLES[item.id]);
    $('sections').append(el('section', { id: item.id, class: 'container sec' }, el('h2', {}, title), body));
    nav.append(el('a', { href: `#${item.id}` }, title));
  }
  nav.append(el('a', { href: '#contact' }, 'Contact'));
}

async function init() {
  $('year').textContent = new Date().getFullYear();
  try {
    const res = await fetch('/api/cv');
    if (!res.ok) throw new Error(res.status);
    render(await res.json());
  } catch (e) {
    document.querySelector('main').prepend(el('p', { class: 'container error' }, 'Could not load CV data. Is the server running?'));
  }
}

$('contactForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const form = ev.target, status = $('formStatus');
  form.querySelectorAll('[data-err]').forEach(s => (s.textContent = ''));
  status.textContent = 'Sending…'; status.className = '';
  try {
    const res = await fetch('/api/contact', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form)))
    });
    const data = await res.json();
    if (res.ok) { form.reset(); status.textContent = 'Thank you — your message has been sent.'; status.className = 'ok'; return; }
    if (data.errors) for (const [k, m] of Object.entries(data.errors)) { const s = form.querySelector(`[data-err="${k}"]`); if (s) s.textContent = m; }
    status.textContent = data.error || 'Please check the highlighted fields.'; status.className = 'bad';
  } catch { status.textContent = 'Network error. Please try again.'; status.className = 'bad'; }
});

init();

'use strict';
const $ = id => document.getElementById(id);
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) k === 'class' ? (n.className = v) : n.setAttribute(k, v);
  for (const k of kids.flat()) n.append(k);
  return n;
}

function render(cv) {
  document.title = `${cv.name} — ${cv.title}`;
  $('name').textContent = cv.name;
  $('title').textContent = cv.title;
  $('tagline').textContent = cv.tagline;
  $('location').textContent = `📍 ${cv.location}`;
  $('heroProfile').textContent = cv.profile.split('. ').slice(0, 1).join('') + '.';
  $('profileText').textContent = cv.profile;
  $('badges').append(el('span', { class: 'badge ok' }, '✓ ' + cv.rightToWork), el('span', { class: 'badge' }, 'Open to remote roles'));
  $('contactList').append(
    el('li', {}, el('a', { href: `mailto:${cv.email}` }, cv.email)),
    el('li', {}, el('a', { href: `tel:${cv.phone.replace(/\s/g, '')}` }, cv.phone)),
    el('li', {}, el('a', { href: cv.linkedin, target: '_blank', rel: 'noopener' }, 'linkedin.com/in/kevin-stateri'))
  );
  $('contactEmail').textContent = cv.email;
  cv.highlights.forEach(h => $('stats').append(el('div', { class: 'stat' }, el('strong', {}, h.value), el('span', {}, h.label))));

  cv.experience.forEach(x => $('experienceList').append(
    el('article', { class: 'job' },
      el('div', { class: 'job-head' },
        el('div', {}, el('h3', {}, x.role), el('p', { class: 'company' }, `${x.company} — ${x.location}`)),
        el('span', { class: 'period' }, x.period)),
      el('ul', {}, x.bullets.map(b => el('li', {}, b))))));

  cv.skills.forEach(s => $('skillList').append(
    el('div', { class: 'skill-card' }, el('h3', {}, s.group), el('div', { class: 'chips' }, s.items.map(i => el('span', { class: 'chip' }, i))))));

  cv.projects.forEach(p => $('projectList').append(
    el('article', { class: 'card' },
      el('div', { class: 'chips small' }, p.stack.map(t => el('span', { class: 'chip' }, t))),
      el('h3', {}, p.name), el('p', {}, p.description))));

  cv.education.forEach(e => $('educationList').append(
    el('div', { class: 'edu' }, el('h3', {}, e.title), el('p', {}, [e.institution, e.year].filter(Boolean).join(' · ')))));
  $('languageList').append(el('h3', { class: 'sub' }, 'Languages'),
    ...cv.languages.map(l => el('div', { class: 'lang' }, el('strong', {}, l.name), el('span', {}, l.level))));
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

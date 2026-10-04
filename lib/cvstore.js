'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA = path.join(__dirname, '..', 'data');
const CV_FILE = path.join(DATA, 'cv.json');
const VERSIONS = path.join(DATA, 'versions');
const MAX_VERSIONS = 30;
const BUILTIN = ['profile', 'experience', 'skills', 'projects', 'education', 'languages'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SAFE_URL = /^(https?:\/\/|mailto:|tel:)/i;
const PHOTO_RE = /^\/uploads\/profile\.(jpg|png|webp)\?v=\d+$/;

class ValidationError extends Error {
  constructor(errors) { super('Validation failed'); this.status = 422; this.errors = errors; }
}

const str = (v, max = 200) => (typeof v === 'string' ? v.replace(/\r/g, '').trim().slice(0, max) : '');
const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
const strs = (v, max, len) => arr(v, max).map(x => str(x, len)).filter(Boolean);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/**
 * Turns untrusted input into a clean CV document, or throws ValidationError.
 * Unknown keys are dropped; strings are trimmed and length-capped; links are limited to safe schemes.
 */
function sanitize(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError({ _: 'CV must be a JSON object.' });
  const errors = {};
  const link = (v, at) => {
    let s = str(v, 500);
    if (!s) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s) && /^\S+\.\S+$/.test(s)) s = 'https://' + s;
    if (!SAFE_URL.test(s)) { errors[at] = 'Link must start with http(s)://, mailto: or tel:'; return ''; }
    return s;
  };

  const cv = {
    name: str(input.name, 100), title: str(input.title, 120), tagline: str(input.tagline, 200),
    location: str(input.location, 120), email: str(input.email, 200), phone: str(input.phone, 40),
    linkedin: link(input.linkedin, 'linkedin'),
    github: link(/^[A-Za-z0-9-]+$/.test(str(input.github, 100)) ? `github.com/${str(input.github, 100)}` : input.github, 'github'), rightToWork: str(input.rightToWork, 200),
    photo: PHOTO_RE.test(input.photo || '') ? input.photo : '',
    profile: str(input.profile, 3000)
  };
  if (!cv.name) errors.name = 'Name is required.';
  if (cv.email && !EMAIL_RE.test(cv.email)) errors.email = 'Email looks invalid.';

  cv.highlights = arr(input.highlights, 8).map(o => ({ value: str(obj(o).value, 20), label: str(obj(o).label, 60) })).filter(o => o.value || o.label);
  cv.skills = arr(input.skills, 20).map(o => ({ group: str(obj(o).group, 60), items: strs(obj(o).items, 40, 80) })).filter(o => o.group || o.items.length);
  cv.experience = arr(input.experience, 30).map(o => ({
    role: str(obj(o).role, 120), company: str(obj(o).company, 120), location: str(obj(o).location, 80),
    period: str(obj(o).period, 60), bullets: strs(obj(o).bullets, 20, 600)
  })).filter(o => o.role || o.company);
  cv.projects = arr(input.projects, 30).map((o, i) => ({
    name: str(obj(o).name, 120), stack: strs(obj(o).stack, 15, 40), description: str(obj(o).description, 800), link: link(obj(o).link, `projects.${i}.link`)
  })).filter(o => o.name);
  cv.education = arr(input.education, 20).map(o => ({ title: str(obj(o).title, 160), institution: str(obj(o).institution, 160), year: str(obj(o).year, 30) })).filter(o => o.title);
  cv.languages = arr(input.languages, 20).map(o => ({ name: str(obj(o).name, 60), level: str(obj(o).level, 60) })).filter(o => o.name);

  const seen = new Set(BUILTIN);
  cv.customSections = arr(input.customSections, 20).map((raw, i) => {
    const s = obj(raw);
    let id = str(s.id, 40).toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!id.startsWith('x-')) id = 'x-' + (id || crypto.randomBytes(4).toString('hex'));
    while (seen.has(id)) id = 'x-' + crypto.randomBytes(4).toString('hex');
    seen.add(id);
    return {
      id, title: str(s.title, 80) || 'Untitled section',
      kind: ['text', 'bullets', 'entries'].includes(s.kind) ? s.kind : 'text',
      text: str(s.text, 4000), bullets: strs(s.bullets, 40, 400),
      entries: arr(s.entries, 30).map((e, j) => ({
        title: str(obj(e).title, 160), subtitle: str(obj(e).subtitle, 160), period: str(obj(e).period, 60),
        description: str(obj(e).description, 1500), link: link(obj(e).link, `customSections.${i}.entries.${j}.link`),
        bullets: strs(obj(e).bullets, 20, 600)
      })).filter(e => e.title || e.subtitle)
    };
  });

  const ids = [...BUILTIN, ...cv.customSections.map(s => s.id)];
  const used = new Set();
  cv.layout = [];
  for (const l of arr(input.layout, 60)) {
    if (l && ids.includes(l.id) && !used.has(l.id)) { used.add(l.id); cv.layout.push({ id: l.id, visible: bool(l.visible, true), title: str(l.title, 80) }); }
  }
  for (const id of ids) if (!used.has(id)) cv.layout.push({ id, visible: true, title: '' });

  const s = obj(input.settings);
  cv.settings = { showHighlights: bool(s.showHighlights, true), photoInPdf: bool(s.photoInPdf, false) };

  if (Object.keys(errors).length) throw new ValidationError(errors);
  return cv;
}

function load() {
  const raw = JSON.parse(fs.readFileSync(CV_FILE, 'utf8'));
  try { return sanitize(raw); } catch (e) { if (e instanceof ValidationError) return raw; throw e; }
}

function snapshotCurrent(nextText) {
  if (!fs.existsSync(CV_FILE)) return;
  const current = fs.readFileSync(CV_FILE, 'utf8');
  if (current === nextText) return;
  fs.mkdirSync(VERSIONS, { recursive: true });
  fs.writeFileSync(path.join(VERSIONS, `cv-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), current);
  const files = fs.readdirSync(VERSIONS).filter(f => f.endsWith('.json')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - MAX_VERSIONS))) fs.unlinkSync(path.join(VERSIONS, f));
}

/** Validates, snapshots the previous version, then writes atomically. */
function save(input) {
  const cv = sanitize(input);
  const text = JSON.stringify(cv, null, 2) + '\n';
  snapshotCurrent(text);
  const tmp = CV_FILE + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, CV_FILE);
  return cv;
}

function listVersions() {
  if (!fs.existsSync(VERSIONS)) return [];
  return fs.readdirSync(VERSIONS).filter(f => /^cv-[\w.-]+\.json$/.test(f)).sort().reverse().map(id => {
    const st = fs.statSync(path.join(VERSIONS, id));
    return { id, savedAt: st.mtime.toISOString(), size: st.size };
  });
}

function readVersion(id) {
  if (!/^cv-[\w.-]+\.json$/.test(id)) return null;
  const file = path.join(VERSIONS, id);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

module.exports = { sanitize, load, save, listVersions, readVersion, ValidationError, BUILTIN };

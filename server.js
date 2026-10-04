'use strict';
/**
 * Zero-dependency Node.js server.
 *
 * Public:
 *   GET  /api/cv        CV data (JSON)            GET  /api/cv.pdf   PDF export (headless Chrome/Edge, cached)
 *   POST /api/contact   contact form              GET  /api/health   liveness
 *   GET  /uploads/...   profile photo             *    /             static files from ./public
 * Admin (session cookie + CSRF header; see lib/auth.js):
 *   POST /api/admin/login | logout     GET /api/admin/me
 *   GET|PUT /api/admin/cv              GET /api/admin/export
 *   GET /api/admin/versions            POST /api/admin/versions/:id/restore
 *   GET /api/admin/messages            DELETE /api/admin/messages/:id
 *   POST|DELETE /api/admin/photo
 */
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const ROOT = __dirname;
require('./lib/env').loadEnv(path.join(ROOT, '.env'));
const auth = require('./lib/auth');
const store = require('./lib/cvstore');
const messages = require('./lib/messages');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(ROOT, 'public');
const UPLOADS = path.join(ROOT, 'data', 'uploads');
const CV_FILE = path.join(ROOT, 'data', 'cv.json');
const PDF_CACHE = path.join(ROOT, '.cache', 'cv.pdf');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.pdf': 'application/pdf'
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; frame-ancestors 'none'"
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  res.end(JSON.stringify(body));
}

function readBuffer(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Payload too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limit = 10_000) {
  try { return JSON.parse((await readBuffer(req, limit)).toString('utf8')); } catch (e) {
    throw Object.assign(new Error(e.status ? e.message : 'Invalid JSON'), { status: e.status || 400 });
  }
}

// ---- Contact form -------------------------------------------------------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hits = new Map(); // ip -> [timestamps]
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 60_000);
  recent.push(now); hits.set(ip, recent);
  return recent.length > 5;
}

function validateContact(b) {
  const errors = {};
  const name = String(b.name || '').trim();
  const email = String(b.email || '').trim();
  const message = String(b.message || '').trim();
  if (b.website) errors.spam = 'Rejected'; // honeypot
  if (name.length < 2 || name.length > 100) errors.name = 'Please enter your name.';
  if (!EMAIL_RE.test(email) || email.length > 200) errors.email = 'Please enter a valid email.';
  if (message.length < 10 || message.length > 2000) errors.message = 'Message must be 10–2000 characters.';
  return { errors, value: { name, email, message } };
}

async function handleContact(req, res) {
  if (rateLimited(req.socket.remoteAddress || 'x')) return sendJson(res, 429, { error: 'Too many requests. Try again shortly.' });
  const body = await readJson(req);
  const { errors, value } = validateContact(body || {});
  if (Object.keys(errors).length) return sendJson(res, 422, { errors });
  await messages.add({ ...value, receivedAt: new Date().toISOString() });
  sendJson(res, 201, { ok: true });
}

// ---- PDF export ----------------------------------------------------------
function findBrowser() {
  return [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium',
    ...['PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'].filter(v => process.env[v]).flatMap(v => [
      path.join(process.env[v], 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env[v], 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    ])
  ].filter(Boolean).find(p => fs.existsSync(p));
}

let pdfJob = null;
function buildPdf(port) {
  if (pdfJob) return pdfJob;
  const browser = findBrowser();
  if (!browser) return Promise.reject(Object.assign(new Error('No Chrome/Edge found. Set CHROME_PATH or use the browser print dialog.'), { status: 501 }));
  fs.mkdirSync(path.dirname(PDF_CACHE), { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cvpdf-'));
  pdfJob = new Promise((resolve, reject) => {
    execFile(browser, [
      '--headless=new', '--disable-gpu', '--virtual-time-budget=5000', `--user-data-dir=${profile}`, '--no-sandbox', '--no-pdf-header-footer',
      `--print-to-pdf=${PDF_CACHE}`, `http://127.0.0.1:${port}/?print=1`
    ], { timeout: 30_000 }, err => {
      pdfJob = null;
      fs.rm(profile, { recursive: true, force: true }, () => {});
      err ? reject(err) : resolve(PDF_CACHE);
    });
  });
  return pdfJob;
}

async function handlePdf(req, res) {
  try {
    const stale = !fs.existsSync(PDF_CACHE) || fs.statSync(PDF_CACHE).mtimeMs < fs.statSync(CV_FILE).mtimeMs;
    if (stale) await buildPdf(server.address().port);
    const stat = fs.statSync(PDF_CACHE);
    const slug = (store.load().name || 'CV').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'CV';
    res.writeHead(200, {
      'Content-Type': 'application/pdf', 'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${slug}_CV.pdf"`, ...SECURITY_HEADERS
    });
    fs.createReadStream(PDF_CACHE).pipe(res);
  } catch (e) {
    sendJson(res, e.status || 500, { error: e.message });
  }
}

// ---- Profile photo -----------------------------------------------------------
const PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
function sniffImage(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function clearPhotos() {
  for (const ext of Object.values(PHOTO_TYPES)) fs.rmSync(path.join(UPLOADS, `profile.${ext}`), { force: true });
}

async function uploadPhoto(req, res) {
  const buf = await readBuffer(req, 2 * 1024 * 1024);
  const type = sniffImage(buf);
  const claimed = String(req.headers['content-type'] || '').split(';')[0];
  if (!type || type !== claimed) return sendJson(res, 415, { error: 'Please upload a JPEG, PNG or WebP image (max 2 MB).' });
  fs.mkdirSync(UPLOADS, { recursive: true });
  clearPhotos();
  fs.writeFileSync(path.join(UPLOADS, `profile.${PHOTO_TYPES[type]}`), buf);
  const photo = `/uploads/profile.${PHOTO_TYPES[type]}?v=${Date.now()}`;
  store.save({ ...store.load(), photo });
  sendJson(res, 200, { photo });
}

function servePhoto(req, res, pathname) {
  const m = pathname.match(/^\/uploads\/profile\.(jpg|png|webp)$/);
  const file = m && path.join(UPLOADS, `profile.${m[1]}`);
  if (!file || !fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[`.${m[1]}`], 'Cache-Control': 'public, max-age=31536000, immutable', ...SECURITY_HEADERS });
  fs.createReadStream(file).pipe(res);
}

// ---- Admin API ----------------------------------------------------------------
async function handleAdmin(req, res, pathname) {
  if (!auth.configured()) return sendJson(res, 503, { error: 'Admin is not configured. Run "npm run setup-admin" and restart the server.' });

  if (req.method === 'POST' && pathname === '/api/admin/login') {
    const body = await readJson(req);
    const r = auth.login(req, res, body.username, body.password);
    return r.ok ? sendJson(res, 200, { user: r.session.user, csrf: r.session.csrf }) : sendJson(res, r.status, { error: r.error });
  }

  const session = auth.getSession(req);
  if (!session) return sendJson(res, 401, { error: 'Not authenticated' });
  if (req.method !== 'GET' && !auth.csrfOk(req, session)) return sendJson(res, 403, { error: 'Invalid CSRF token' });

  const route = `${req.method} ${pathname}`;
  let m;
  if (route === 'GET /api/admin/me') return sendJson(res, 200, { user: session.user, csrf: session.csrf });
  if (route === 'POST /api/admin/logout') { auth.logout(req, res); return sendJson(res, 200, { ok: true }); }
  if (route === 'GET /api/admin/cv') return sendJson(res, 200, store.load());
  if (route === 'PUT /api/admin/cv') {
    try { return sendJson(res, 200, store.save(await readJson(req, 300_000))); } catch (e) {
      if (e instanceof store.ValidationError) return sendJson(res, 422, { error: 'Please fix the highlighted problems.', errors: e.errors });
      throw e;
    }
  }
  if (route === 'GET /api/admin/export') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="cv.json"', ...SECURITY_HEADERS });
    return res.end(fs.readFileSync(CV_FILE));
  }
  if (route === 'GET /api/admin/versions') return sendJson(res, 200, store.listVersions());
  if (req.method === 'POST' && (m = pathname.match(/^\/api\/admin\/versions\/([^/]+)\/restore$/))) {
    const old = store.readVersion(decodeURIComponent(m[1]));
    if (!old) return sendJson(res, 404, { error: 'Version not found' });
    return sendJson(res, 200, store.save({ ...old, photo: store.load().photo }));
  }
  if (route === 'GET /api/admin/messages') return sendJson(res, 200, await messages.list());
  if (req.method === 'DELETE' && (m = pathname.match(/^\/api\/admin\/messages\/([\w-]+)$/))) {
    return (await messages.remove(m[1])) ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'Not found' });
  }
  if (route === 'POST /api/admin/photo') return uploadPhoto(req, res);
  if (route === 'DELETE /api/admin/photo') { clearPhotos(); store.save({ ...store.load(), photo: '' }); return sendJson(res, 200, { photo: '' }); }
  return sendJson(res, 404, { error: 'Not found' });
}

// ---- Static files ---------------------------------------------------------------
function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname === '/admin' ? '/admin.html' : pathname;
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SECURITY_HEADERS };
    if (rel === '/admin.html') headers['X-Robots-Tag'] = 'noindex, nofollow';
    res.writeHead(200, headers);
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && pathname === '/api/health') return sendJson(res, 200, { status: 'ok' });
    if (req.method === 'GET' && pathname === '/api/cv') return sendJson(res, 200, store.load());
    if (req.method === 'GET' && pathname === '/api/cv.pdf') return handlePdf(req, res);
    if (req.method === 'POST' && pathname === '/api/contact') return await handleContact(req, res);
    if (pathname.startsWith('/api/admin/')) return await handleAdmin(req, res, pathname);
    if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    if (pathname.startsWith('/uploads/')) return servePhoto(req, res, pathname);
    serveStatic(req, res, decodeURIComponent(pathname));
  } catch (e) {
    if (e.status) return sendJson(res, e.status, { error: e.message });
    console.error(e);
    sendJson(res, 500, { error: 'Internal server error' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`CV site running at http://localhost:${PORT}`);
    console.log(auth.configured() ? `Admin panel: http://localhost:${PORT}/admin` : 'Admin disabled — run "npm run setup-admin" to enable /admin');
  });
}
module.exports = { server, validateContact };

'use strict';
/**
 * Zero-dependency Node.js server:
 *   GET  /api/cv       -> CV data (JSON)
 *   POST /api/contact  -> validates and stores a message (data/messages.jsonl)
 *   GET  /api/cv.pdf   -> PDF export (headless Chrome/Edge; cached)
 *   GET  /api/health   -> liveness
 *   everything else    -> static files from ./public
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const CV_FILE = path.join(ROOT, 'data', 'cv.json');
const MESSAGES_FILE = path.join(ROOT, 'data', 'messages.jsonl');
const PDF_CACHE = path.join(ROOT, '.cache', 'Kevin_Da_Costa_Stateri_CV.pdf');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf'
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; frame-ancestors 'none'"
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 10_000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Payload too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
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
  let body;
  try { body = JSON.parse(await readBody(req)); } catch (e) {
    return sendJson(res, e.status || 400, { error: e.status ? e.message : 'Invalid JSON' });
  }
  const { errors, value } = validateContact(body || {});
  if (Object.keys(errors).length) return sendJson(res, 422, { errors });
  const record = { ...value, receivedAt: new Date().toISOString() };
  await fs.promises.appendFile(MESSAGES_FILE, JSON.stringify(record) + '\n');
  sendJson(res, 201, { ok: true });
}

// ---- PDF export ----------------------------------------------------------
function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
  ].filter(Boolean);
  return candidates.find(p => fs.existsSync(p));
}

let pdfJob = null;
function buildPdf(port) {
  if (pdfJob) return pdfJob;
  const browser = findBrowser();
  if (!browser) return Promise.reject(Object.assign(new Error('No Chrome/Edge found. Set CHROME_PATH or use the browser print dialog.'), { status: 501 }));
  fs.mkdirSync(path.dirname(PDF_CACHE), { recursive: true });
  pdfJob = new Promise((resolve, reject) => {
    execFile(browser, [
      '--headless=new', '--disable-gpu', '--virtual-time-budget=5000', `--user-data-dir=${fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'cvpdf-'))}`, '--no-sandbox', '--no-pdf-header-footer',
      `--print-to-pdf=${PDF_CACHE}`, `http://127.0.0.1:${port}/?print=1`
    ], { timeout: 30_000 }, err => { pdfJob = null; err ? reject(err) : resolve(PDF_CACHE); });
  });
  return pdfJob;
}

async function handlePdf(req, res) {
  try {
    const cvMtime = fs.statSync(CV_FILE).mtimeMs;
    const stale = !fs.existsSync(PDF_CACHE) || fs.statSync(PDF_CACHE).mtimeMs < cvMtime;
    if (stale) await buildPdf(server.address().port);
    const stat = fs.statSync(PDF_CACHE);
    res.writeHead(200, {
      'Content-Type': 'application/pdf', 'Content-Length': stat.size,
      'Content-Disposition': 'attachment; filename="Kevin_Da_Costa_Stateri_CV.pdf"', ...SECURITY_HEADERS
    });
    fs.createReadStream(PDF_CACHE).pipe(res);
  } catch (e) {
    sendJson(res, e.status || 500, { error: e.message });
  }
}

// ---- Static files ---------------------------------------------------------
function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SECURITY_HEADERS });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && pathname === '/api/health') return sendJson(res, 200, { status: 'ok' });
    if (req.method === 'GET' && pathname === '/api/cv') return sendJson(res, 200, JSON.parse(fs.readFileSync(CV_FILE, 'utf8')));
    if (req.method === 'GET' && pathname === '/api/cv.pdf') return handlePdf(req, res);
    if (req.method === 'POST' && pathname === '/api/contact') return handleContact(req, res);
    if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    serveStatic(req, res, decodeURIComponent(pathname));
  } catch (e) {
    console.error(e);
    sendJson(res, 500, { error: 'Internal server error' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`CV site running at http://localhost:${PORT}`));
}
module.exports = { server, validateContact };

'use strict';
const crypto = require('node:crypto');

const SESSION_TTL = 8 * 60 * 60 * 1000;
const MAX_FAILS = 5;
const FAIL_WINDOW = 15 * 60 * 1000;
const sessions = new Map(); // sid -> { user, csrf, exp }
const fails = new Map();    // ip  -> [timestamps]

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [alg, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

const digest = s => crypto.createHash('sha256').update(String(s)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));

const configured = () => Boolean(process.env.ADMIN_USER && process.env.ADMIN_PASSWORD_HASH);

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore */ } }
  }
  return out;
}

const isSecure = req => process.env.COOKIE_SECURE === '1' || req.headers['x-forwarded-proto'] === 'https';
const cookie = (req, value, maxAge) =>
  `sid=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${isSecure(req) ? '; Secure' : ''}`;

function getSession(req) {
  const sid = parseCookies(req).sid;
  const s = sid && sessions.get(sid);
  if (!s) return null;
  if (s.exp < Date.now()) { sessions.delete(sid); return null; }
  return s;
}

function recentFails(ip) {
  const now = Date.now();
  const list = (fails.get(ip) || []).filter(t => now - t < FAIL_WINDOW);
  fails.set(ip, list);
  return list;
}

/** Returns { ok, status, error?, session? }. Sets the session cookie on success. */
function login(req, res, username, password) {
  const ip = req.socket.remoteAddress || 'x';
  if (recentFails(ip).length >= MAX_FAILS) return { ok: false, status: 429, error: 'Too many failed attempts. Try again in 15 minutes.' };
  const userOk = safeEqual(String(username || ''), process.env.ADMIN_USER);
  const passOk = verifyPassword(String(password || ''), process.env.ADMIN_PASSWORD_HASH); // always run: constant-ish time
  if (!(userOk && passOk)) { recentFails(ip).push(Date.now()); return { ok: false, status: 401, error: 'Invalid username or password.' }; }
  fails.delete(ip);
  for (const [sid, s] of sessions) if (s.exp < Date.now()) sessions.delete(sid);
  const sid = crypto.randomBytes(32).toString('hex');
  const session = { user: process.env.ADMIN_USER, csrf: crypto.randomBytes(24).toString('hex'), exp: Date.now() + SESSION_TTL };
  sessions.set(sid, session);
  res.setHeader('Set-Cookie', cookie(req, sid, SESSION_TTL / 1000));
  return { ok: true, session };
}

function logout(req, res) {
  const sid = parseCookies(req).sid;
  if (sid) sessions.delete(sid);
  res.setHeader('Set-Cookie', cookie(req, '', 0));
}

const csrfOk = (req, session) => safeEqual(req.headers['x-csrf-token'] || '', session.csrf);

module.exports = { hashPassword, verifyPassword, configured, getSession, login, logout, csrfOk };

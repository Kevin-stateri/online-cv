'use strict';
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const FILE = path.join(__dirname, '..', 'data', 'messages.jsonl');

async function add(record) {
  const rec = { id: crypto.randomUUID(), ...record };
  await fsp.appendFile(FILE, JSON.stringify(rec) + '\n');
  return rec;
}

/** Oldest first. Messages written before ids existed get a stable legacy id. */
async function readAll() {
  let text;
  try { text = await fsp.readFile(FILE, 'utf8'); } catch { return []; }
  return text.split('\n').filter(Boolean).map((line, i) => {
    try { const m = JSON.parse(line); if (!m.id) m.id = `legacy-${i}`; return m; } catch { return null; }
  }).filter(Boolean);
}

const list = async () => (await readAll()).reverse();

async function remove(id) {
  const all = await readAll();
  const keep = all.filter(m => m.id !== id);
  if (keep.length === all.length) return false;
  await fsp.writeFile(FILE, keep.map(m => JSON.stringify(m)).join('\n') + (keep.length ? '\n' : ''));
  return true;
}

module.exports = { add, list, remove };

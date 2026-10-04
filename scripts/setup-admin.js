'use strict';
/**
 * Creates/updates .env with ADMIN_USER and a scrypt hash of the password (never the password itself).
 * Interactive:      npm run setup-admin
 * Non-interactive:  ADMIN_USER=me ADMIN_PASSWORD='long passphrase' npm run setup-admin
 */
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { hashPassword } = require('../lib/auth');

const ENV_FILE = path.join(__dirname, '..', '.env');

function ask(question, { hidden = false } = {}) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = s => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, answer => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer); });
  });
}

(async () => {
  let user = process.env.ADMIN_USER;
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    user = (await ask('Admin username [admin]: ')).trim() || 'admin';
    password = await ask('Admin password (min 10 chars): ', { hidden: true });
    if (password !== await ask('Repeat password: ', { hidden: true })) { console.error('Passwords do not match.'); process.exit(1); }
  }
  user = (user || 'admin').trim();
  if (password.length < 10) { console.error('Password must be at least 10 characters.'); process.exit(1); }

  const keep = fs.existsSync(ENV_FILE)
    ? fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/).filter(l => l && !/^\s*(ADMIN_USER|ADMIN_PASSWORD_HASH)\s*=/.test(l))
    : [];
  fs.writeFileSync(ENV_FILE, [...keep, `ADMIN_USER=${user}`, `ADMIN_PASSWORD_HASH=${hashPassword(password)}`].join('\n') + '\n', { mode: 0o600 });
  console.log(`Saved ${ENV_FILE}. Restart the server, then open /admin.`);
})();

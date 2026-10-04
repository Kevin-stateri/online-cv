'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { sanitize, ValidationError } = require('../lib/cvstore');
const { hashPassword, verifyPassword } = require('../lib/auth');

test('password hashing verifies only the right password', () => {
  const stored = hashPassword('correct horse battery');
  assert.ok(verifyPassword('correct horse battery', stored));
  assert.ok(!verifyPassword('wrong', stored));
  assert.ok(!verifyPassword('x', ''));
});

test('sanitize requires a name and rejects unsafe links', () => {
  assert.throws(() => sanitize({}), ValidationError);
  assert.throws(() => sanitize({ name: 'A', linkedin: 'javascript:alert(1)' }), e => Boolean(e.errors.linkedin));
  assert.strictEqual(sanitize({ name: 'A', linkedin: 'linkedin.com/in/a' }).linkedin, 'https://linkedin.com/in/a');
});

test('sanitize drops unknown keys, keeps layout complete and ids unique', () => {
  const cv = sanitize({
    name: 'A', evil: 1, photo: 'http://x/y.png',
    customSections: [{ id: 'profile', title: 'Awards', kind: 'bullets', bullets: ['x', ''] }, { title: 'Other', kind: 'nope' }],
    layout: [{ id: 'skills', visible: false }, { id: 'ghost' }]
  });
  assert.strictEqual(cv.evil, undefined);
  assert.strictEqual(cv.photo, '');
  const ids = cv.layout.map(l => l.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  assert.strictEqual(ids[0], 'skills');
  assert.ok(!ids.includes('ghost'));
  assert.ok(cv.customSections.every(s => s.id.startsWith('x-')));
  assert.strictEqual(cv.customSections[0].bullets.length, 1);
  assert.strictEqual(cv.customSections[1].kind, 'text');
  assert.strictEqual(ids.length, 6 + 2);
});

test('github accepts a username, a bare domain or a full URL', () => {
  assert.strictEqual(sanitize({ name: 'A', github: 'kevin-s' }).github, 'https://github.com/kevin-s');
  assert.strictEqual(sanitize({ name: 'A', github: 'github.com/kevin' }).github, 'https://github.com/kevin');
  assert.strictEqual(sanitize({ name: 'A' }).github, '');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedAuthor, equalState, newCsrfToken, parseCookie, readSession, secureCookie, signSession } from '../worker/auth.mjs';

const secret = 'a-test-secret-that-is-longer-than-32-characters';

test('session signature, expiry, and allowlist prevent unauthorized access', async () => {
  const payload = { id: 42, login: 'Alice', csrf: newCsrfToken(), exp: Date.now() + 60000 };
  const token = await signSession(payload, secret);
  assert.equal((await readSession(token, secret)).login, 'Alice');
  assert.equal(await readSession(token + 'x', secret), null);
  assert.equal(await readSession(token, secret, payload.exp + 1), null);
  assert.equal(allowedAuthor(42, '1,42'), true);
  assert.equal(allowedAuthor(13, '1,42'), false);
});

test('cookies and OAuth state use scoped values', () => {
  assert.equal(parseCookie('other=1; session=abc.def; state=xyz', 'session'), 'abc.def');
  assert.equal(equalState('a'.repeat(32), 'a'.repeat(32)), true);
  assert.equal(equalState('a'.repeat(32), 'b'.repeat(32)), false);
  const cookie = secureCookie('session', 'value', 'https://editor.example.com/', 60);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
});

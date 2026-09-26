import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../worker/index.mjs';
import { signSession } from '../worker/auth.mjs';

const env = {
  SESSION_SECRET: 'a-test-secret-that-is-longer-than-32-characters',
  GITHUB_OAUTH_CLIENT_ID: 'test-client',
  GITHUB_OAUTH_CLIENT_SECRET: 'test-secret',
  GITHUB_APP_ID: '123',
  GITHUB_INSTALLATION_ID: '456',
  GITHUB_PRIVATE_KEY: 'test-key',
  EDITOR_ORIGIN: 'https://editor.example.test',
  AUTH_LIMITER: { limit: async () => ({ success: true }) },
  API_LIMITER: { limit: async () => ({ success: true }) },
};

test('login sets an HTTP-only state cookie and redirects to GitHub', async () => {
  const handle = createHandler();
  const response = await handle(new Request('https://editor.example.test/auth/login'), env);
  assert.equal(response.status, 302);
  assert.match(response.headers.get('Location'), /^https:\/\/github\.com\/login\/oauth\/authorize\?/);
  assert.match(response.headers.getSetCookie().join(';'), /oauth_state=.*HttpOnly/);
  assert.match(new URL(response.headers.get('Location')).searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
});

test('login rate limit blocks repeated requests before redirecting', async () => {
  const response = await createHandler()(new Request('https://editor.example.test/auth/login'), {
    ...env, AUTH_LIMITER: { limit: async () => ({ success: false }) },
  });
  assert.equal(response.status, 429);
});

test('OAuth callback accepts only matching state and the blog owner', async () => {
  const login = await createHandler()(new Request('https://editor.example.test/auth/login'), env);
  const state = new URL(login.headers.get('Location')).searchParams.get('state');
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  let outbound = 0;
  const handle = createHandler({ fetchImpl: async (url, options) => {
    outbound++;
    if (url === 'https://github.com/login/oauth/access_token') {
      assert.match(options.body.get('code_verifier'), /^[A-Za-z0-9_-]{43}$/);
      return new Response(JSON.stringify({ access_token: 'user-token' }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url === 'https://api.github.com/user') return new Response(JSON.stringify({ id: 225505821, login: 'kiwicnlee' }), { headers: { 'Content-Type': 'application/json' } });
    throw new Error(`Unexpected URL: ${url}`);
  } });
  const invalid = await handle(new Request('https://editor.example.test/auth/callback?code=one&state=wrong', { headers: { Cookie: cookie } }), env);
  assert.equal(invalid.status, 403);
  assert.equal(outbound, 0);
  const valid = await handle(new Request(`https://editor.example.test/auth/callback?code=one&state=${state}`, { headers: { Cookie: cookie } }), env);
  assert.equal(valid.status, 302);
  assert.match(valid.headers.get('Set-Cookie'), /editor_session=/);
  assert.equal(outbound, 2);
});

test('OAuth callback rejects a valid login from another GitHub account', async () => {
  const login = await createHandler()(new Request('https://editor.example.test/auth/login'), env);
  const state = new URL(login.headers.get('Location')).searchParams.get('state');
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const handle = createHandler({ fetchImpl: async url => {
    if (url === 'https://github.com/login/oauth/access_token') return Response.json({ access_token: 'other-user-token' });
    if (url === 'https://api.github.com/user') return Response.json({ id: 42, login: 'alice' });
    throw new Error(`Unexpected URL: ${url}`);
  } });
  const response = await handle(new Request(`https://editor.example.test/auth/callback?code=one&state=${state}`, {
    headers: { Cookie: cookie },
  }), env);
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('Set-Cookie'), null);
});

test('draft endpoints reject missing sessions and cross-origin writes before GitHub access', async () => {
  let outbound = 0;
  const handle = createHandler({ fetchImpl: async () => { outbound++; throw new Error('Should not call GitHub'); } });
  const anonymous = await handle(new Request('https://editor.example.test/api/drafts'), env);
  assert.equal(anonymous.status, 401);

  const cookie = await signSession({ id: 225505821, login: 'kiwicnlee', csrf: 'a'.repeat(32), exp: Date.now() + 60000 }, env.SESSION_SECRET);
  const response = await handle(new Request('https://editor.example.test/api/drafts', {
    method: 'POST',
    headers: { Cookie: `editor_session=${cookie}`, Origin: 'https://evil.example.test', 'X-CSRF-Token': 'a'.repeat(32) },
    body: '{}',
  }), env);
  assert.equal(response.status, 403);
  assert.equal(outbound, 0);
  const invalid = await handle(new Request('https://editor.example.test/api/drafts', {
    method: 'POST',
    headers: { Cookie: `editor_session=${cookie}`, Origin: 'https://editor.example.test', 'X-CSRF-Token': 'a'.repeat(32) },
    body: JSON.stringify({ title: '测试', slug: '../unsafe', category: '机器人技术', tags: [], body: '' }),
  }), env);
  assert.equal(invalid.status, 400);
  assert.equal(outbound, 0);
});

test('sessions for other GitHub accounts cannot access the editor', async () => {
  const cookie = await signSession({ id: 42, login: 'alice', csrf: 'a'.repeat(32), exp: Date.now() + 60000 }, env.SESSION_SECRET);
  const response = await createHandler()(new Request('https://editor.example.test/api/me', {
    headers: { Cookie: `editor_session=${cookie}` },
  }), env);
  assert.equal(response.status, 401);
});

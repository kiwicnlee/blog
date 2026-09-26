import { equalState, isOwner, newCodeVerifier, newCsrfToken, newOAuthState, oauthChallenge, parseCookie, readSession, secureCookie, signSession } from './auth.mjs';
import { createDraft, GitHubError, githubRequest, installationToken, listDrafts, loadDraft, updateDraft, validateAttachments } from './github.mjs';
import { validateDraft } from '../shared/content.mjs';

const BLOG = 'https://kiwicnlee.github.io/blog/';
const SESSION_AGE = 8 * 60 * 60;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extraHeaders },
  });
}

function problem(message, status) { return json({ error: message }, status); }

function configured(env) {
  return !!(env.SESSION_SECRET && env.GITHUB_OAUTH_CLIENT_ID && env.GITHUB_OAUTH_CLIENT_SECRET &&
    env.GITHUB_APP_ID && env.GITHUB_INSTALLATION_ID && env.GITHUB_PRIVATE_KEY &&
    env.EDITOR_ORIGIN && env.AUTH_LIMITER && env.API_LIMITER);
}

async function exchangeCode(code, verifier, origin, env, fetchImpl) {
  const response = await fetchImpl('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GITHUB_OAUTH_CLIENT_ID, client_secret: env.GITHUB_OAUTH_CLIENT_SECRET, code, code_verifier: verifier, redirect_uri: `${origin}/auth/callback` }),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error('GitHub 登录授权失败');
  return data.access_token;
}

async function readBody(request) {
  const limit = 9 * 1024 * 1024;
  if (Number(request.headers.get('Content-Length') || 0) > limit) throw new Error('请求不能超过 9 MiB');
  if (!request.body) throw new Error('请求缺少正文');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error('请求不能超过 9 MiB');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  try { return JSON.parse(text); }
  catch { throw new Error('请求不是有效 JSON'); }
}

export function createHandler({ fetchImpl = fetch } = {}) {
  return async function handle(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ status: 'ok' });

    if (url.pathname === '/auth/login') {
      if (!configured(env)) return problem('编辑后台尚未配置', 503);
      if (url.origin !== env.EDITOR_ORIGIN) return problem('编辑后台域名不匹配', 403);
      if (!(await env.AUTH_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'local' })).success) return problem('登录请求过于频繁', 429);
      const state = newOAuthState();
      const verifier = newCodeVerifier();
      const target = new URL('https://github.com/login/oauth/authorize');
      target.searchParams.set('client_id', env.GITHUB_OAUTH_CLIENT_ID);
      target.searchParams.set('redirect_uri', `${env.EDITOR_ORIGIN}/auth/callback`);
      target.searchParams.set('state', state);
      target.searchParams.set('code_challenge', await oauthChallenge(verifier));
      target.searchParams.set('code_challenge_method', 'S256');
      target.searchParams.set('allow_signup', 'false');
      const headers = new Headers({ Location: target.toString(), 'Cache-Control': 'no-store' });
      headers.append('Set-Cookie', secureCookie('oauth_state', state, request.url, 600));
      headers.append('Set-Cookie', secureCookie('oauth_verifier', verifier, request.url, 600));
      return new Response(null, { status: 302, headers });
    }

    if (url.pathname === '/auth/callback') {
      if (!configured(env)) return problem('编辑后台尚未配置', 503);
      if (url.origin !== env.EDITOR_ORIGIN) return problem('编辑后台域名不匹配', 403);
      if (!(await env.AUTH_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'local' })).success) return problem('登录请求过于频繁', 429);
      const state = parseCookie(request.headers.get('Cookie'), 'oauth_state');
      if (!equalState(url.searchParams.get('state'), state)) return problem('登录状态校验失败', 403);
      const verifier = parseCookie(request.headers.get('Cookie'), 'oauth_verifier');
      if (!/^[A-Za-z0-9_-]{43,128}$/.test(verifier || '')) return problem('登录校验码无效', 403);
      const code = url.searchParams.get('code');
      if (!code || code.length > 256) return problem('登录授权码无效', 400);
      try {
        const userToken = await exchangeCode(code, verifier, env.EDITOR_ORIGIN, env, fetchImpl);
        const user = await githubRequest('/user', userToken, { fetchImpl });
        if (!isOwner(user.id)) return problem('仅博客所有者可以登录', 403);
        const session = await signSession({ id: user.id, login: user.login, csrf: newCsrfToken(), exp: Date.now() + SESSION_AGE * 1000 }, env.SESSION_SECRET);
        const headers = new Headers({ Location: '/', 'Cache-Control': 'no-store' });
        headers.append('Set-Cookie', secureCookie('oauth_state', '', request.url, 0));
        headers.append('Set-Cookie', secureCookie('oauth_verifier', '', request.url, 0));
        headers.append('Set-Cookie', secureCookie('editor_session', session, request.url, SESSION_AGE));
        return new Response(null, { status: 302, headers });
      } catch {
        return problem('GitHub 登录失败，请重新尝试', 502);
      }
    }

    if (url.pathname.startsWith('/api/') || url.pathname === '/auth/logout') {
      if (!configured(env)) return problem('编辑后台尚未配置', 503);
      if (url.origin !== env.EDITOR_ORIGIN) return problem('编辑后台域名不匹配', 403);
      const session = await readSession(parseCookie(request.headers.get('Cookie'), 'editor_session'), env.SESSION_SECRET);
      if (!session || !isOwner(session.id)) return problem('请先使用博客所有者的 GitHub 账号登录', 401);
      if (!(await env.API_LIMITER.limit({ key: String(session.id) })).success) return problem('编辑请求过于频繁', 429);
      if (request.method !== 'GET') {
        if (request.headers.get('Origin') !== env.EDITOR_ORIGIN || !equalState(request.headers.get('X-CSRF-Token'), session.csrf)) {
          return problem('请求来源校验失败', 403);
        }
      }
      if (url.pathname === '/api/me' && request.method === 'GET') return json({ login: session.login, csrf: session.csrf, blog: BLOG });
      if (url.pathname === '/auth/logout' && request.method === 'POST') {
        return json({ ok: true }, 200, { 'Set-Cookie': secureCookie('editor_session', '', request.url, 0) });
      }

      try {
        const match = url.pathname.match(/^\/api\/drafts\/(\d+)$/);
        const list = url.pathname === '/api/drafts' && request.method === 'GET';
        const create = url.pathname === '/api/drafts' && request.method === 'POST';
        const load = !!match && request.method === 'GET';
        const update = !!match && request.method === 'PUT';
        if (!list && !create && !load && !update) return problem('接口不存在', 404);
        let draft;
        let attachments;
        if (create || update) {
          const input = await readBody(request);
          draft = validateDraft(input, session.login);
          attachments = validateAttachments(input.attachments);
        }
        const token = await installationToken(env, fetchImpl);
        if (list) return json({ drafts: await listDrafts(token, fetchImpl) });
        if (create) return json(await createDraft(draft, attachments, token, fetchImpl), 201);
        if (load) return json(await loadDraft(Number(match[1]), token, fetchImpl));
        return json(await updateDraft(Number(match[1]), draft, attachments, token, fetchImpl));
      } catch (error) {
        if (error instanceof GitHubError) return problem(`GitHub 请求失败：${error.message}`, [409, 422].includes(error.status) ? 409 : 502);
        if (error instanceof TypeError || error instanceof SyntaxError) return problem('请求格式不正确', 400);
        if (error instanceof Error && /文章|思维导图|图片|标签|标题|分类|日期|请求|草稿|路径/.test(error.message)) return problem(error.message, 400);
        console.error('Editor request failed:', error instanceof Error ? error.message : String(error));
        return problem('编辑服务暂时不可用', 500);
      }
    }

    if (!env.ASSETS) return problem('编辑后台静态文件尚未部署', 503);
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; base-uri 'none'; frame-ancestors 'none'");
    return new Response(response.body, { status: response.status, headers });
  };
}

export default { fetch: (request, env) => createHandler()(request, env) };

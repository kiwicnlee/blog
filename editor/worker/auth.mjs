const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64url(text) {
  const normalized = text.replaceAll('-', '+').replaceAll('_', '/');
  return Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')), char => char.charCodeAt(0));
}

function randomToken(bytes = 24) {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function hmacKey(secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('SESSION_SECRET 必须至少 32 个字符');
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signSession(payload, secret) {
  const data = base64url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(data));
  return `${data}.${base64url(new Uint8Array(signature))}`;
}

export async function readSession(cookie, secret, now = Date.now()) {
  if (typeof cookie !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(cookie)) return null;
  try {
    const [data, signature] = cookie.split('.');
    const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromBase64url(signature), encoder.encode(data));
    if (!valid) return null;
    const payload = JSON.parse(decoder.decode(fromBase64url(data)));
    if (!Number.isSafeInteger(payload.id) || typeof payload.login !== 'string' || typeof payload.csrf !== 'string' || payload.exp <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookie(header, name) {
  const item = (header || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return item ? item.slice(name.length + 1) : null;
}

export function secureCookie(name, value, requestUrl, maxAge, httpOnly = true) {
  const url = new URL(requestUrl);
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}${httpOnly ? '; HttpOnly' : ''}`;
}

export function allowedAuthor(id, rawAllowlist) {
  if (!Number.isSafeInteger(id) || !rawAllowlist) return false;
  return rawAllowlist.split(',').some(value => /^\d+$/.test(value.trim()) && Number(value.trim()) === id);
}

export function equalState(received, expected) {
  if (typeof received !== 'string' || typeof expected !== 'string' || received.length !== expected.length || received.length < 24) return false;
  let difference = 0;
  for (let index = 0; index < received.length; index++) difference |= received.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

export function newOAuthState() { return randomToken(24); }
export function newCsrfToken() { return randomToken(24); }
export function newCodeVerifier() { return randomToken(32); }
export async function oauthChallenge(verifier) {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))));
}

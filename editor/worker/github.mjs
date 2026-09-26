import { renderMindmapSvg, serializePost } from '../shared/content.mjs';

const API = 'https://api.github.com';
const REPO = 'kiwicnlee/blog';
const REPO_PATH = `/repos/${REPO}`;
const encoder = new TextEncoder();
let cachedInstallation = null;

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function base64(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 32768) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
  }
  return btoa(binary);
}

function concatenate(...parts) {
  const output = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

function der(tag, value) {
  let size = value.length;
  const length = [];
  do { length.unshift(size & 255); size >>>= 8; } while (size);
  const prefix = value.length < 128 ? Uint8Array.of(value.length) : Uint8Array.of(128 | length.length, ...length);
  return concatenate(Uint8Array.of(tag), prefix, value);
}

function privateKeyDer(pem) {
  const normalized = pem.replaceAll('\\n', '\n');
  const isPkcs1 = normalized.includes('-----BEGIN RSA PRIVATE KEY-----');
  if (!isPkcs1 && !normalized.includes('-----BEGIN PRIVATE KEY-----')) throw new Error('GitHub App 私钥必须是 PEM 格式');
  const raw = normalized.replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----|-----END (?:RSA )?PRIVATE KEY-----|\s/g, '');
  const bytes = Uint8Array.from(atob(raw), char => char.charCodeAt(0));
  if (!isPkcs1) return bytes;
  const rsaOid = der(0x06, Uint8Array.of(0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01));
  const algorithm = der(0x30, concatenate(rsaOid, Uint8Array.of(0x05, 0x00)));
  return der(0x30, concatenate(Uint8Array.of(0x02, 0x01, 0x00), algorithm, der(0x04, bytes)));
}

export class GitHubError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function githubRequest(path, token, { method = 'GET', body, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(API + path, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'kiwi-blog-editor',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new GitHubError(response.status, data.message || `GitHub API HTTP ${response.status}`);
  return data;
}

export async function signAppJwt(appId, pem, now = Date.now()) {
  if (!/^\d+$/.test(String(appId || '')) || !pem) throw new Error('缺少 GitHub App 配置');
  const key = await crypto.subtle.importKey('pkcs8', privateKeyDer(pem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const issued = Math.floor(now / 1000) - 60;
  const header = base64url(encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = base64url(encoder.encode(JSON.stringify({ iat: issued, exp: issued + 600, iss: String(appId) })));
  const input = `${header}.${payload}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(input));
  return `${input}.${base64url(new Uint8Array(signature))}`;
}

export async function installationToken(env, fetchImpl = fetch) {
  if (!env.GITHUB_INSTALLATION_ID) throw new Error('缺少 GITHUB_INSTALLATION_ID');
  if (fetchImpl === fetch && cachedInstallation && cachedInstallation.id === env.GITHUB_INSTALLATION_ID &&
      cachedInstallation.expires > Date.now() + 60000) return cachedInstallation.token;
  const jwt = await signAppJwt(env.GITHUB_APP_ID, env.GITHUB_PRIVATE_KEY);
  const result = await githubRequest(`/app/installations/${encodeURIComponent(env.GITHUB_INSTALLATION_ID)}/access_tokens`, jwt, {
    method: 'POST',
    body: { repositories: ['blog'], permissions: { contents: 'write', pull_requests: 'write' } },
    fetchImpl,
  });
  if (fetchImpl === fetch) cachedInstallation = { id: env.GITHUB_INSTALLATION_ID, token: result.token, expires: Date.parse(result.expires_at) };
  return result.token;
}

function branchPath(branch) {
  return branch.split('/').map(encodeURIComponent).join('/');
}

function validateBranch(branch) {
  if (typeof branch !== 'string' || !/^cms\/[A-Za-z0-9-]+\/[a-z0-9-]+-[a-f0-9]{8}$/.test(branch)) {
    throw new Error('草稿分支格式不正确');
  }
  return branch;
}

function draftFiles(draft, attachments) {
  const files = [{ path: `source/_posts/${draft.slug}.md`, bytes: encoder.encode(serializePost(draft)) }];
  if (draft.mindmap) {
    files.push({ path: `source/_posts/${draft.slug}/mindmap.json`, bytes: encoder.encode(`${JSON.stringify(draft.mindmap, null, 2)}\n`) });
    files.push({ path: `source/_posts/${draft.slug}/mindmap.svg`, bytes: encoder.encode(renderMindmapSvg(draft.mindmap)) });
  }
  for (const attachment of attachments) {
    files.push({ path: `source/_posts/${draft.slug}/${attachment.name}`, bytes: attachment.bytes });
  }
  return files;
}

export function validateAttachments(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > 8) throw new Error('一次最多上传 8 张图片');
  const seen = new Set();
  let total = 0;
  return raw.map(item => {
    if (!item || typeof item !== 'object' || typeof item.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\.(?:png|jpg|jpeg|webp)$/i.test(item.name)) {
      throw new Error('图片文件名不合法');
    }
    const name = item.name.toLowerCase();
    if (seen.has(name)) throw new Error('图片文件名重复');
    seen.add(name);
    const suffix = name.split('.').pop();
    const expected = suffix === 'png' ? 'image/png' : suffix === 'webp' ? 'image/webp' : 'image/jpeg';
    if (item.mime !== expected || typeof item.base64 !== 'string' || item.base64.length > 7_000_000) throw new Error('图片类型或大小不合法');
    let bytes;
    try { bytes = Uint8Array.from(atob(item.base64), char => char.charCodeAt(0)); }
    catch { throw new Error('图片数据不是有效的 Base64'); }
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error('单张图片不能超过 5 MiB');
    total += bytes.length;
    if (total > 6 * 1024 * 1024) throw new Error('本次图片总量不能超过 6 MiB');
    const magic = expected === 'image/png' ? [137, 80, 78, 71] : expected === 'image/webp' ? [82, 73, 70, 70] : [255, 216, 255];
    if (!magic.every((byte, index) => bytes[index] === byte) ||
        (expected === 'image/webp' && String.fromCharCode(...bytes.subarray(8, 12)) !== 'WEBP')) {
      throw new Error('图片内容与类型不匹配');
    }
    return { name: item.name, bytes };
  });
}

async function commitFiles(branch, draft, attachments, token, fetchImpl) {
  const ref = await githubRequest(`${REPO_PATH}/git/ref/heads/${branchPath(branch)}`, token, { fetchImpl });
  const parent = ref.object.sha;
  const base = await githubRequest(`${REPO_PATH}/git/commits/${parent}`, token, { fetchImpl });
  const entries = [];
  for (const file of draftFiles(draft, attachments)) {
    const blob = await githubRequest(`${REPO_PATH}/git/blobs`, token, {
      method: 'POST', body: { content: base64(file.bytes), encoding: 'base64' }, fetchImpl,
    });
    entries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const tree = await githubRequest(`${REPO_PATH}/git/trees`, token, {
    method: 'POST', body: { base_tree: base.tree.sha, tree: entries }, fetchImpl,
  });
  const commit = await githubRequest(`${REPO_PATH}/git/commits`, token, {
    method: 'POST', body: { message: `Draft: ${draft.title}`, tree: tree.sha, parents: [parent] }, fetchImpl,
  });
  await githubRequest(`${REPO_PATH}/git/refs/heads/${branchPath(branch)}`, token, {
    method: 'PATCH', body: { sha: commit.sha, force: false }, fetchImpl,
  });
  return commit.sha;
}

export async function createDraft(draft, attachments, token, fetchImpl = fetch) {
  try {
    await githubRequest(`${REPO_PATH}/contents/source/_posts/${draft.slug}.md?ref=main`, token, { fetchImpl });
    throw new GitHubError(409, '文章路径已被已发布文章占用');
  } catch (error) {
    if (!(error instanceof GitHubError && error.status === 404)) throw error;
  }
  if ((await listDrafts(token, fetchImpl)).some(item => item.branch.split('/')[2].slice(0, -9) === draft.slug)) {
    throw new GitHubError(409, '该文章路径已有待审核草稿');
  }
  const main = await githubRequest(`${REPO_PATH}/git/ref/heads/main`, token, { fetchImpl });
  const branch = `cms/${draft.author}/${draft.slug}-${crypto.randomUUID().slice(0, 8)}`;
  validateBranch(branch);
  await githubRequest(`${REPO_PATH}/git/refs`, token, {
    method: 'POST', body: { ref: `refs/heads/${branch}`, sha: main.object.sha }, fetchImpl,
  });
  const commit = await commitFiles(branch, draft, attachments, token, fetchImpl);
  const pr = await githubRequest(`${REPO_PATH}/pulls`, token, {
    method: 'POST',
    body: { title: draft.title, head: branch, base: 'main', body: `由 @${draft.author} 在线提交的文章草稿。请审核正文、图片和思维导图后合并。` },
    fetchImpl,
  });
  return { number: pr.number, url: pr.html_url, branch, commit };
}

async function getManagedPull(number, token, fetchImpl) {
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('PR 编号不正确');
  const pr = await githubRequest(`${REPO_PATH}/pulls/${number}`, token, { fetchImpl });
  if (pr.state !== 'open' || pr.base.ref !== 'main' || pr.head.repo?.full_name !== REPO) throw new Error('这不是可编辑的博客草稿');
  validateBranch(pr.head.ref);
  return pr;
}

export async function updateDraft(number, draft, attachments, token, fetchImpl = fetch) {
  const pr = await getManagedPull(number, token, fetchImpl);
  const [,, slugPart] = pr.head.ref.split('/');
  const slugFromBranch = slugPart.slice(0, -9);
  if (slugFromBranch !== draft.slug) throw new Error('文章路径不能在草稿创建后更改');
  const commit = await commitFiles(pr.head.ref, { ...draft, author: pr.head.ref.split('/')[1] }, attachments, token, fetchImpl);
  if (pr.title !== draft.title) await githubRequest(`${REPO_PATH}/pulls/${number}`, token, { method: 'PATCH', body: { title: draft.title }, fetchImpl });
  return { number, url: pr.html_url, branch: pr.head.ref, commit };
}

export async function listDrafts(token, fetchImpl = fetch) {
  const pulls = await githubRequest(`${REPO_PATH}/pulls?state=open&base=main&per_page=100`, token, { fetchImpl });
  return pulls.filter(pr => pr.head.repo.full_name === REPO && pr.head.ref.startsWith('cms/'))
    .map(pr => ({ number: pr.number, title: pr.title, branch: pr.head.ref, url: pr.html_url, updatedAt: pr.updated_at }));
}

export async function loadDraft(number, token, fetchImpl = fetch) {
  const pr = await getManagedPull(number, token, fetchImpl);
  const slug = pr.head.ref.split('/')[2].slice(0, -9);
  const ref = encodeURIComponent(pr.head.ref);
  const article = await githubRequest(`${REPO_PATH}/contents/source/_posts/${slug}.md?ref=${ref}`, token, { fetchImpl });
  const bytes = Uint8Array.from(atob(article.content.replace(/\s/g, '')), char => char.charCodeAt(0));
  let mindmap = null;
  try {
    const map = await githubRequest(`${REPO_PATH}/contents/source/_posts/${slug}/mindmap.json?ref=${ref}`, token, { fetchImpl });
    const mapBytes = Uint8Array.from(atob(map.content.replace(/\s/g, '')), char => char.charCodeAt(0));
    mindmap = JSON.parse(new TextDecoder().decode(mapBytes));
  } catch (error) {
    if (!(error instanceof GitHubError && error.status === 404)) throw error;
  }
  return { number, url: pr.html_url, slug, markdown: new TextDecoder().decode(bytes), mindmap, branch: pr.head.ref };
}

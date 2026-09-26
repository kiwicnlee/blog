import test from 'node:test';
import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { createDraft, loadDraft, signAppJwt, updateDraft, validateAttachments } from '../worker/github.mjs';
import { validateDraft } from '../shared/content.mjs';

test('draft creation writes only a cms branch and opens a PR against main', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    const path = new URL(url).pathname;
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method: options.method, body });
    let result;
    if (path.includes('/contents/source/_posts/') && path.endsWith('/team-post.md')) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    if (path.endsWith('/git/ref/heads/main')) result = { object: { sha: 'main-head' } };
    else if (options.method === 'POST' && path.endsWith('/git/refs')) result = { ref: body.ref };
    else if (path.includes('/git/ref/heads/cms/')) result = { object: { sha: 'main-head' } };
    else if (path.endsWith('/git/commits/main-head')) result = { tree: { sha: 'old-tree' } };
    else if (path.endsWith('/git/blobs')) result = { sha: 'new-blob' };
    else if (path.endsWith('/git/trees')) result = { sha: 'new-tree' };
    else if (path.endsWith('/git/commits')) result = { sha: 'new-commit' };
    else if (path.includes('/git/refs/heads/cms/')) result = { object: { sha: 'new-commit' } };
    else if (path.endsWith('/pulls') && options.method === 'GET') result = [];
    else if (path.endsWith('/pulls')) result = { number: 7, html_url: 'https://github.com/kiwicnlee/blog/pull/7' };
    else throw new Error(`Unexpected request: ${options.method} ${path}`);
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const draft = validateDraft({ title: '协作文章', slug: 'team-post', category: '生活随笔', tags: [], body: '正文', mindmap: { nodeData: { id: 'root', topic: '中心', children: [] } } }, 'alice');
  const result = await createDraft(draft, [], 'test-token', fakeFetch);
  assert.equal(result.number, 7);
  assert.match(result.branch, /^cms\/alice\/life\/team-post-[a-f0-9]{8}$/);
  assert.deepEqual(calls.find(call => call.path.endsWith('/git/trees')).body.tree.map(item => item.path), [
    'source/_posts/life/team-post.md',
    'source/_posts/life/team-post/mindmap.json',
    'source/_posts/life/team-post/mindmap.svg',
  ]);
  assert.equal(calls.find(call => call.path.endsWith('/pulls') && call.method === 'POST').body.base, 'main');
  assert.equal(calls.some(call => call.method === 'PATCH' && call.path.endsWith('/git/refs/heads/main')), false);
});

test('existing published slug in another category is rejected before creating a branch', async () => {
  const methods = [];
  const fakeFetch = async (url, options) => {
    methods.push(options.method);
    if (new URL(url).pathname.endsWith('/source/_posts/team-post.md')) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ path: 'source/_posts/team-post.md' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const draft = validateDraft({ title: '协作文章', slug: 'team-post', category: '生活随笔', tags: [], body: '正文' }, 'alice');
  await assert.rejects(createDraft(draft, [], 'test-token', fakeFetch), /路径已被已发布文章占用/);
  assert.deepEqual(methods, ['GET', 'GET']);
});

test('editing a draft cannot move it to another category directory', async () => {
  const draft = validateDraft({ title: '测试', slug: 'team-post', category: '生活随笔', tags: [], body: '正文' }, 'alice');
  const fakeFetch = async url => {
    if (!new URL(url).pathname.endsWith('/pulls/8')) throw new Error('Unexpected GitHub write');
    return Response.json({ state: 'open', base: { ref: 'main' }, head: { ref: 'cms/alice/tech/team-post-1234abcd', repo: { full_name: 'kiwicnlee/blog' } } });
  };
  await assert.rejects(updateDraft(8, draft, [], 'test-token', fakeFetch), /分类不能在草稿创建后更改/);
});

test('GitHub App JWT signs with either downloaded PKCS#1 or PKCS#8 private keys', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  for (const type of ['pkcs1', 'pkcs8']) {
    const jwt = await signAppJwt(123, privateKey.export({ format: 'pem', type }));
    const parts = jwt.split('.');
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${parts[0]}.${parts[1]}`);
    assert.equal(verifier.verify(publicKey, Buffer.from(parts[2], 'base64url')), true);
  }
});

test('image validation checks extension, MIME and content signature', () => {
  const png = btoa(String.fromCharCode(137, 80, 78, 71, 0));
  assert.equal(validateAttachments([{ name: 'photo.png', mime: 'image/png', base64: png }]).length, 1);
  assert.throws(() => validateAttachments([{ name: '../photo.png', mime: 'image/png', base64: png }]), /文件名/);
  assert.throws(() => validateAttachments([{ name: 'photo.png', mime: 'image/jpeg', base64: png }]), /类型/);
});

test('loading a draft decodes Chinese Markdown and optional map data', async () => {
  const source = '---\ntitle: "测试"\n---\n\n中文正文';
  const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(source)));
  const fakeFetch = async (url) => {
    const path = new URL(url).pathname;
    let data;
    let status = 200;
    if (path.endsWith('/pulls/7')) data = { state: 'open', base: { ref: 'main' }, head: { ref: 'cms/alice/life/team-post-1234abcd', repo: { full_name: 'kiwicnlee/blog' } }, html_url: 'https://github.com/kiwicnlee/blog/pull/7' };
    else if (path.endsWith('/life/team-post.md')) data = { content: encoded };
    else { data = { message: 'Not Found' }; status = 404; }
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  };
  const loaded = await loadDraft(7, 'test-token', fakeFetch);
  assert.equal(loaded.markdown, source);
  assert.equal(loaded.mindmap, null);
});

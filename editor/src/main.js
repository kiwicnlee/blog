import YAML from 'yaml';
import './style.css';

const $ = selector => document.querySelector(selector);
const state = { csrf: null, editor: null, mind: null, map: null, attachments: [], draftNumber: null, prUrl: null };

function notice(message, error = false) {
  const target = $('#status');
  target.textContent = message;
  target.classList.toggle('error', error);
}

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(method === 'GET' ? {} : { 'X-CSRF-Token': state.csrf }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
}

function localDateTime() {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  return parts.replace(' ', 'T');
}

function suggestSlug(title) {
  const ascii = title.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);
  return ascii || `post-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}

function imageAlt(name) {
  return name.replace(/[\[\]<>\\]/g, '').slice(0, 80) || '文章图片';
}

async function addImage(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('仅支持不超过 5 MiB 的 PNG、JPEG、WebP 图片');
  const currentSize = state.attachments.reduce((total, item) => total + item.base64.length * 3 / 4, 0);
  if (currentSize + file.size > 6 * 1024 * 1024) throw new Error('一次保存的图片总量不能超过 6 MiB');
  const suffix = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const base = file.name.replace(/\.[^.]+$/, '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, '').slice(0, 55) || 'image';
  let name = `${base}.${suffix}`;
  let index = 2;
  while (state.attachments.some(item => item.name.toLowerCase() === name.toLowerCase())) name = `${base}-${index++}.${suffix}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  state.attachments.push({ name, mime: file.type, base64: bytesToBase64(bytes) });
  notice(`已加入图片 ${name}，保存草稿时一起上传。`);
  return name;
}

async function initializeEditor() {
  await import('vditor/dist/index.css');
  const { default: Vditor } = await import('vditor');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('正文编辑器初始化超时')), 12000);
    state.editor = new Vditor('markdown-editor', {
      height: 550,
      lang: 'zh_CN',
      mode: 'sv',
      cache: { enable: false },
      cdn: `${location.origin}/vditor`,
      preview: { markdown: { sanitize: true }, actions: ['desktop', 'tablet', 'mobile'] },
      upload: {
        accept: 'image/png,image/jpeg,image/webp',
        max: 5 * 1024 * 1024,
        async handler(files) {
          try {
            for (const file of files) {
              const name = await addImage(file);
              state.editor.insertValue(`![${imageAlt(file.name)}](${name})`);
            }
            return null;
          } catch (error) { notice(error.message, true); return error.message; }
        },
      },
      after() { clearTimeout(timer); resolve(); },
    });
  });
}

function resetPost() {
  state.draftNumber = null;
  state.prUrl = null;
  state.attachments = [];
  state.map = null;
  state.mind?.destroy?.();
  state.mind = null;
  $('#mindmap-canvas').replaceChildren();
  $('#mindmap-panel').hidden = true;
  $('#map-toggle').textContent = '打开导图编辑器';
  $('#map-clear').hidden = true;
  $('#post-form').reset();
  $('#post-date').value = localDateTime();
  $('#post-slug').readOnly = false;
  state.editor.setValue('');
  $('#editor-title').textContent = '新建文章';
  $('#save-button').firstChild.textContent = '保存草稿并创建 PR ';
  $('#pr-link').hidden = true;
  notice('');
}

function parseMarkdown(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) throw new Error('草稿缺少 Hexo front matter');
  return { meta: YAML.parse(match[1]), body: markdown.slice(match[0].length) };
}

async function openDraft(number) {
  notice('正在读取草稿……');
  try {
    const draft = await api(`/api/drafts/${number}`);
    const { meta, body } = parseMarkdown(draft.markdown);
    resetPost();
    state.draftNumber = number;
    state.prUrl = draft.url;
    state.map = draft.mindmap;
    $('#post-title').value = meta.title || '';
    $('#post-slug').value = draft.slug;
    $('#post-slug').readOnly = true;
    $('#post-date').value = String(meta.date || '').replace(' ', 'T').slice(0, 16);
    $('#post-description').value = meta.description || '';
    $('#post-category').value = meta.categories?.[0] || '机器人技术';
    $('#post-tags').value = (meta.tags || []).join(', ');
    state.editor.setValue(body.replace(/!\[文章思维导图\]\(mindmap\.svg\)/, '<!-- mindmap -->'));
    $('#editor-title').textContent = '编辑草稿';
    $('#save-button').firstChild.textContent = '更新草稿 PR ';
    $('#pr-link').href = draft.url;
    $('#pr-link').hidden = false;
    $('#map-clear').hidden = !state.map;
    notice('草稿已载入。');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) { notice(error.message, true); }
}

async function refreshDrafts() {
  const list = $('#draft-list');
  list.textContent = '正在加载……';
  try {
    const { drafts } = await api('/api/drafts');
    list.replaceChildren();
    if (!drafts.length) { list.textContent = '还没有待审核的草稿。'; return; }
    for (const draft of drafts) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'draft-item';
      const title = document.createElement('strong');
      title.textContent = draft.title;
      const detail = document.createElement('small');
      detail.textContent = `PR #${draft.number} · ${draft.branch.split('/')[1]}`;
      button.append(title, detail);
      button.addEventListener('click', () => openDraft(draft.number));
      list.append(button);
    }
  } catch (error) { list.textContent = error.message; }
}

async function toggleMap() {
  const panel = $('#mindmap-panel');
  if (!panel.hidden) { panel.hidden = true; $('#map-toggle').textContent = '打开导图编辑器'; return; }
  panel.hidden = false;
  $('#map-toggle').textContent = '收起导图编辑器';
  $('#map-clear').hidden = false;
  if (!state.mind) {
    await import('mind-elixir/style.css');
    const { default: MindElixir } = await import('mind-elixir');
    state.mind = new MindElixir({ el: '#mindmap-canvas', direction: MindElixir.RIGHT, toolBar: true, keypress: true });
    state.mind.init(state.map || MindElixir.new($('#post-title').value.trim() || '中心主题'));
  }
}

function collectPost() {
  return {
    title: $('#post-title').value.trim(), slug: $('#post-slug').value.trim(), date: $('#post-date').value,
    description: $('#post-description').value.trim(), category: $('#post-category').value,
    tags: $('#post-tags').value.split(/[,，]/).map(item => item.trim()).filter(Boolean),
    body: state.editor.getValue(), mindmap: state.mind?.getData() || state.map,
    attachments: state.attachments,
  };
}

async function savePost(event) {
  event.preventDefault();
  const button = $('#save-button');
  button.disabled = true;
  notice('正在保存草稿并创建审核记录……');
  try {
    const path = state.draftNumber ? `/api/drafts/${state.draftNumber}` : '/api/drafts';
    const result = await api(path, { method: state.draftNumber ? 'PUT' : 'POST', body: collectPost() });
    state.draftNumber = result.number;
    state.prUrl = result.url;
    state.attachments = [];
    $('#post-slug').readOnly = true;
    $('#editor-title').textContent = '编辑草稿';
    $('#save-button').firstChild.textContent = '更新草稿 PR ';
    $('#pr-link').href = result.url;
    $('#pr-link').hidden = false;
    notice(`已保存到 PR #${result.number}，等待审核合并。`);
    await refreshDrafts();
  } catch (error) { notice(error.message, true); }
  finally { button.disabled = false; }
}

async function start() {
  try {
    const me = await api('/api/me');
    state.csrf = me.csrf;
    $('#account-name').textContent = me.login;
    $('#logout-button').hidden = false;
    $('#workspace').hidden = false;
    await initializeEditor();
    resetPost();
    await refreshDrafts();
  } catch (error) {
    $('#login-view').hidden = false;
    if (!/请先登录/.test(error.message)) {
      const note = document.createElement('p');
      note.className = 'login-error';
      note.textContent = error.message;
      $('#login-view').append(note);
    }
  }
}

$('#new-button').addEventListener('click', resetPost);
$('#post-form').addEventListener('submit', savePost);
$('#post-title').addEventListener('input', () => { if (!$('#post-slug').value) $('#post-slug').value = suggestSlug($('#post-title').value); });
$('#image-upload').addEventListener('change', async event => {
  for (const file of event.target.files) {
    try { const name = await addImage(file); state.editor.insertValue(`![${imageAlt(file.name)}](${name})`); }
    catch (error) { notice(error.message, true); }
  }
  event.target.value = '';
});
$('#map-toggle').addEventListener('click', () => toggleMap().catch(error => notice(error.message, true)));
$('#map-clear').addEventListener('click', () => {
  state.mind?.destroy?.(); state.mind = null; state.map = null;
  $('#mindmap-canvas').replaceChildren(); $('#mindmap-panel').hidden = true;
  $('#map-toggle').textContent = '打开导图编辑器'; $('#map-clear').hidden = true;
  notice('思维导图已从当前草稿中移除，保存后生效。');
});
$('#logout-button').addEventListener('click', async () => {
  try { await api('/auth/logout', { method: 'POST' }); location.reload(); }
  catch (error) { notice(error.message, true); }
});

start();

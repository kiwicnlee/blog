export const CATEGORY_DIRECTORIES = { '机器人技术': 'tech', '生活随笔': 'life' };
export const CATEGORIES = Object.keys(CATEGORY_DIRECTORIES);
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const NODE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_MAP_NODES = 120;
const MAX_MAP_DEPTH = 8;

function assertString(value, name, min, max) {
  if (typeof value !== 'string') throw new Error(`${name} 必须是文本`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) throw new Error(`${name} 长度应为 ${min}-${max} 个字符`);
  return trimmed;
}

export function validateSlug(value) {
  if (typeof value !== 'string' || !SLUG.test(value)) {
    throw new Error('文章路径只能包含小写英文字母、数字和中划线，且不能以中划线结尾');
  }
  return value;
}

export function validateMindmap(raw) {
  if (raw == null) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !raw.nodeData) {
    throw new Error('思维导图数据格式不正确');
  }
  const seen = new Set();
  let count = 0;
  const visit = (node, depth) => {
    if (!node || typeof node !== 'object' || Array.isArray(node) || depth > MAX_MAP_DEPTH) {
      throw new Error('思维导图层级或节点格式不正确');
    }
    if (++count > MAX_MAP_NODES) throw new Error('思维导图节点不能超过 120 个');
    const topic = assertString(node.topic, '思维导图节点', 1, 64);
    const id = NODE_ID.test(node.id || '') ? node.id : `node-${count}`;
    if (seen.has(id)) throw new Error('思维导图节点 ID 重复');
    seen.add(id);
    if (node.children != null && !Array.isArray(node.children)) throw new Error('子节点必须是列表');
    return { id, topic, expanded: node.expanded !== false, children: (node.children || []).map(child => visit(child, depth + 1)) };
  };
  return { nodeData: visit(raw.nodeData, 0) };
}

export function validateDraft(input, author) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('文章数据格式不正确');
  const title = assertString(input.title, '标题', 1, 120);
  const slug = validateSlug(input.slug);
  const description = assertString(input.description || '', '摘要', 0, 300);
  const category = assertString(input.category, '分类', 1, 30);
  if (!CATEGORIES.includes(category)) throw new Error('请选择博客已有分类');
  if (!Array.isArray(input.tags) || input.tags.length > 10) throw new Error('标签不能超过 10 个');
  const tags = input.tags.map(tag => assertString(tag, '标签', 1, 30));
  if (new Set(tags).size !== tags.length) throw new Error('标签不能重复');
  if (typeof input.body !== 'string' || input.body.length > 200000) throw new Error('正文不能超过 20 万字符');
  const writer = assertString(author, '作者', 1, 80);
  const date = input.date || new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date()).replace(' ', 'T');
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(date)) {
    throw new Error('日期格式不正确');
  }
  const [year, month, day, hour, minute, second = 0] = date.split(/[-T:]/).map(Number);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 ||
      day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23 || minute > 59 || second > 59) {
    throw new Error('日期数值不正确');
  }
  return { title, slug, description, category, directory: CATEGORY_DIRECTORIES[category], tags, body: input.body, author: writer, date, mindmap: validateMindmap(input.mindmap) };
}

export function serializePost(draft) {
  const lines = [
    '---',
    `title: ${JSON.stringify(draft.title)}`,
    `date: ${JSON.stringify(draft.date.replace('T', ' '))}`,
    `description: ${JSON.stringify(draft.description)}`,
    `author: ${JSON.stringify(draft.author)}`,
    'categories:',
    `  - ${JSON.stringify(draft.category)}`,
    'tags:',
    ...draft.tags.map(tag => `  - ${JSON.stringify(tag)}`),
    '---',
    '',
  ];
  let body = draft.body.trim();
  if (draft.mindmap) {
    const image = '![文章思维导图](mindmap.svg)';
    body = body.includes('<!-- mindmap -->')
      ? body.replace('<!-- mindmap -->', image)
      : `${body}\n\n## 思维导图\n\n${image}`;
  }
  return `${lines.join('\n')}${body}\n`;
}

function escapeXml(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function topicLines(text) {
  const chars = [...text];
  const lines = [];
  while (chars.length && lines.length < 3) lines.push(chars.splice(0, 14).join(''));
  if (chars.length) lines[2] = `${lines[2].slice(0, 12)}…`;
  return lines;
}

export function renderMindmapSvg(mindmap) {
  if (!mindmap) throw new Error('缺少思维导图');
  const nodes = [];
  const edges = [];
  let leaf = 0;
  let maxDepth = 0;
  const layout = (node, depth, parent) => {
    maxDepth = Math.max(maxDepth, depth);
    const record = { topic: node.topic, depth, x: 28 + depth * 225, y: 0 };
    nodes.push(record);
    if (parent) edges.push([parent, record]);
    const children = node.children.map(child => layout(child, depth + 1, record));
    record.y = children.length ? (children[0].y + children[children.length - 1].y) / 2 : 58 + leaf++ * 88;
    return record;
  };
  layout(mindmap.nodeData, 0, null);
  const width = 28 + (maxDepth + 1) * 225;
  const height = Math.max(150, 55 + leaf * 88);
  const paths = edges.map(([from, to]) => `<path d="M ${from.x + 186} ${from.y} C ${from.x + 208} ${from.y}, ${to.x - 22} ${to.y}, ${to.x} ${to.y}" fill="none" stroke="#93a9af" stroke-width="2"/>`).join('');
  const boxes = nodes.map(node => {
    const root = node.depth === 0;
    const lines = topicLines(node.topic);
    const labels = lines.map((line, index) => `<tspan x="${node.x + 12}" y="${node.y - (lines.length - 1) * 9 + index * 18 + 5}">${escapeXml(line)}</tspan>`).join('');
    return `<rect x="${node.x}" y="${node.y - 30}" width="186" height="60" rx="9" fill="${root ? '#183544' : '#f7f8f6'}" stroke="${root ? '#183544' : '#c8d4d5'}"/><text font-family="sans-serif" font-size="14" font-weight="${root ? 700 : 500}" fill="${root ? '#ffffff' : '#183544'}">${labels}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="文章思维导图"><rect width="100%" height="100%" fill="#ffffff"/>${paths}${boxes}</svg>\n`;
}

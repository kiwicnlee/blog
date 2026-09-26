import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const editorRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(editorRoot, 'node_modules', 'vditor', 'dist');
const target = join(editorRoot, 'dist', 'vditor', 'dist');
await mkdir(target, { recursive: true });
for (const folder of ['css', 'images', 'js']) {
  await cp(join(source, folder), join(target, folder), { recursive: true });
}

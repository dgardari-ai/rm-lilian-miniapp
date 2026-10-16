import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { CONFIG } from '../model.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = '1.1.3';
const CURRENT = [
  'index.html', 'styles.css', 'app.js', 'model.mjs', 'robots.txt',
  'assets/IMG_4584.jpeg', 'assets/IMG_4914.jpeg',
  'assets/IMG_4915.jpeg', 'assets/IMG_4920.jpeg',
];
const ARCHIVE = [
  ...['index.html', 'styles.css', 'app.js', 'model.mjs', 'robots.txt',
    'assets/IMG_4584.jpeg', 'assets/IMG_4620.jpeg', 'assets/IMG_4622.jpeg',
    'assets/IMG_4627.jpeg'].map((name) => `versions/1.0/${name}`),
  ...CURRENT.map((name) => `versions/1.1/${name}`),
];
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

export function renderStaticHtml(input) {
  let html = input.replace(/content="1\.1\.\d+"/, `content="${VERSION}"`)
    .replace(/\?v=1\.1\.\d+/g, `?v=${VERSION}`);
  const text = {
    'intro-description': CONFIG.ui.introDescription,
    start: CONFIG.ui.startButton,
    'space-start': CONFIG.ui.spaceButton,
    'select-title': CONFIG.ui.branchTitle,
    'space-title': CONFIG.ui.spaceTitle,
    'city-prompt': CONFIG.ui.cityPrompt,
    'form-heading': CONFIG.ui.formTitle,
    'size-label': CONFIG.ui.sizeLabel,
    'height-label': CONFIG.ui.heightLabel,
    'size-error': CONFIG.ui.sizeError,
    'height-error': CONFIG.ui.heightError,
    'contact-hint': CONFIG.ui.contactHint,
    'submit-btn': CONFIG.branches[0].cta,
    'chosen-brand': CONFIG.branches[0].brand,
    'chosen-label': CONFIG.branches[0].cardTitle,
  };
  for (const [id, value] of Object.entries(text)) {
    const pattern = new RegExp(`(<(?:p|h2|button|legend|label)\\b[^>]*\\bid="${id}"[^>]*>)[^<]*(</(?:p|h2|button|legend|label)>)`);
    if (!pattern.test(html)) throw new Error(`Missing static text target: ${id}`);
    html = html.replace(pattern, (_, start, end) => start + escapeHtml(value) + end);
  }
  for (const branch of CONFIG.branches) {
    const pattern = new RegExp(`(<figure\\b[^>]*data-image-branch="${branch.key}"[^>]*>)([\\s\\S]*?)(</figure>)`);
    if (!pattern.test(html)) throw new Error(`Missing figure: ${branch.key}`);
    html = html.replace(pattern, (_, start, inner, end) => start + inner
      .replace(/<img\b[^>]*>/, `<img src="./${branch.image}" width="${branch.imageWidth}" height="${branch.imageHeight}" alt="${escapeHtml(branch.alt)}" referrerpolicy="no-referrer">`)
      .replace(/<figcaption>[^<]*<\/figcaption>/, `<figcaption>${escapeHtml(branch.collageLabel)}</figcaption>`) + end);
  }
  html = html.replace(/<img\b[^>]*>/g, (tag) => tag.includes('referrerpolicy=')
    ? tag : tag.replace(/>$/, ' referrerpolicy="no-referrer">'));
  html = html.replace(/(<input\b[^>]*id="height-input"[^>]*?)(?: placeholder="[^"]*")?(>)/,
    (_, start, end) => start.replace(/ placeholder="[^"]*"/, '') + ` placeholder="${escapeHtml(CONFIG.ui.heightPlaceholder)}"` + end);
  return html;
}

async function listFiles(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = [];
  for (const entry of entries) {
    const file = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink not allowed in release output: ${file}`);
    if (entry.isDirectory()) files.push(...await listFiles(file));
    else files.push(file);
  }
  return files;
}

export async function buildRelease(output) {
  const destination = resolve(output);
  if (destination === ROOT || ROOT.startsWith(destination + '/') || destination.startsWith(ROOT + '/')) {
    throw new Error('Release output must be outside the source checkout');
  }
  const allowed = new Set([...CURRENT, ...ARCHIVE]);
  for (const file of await listFiles(destination)) {
    if (!allowed.has(relative(destination, file))) throw new Error(`Unexpected output file: ${file}`);
  }
  const [sourceHtml, css, model, loader, app] = await Promise.all([
    'index.html', 'styles.css', 'model.mjs', 'image-loader.mjs', 'app.js',
  ].map((name) => readFile(join(ROOT, name), 'utf8')));
  const stripExports = (text) => text.replace(/^export (?=(?:const|function)\b)/gm, '');
  const appBody = app.replace(/^import [^\n]+;\r?\n/gm, '');
  const bundle = `(() => {\n'use strict';\n${stripExports(model)}\n${stripExports(loader)}\n${appBody}\n})();\n`;
  new Function(bundle); // Compile only: reject an invalid release without executing browser code.
  if (/<\/style/i.test(css)) throw new Error('CSS must not contain a closing style tag');
  let html = renderStaticHtml(sourceHtml)
    .replace(/  <link rel="stylesheet"[^>]*>\n/, () => `  <style>\n${css}\n</style>\n`)
    .replace(/  <script type="module"[^>]*><\/script>\n/, '');
  html = html.replace('</body>', () => `<script>\n${bundle.replace(/<\/script/gi, '<\\/script')}\n</script>\n</body>`);
  const compressed = gzipSync(Buffer.from(html), { level: 9 });
  if (compressed.length >= 16 * 1024) throw new Error(`Compressed index exceeds budget: ${compressed.length}`);
  await mkdir(destination, { recursive: true });
  const manifest = [];
  for (const name of [...CURRENT, ...ARCHIVE]) {
    let bytes;
    if (name === 'index.html') bytes = Buffer.from(html);
    else if (name === 'app.js') bytes = Buffer.from(bundle);
    else bytes = await readFile(join(ROOT, name));
    await mkdir(dirname(join(destination, name)), { recursive: true });
    await writeFile(join(destination, name), bytes);
    manifest.push({ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  return { version: VERSION, output: destination, files: manifest.length,
    indexBytes: Buffer.byteLength(html), indexGzipBytes: compressed.length,
    totalBytes: manifest.reduce((sum, file) => sum + file.bytes, 0), manifest };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildRelease(process.argv[2] || '/private/tmp/rm-lilian-resilient-release');
  console.log(JSON.stringify(result, null, 2));
}

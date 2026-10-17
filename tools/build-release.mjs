import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { CONFIG } from '../model.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = '1.1.4';
const PART_BYTES = 10000;
const STARTUP_LIMIT = 12 * 1024;
const MIRROR = 'https://dgardari-ai.github.io/rm-lilian-miniapp/releases/1.1.4/';
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
  const [sourceHtml, css, model, loader, app, sdk, startup] = await Promise.all([
    'index.html', 'styles.css', 'model.mjs', 'image-loader.mjs', 'app.js',
    'tools/vendor/telegram-web-app.js', 'tools/startup-loader.js',
  ].map((name) => readFile(join(ROOT, name), 'utf8')));
  const sdkHash = createHash('sha256').update(sdk).digest('hex');
  if (sdkHash !== '124bdff7ba3fe86c8ba5143467afec21e020405e74abdb92cfdda6c0ee3b5908') {
    throw new Error('Official Telegram SDK snapshot changed; review its source before updating the pin');
  }
  const stripExports = (text) => text.replace(/^export (?=(?:const|function)\b)/gm, '');
  const appBody = app.replace(/^import [^\n]+;\r?\n/gm, '');
  const bundle = `(() => {\n'use strict';\n${stripExports(model)}\n${stripExports(loader)}\n${appBody}\n})();\n`;
  new Function(bundle); // Compile only: reject an invalid release without executing browser code.
  if (/<\/style/i.test(css)) throw new Error('CSS must not contain a closing style tag');
  const runtime = new Map();
  function group(kind, label, text, id) {
    const bytes = Buffer.from(text);
    const parts = [];
    for (let offset = 0; offset < bytes.length; offset += PART_BYTES) {
      const part = bytes.subarray(offset, offset + PART_BYTES);
      const hash = createHash('sha256').update(part);
      const hex = hash.copy().digest('hex');
      const path = `runtime-1.1.4/${label}-${parts.length}-${hex.slice(0, 12)}.txt`;
      runtime.set(path, part);
      parts.push({ path, bytes: part.length, sha256: hash.digest('base64') });
    }
    return { kind, ...(id ? { id } : {}), parts };
  }
  const config = { version: VERSION, mirror: MIRROR, groups: [
    group('style', 'style', css),
    group('script', 'telegram', sdk, 'telegram-sdk'),
    group('script', 'model', stripExports(model)),
    group('script', 'images', stripExports(loader)),
    group('script', 'app', appBody),
  ] };
  if (startup.split('__RM_RELEASE__').length !== 2) throw new Error('Startup config placeholder must occur exactly once');
  const bootstrap = startup.replace('__RM_RELEASE__', JSON.stringify(config));
  new Function(bootstrap);
  // No external resource is needed to finish the first document. In particular,
  // stalled photos or the Telegram SDK cannot hold Telegram's loading overlay.
  let html = renderStaticHtml(sourceHtml)
    .replace('<html lang="ru">', '<html lang="ru" class="rm-booting">')
    .replace(/\s*<link rel="stylesheet"[^>]*>/, '')
    .replace(/\s*<script id="telegram-sdk"[^>]*><\/script>/, '')
    .replace(/\s*<script type="module"[^>]*><\/script>/, '')
    .replace(/(<img\b[^>]*?)\ssrc=/g, '$1 data-rm-src=')
    .replace(/\n[ \t]+/g, '\n');
  const shell = `<style>html{background:#9AA982;color:#14251a}body{margin:0}.rm-booting .app{display:none}#rm-boot{padding:48px 24px;font:18px/1.5 system-ui,sans-serif;max-width:500px;margin:auto}#rm-retry{font:inherit;background:#304630;color:#fff;border:0;border-radius:30px;padding:14px 24px;cursor:pointer}</style>`;
  html = html.replace('</head>', shell + '\n</head>');
  html = html.replace('<body>', '<body>\n<div id="rm-boot" role="status" aria-live="polite"><p id="rm-boot-message">Открываем подбор образа…</p><button id="rm-retry" type="button" hidden>Попробовать ещё раз</button></div>');
  html = html.replace('</body>', () => `<script>\n${bootstrap.replace(/<\/script/gi, '<\\/script')}\n</script>\n</body>`);
  const compressed = gzipSync(Buffer.from(html), { level: 9 });
  if (Buffer.byteLength(html) >= STARTUP_LIMIT) throw new Error(`Uncompressed index exceeds startup budget: ${Buffer.byteLength(html)}`);
  const allowed = new Set([...CURRENT, ...ARCHIVE, ...runtime.keys()]);
  for (const file of await listFiles(destination)) {
    if (!allowed.has(relative(destination, file))) throw new Error(`Unexpected output file: ${file}`);
  }
  await mkdir(destination, { recursive: true });
  const manifest = [];
  for (const name of allowed) {
    let bytes;
    if (name === 'index.html') bytes = Buffer.from(html);
    else if (name === 'app.js') bytes = Buffer.from(bundle);
    else if (runtime.has(name)) bytes = runtime.get(name);
    else bytes = await readFile(join(ROOT, name));
    await mkdir(dirname(join(destination, name)), { recursive: true });
    await writeFile(join(destination, name), bytes);
    manifest.push({ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  return { version: VERSION, output: destination, files: manifest.length,
    indexBytes: Buffer.byteLength(html), indexGzipBytes: compressed.length,
    startupLimit: STARTUP_LIMIT, runtimeParts: runtime.size,
    totalBytes: manifest.reduce((sum, file) => sum + file.bytes, 0), manifest };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildRelease(process.argv[2] || '/private/tmp/rm-lilian-resilient-release');
  console.log(JSON.stringify(result, null, 2));
}

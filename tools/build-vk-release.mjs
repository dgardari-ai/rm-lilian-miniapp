import { readFile, writeFile, mkdir, readdir, lstat, realpath } from 'node:fs/promises';
import { resolve, dirname, basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { CONFIG } from '../model.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = '1.1.2-vk-candidate.3';
const FILES = ['vk/index.html', 'vk/app.js', 'vk/styles.css', 'vk/transport.mjs'];
const SDK_SHA384 = '8K7KdNdtyf4bfQKPtkFUE/XpmZs7mvXeU35WT+sO8mWa2ThX7Cz4y4kzyAVcp2B2';
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
const escapeScript = (source) => source.replace(/<\/script/gi, '<\\/script');
// Only standalone comments in these known sources; preserve strings and inline code.
const stripSourceComments = (source) => source
  .replace(/^[\t ]*\/\*[\s\S]*?\*\/[\t ]*(?:\r?\n|$)/gm, '\n')
  .replace(/^[\t ]*\/\/[^\r\n]*(?:\r?\n|$)/gm, '\n');

function replaceRequired(input, pattern, replacement, label) {
  if (!pattern.test(input)) throw new Error(`Missing source element: ${label}`);
  return input.replace(pattern, replacement);
}

export function renderStaticVkHtml(input) {
  let html = replaceRequired(input, /(<meta name="app-version" content=")[^"]+(">)/,
    (_, start, end) => start + VERSION + end, 'app-version');
  for (const [id, value] of Object.entries({
    'intro-description': CONFIG.ui.introDescription,
    start: CONFIG.ui.startButton,
    'space-start': CONFIG.ui.spaceButton,
  })) {
    const pattern = new RegExp(`(<(?:p|button)\\b[^>]*\\bid="${id}"[^>]*>)[^<]*(</(?:p|button)>)`);
    html = replaceRequired(html, pattern,
      (_, start, end) => start + escapeHtml(value) + end, id);
  }
  for (const branch of CONFIG.branches) {
    const pattern = new RegExp(`(<figure\\b[^>]*data-image-branch="${branch.key}"[^>]*>)([\\s\\S]*?)(</figure>)`);
    html = replaceRequired(html, pattern, (_, start, inner, end) => start + inner
      .replace(/<img\b[^>]*>/, `<img src="../${branch.image}" width="${branch.imageWidth}" height="${branch.imageHeight}" alt="${escapeHtml(branch.alt)}" referrerpolicy="no-referrer">`)
      .replace(/<figcaption>[^<]*<\/figcaption>/, `<figcaption>${escapeHtml(branch.collageLabel)}</figcaption>`) + end,
    `figure ${branch.key}`);
  }
  return html.replace(/<img\b[^>]*>/g, (tag) => tag.includes('referrerpolicy=')
    ? tag : tag.replace(/>$/, ' referrerpolicy="no-referrer">'));
}

async function existingFiles(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink in output: ${path}`);
    if (entry.isDirectory()) files.push(...await existingFiles(path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Unexpected output entry: ${path}`);
  }
  return files;
}

export async function buildVkRelease(output) {
  // This one-purpose packager may write only a direct child of the private temp directory.
  const requested = resolve(output);
  const tempRoot = await realpath('/private/tmp');
  if (await realpath(dirname(requested)) !== tempRoot) {
    throw new Error('VK release output must be a separate directory directly under /private/tmp');
  }
  const destination = join(tempRoot, basename(requested));
  try {
    const info = await lstat(destination);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid release output directory');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const path of await existingFiles(destination)) {
    if (!FILES.includes(relative(destination, path))) throw new Error(`Unexpected output file: ${path}`);
  }

  const [sourceHtml, sharedCss, vkCss, model, transport, app, sdkBytes, license] = await Promise.all([
    'vk/index.html', 'styles.css', 'vk/styles.css', 'model.mjs', 'vk/transport.mjs',
    'vk/app.js', 'tools/vendor/vk-bridge-3.0.2.js', 'tools/vendor/vk-bridge-LICENSE',
  ].map((name) => readFile(join(ROOT, name))));
  if (createHash('sha384').update(sdkBytes).digest('base64') !== SDK_SHA384) {
    throw new Error('VK Bridge 3.0.2 does not match the pinned SHA-384');
  }
  const sdk = sdkBytes.toString('utf8')
    .replace(/^\s*\/\/[#@]\s*sourceMappingURL=.*(?:\r?\n|$)/gm, '');
  const licensedSdk = `/* @vkontakte/vk-bridge 3.0.2\n${license.toString('utf8').replace(/\*\//g, '*\\/')}\n*/\n${sdk}\n`;
  new Function(licensedSdk); // Syntax check only; never run the SDK in the packager.

  const stripExports = (text) => text.replace(/^export (?=(?:const|function)\b)/gm, '');
  let appBody = app.toString('utf8').replace(/^import [^\n]+;\r?\n/gm, '');
  appBody = replaceRequired(appBody,
    /new URL\('\.\.\/' \+ path, import\.meta\.url\)/,
    "new URL('../' + path, document.baseURI)", 'assetUrl');
  const bundle = stripSourceComments(`(() => {\n'use strict';\n${stripExports(model.toString('utf8'))}\n${stripExports(transport.toString('utf8'))}\n${appBody}\n})();\n`);
  if (/^\s*(?:import|export)\b/m.test(bundle) || bundle.includes('import.meta')) {
    throw new Error('Unexpected module dependency remains in the VK bundle');
  }
  new Function(bundle); // Compile without browser globals or side effects.
  const combinedCss = stripSourceComments(sharedCss.toString('utf8') + '\n' + vkCss.toString('utf8'));
  if (/<\/style/i.test(combinedCss)) throw new Error('CSS contains a closing style tag');

  let html = renderStaticVkHtml(sourceHtml.toString('utf8'));
  html = replaceRequired(html, /  <link rel="stylesheet" href="\.\.\/styles\.css[^\"]*">\r?\n/,
    () => `  <style>\n${combinedCss}\n</style>\n`, 'shared stylesheet');
  html = replaceRequired(html, /  <link rel="stylesheet" href="\.\/styles\.css[^\"]*">\r?\n/,
    '', 'VK stylesheet');
  html = replaceRequired(html, /  <script id="vk-sdk"[^>]*><\/script>\r?\n/,
    () => `  <script id="vk-sdk">\n${escapeScript(licensedSdk)}\n</script>\n`, 'VK SDK');
  html = replaceRequired(html, /  <script type="module" src="\.\/app\.js[^\"]*"><\/script>\r?\n/,
    '', 'VK application module');
  html = replaceRequired(html, /<\/body>/,
    () => `<script>\n${escapeScript(bundle)}\n</script>\n</body>`, 'body');
  if (/<script\b[^>]*\bsrc\s*=|<link\b[^>]*rel="stylesheet"|sourceMappingURL/i.test(html)) {
    throw new Error('An external executable/style dependency remains in the packed HTML');
  }
  const compressed = gzipSync(Buffer.from(html), { level: 9 });
  const compressed6 = gzipSync(Buffer.from(html), { level: 6 });
  if (Math.max(compressed.length, compressed6.length) >= 16 * 1024) {
    throw new Error(`Compressed index exceeds budget: level9=${compressed.length}, level6=${compressed6.length}`);
  }

  const outputBytes = new Map([
    ['vk/index.html', Buffer.from(html)], ['vk/app.js', Buffer.from(bundle)],
    ['vk/styles.css', vkCss], ['vk/transport.mjs', transport],
  ]);
  await mkdir(join(destination, 'vk'), { recursive: true });
  const manifest = [];
  for (const [path, bytes] of outputBytes) {
    await writeFile(join(destination, path), bytes);
    manifest.push({ path, bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  return { version: VERSION, output: destination, files: manifest.length,
    sdkSha384: SDK_SHA384, indexBytes: Buffer.byteLength(html),
    indexGzipBytes: compressed.length, indexGzipLevel6Bytes: compressed6.length, manifest };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await buildVkRelease(
    process.argv[2] || '/private/tmp/rm-lilian-vk-candidate-3-release',
  ), null, 2));
}

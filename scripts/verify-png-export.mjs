#!/usr/bin/env node
/**
 * Vérification réelle de l'export PNG (usage interne, non déployé).
 *
 *   node scripts/verify-png-export.mjs
 *
 * Compile `apps/web/src/lib/png-export.ts` avec esbuild — c'est donc **le vrai
 * module livré** qui est exercé, pas une copie — puis l'exécute dans Chrome
 * headless et contrôle :
 *   - qu'un PNG valide est produit aux dimensions demandées (1× et 2×) ;
 *   - que l'image n'est pas vide (variance des pixels) ;
 *   - qu'une ressource externe inaccessible déclenche bien un avertissement.
 *
 * Sortie : `tmp/png-export-result.json` et `tmp/png-export.png`.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { composeImage } from '../apps/api/dist/image/composer.js';

const ROOT = process.cwd();
const TMP = join(ROOT, 'tmp');
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('Aucun navigateur headless trouvé (définir CHROME_PATH)');
}

/**
 * Compile le module avec l'API JS d'esbuild : elle résout elle-même le binaire
 * de la plateforme, contrairement au script `bin/esbuild` (bash, inutilisable
 * depuis spawn sur Windows).
 */
async function bundleWithEsbuild(entry, outfile) {
  const base = join(ROOT, 'node_modules', '.pnpm');
  const found = readdirSync(base).find((name) => name.startsWith('esbuild@'));
  if (!found) throw new Error('esbuild introuvable dans le store pnpm');
  const modulePath = join(base, found, 'node_modules', 'esbuild', 'lib', 'main.js');
  const { build } = await import(pathToFileURL(modulePath).href);
  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    target: 'es2020',
    outfile,
    logLevel: 'warning',
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

async function main() {
  mkdirSync(TMP, { recursive: true });

  // 1. Compiler le module réel.
  await bundleWithEsbuild(join(ROOT, 'apps/web/src/lib/png-export.ts'), join(TMP, 'png-export.js'));
  console.log('module compilé → tmp/png-export.js');

  // 2. Préparer les visuels à convertir.
  const plain = composeImage({
    width: 1080,
    height: 1080,
    format: 'SQUARE',
    style: 'EDITORIAL',
    headline: 'Export PNG vérifié',
    subheadline: 'Le rendu canvas doit rester fidèle à l’aperçu.',
    callToAction: 'Télécharger',
    badge: 'Test',
    palette: ['#0f172a', '#7c5cff', '#22d3ee'],
    logoHref: null,
    referenceHref: null,
    brandName: 'Atelier Nord',
    slogan: 'Le contenu, sans bruit',
    seed: 1234,
  });

  const withExternal = composeImage({
    width: 1080,
    height: 1080,
    format: 'SQUARE',
    style: 'MINIMAL',
    headline: 'Logo distant',
    subheadline: null,
    callToAction: null,
    badge: null,
    palette: ['#e8e4dc', '#1f2937', '#7c5cff'],
    logoHref: 'https://cdn.invalid.example/logo-inexistant.svg',
    referenceHref: null,
    brandName: null,
    slogan: null,
    seed: 7,
  });

  writeFileSync(
    join(TMP, 'png-cases.json'),
    JSON.stringify({ plain: plain.svg, withExternal: withExternal.svg }),
  );

  writeFileSync(
    join(TMP, 'png-check.html'),
    `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Vérification export PNG</title>
<style>body{font-family:system-ui,sans-serif;padding:16px;background:#0b0d12;color:#e6e8ee}</style>
</head><body>
<pre id="result">en cours…</pre>
<div id="shots"></div>
<script type="module">
  import { exportPng, svgToPng, inlineSvgAssets } from './png-export.js';

  async function dimensions(blob) {
    const bitmap = await createImageBitmap(blob);
    const { width, height } = bitmap;
    bitmap.close();
    return { width, height };
  }

  /** Un PNG entièrement uni aurait une variance quasi nulle. */
  async function variance(blob) {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0, 64, 64);
    bitmap.close();
    const { data } = context.getImageData(0, 0, 64, 64);
    let sum = 0, sumSq = 0;
    const values = [];
    for (let i = 0; i < data.length; i += 4) {
      const value = (data[i] + data[i + 1] + data[i + 2]) / 3;
      values.push(value); sum += value; sumSq += value * value;
    }
    const mean = sum / values.length;
    return Math.round(Math.sqrt(sumSq / values.length - mean * mean) * 100) / 100;
  }

  async function run() {
    const cases = await (await fetch('./png-cases.json')).json();
    const out = {};

    const one = await exportPng({ svg: cases.plain, width: 1080, height: 1080, filename: 'test', scale: 1 });
    out.png1x = {
      bytes: one.blob.size,
      type: one.blob.type,
      filename: one.filename,
      ...(await dimensions(one.blob)),
      variance: await variance(one.blob),
      warnings: one.warnings,
    };

    const two = await exportPng({ svg: cases.plain, width: 1080, height: 1080, filename: 'test', scale: 2 });
    out.png2x = { bytes: two.blob.size, filename: two.filename, ...(await dimensions(two.blob)) };

    const inlined = await inlineSvgAssets(cases.withExternal);
    out.inlining = { warnings: inlined.warnings, stillExternal: inlined.svg.includes('cdn.invalid.example') };

    const direct = await svgToPng(cases.plain, 540, 540, { scale: 1 });
    out.small = { bytes: direct.size, ...(await dimensions(direct)) };

    try {
      await svgToPng('pas un svg', 100, 100);
      out.invalidSvg = 'aucune erreur (inattendu)';
    } catch (error) {
      out.invalidSvg = error.message;
    }

    const url = URL.createObjectURL(one.blob);
    const img = document.createElement('img');
    img.src = url;
    img.width = 320;
    document.getElementById('shots').append(img);

    const buffer = new Uint8Array(await one.blob.arrayBuffer());
    let binary = '';
    for (const byte of buffer) binary += String.fromCharCode(byte);
    const png = btoa(binary);

    document.getElementById('result').textContent = 'RESULT:' + JSON.stringify(out);
    await fetch('./report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result: out, png }),
    });
  }

  run().catch(async (error) => {
    document.getElementById('result').textContent = 'RESULT:' + JSON.stringify({ error: error.message });
    await fetch('./report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result: { error: error.message } }),
    }).catch(() => undefined);
  });
</script></body></html>`,
  );

  // 3. Servir tmp/ en HTTP (les modules ES ne se chargent pas depuis file://).
  let reportResolve;
  const report = new Promise((resolve) => (reportResolve = resolve));
  const server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0];
    if (path === '/report') {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        response.writeHead(204).end();
        try {
          reportResolve(JSON.parse(body));
        } catch {
          reportResolve({ result: { error: 'rapport illisible' } });
        }
      });
      return;
    }
    const file = join(TMP, path === '/' ? 'png-check.html' : path.slice(1));
    if (!file.startsWith(TMP) || !existsSync(file)) {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    response.end(readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  console.log(`serveur local → http://127.0.0.1:${port}/`);

  // 4. Chrome headless : le rapport revient par HTTP, puis on ferme le navigateur.
  const chrome = findChrome();
  const child = spawn(chrome, [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--window-size=420,480',
    `http://127.0.0.1:${port}/`,
  ]);
  child.stderr.on('data', () => undefined);

  const timeout = new Promise((resolve) =>
    setTimeout(() => resolve({ result: { error: 'délai dépassé (60 s)' } }), 60_000),
  );
  const payload = await Promise.race([report, timeout]);
  child.kill();
  server.close();

  const result = payload.result ?? {};
  if (result.error) throw new Error(result.error);
  if (typeof payload.png === 'string') {
    writeFileSync(join(TMP, 'png-export.png'), Buffer.from(payload.png, 'base64'));
  }
  writeFileSync(join(TMP, 'png-export-result.json'), JSON.stringify(result, null, 2));

  // 5. Verdict.
  const failures = [];
  const check = (label, condition, detail) => {
    console.log(`${condition ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!condition) failures.push(label);
  };

  console.log('\nExport PNG :');
  check('PNG 1× produit', result.png1x?.bytes > 1000, `${result.png1x?.bytes} octets`);
  check('Type MIME image/png', result.png1x?.type === 'image/png', result.png1x?.type);
  check(
    'Dimensions 1× = 1080×1080',
    result.png1x?.width === 1080 && result.png1x?.height === 1080,
    `${result.png1x?.width}×${result.png1x?.height}`,
  );
  check(
    'Nom de fichier sans suffixe',
    result.png1x?.filename === 'test.png',
    result.png1x?.filename,
  );
  check('Image non vide', result.png1x?.variance > 5, `variance ${result.png1x?.variance}`);
  check('Aucun avertissement sans ressource externe', result.png1x?.warnings?.length === 0);
  check(
    'Dimensions 2× = 2160×2160',
    result.png2x?.width === 2160 && result.png2x?.height === 2160,
    `${result.png2x?.width}×${result.png2x?.height}`,
  );
  check('Suffixe @2x', result.png2x?.filename === 'test@2x.png', result.png2x?.filename);
  check('Le PNG 2× est plus lourd', result.png2x?.bytes > result.png1x?.bytes);
  check('Dimensions libres respectées', result.small?.width === 540, `${result.small?.width}`);
  check(
    'Un SVG invalide est rejeté',
    typeof result.invalidSvg === 'string' && /interprété/i.test(result.invalidSvg),
    result.invalidSvg,
  );
  check(
    'Une ressource externe inaccessible est signalée',
    result.inlining?.warnings?.length === 1,
    JSON.stringify(result.inlining?.warnings),
  );
  check('Le SVG reste intact quand l’intégration échoue', result.inlining?.stillExternal === true);

  if (failures.length > 0) {
    console.error(`\n${failures.length} contrôle(s) en échec.`);
    process.exitCode = 1;
    return;
  }
  console.log('\nExport PNG vérifié.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

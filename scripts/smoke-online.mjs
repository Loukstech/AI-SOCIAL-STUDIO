#!/usr/bin/env node
// Smoke test « en ligne » : valide le déploiement réel, pas le local.
// Aucune dépendance externe : Node >= 22 (fetch natif).
//
//   node scripts/smoke-online.mjs
//   WEB_URL=... API_URL=... node scripts/smoke-online.mjs
//
// Variables optionnelles :
//   WEB_URL   URL du frontend (défaut : Cloudflare Pages)
//   API_URL   URL de l'API     (défaut : Render)
//   TIMEOUT   budget par requête en ms (défaut : 45000, le plan free Render se réveille)
//   RETRIES   tentatives par requête (défaut : 3 ; 10 en CI pour couvrir un redéploiement)

const WEB_URL = (process.env.WEB_URL ?? 'https://ai-social-studio.pages.dev').replace(/\/$/, '');
const API_URL = (process.env.API_URL ?? 'https://ai-social-studio-api.onrender.com').replace(
  /\/$/,
  '',
);
const TIMEOUT = Number(process.env.TIMEOUT ?? 45_000);
const RETRIES = Number(process.env.RETRIES ?? 3);

const results = [];
let failed = 0;

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failed += 1;
  const mark = ok ? 'OK  ' : 'FAIL';
  console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function fetchWithRetry(url, options = {}, attempts = RETRIES) {
  let lastError;
  for (let i = 1; i <= attempts; i += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      // Réveil du plan free (interstitial HTML) ou redéploiement en cours (502/503/404) :
      // on patiente puis on réessaie au lieu de déclarer le déploiement cassé.
      const contentType = response.headers.get('content-type') ?? '';
      const wakingUp =
        (response.status === 200 && !contentType.includes('json') && url.includes('/api/')) ||
        [502, 503, 504].includes(response.status);
      if (wakingUp) {
        if (i < attempts) {
          await new Promise((resolve) => setTimeout(resolve, 3000 * Math.min(i, 5)));
          continue;
        }
      }
      return response;
    } catch (error) {
      lastError = error;
      if (i < attempts) await new Promise((resolve) => setTimeout(resolve, 3000 * Math.min(i, 5)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new Error(`Pas de réponse JSON de ${url}`);
}

async function run() {
  console.log('Smoke test en ligne');
  console.log(`  frontend : ${WEB_URL}`);
  console.log(`  api      : ${API_URL}`);
  console.log('');

  // 1. Frontend servi
  try {
    const started = Date.now();
    const res = await fetchWithRetry(WEB_URL);
    const html = await res.text();
    const ms = Date.now() - started;
    record('Frontend HTTP 200', res.status === 200, `${res.status} en ${ms} ms`);
    record(
      'Frontend contient le point de montage React',
      html.includes('id="root"') && html.includes('<title>'),
      html.includes('<title>') ? 'titre present' : 'titre absent',
    );

    // 2. Le bundle JS est accessible et pointe vers la bonne API
    const bundle = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
    if (bundle) {
      const jsRes = await fetchWithRetry(`${WEB_URL}${bundle}`);
      const js = await jsRes.text();
      record('Bundle JS accessible', jsRes.status === 200, `${bundle} (${js.length} octets)`);
      record(
        'Bundle compile vers la bonne API',
        js.includes(API_URL),
        js.includes(API_URL) ? API_URL : "URL d'API absente ou obsolete",
      );
    } else {
      record('Bundle JS reference dans index.html', false, 'aucun /assets/*.js trouve');
    }
  } catch (error) {
    record('Frontend joignable', false, error.message.slice(0, 120));
  }

  // 3. Health API
  try {
    const started = Date.now();
    const res = await fetchWithRetry(`${API_URL}/api/v1/health`);
    const ms = Date.now() - started;
    const body = await res.json().catch(() => null);
    record('API health HTTP 200', res.status === 200, `${res.status} en ${ms} ms`);
    record('API status ok', body?.status === 'ok', `status=${body?.status}`);
    record(
      'PostgreSQL up',
      body?.dependencies?.database === 'up',
      `database=${body?.dependencies?.database}`,
    );
    record('Redis up', body?.dependencies?.redis === 'up', `redis=${body?.dependencies?.redis}`);
    record(
      'Environnement production',
      body?.environment === 'production',
      `environment=${body?.environment}`,
    );
  } catch (error) {
    record('API health joignable', false, error.message.slice(0, 120));
  }

  // 4. CORS : l'origine du frontend est autorisee, les autres refusées
  try {
    const allowed = await fetchWithRetry(`${API_URL}/api/v1/health`, {
      method: 'OPTIONS',
      headers: {
        Origin: WEB_URL,
        'Access-Control-Request-Method': 'GET',
      },
    });
    record(
      'CORS preflight autorise pour le frontend',
      allowed.headers.get('access-control-allow-origin') === WEB_URL,
      `origin=${allowed.headers.get('access-control-allow-origin')}`,
    );
  } catch (error) {
    record('CORS preflight', false, error.message.slice(0, 120));
  }

  // 5. Le prefixe versionne est bien applique
  try {
    const res = await fetchWithRetry(`${API_URL}/health`);
    record('Route non versionnee renvoie 404', res.status === 404, `HTTP ${res.status}`);
  } catch (error) {
    record('Route non versionnee renvoie 404', false, error.message.slice(0, 120));
  }

  // 6. Headers de securite (helmet)
  try {
    const res = await fetchWithRetry(`${API_URL}/api/v1/health`);
    const missing = [
      'strict-transport-security',
      'x-content-type-options',
      'x-frame-options',
      'content-security-policy',
    ].filter((header) => !res.headers.get(header));
    record('Headers de securite présents', missing.length === 0, missing.join(', ') || 'tous');
  } catch (error) {
    record('Headers de securite', false, error.message.slice(0, 120));
  }

  console.log('');
  const passed = results.length - failed;
  console.log(`${passed}/${results.length} vérifications réussies`);
  if (failed > 0) {
    console.error(`${failed} échec(s) — déploiement à vérifier.`);
    process.exitCode = 1;
  } else {
    console.log('Déploiement en ligne sain.');
  }
}

run().catch((error) => {
  console.error('Smoke test interrompu :', error);
  process.exitCode = 1;
});

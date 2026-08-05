/**
 * Mini-serveur HTTP local pour le skill produits-nom.
 *
 * Sert la page web (page.html) + les images téléchargées + une mini API.
 *
 * Usage : node scripts/server.cjs <chemin-session.json> [port]
 *
 * Le fichier session.json doit déjà exister avec la structure :
 * {
 *   "version": 1,
 *   "created_at": "...",
 *   "status": "in_progress",
 *   "products": [{ reference, name, description, category, names, descs, ... }],
 *   "decisions": {},
 *   "awaitingRegen": null
 * }
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');

const SESSION_FILE = process.argv[2];
const PORT = parseInt(process.argv[3] || process.env.PORT || '3010', 10);

if (!SESSION_FILE) {
  console.error('Usage: node server.cjs <chemin-session.json> [port]');
  process.exit(1);
}

if (!fs.existsSync(SESSION_FILE)) {
  console.error(`Fichier session introuvable : ${SESSION_FILE}`);
  process.exit(1);
}

const IMAGES_DIR = path.join(os.homedir(), 'Desktop', 'beli-images-temp');
const PAGE_FILE = path.join(__dirname, 'page.html');

// Cache en mémoire des tags et sous-cat (rechargé à chaque démarrage)
let TAG_CACHE = []; // [{ id, name }]
let SUBCAT_CACHE = {}; // { [categoryId]: [{ id, name }] }

// Sauvegarde automatique sur le VPS (filet de secours contre les crashs PC)
const VPS_BACKUP_PATH = '/var/www/beliandjolie/data/name-session-backup/session.json';
const VPS_HOST = 'root@72.61.106.128';

function readSession() {
  try {
    return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
  } catch (e) {
    return null;
  }
}

let vpsSyncPending = false;
let vpsSyncQueued = false;

function syncToVps() {
  // Coalesce : si une sync est en cours, on note qu'il faudra en refaire une après
  if (vpsSyncPending) { vpsSyncQueued = true; return; }
  vpsSyncPending = true;
  const posixSrc = SESSION_FILE
    .replace(/^([A-Z]):/i, (_, d) => `/${d.toLowerCase()}`)
    .replace(/\\/g, '/');
  const child = spawn('bash', ['-c',
    `scp -o ConnectTimeout=5 -o BatchMode=yes "${posixSrc}" "${VPS_HOST}:${VPS_BACKUP_PATH}" > /dev/null 2>&1`
  ], { detached: true, stdio: 'ignore' });
  child.on('exit', () => {
    vpsSyncPending = false;
    if (vpsSyncQueued) { vpsSyncQueued = false; syncToVps(); }
  });
  child.unref();
}

function writeSession(s) {
  s.updated_at = new Date().toISOString();
  const tmp = SESSION_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, SESSION_FILE);
  syncToVps();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

async function loadAutocompleteCaches() {
  const s = readSession();
  if (!s || !s.products) return;

  const tagMap = new Map();
  const subMap = {};
  for (const p of s.products) {
    for (const t of (p.tags || [])) {
      if (t && t.id) tagMap.set(t.id, t.name);
    }
    if (p.category && p.category.id) {
      subMap[p.category.id] = subMap[p.category.id] || new Map();
      const m = subMap[p.category.id];
      for (const sc of (p.category.availableSubCategories || [])) {
        if (sc && sc.id) m.set(sc.id, sc.name);
      }
    }
  }
  TAG_CACHE = Array.from(tagMap.entries()).map(([id, name]) => ({ id, name }));
  SUBCAT_CACHE = Object.fromEntries(
    Object.entries(subMap).map(([cid, m]) => [
      cid,
      Array.from(m.entries()).map(([id, name]) => ({ id, name })),
    ]),
  );
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname === '/' && req.method === 'GET') {
      const html = fs.readFileSync(PAGE_FILE, 'utf-8');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(html);
      return;
    }

    if (url.pathname === '/api/session' && req.method === 'GET') {
      const s = readSession();
      if (!s) return sendJSON(res, 500, { error: 'session unreadable' });
      return sendJSON(res, 200, s);
    }

    if (url.pathname === '/api/validate' && req.method === 'POST') {
      const body = await readBody(req);
      const { ref, name, description, tagNames, subCategoryNames, compositionRefs } = body;
      if (!ref || !name || !description) {
        return sendJSON(res, 400, { error: 'ref, name, description requis' });
      }
      const s = readSession();
      if (!s) return sendJSON(res, 500, { error: 'session unreadable' });

      // Retrouver la traduction anglaise correspondant au FR choisi via son index
      // dans les propositions. Si le FR ne correspond à aucune proposition (édition
      // manuelle), on laisse nameEn/descriptionEn vides — PFS prendra le relais.
      let nameEn = null;
      let descriptionEn = null;
      const product = (s.products || []).find((p) => p.reference === ref);
      if (product) {
        const nameIdx = (product.names || []).indexOf(name);
        const descIdx = (product.descs || []).indexOf(description);
        if (nameIdx >= 0 && Array.isArray(product.names_en) && product.names_en[nameIdx]) {
          nameEn = product.names_en[nameIdx];
        }
        if (descIdx >= 0 && Array.isArray(product.descs_en) && product.descs_en[descIdx]) {
          descriptionEn = product.descs_en[descIdx];
        }
      }

      s.decisions = s.decisions || {};
      s.decisions[ref] = {
        name,
        description,
        nameEn,
        descriptionEn,
        tagNames: Array.isArray(tagNames) ? tagNames : [],
        subCategoryNames: Array.isArray(subCategoryNames) ? subCategoryNames : [],
        compositionRefs: Array.isArray(compositionRefs) ? compositionRefs : [],
        validated_at: new Date().toISOString(),
      };
      writeSession(s);
      return sendJSON(res, 200, { ok: true, count: Object.keys(s.decisions).length });
    }

    if (url.pathname === '/api/request-regen' && req.method === 'POST') {
      const body = await readBody(req);
      const { ref, comment, what, answers } = body;
      if (!ref || !what) return sendJSON(res, 400, { error: 'ref et what requis' });
      if (!['name', 'description', 'both', 'all'].includes(what)) {
        return sendJSON(res, 400, { error: 'what invalide' });
      }
      const s = readSession();
      if (!s) return sendJSON(res, 500, { error: 'session unreadable' });
      s.awaitingRegen = {
        ref,
        comment: comment || '',
        what,
        answers: Array.isArray(answers) ? answers : [],
        requested_at: new Date().toISOString(),
      };
      writeSession(s);
      return sendJSON(res, 200, { ok: true });
    }

    // Phase « collecting_hints » : la cliente tape un indice pour un produit.
    // Autosave à chaque frappe (debounced côté front).
    if (url.pathname === '/api/save-hint' && req.method === 'POST') {
      const body = await readBody(req);
      const { ref, hint } = body;
      if (!ref) return sendJSON(res, 400, { error: 'ref requis' });
      const s = readSession();
      if (!s) return sendJSON(res, 500, { error: 'session unreadable' });
      s.hints = s.hints || {};
      s.hints[ref] = typeof hint === 'string' ? hint : '';
      writeSession(s);
      return sendJSON(res, 200, { ok: true });
    }

    // Phase « collecting_hints » → clic sur "Générer les propositions".
    // On bascule la session en awaiting_generation et on attend que la cliente
    // revienne dans Claude Code taper « génère ».
    if (url.pathname === '/api/request-generation' && req.method === 'POST') {
      const s = readSession();
      if (!s) return sendJSON(res, 500, { error: 'session unreadable' });
      s.phase = 'awaiting_generation';
      s.awaiting_generation_at = new Date().toISOString();
      writeSession(s);
      return sendJSON(res, 200, { ok: true });
    }

    if (url.pathname === '/api/push-all' && req.method === 'POST') {
      const s = readSession();
      if (!s) return sendJSON(res, 500, { error: 'session unreadable' });
      const decisions = s.decisions || {};
      const items = Object.entries(decisions).map(([ref, d]) => ({
        ref,
        name: d.name,
        description: d.description,
        nameEn: d.nameEn || undefined,
        descriptionEn: d.descriptionEn || undefined,
        tagNames: d.tagNames || [],
        subCategoryNames: d.subCategoryNames || [],
        compositionRefs: d.compositionRefs || [],
      }));
      if (items.length === 0) {
        return sendJSON(res, 400, { error: 'aucune validation à envoyer' });
      }

      // Build payload
      const payloadPath = path.join(os.tmpdir(), `beli-nom-payload-${Date.now()}.json`);
      fs.writeFileSync(
        payloadPath,
        JSON.stringify({ items }, null, 2),
      );

      // Launch scp + ssh in background. We rely on bash being available
      // (Git Bash / WSL / Cygwin). Path is converted from Windows to POSIX.
      const posixPayload = payloadPath
        .replace(/^([A-Z]):/i, (_, d) => `/${d.toLowerCase()}`)
        .replace(/\\/g, '/');

      const bashCmd = [
        `scp "${posixPayload}" root@72.61.106.128:/tmp/_apply_payload.json`,
        `ssh root@72.61.106.128 'cd /var/www/beliandjolie && NODE_OPTIONS="-r ./scripts/_lib_no_next_cache.cjs" npx tsx scripts/name-batch-apply.ts /tmp/_apply_payload.json && rm /tmp/_apply_payload.json' > /tmp/beli-push.log 2>&1`,
        `rm "${posixPayload}"`,
      ].join(' && ');

      const child = spawn('bash', ['-c', bashCmd], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();

      s.status = 'pushed';
      s.pushed_at = new Date().toISOString();
      s.pushed_count = items.length;
      writeSession(s);

      return sendJSON(res, 200, { ok: true, count: items.length });
    }

    if (url.pathname === '/api/autocomplete/tags' && req.method === 'GET') {
      const q = (url.searchParams.get('q') || '').toLowerCase().trim();
      const matches = q
        ? TAG_CACHE.filter((t) => t.name.toLowerCase().includes(q)).slice(0, 20)
        : TAG_CACHE.slice(0, 20);
      return sendJSON(res, 200, { results: matches });
    }

    if (url.pathname === '/api/autocomplete/subcats' && req.method === 'GET') {
      const q = (url.searchParams.get('q') || '').toLowerCase().trim();
      const categoryId = url.searchParams.get('categoryId') || '';
      const pool = SUBCAT_CACHE[categoryId] || [];
      const matches = q
        ? pool.filter((sc) => sc.name.toLowerCase().includes(q)).slice(0, 20)
        : pool.slice(0, 20);
      return sendJSON(res, 200, { results: matches });
    }

    if (url.pathname.startsWith('/images/') && req.method === 'GET') {
      const filename = path.basename(decodeURIComponent(url.pathname.replace('/images/', '')));
      if (!/^[a-z0-9._-]+\.webp$/i.test(filename)) {
        res.writeHead(400); return res.end();
      }
      const filepath = path.join(IMAGES_DIR, filename);
      if (!fs.existsSync(filepath)) {
        res.writeHead(404); return res.end();
      }
      const stat = fs.statSync(filepath);
      res.writeHead(200, {
        'Content-Type': 'image/webp',
        'Content-Length': stat.size,
        'Cache-Control': 'public, max-age=3600',
      });
      fs.createReadStream(filepath).pipe(res);
      return;
    }

    if (url.pathname === '/favicon.ico') {
      res.writeHead(204); return res.end();
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } catch (e) {
    console.error('Server error:', e);
    sendJSON(res, 500, { error: e.message || 'internal error' });
  }
});

server.listen(PORT, '127.0.0.1', async () => {
  await loadAutocompleteCaches();
  console.log(`\n  🟢 Serveur prêt sur http://localhost:${PORT}`);
  console.log(`  📄 Session : ${SESSION_FILE}`);
  console.log(`  🖼  Images  : ${IMAGES_DIR}`);
  console.log(`  💡 Tags en cache : ${TAG_CACHE.length}`);
  console.log(`\n  Ouvrez http://localhost:${PORT} dans votre navigateur.\n`);
});

process.on('SIGINT', () => {
  console.log('\n  Serveur arrêté.');
  process.exit(0);
});

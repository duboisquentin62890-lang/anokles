// Sauvegarde automatique des clés → webhook Discord (fichier key.json) toutes les heures.
// + import/restauration d'un key.json dans la base.
const { db } = require('./db');

// Webhook configurable via env (KEY_BACKUP_WEBHOOK dans .env). Jamais en dur dans le code.
const WEBHOOK = process.env.KEY_BACKUP_WEBHOOK || '';

const INTERVAL_MS = 60 * 60 * 1000; // 1 heure

// Toutes les clés + slug produit (pour ré-import fiable même si les IDs changent).
function collectKeys() {
  return db.prepare(`
    SELECT k.key_code, p.slug AS product_slug, k.duration_days, k.note, k.created_by,
           k.discord_id, k.hwid, k.redeemed_at, k.expires_at, k.status, k.ip, k.created_at
    FROM license_keys k
    JOIN products p ON p.id = k.product_id
    ORDER BY k.id ASC
  `).all();
}

// Envoie key.json au webhook Discord. Renvoie { ok, count }.
async function sendKeyBackup(reason = 'auto') {
  if (typeof fetch !== 'function') return { ok: false, error: 'fetch indisponible' };
  if (!WEBHOOK) return { ok: false, error: 'KEY_BACKUP_WEBHOOK non configuré (.env)' };
  const keys = collectKeys();
  const payload = { exported_at: new Date().toISOString(), reason, count: keys.length, keys };
  const json = JSON.stringify(payload, null, 2);

  const form = new FormData();
  form.append('payload_json', JSON.stringify({
    content: `🔐 Backup clés Anokles — **${keys.length}** clé(s) · ${reason} · ${new Date().toLocaleString('fr-FR')}`,
  }));
  form.append('files[0]', new Blob([json], { type: 'application/json' }), 'key.json');

  try {
    const res = await fetch(WEBHOOK, { method: 'POST', body: form });
    if (!res.ok) return { ok: false, error: `webhook HTTP ${res.status}`, count: keys.length };
    return { ok: true, count: keys.length };
  } catch (e) {
    return { ok: false, error: e.message, count: keys.length };
  }
}

// Restaure des clés depuis un key.json. { keys:[...] } ou tableau brut.
// N'écrase pas une clé existante (INSERT OR IGNORE sur key_code). Renvoie { imported, skipped, missingProduct }.
function importKeys(input) {
  const list = Array.isArray(input) ? input : (input && Array.isArray(input.keys) ? input.keys : null);
  if (!list) throw new Error('Format invalide : attendu un tableau ou { keys: [...] }');

  const findBySlug = db.prepare('SELECT id FROM products WHERE slug = ?');
  const findById = db.prepare('SELECT id FROM products WHERE id = ?');
  const existing = db.prepare('SELECT 1 FROM license_keys WHERE key_code = ?');
  const insert = db.prepare(`
    INSERT INTO license_keys
      (key_code, product_id, duration_days, note, created_by, discord_id, hwid, redeemed_at, expires_at, status, ip, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
  `);

  let imported = 0; let skipped = 0; let missingProduct = 0;
  const tx = db.transaction(() => {
    for (const k of list) {
      if (!k || !k.key_code) { skipped++; continue; }
      if (existing.get(k.key_code)) { skipped++; continue; }
      let product = null;
      if (k.product_slug) product = findBySlug.get(k.product_slug);
      if (!product && k.product_id) product = findById.get(k.product_id);
      if (!product) { missingProduct++; continue; }
      insert.run(
        String(k.key_code),
        product.id,
        Number(k.duration_days) || 30,
        k.note || null,
        k.created_by || 'import',
        k.discord_id || null,
        k.hwid || null,
        k.redeemed_at || null,
        k.expires_at || null,
        k.status || 'unused',
        k.ip || null,
        k.created_at || null,
      );
      imported++;
    }
  });
  tx();
  return { imported, skipped, missingProduct, total: list.length };
}

// Démarre la sauvegarde horaire. Un premier envoi est fait ~30 s après le boot.
function startKeyBackups() {
  if (!WEBHOOK) {
    console.log('[backup] KEY_BACKUP_WEBHOOK non configuré — sauvegarde horaire désactivée');
    return;
  }
  const boot = setTimeout(() => {
    sendKeyBackup('boot').then((r) => {
      if (r.ok) console.log(`[backup] envoi initial OK (${r.count} clés)`);
      else console.warn('[backup] envoi initial échoué :', r.error);
    });
  }, 30 * 1000);
  boot.unref?.();

  const timer = setInterval(() => {
    sendKeyBackup('auto-1h').then((r) => {
      if (r.ok) console.log(`[backup] horaire OK (${r.count} clés)`);
      else console.warn('[backup] horaire échoué :', r.error);
    });
  }, INTERVAL_MS);
  timer.unref?.();
}

module.exports = { collectKeys, sendKeyBackup, importKeys, startKeyBackups };

const express = require('express');
const { db, generateKeyCode } = require('../db');
const { authRequired, adminRequired } = require('../auth');

const router = express.Router();

const DURATIONS = {
  '1d': 1,
  '3d': 3,
  '7d': 7,
  '1w': 7,
  '14d': 14,
  '30d': 30,
  '1m': 30,
  '90d': 90,
  '3m': 90,
  'lifetime': 36500,
  'lftm': 36500,
  'life': 36500,
  // Presets du site (ANK-<CODE>)
  'hours': 1 / 24,
  'hour': 1 / 24,
  'day': 1,
  'week': 7,
  'month': 30,
  'media': 36500,
};

// Presets proposés dans le panel admin / bot (code embarqué dans la clé)
const DURATION_PRESETS = [
  { code: 'HOURS', value: 'hours', label: '1 heure' },
  { code: 'DAY', value: 'day', label: '1 jour' },
  { code: 'WEEK', value: 'week', label: '1 semaine' },
  { code: 'MONTH', value: 'month', label: '1 mois' },
  { code: 'LFTM', value: 'lftm', label: 'Lifetime' },
  { code: 'MEDIA', value: 'media', label: 'Média / créateur' },
];

function resolveDuration(input) {
  if (typeof input === 'number') return input;
  const raw = String(input || '30d').toLowerCase().trim();
  if (DURATIONS[raw] !== undefined) return DURATIONS[raw];
  const m = raw.match(/^(\d+)d$/);
  if (m) return Number(m[1]);
  const n = Number(raw);
  return Number.isFinite(n) ? n : 30;
}

// Renvoie le token de durée embarqué dans la clé (ANK-<CODE>-…)
const DURATION_CODES = {
  hours: 'HOURS', hour: 'HOURS', '1h': 'HOURS',
  day: 'DAY', '1d': 'DAY',
  week: 'WEEK', '1w': 'WEEK', '7d': 'WEEK',
  month: 'MONTH', '1m': 'MONTH', '30d': 'MONTH',
  lftm: 'LFTM', lifetime: 'LFTM', life: 'LFTM',
  media: 'MEDIA',
};

function codeForDuration(input) {
  const raw = String(input ?? '').toLowerCase().trim();
  if (DURATION_CODES[raw]) return DURATION_CODES[raw];
  const days = resolveDuration(raw);
  if (days >= 36500) return 'LFTM';
  if (days >= 30) return 'MONTH';
  if (days >= 7) return 'WEEK';
  if (days >= 1) return 'DAY';
  return 'HOURS';
}

// Durée réelle = (durée d'une unité) × quantité.
// La quantité N'apparaît PAS dans la clé : le token reste MONTH/DAY/WEEK/HOURS.
// Lifetime / média ne sont jamais multipliés.
function resolveDays(duration, quantity = 1) {
  const base = resolveDuration(duration);
  if (base >= 36500) return base;
  const q = Math.max(1, Math.min(Number(quantity) || 1, 3650));
  return base * q;
}

router.get('/', adminRequired, (req, res) => {
  const { status, product_id, q } = req.query;
  let sql = `
    SELECT k.*, p.name AS product_name, u.username AS redeemed_username
    FROM license_keys k
    JOIN products p ON p.id = k.product_id
    LEFT JOIN users u ON u.id = k.redeemed_by
    WHERE 1=1
  `;
  const params = [];
  if (status) { sql += ' AND k.status = ?'; params.push(status); }
  if (product_id) { sql += ' AND k.product_id = ?'; params.push(product_id); }
  if (q) {
    sql += ' AND (k.key_code LIKE ? OR k.discord_id LIKE ? OR k.note LIKE ? OR k.hwid LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  sql += ' ORDER BY k.id DESC LIMIT 500';
  res.json({ keys: db.prepare(sql).all(...params) });
});

router.post('/generate', adminRequired, (req, res) => {
  const { product_id, product_slug, duration, quantity = 1, amount = 1, note, discord_id, prefix } = req.body || {};
  let product = null;
  if (product_id) product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
  if (!product && product_slug) product = db.prepare('SELECT * FROM products WHERE slug = ?').get(product_slug);
  if (!product) return res.status(400).json({ error: 'Produit invalide' });
  if (product.is_free) return res.status(400).json({ error: 'Impossible de générer une clé pour un produit gratuit' });

  const days = resolveDays(duration, quantity);
  const durationCode = codeForDuration(duration);
  const count = Math.min(Math.max(Number(amount) || 1, 1), 100);
  const keys = [];
  const insert = db.prepare(`
    INSERT INTO license_keys (key_code, product_id, duration_days, note, created_by, discord_id, status)
    VALUES (?, ?, ?, ?, ?, ?, 'unused')
  `);

  const tx = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const code = generateKeyCode(durationCode);
      const info = insert.run(code, product.id, days, note || null, req.user.username, discord_id || null);
      keys.push(db.prepare('SELECT * FROM license_keys WHERE id = ?').get(info.lastInsertRowid));
    }
  });
  tx();
  res.json({ keys, product: { id: product.id, name: product.name, slug: product.slug }, duration_days: days });
});

router.post('/redeem', authRequired, (req, res) => {
  const { key, hwid } = req.body || {};
  if (!key) return res.status(400).json({ error: 'Clé requise' });
  const row = db.prepare('SELECT * FROM license_keys WHERE key_code = ?').get(key.trim());
  if (!row) return res.status(404).json({ error: 'Clé introuvable' });
  if (row.status !== 'unused' && row.redeemed_by !== req.user.id) {
    return res.status(400).json({ error: `Clé déjà utilisée (${row.status})` });
  }

  const ip = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.ip;

  // durée en jours (fractionnaire possible pour HOURS) → ms
  const expires = new Date(Date.now() + row.duration_days * 86400000);

  db.prepare(`
    UPDATE license_keys
    SET status = 'active', redeemed_by = ?, redeemed_at = datetime('now'), expires_at = ?, hwid = COALESCE(?, hwid), ip = COALESCE(ip, ?)
    WHERE id = ?
  `).run(req.user.id, expires.toISOString(), hwid || null, ip || null, row.id);

  const product = db.prepare('SELECT id, name, slug FROM products WHERE id = ?').get(row.product_id);
  res.json({
    ok: true,
    key: db.prepare('SELECT * FROM license_keys WHERE id = ?').get(row.id),
    product,
  });
});

router.post('/hwid-reset', adminRequired, (req, res) => {
  const { key, discord_id } = req.body || {};
  let row = null;
  if (key) row = db.prepare('SELECT * FROM license_keys WHERE key_code = ?').get(key);
  else if (discord_id) {
    row = db.prepare(`
      SELECT * FROM license_keys WHERE discord_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1
    `).get(String(discord_id));
  }
  if (!row) return res.status(404).json({ error: 'Licence introuvable' });
  db.prepare('UPDATE license_keys SET hwid = NULL WHERE id = ?').run(row.id);
  res.json({ ok: true, key: db.prepare('SELECT * FROM license_keys WHERE id = ?').get(row.id) });
});

router.post('/:id/revoke', adminRequired, (req, res) => {
  db.prepare("UPDATE license_keys SET status = 'revoked' WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', adminRequired, (req, res) => {
  db.prepare('DELETE FROM license_keys WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Blacklist la clé (≠ revoke) : entrée blacklist + statut. Option { ip:true } → BL aussi l'IP.
router.post('/:id/blacklist', adminRequired, (req, res) => {
  const row = db.prepare('SELECT * FROM license_keys WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Clé introuvable' });
  const reason = (req.body && req.body.reason) || 'Blacklisted via panel';
  try {
    db.prepare('INSERT OR IGNORE INTO blacklist (type, value, reason, created_by) VALUES (?, ?, ?, ?)')
      .run('key', row.key_code, reason, req.user.username);
    if (req.body && req.body.ip && row.ip) {
      db.prepare('INSERT OR IGNORE INTO blacklist (type, value, reason, created_by) VALUES (?, ?, ?, ?)')
        .run('ip', row.ip, `Key ${row.key_code}`, req.user.username);
    }
    if (row.hwid) {
      db.prepare('INSERT OR IGNORE INTO blacklist (type, value, reason, created_by) VALUES (?, ?, ?, ?)')
        .run('hwid', row.hwid, `Key ${row.key_code}`, req.user.username);
    }
  } catch { /* déjà blacklist */ }
  db.prepare("UPDATE license_keys SET status = 'blacklisted' WHERE id = ?").run(row.id);
  res.json({ ok: true, key: db.prepare('SELECT * FROM license_keys WHERE id = ?').get(row.id) });
});

// Retire la clé de la blacklist et lui rend un statut cohérent.
router.post('/:id/unblacklist', adminRequired, (req, res) => {
  const row = db.prepare('SELECT * FROM license_keys WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Clé introuvable' });
  db.prepare("DELETE FROM blacklist WHERE type = 'key' AND value = ?").run(row.key_code);
  const status = row.redeemed_at ? 'active' : 'unused';
  db.prepare('UPDATE license_keys SET status = ? WHERE id = ?').run(status, row.id);
  res.json({ ok: true, key: db.prepare('SELECT * FROM license_keys WHERE id = ?').get(row.id) });
});

// Ban l'IP associée à la clé.
router.post('/:id/ban-ip', adminRequired, (req, res) => {
  const row = db.prepare('SELECT * FROM license_keys WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Clé introuvable' });
  if (!row.ip) return res.status(400).json({ error: 'Aucune IP enregistrée pour cette clé' });
  try {
    db.prepare('INSERT OR IGNORE INTO blacklist (type, value, reason, created_by) VALUES (?, ?, ?, ?)')
      .run('ip', row.ip, (req.body && req.body.reason) || `Key ${row.key_code}`, req.user.username);
  } catch { /* déjà */ }
  res.json({ ok: true, ip: row.ip });
});

// Opérations de masse : delete / revoke / blacklist, par liste d'ids OU par statut.
router.post('/bulk', adminRequired, (req, res) => {
  const { action, ids, status } = req.body || {};
  if (!['delete', 'revoke', 'blacklist'].includes(action)) {
    return res.status(400).json({ error: 'action invalide (delete|revoke|blacklist)' });
  }
  let rows = [];
  if (Array.isArray(ids) && ids.length) {
    const ph = ids.map(() => '?').join(',');
    rows = db.prepare(`SELECT * FROM license_keys WHERE id IN (${ph})`).all(...ids);
  } else if (status) {
    rows = db.prepare('SELECT * FROM license_keys WHERE status = ?').all(status);
  } else {
    return res.status(400).json({ error: 'Fournis ids[] ou status' });
  }

  const tx = db.transaction(() => {
    for (const row of rows) {
      if (action === 'delete') {
        db.prepare('DELETE FROM license_keys WHERE id = ?').run(row.id);
      } else if (action === 'revoke') {
        db.prepare("UPDATE license_keys SET status = 'revoked' WHERE id = ?").run(row.id);
      } else if (action === 'blacklist') {
        db.prepare('INSERT OR IGNORE INTO blacklist (type, value, reason, created_by) VALUES (?, ?, ?, ?)')
          .run('key', row.key_code, 'Bulk blacklist', req.user.username);
        db.prepare("UPDATE license_keys SET status = 'blacklisted' WHERE id = ?").run(row.id);
      }
    }
  });
  tx();
  res.json({ ok: true, affected: rows.length });
});

/* ---------------------------------------------------------------------------
 * Vérification pour le LOADER C++ (machine-to-machine, pas de JWT).
 * POST /api/keys/verify  { key, hwid }
 *  - optionnel : header  x-loader-key: <LOADER_API_KEY>  (si la var est posée)
 *  - lie le HWID à la 1ʳᵉ utilisation puis le verrouille (anti-partage de clé)
 *  - refuse clé expirée / révoquée / blacklistée / HWID différent
 * Réponse : { valid: bool, reason?, product, expires_at, duration_days }
 * ------------------------------------------------------------------------- */
function isValueBlacklisted(type, value) {
  if (!value) return false;
  return Boolean(db.prepare('SELECT 1 FROM blacklist WHERE type = ? AND value = ?').get(type, value));
}

router.post('/verify', (req, res) => {
  const loaderKey = process.env.LOADER_API_KEY;
  if (loaderKey && req.get('x-loader-key') !== loaderKey) {
    return res.status(401).json({ valid: false, reason: 'unauthorized' });
  }

  const key = String((req.body && req.body.key) || '').trim();
  const hwid = String((req.body && req.body.hwid) || '').trim();
  const productRef = req.body && req.body.product; // slug ou id du loader appelant (optionnel mais recommandé)
  if (!key || !hwid) return res.status(400).json({ valid: false, reason: 'key_and_hwid_required' });

  const ip = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.ip;

  const row = db.prepare('SELECT * FROM license_keys WHERE key_code = ?').get(key);
  if (!row) return res.json({ valid: false, reason: 'not_found' });

  // Enregistre l'IP à la 1ʳᵉ vue (utile pour BL / audit côté panel)
  if (!row.ip && ip) {
    db.prepare('UPDATE license_keys SET ip = ? WHERE id = ?').run(ip, row.id);
    row.ip = ip;
  }

  // Vérifie que la clé appartient bien au produit du loader qui l'utilise
  if (productRef !== undefined && productRef !== null && String(productRef).length) {
    let expected = null;
    if (/^\d+$/.test(String(productRef))) expected = db.prepare('SELECT id FROM products WHERE id = ?').get(Number(productRef));
    else expected = db.prepare('SELECT id FROM products WHERE slug = ?').get(String(productRef));
    if (!expected) return res.json({ valid: false, reason: 'unknown_product' });
    if (expected.id !== row.product_id) return res.json({ valid: false, reason: 'wrong_product' });
  }

  if (row.status === 'blacklisted' || row.status === 'revoked') {
    return res.json({ valid: false, reason: row.status });
  }
  if (isValueBlacklisted('key', key) || isValueBlacklisted('hwid', hwid)) {
    return res.json({ valid: false, reason: 'blacklisted' });
  }

  // Activation à la première utilisation par le loader
  if (row.status === 'unused') {
    const expires = new Date(Date.now() + row.duration_days * 86400000).toISOString();
    db.prepare(`
      UPDATE license_keys SET status = 'active', redeemed_at = datetime('now'), expires_at = ?, hwid = ?
      WHERE id = ?
    `).run(expires, hwid, row.id);
    row.status = 'active'; row.expires_at = expires; row.hwid = hwid;
  }

  // Verrou HWID : lie si vide, sinon exige la correspondance
  if (!row.hwid) {
    db.prepare('UPDATE license_keys SET hwid = ? WHERE id = ?').run(hwid, row.id);
    row.hwid = hwid;
  } else if (row.hwid !== hwid) {
    return res.json({ valid: false, reason: 'hwid_mismatch' });
  }

  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    db.prepare("UPDATE license_keys SET status = 'expired' WHERE id = ?").run(row.id);
    return res.json({ valid: false, reason: 'expired', expires_at: row.expires_at });
  }

  const product = db.prepare('SELECT id, name, slug FROM products WHERE id = ?').get(row.product_id);

  // Tous les produits que ce COMPTE possède : soit claim sur le compte (redeemed_by),
  // soit activés sur cette machine (même hwid). Le loader débloque tous ces produits,
  // pas seulement celui de la clé entrée. Lecture seule — ne modifie aucun produit.
  const owned = db.prepare(`
    SELECT p.slug AS slug, p.name AS name, MAX(k.expires_at) AS expires_at
    FROM license_keys k
    JOIN products p ON p.id = k.product_id
    WHERE k.status = 'active'
      AND (k.expires_at IS NULL OR k.expires_at > datetime('now'))
      AND (
        (? IS NOT NULL AND k.redeemed_by = ?)
        OR k.hwid = ?
      )
    GROUP BY p.id, p.slug, p.name
  `).all(row.redeemed_by ?? null, row.redeemed_by ?? null, hwid);

  // garantit que le produit de la clé entrée figure toujours dans la liste
  const products = owned.slice();
  if (product && !products.some((x) => x.slug === product.slug)) {
    products.push({ slug: product.slug, name: product.name, expires_at: row.expires_at });
  }

  return res.json({
    valid: true,
    product,
    products,
    duration_days: row.duration_days,
    expires_at: row.expires_at,
    hwid: row.hwid,
  });
});

module.exports = { router, resolveDuration, resolveDays, codeForDuration, DURATIONS, DURATION_PRESETS };

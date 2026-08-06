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

  // durée en jours (fractionnaire possible pour HOURS) → ms
  const expires = new Date(Date.now() + row.duration_days * 86400000);

  db.prepare(`
    UPDATE license_keys
    SET status = 'active', redeemed_by = ?, redeemed_at = datetime('now'), expires_at = ?, hwid = COALESCE(?, hwid)
    WHERE id = ?
  `).run(req.user.id, expires.toISOString(), hwid || null, row.id);

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

module.exports = { router, resolveDuration, resolveDays, codeForDuration, DURATIONS, DURATION_PRESETS };

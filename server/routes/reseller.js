const express = require('express');
const { db, generateKeyCode } = require('../db');
const { resellerRequired } = require('../auth');
const { resolveDays, codeForDuration } = require('./keys');

const router = express.Router();

function isPrivileged(user) {
  return user.role === 'admin' || user.role === 'staff';
}

// Produits accessibles au reseller (assignés) ; admin/staff → tous
function accessibleProducts(user) {
  if (isPrivileged(user)) {
    return db.prepare('SELECT id, slug, name, price, is_free FROM products ORDER BY name ASC').all();
  }
  return db.prepare(`
    SELECT p.id, p.slug, p.name, p.price, p.is_free
    FROM products p
    JOIN reseller_products rp ON rp.product_id = p.id
    WHERE rp.user_id = ?
    ORDER BY p.name ASC
  `).all(user.id);
}

function canAccessProduct(user, productId) {
  if (isPrivileged(user)) return true;
  return Boolean(db.prepare('SELECT 1 FROM reseller_products WHERE user_id = ? AND product_id = ?').get(user.id, productId));
}

function keysUsed(username) {
  return db.prepare('SELECT COUNT(*) AS c FROM license_keys WHERE created_by = ?').get(username).c;
}

// Infos du reseller connecté : quota, conso, produits assignés
router.get('/me', resellerRequired, (req, res) => {
  const used = keysUsed(req.user.username);
  res.json({
    reseller: {
      id: req.user.id,
      username: req.user.username,
      role: req.user.role,
      key_quota: req.user.key_quota || 0,
      keys_used: used,
      keys_remaining: req.user.key_quota ? Math.max(0, req.user.key_quota - used) : null,
    },
    products: accessibleProducts(req.user),
  });
});

router.get('/products', resellerRequired, (req, res) => {
  res.json({ products: accessibleProducts(req.user) });
});

// Clés générées par ce reseller (admin/staff voient aussi seulement les leurs ici)
router.get('/keys', resellerRequired, (req, res) => {
  const keys = db.prepare(`
    SELECT k.*, p.name AS product_name, u.username AS redeemed_username
    FROM license_keys k
    JOIN products p ON p.id = k.product_id
    LEFT JOIN users u ON u.id = k.redeemed_by
    WHERE k.created_by = ?
    ORDER BY k.id DESC LIMIT 500
  `).all(req.user.username);
  res.json({ keys });
});

// Génération de clés pour un produit assigné, dans la limite du quota
router.post('/keys', resellerRequired, (req, res) => {
  const { product_id, product_slug, duration, quantity = 1, amount = 1, note } = req.body || {};
  let product = null;
  if (product_id) product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
  if (!product && product_slug) product = db.prepare('SELECT * FROM products WHERE slug = ?').get(product_slug);
  if (!product) return res.status(400).json({ error: 'Produit invalide' });
  if (product.is_free) return res.status(400).json({ error: 'Produit gratuit : pas de clé' });
  if (!canAccessProduct(req.user, product.id)) {
    return res.status(403).json({ error: 'Produit non assigné à ton compte' });
  }

  const count = Math.min(Math.max(Number(amount) || 1, 1), 100);

  // Quota (0 = illimité), seulement pour les resellers
  if (!isPrivileged(req.user) && req.user.key_quota) {
    const used = keysUsed(req.user.username);
    if (used + count > req.user.key_quota) {
      return res.status(403).json({ error: `Quota dépassé (${used}/${req.user.key_quota}, +${count} demandé)` });
    }
  }

  const days = resolveDays(duration, quantity);
  const durationCode = codeForDuration(duration);
  const keys = [];
  const insert = db.prepare(`
    INSERT INTO license_keys (key_code, product_id, duration_days, note, created_by, status)
    VALUES (?, ?, ?, ?, ?, 'unused')
  `);
  const tx = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const code = generateKeyCode(durationCode);
      const info = insert.run(code, product.id, days, note || null, req.user.username);
      keys.push(db.prepare('SELECT * FROM license_keys WHERE id = ?').get(info.lastInsertRowid));
    }
  });
  tx();
  res.json({ keys, product: { id: product.id, name: product.name, slug: product.slug }, duration_days: days });
});

// Récupère une clé si elle appartient au reseller (ou admin/staff)
function ownKey(user, id) {
  const row = db.prepare('SELECT * FROM license_keys WHERE id = ?').get(id);
  if (!row) return null;
  if (!isPrivileged(user) && row.created_by !== user.username) return null;
  return row;
}

router.post('/keys/hwid-reset', resellerRequired, (req, res) => {
  const row = db.prepare('SELECT * FROM license_keys WHERE key_code = ?').get((req.body && req.body.key) || '');
  if (!row || (!isPrivileged(req.user) && row.created_by !== req.user.username)) {
    return res.status(404).json({ error: 'Clé introuvable' });
  }
  db.prepare('UPDATE license_keys SET hwid = NULL WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

router.post('/keys/:id/revoke', resellerRequired, (req, res) => {
  const row = ownKey(req.user, req.params.id);
  if (!row) return res.status(404).json({ error: 'Clé introuvable' });
  db.prepare("UPDATE license_keys SET status = 'revoked' WHERE id = ?").run(row.id);
  res.json({ ok: true });
});

router.delete('/keys/:id', resellerRequired, (req, res) => {
  const row = ownKey(req.user, req.params.id);
  if (!row) return res.status(404).json({ error: 'Clé introuvable' });
  db.prepare('DELETE FROM license_keys WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

module.exports = router;

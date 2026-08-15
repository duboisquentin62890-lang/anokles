const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { adminRequired } = require('../auth');

const router = express.Router();

let discordBanFn = null;
function setDiscordBanHandler(fn) {
  discordBanFn = fn;
}

router.get('/stats', adminRequired, (_req, res) => {
  const stats = {
    users: db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
    products: db.prepare('SELECT COUNT(*) AS c FROM products').get().c,
    keys_unused: db.prepare("SELECT COUNT(*) AS c FROM license_keys WHERE status = 'unused'").get().c,
    keys_active: db.prepare("SELECT COUNT(*) AS c FROM license_keys WHERE status = 'active'").get().c,
    blacklist: db.prepare('SELECT COUNT(*) AS c FROM blacklist').get().c,
    bans: db.prepare('SELECT COUNT(*) AS c FROM bans WHERE active = 1').get().c,
    downloads: db.prepare('SELECT COUNT(*) AS c FROM downloads').get().c,
  };
  res.json({ stats });
});

router.get('/users', adminRequired, (_req, res) => {
  const users = db.prepare(`
    SELECT id, username, role, discord_id, email, banned, ban_reason, created_at
    FROM users ORDER BY id DESC LIMIT 500
  `).all();
  res.json({ users });
});

router.get('/blacklist', adminRequired, (_req, res) => {
  res.json({ entries: db.prepare('SELECT * FROM blacklist ORDER BY id DESC').all() });
});

router.post('/blacklist', adminRequired, (req, res) => {
  const { type, value, reason } = req.body || {};
  if (!type || !value) return res.status(400).json({ error: 'type et value requis' });
  if (!['discord', 'ip', 'hwid', 'key'].includes(type)) {
    return res.status(400).json({ error: 'type invalide' });
  }
  try {
    const info = db.prepare(`
      INSERT INTO blacklist (type, value, reason, created_by) VALUES (?, ?, ?, ?)
    `).run(type, String(value), reason || null, req.user.username);

    if (type === 'key') {
      db.prepare("UPDATE license_keys SET status = 'blacklisted' WHERE key_code = ?").run(String(value));
    }
    if (type === 'hwid') {
      db.prepare("UPDATE license_keys SET status = 'blacklisted' WHERE hwid = ?").run(String(value));
    }

    res.json({ entry: db.prepare('SELECT * FROM blacklist WHERE id = ?').get(info.lastInsertRowid) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/blacklist/:id', adminRequired, (req, res) => {
  db.prepare('DELETE FROM blacklist WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.get('/bans', adminRequired, (_req, res) => {
  res.json({ bans: db.prepare('SELECT * FROM bans ORDER BY id DESC LIMIT 500').all() });
});

router.post('/bans', adminRequired, async (req, res) => {
  const {
    discord_id,
    username,
    ip,
    reason,
    site_ban = true,
    discord_ban = true,
  } = req.body || {};

  if (!discord_id && !username && !ip) {
    return res.status(400).json({ error: 'discord_id, username ou ip requis' });
  }

  const info = db.prepare(`
    INSERT INTO bans (discord_id, username, ip, reason, banned_by, site_ban, discord_ban, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    discord_id ? String(discord_id) : null,
    username || null,
    ip || null,
    reason || 'Banned',
    req.user.username,
    site_ban ? 1 : 0,
    discord_ban ? 1 : 0
  );

  if (site_ban) {
    if (username) {
      db.prepare('UPDATE users SET banned = 1, ban_reason = ? WHERE username = ?').run(reason || 'Banned', username);
    }
    if (discord_id) {
      db.prepare('UPDATE users SET banned = 1, ban_reason = ? WHERE discord_id = ?').run(reason || 'Banned', String(discord_id));
    }
  }

  let discordResult = null;
  if (discord_ban && discord_id && discordBanFn) {
    try {
      discordResult = await discordBanFn(String(discord_id), reason || 'Banned from Anokles');
    } catch (e) {
      discordResult = { ok: false, error: e.message };
    }
  }

  res.json({
    ban: db.prepare('SELECT * FROM bans WHERE id = ?').get(info.lastInsertRowid),
    discord: discordResult,
  });
});

router.post('/bans/:id/unban', adminRequired, async (req, res) => {
  const ban = db.prepare('SELECT * FROM bans WHERE id = ?').get(req.params.id);
  if (!ban) return res.status(404).json({ error: 'Ban introuvable' });
  db.prepare('UPDATE bans SET active = 0 WHERE id = ?').run(ban.id);
  if (ban.username) {
    db.prepare('UPDATE users SET banned = 0, ban_reason = NULL WHERE username = ?').run(ban.username);
  }
  if (ban.discord_id) {
    db.prepare('UPDATE users SET banned = 0, ban_reason = NULL WHERE discord_id = ?').run(ban.discord_id);
  }
  res.json({ ok: true });
});

router.get('/downloads', adminRequired, (_req, res) => {
  const downloads = db.prepare(`
    SELECT d.*, p.name AS product_name, u.username
    FROM downloads d
    JOIN products p ON p.id = d.product_id
    LEFT JOIN users u ON u.id = d.user_id
    ORDER BY d.id DESC LIMIT 200
  `).all();
  res.json({ downloads });
});

/* ---- Resellers (rebrand : comptes qui génèrent leurs propres clés) ---- */

// Liste des resellers + quota + conso + produits assignés
router.get('/resellers', adminRequired, (_req, res) => {
  const resellers = db.prepare(`
    SELECT id, username, key_quota, banned, created_at
    FROM users WHERE role = 'reseller' ORDER BY id DESC
  `).all();
  const out = resellers.map((r) => {
    const used = db.prepare('SELECT COUNT(*) AS c FROM license_keys WHERE created_by = ?').get(r.username).c;
    const products = db.prepare('SELECT product_id FROM reseller_products WHERE user_id = ?').all(r.id).map((x) => x.product_id);
    return { ...r, keys_used: used, product_ids: products };
  });
  res.json({ resellers: out });
});

// Crée un compte reseller
router.post('/resellers', adminRequired, (req, res) => {
  const { username, password, key_quota = 0 } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username et password requis' });
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return res.status(400).json({ error: 'Nom déjà pris' });
  const info = db.prepare(
    "INSERT INTO users (username, password_hash, role, key_quota) VALUES (?, ?, 'reseller', ?)"
  ).run(username, bcrypt.hashSync(String(password), 10), Number(key_quota) || 0);
  res.json({ reseller: db.prepare('SELECT id, username, role, key_quota, banned, created_at FROM users WHERE id = ?').get(info.lastInsertRowid) });
});

// Modifie quota / mot de passe
router.patch('/resellers/:id', adminRequired, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'reseller'").get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Reseller introuvable' });
  if (req.body.key_quota !== undefined) {
    db.prepare('UPDATE users SET key_quota = ? WHERE id = ?').run(Number(req.body.key_quota) || 0, user.id);
  }
  if (req.body.password) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(req.body.password), 10), user.id);
  }
  res.json({ reseller: db.prepare('SELECT id, username, role, key_quota, banned FROM users WHERE id = ?').get(user.id) });
});

// Suspend / réactive (banned)
router.post('/resellers/:id/suspend', adminRequired, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'reseller'").get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Reseller introuvable' });
  const banned = user.banned ? 0 : 1;
  db.prepare('UPDATE users SET banned = ?, ban_reason = ? WHERE id = ?')
    .run(banned, banned ? 'Reseller suspendu' : null, user.id);
  res.json({ ok: true, banned });
});

// Supprime le compte reseller
router.delete('/resellers/:id', adminRequired, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'reseller'").get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Reseller introuvable' });
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  res.json({ ok: true });
});

// Assigne un produit au reseller
router.post('/resellers/:id/products', adminRequired, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'reseller'").get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Reseller introuvable' });
  const productId = Number(req.body && req.body.product_id);
  if (!productId) return res.status(400).json({ error: 'product_id requis' });
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
  if (!product) return res.status(404).json({ error: 'Produit introuvable' });
  db.prepare('INSERT OR IGNORE INTO reseller_products (user_id, product_id) VALUES (?, ?)').run(user.id, productId);
  res.json({ ok: true });
});

// Retire un produit assigné
router.delete('/resellers/:id/products/:productId', adminRequired, (req, res) => {
  db.prepare('DELETE FROM reseller_products WHERE user_id = ? AND product_id = ?')
    .run(req.params.id, req.params.productId);
  res.json({ ok: true });
});

module.exports = { router, setDiscordBanHandler };

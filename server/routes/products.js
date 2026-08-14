const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { db, uploadsDir, generateKeyCode } = require('../db');
const { authRequired, adminRequired, isBlacklisted, isBanned } = require('../auth');
const { resolveDuration, resolveDays, codeForDuration } = require('./keys');

const router = express.Router();

// Upload des builds de loader (admin) → server/uploads/<slug>-<ts>.<ext>
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 12);
    cb(null, `build-${req.params.id}-${Date.now()}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 300 * 1024 * 1024 } });

// Upload d'images de preview (admin) → server/uploads/img-<id>-<ts>.<ext>
const imgStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname || '').slice(0, 8) || '.png').toLowerCase();
    cb(null, `img-${req.params.id}-${Date.now()}${ext}`);
  },
});
const imgUpload = multer({
  storage: imgStorage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype || '')),
});

function attachExtras(product) {
  if (!product) return product;
  const prices = db.prepare(
    'SELECT id, label, duration, price FROM product_prices WHERE product_id = ? ORDER BY sort ASC, price ASC'
  ).all(product.id);
  const files = db.prepare(
    'SELECT id, label, filename, size FROM product_files WHERE product_id = ? ORDER BY id DESC'
  ).all(product.id);
  const images = db.prepare(
    'SELECT id, url, sort FROM product_images WHERE product_id = ? ORDER BY sort ASC, id ASC'
  ).all(product.id);
  const priceFrom = prices.length ? Math.min(...prices.map((p) => p.price)) : product.price;
  // Image principale = image_url si définie, sinon 1ʳᵉ image de la galerie
  const mainImage = product.image_url || (images[0] ? images[0].url : null);
  return { ...product, prices, files, images, image_url: mainImage, price_from: priceFrom };
}

// Contrôle licence partagé (compte JWT OU clé) — renvoie {ip,userId} ou {error,status}
function verifyDownloadAccess(req, product) {
  const ip = req.headers['x-forwarded-for']?.toString().split(',')[0] || req.ip;
  const keyCode = req.body?.key || req.headers['x-license-key'];
  let userId = null;

  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    try {
      const jwt = require('jsonwebtoken');
      const payload = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET || 'dev-secret');
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
      if (user) {
        if (user.banned) return { error: 'Compte banni', status: 403 };
        userId = user.id;
        const ban = isBanned({ discordId: user.discord_id, username: user.username, ip });
        const bl = isBlacklisted({ discordId: user.discord_id, ip });
        if (ban || bl) return { error: 'Accès refusé', status: 403 };
      }
    } catch { /* ignore */ }
  }

  if (!product.is_free) {
    if (!keyCode && !userId) return { error: 'Clé ou compte requis', status: 401 };
    if (keyCode) {
      const key = db.prepare('SELECT * FROM license_keys WHERE key_code = ?').get(keyCode);
      if (!key || key.product_id !== product.id) return { error: 'Clé invalide', status: 403 };
      if (key.status === 'revoked' || key.status === 'blacklisted') return { error: 'Clé révoquée', status: 403 };
      if (key.expires_at && new Date(key.expires_at) < new Date()) {
        db.prepare("UPDATE license_keys SET status = 'expired' WHERE id = ?").run(key.id);
        return { error: 'Clé expirée', status: 403 };
      }
    } else {
      const owned = db.prepare(`
        SELECT * FROM license_keys WHERE redeemed_by = ? AND product_id = ? AND status = 'active'
      `).get(userId, product.id);
      if (!owned) return { error: 'Aucune licence active pour ce produit', status: 403 };
    }
  }
  return { ip, userId };
}

router.get('/', (_req, res) => {
  const products = db.prepare(`
    SELECT id, slug, name, description, category, price, is_free, in_stock, featured, status, image_url,
           CASE WHEN download_path IS NOT NULL AND download_path != '' THEN 1 ELSE 0 END AS has_build
    FROM products ORDER BY featured DESC, price DESC
  `).all();
  res.json({ products: products.map(attachExtras) });
});

router.get('/:slug', (req, res) => {
  const product = db.prepare(`
    SELECT id, slug, name, description, category, price, is_free, in_stock, featured, status, image_url,
           CASE WHEN download_path IS NOT NULL AND download_path != '' THEN 1 ELSE 0 END AS has_build
    FROM products WHERE slug = ?
  `).get(req.params.slug);
  if (!product) return res.status(404).json({ error: 'Produit introuvable' });
  res.json({ product: attachExtras(product) });
});

router.post('/', adminRequired, (req, res) => {
  const { slug, name, description, category, price, is_free, featured, status, image_url } = req.body || {};
  if (!slug || !name) return res.status(400).json({ error: 'slug et name requis' });
  try {
    const info = db.prepare(`
      INSERT INTO products (slug, name, description, category, price, is_free, featured, status, image_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      slug,
      name,
      description || '',
      category || 'General',
      Number(price) || 0,
      is_free ? 1 : 0,
      featured ? 1 : 0,
      status || 'undetected',
      image_url || null
    );
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);
    res.json({ product });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.patch('/:id', adminRequired, (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Introuvable' });
  const fields = ['name', 'description', 'category', 'price', 'is_free', 'in_stock', 'featured', 'status', 'image_url', 'download_path', 'slug'];
  const updates = [];
  const values = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      let v = req.body[f];
      if (['is_free', 'in_stock', 'featured'].includes(f)) v = v ? 1 : 0;
      values.push(v);
    }
  }
  if (!updates.length) return res.json({ product });
  values.push(product.id);
  db.prepare(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json({ product: db.prepare('SELECT * FROM products WHERE id = ?').get(product.id) });
});

router.delete('/:id', adminRequired, (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* ---- API clés par produit ---- */

// Liste des clés + stock d'un produit
router.get('/:slug/keys', adminRequired, (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE slug = ?').get(req.params.slug);
  if (!product) return res.status(404).json({ error: 'Produit introuvable' });
  const keys = db.prepare(`
    SELECT k.*, u.username AS redeemed_username
    FROM license_keys k
    LEFT JOIN users u ON u.id = k.redeemed_by
    WHERE k.product_id = ?
    ORDER BY k.id DESC LIMIT 500
  `).all(product.id);
  const stock = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'unused' THEN 1 ELSE 0 END) AS unused,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active
    FROM license_keys WHERE product_id = ?
  `).get(product.id);
  res.json({
    product: { id: product.id, name: product.name, slug: product.slug, prefix: 'ANK' },
    stock: { total: stock.total || 0, unused: stock.unused || 0, active: stock.active || 0 },
    keys,
  });
});

// Génère des clés dédiées à ce produit (préfixe propre au produit)
router.post('/:slug/keys', adminRequired, (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE slug = ?').get(req.params.slug);
  if (!product) return res.status(404).json({ error: 'Produit introuvable' });
  if (product.is_free) return res.status(400).json({ error: 'Impossible de générer une clé pour un produit gratuit' });

  const { duration, quantity = 1, amount = 1, note, discord_id } = req.body || {};
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

  res.json({
    keys,
    product: { id: product.id, name: product.name, slug: product.slug, prefix: 'ANK' },
    duration_days: days,
  });
});

/* ---- Prix multiples (paliers 1 day / 1 month / lftm …) ---- */

router.get('/:id/prices', (req, res) => {
  const rows = db.prepare(
    'SELECT id, label, duration, price, sort FROM product_prices WHERE product_id = ? ORDER BY sort ASC, price ASC'
  ).all(req.params.id);
  res.json({ prices: rows });
});

router.post('/:id/prices', adminRequired, (req, res) => {
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Produit introuvable' });
  const { label, duration, price, sort } = req.body || {};
  if (!label || !duration) return res.status(400).json({ error: 'label et duration requis' });
  const info = db.prepare(
    'INSERT INTO product_prices (product_id, label, duration, price, sort) VALUES (?, ?, ?, ?, ?)'
  ).run(product.id, String(label), String(duration), Number(price) || 0, Number(sort) || 0);
  res.json({ price: db.prepare('SELECT * FROM product_prices WHERE id = ?').get(info.lastInsertRowid) });
});

router.patch('/prices/:priceId', adminRequired, (req, res) => {
  const row = db.prepare('SELECT * FROM product_prices WHERE id = ?').get(req.params.priceId);
  if (!row) return res.status(404).json({ error: 'Palier introuvable' });
  const fields = ['label', 'duration', 'price', 'sort'];
  const updates = [];
  const values = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      values.push(f === 'price' || f === 'sort' ? Number(req.body[f]) || 0 : String(req.body[f]));
    }
  }
  if (!updates.length) return res.json({ price: row });
  values.push(row.id);
  db.prepare(`UPDATE product_prices SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json({ price: db.prepare('SELECT * FROM product_prices WHERE id = ?').get(row.id) });
});

router.delete('/prices/:priceId', adminRequired, (req, res) => {
  db.prepare('DELETE FROM product_prices WHERE id = ?').run(req.params.priceId);
  res.json({ ok: true });
});

/* ---- Bibliothèque de fichiers (plusieurs .exe / versions par produit) ---- */

router.get('/:id/files', (req, res) => {
  const rows = db.prepare(
    'SELECT id, label, filename, size, created_at FROM product_files WHERE product_id = ? ORDER BY id DESC'
  ).all(req.params.id);
  res.json({ files: rows });
});

router.post('/:id/files', adminRequired, upload.single('file'), (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Produit introuvable' });
  if (!req.file) return res.status(400).json({ error: 'Fichier requis (champ « file »)' });
  const info = db.prepare(
    'INSERT INTO product_files (product_id, label, filename, path, size) VALUES (?, ?, ?, ?, ?)'
  ).run(
    product.id,
    (req.body && req.body.label) || null,
    req.file.originalname || req.file.filename,
    req.file.path,
    req.file.size || null
  );
  db.prepare('UPDATE products SET in_stock = 1 WHERE id = ?').run(product.id);
  res.json({ file: db.prepare('SELECT id, label, filename, size, created_at FROM product_files WHERE id = ?').get(info.lastInsertRowid) });
});

router.delete('/files/:fileId', adminRequired, (req, res) => {
  const row = db.prepare('SELECT * FROM product_files WHERE id = ?').get(req.params.fileId);
  if (!row) return res.status(404).json({ error: 'Fichier introuvable' });
  if (row.path && row.path.startsWith(uploadsDir) && fs.existsSync(row.path)) {
    try { fs.unlinkSync(row.path); } catch { /* ignore */ }
  }
  db.prepare('DELETE FROM product_files WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

// Télécharge un fichier précis avec le même contrôle licence que /:slug/download
router.post('/files/:fileId/download', (req, res) => {
  const file = db.prepare('SELECT * FROM product_files WHERE id = ?').get(req.params.fileId);
  if (!file) return res.status(404).json({ error: 'Fichier introuvable' });
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(file.product_id);
  if (!product) return res.status(404).json({ error: 'Produit introuvable' });

  const check = verifyDownloadAccess(req, product);
  if (check.error) return res.status(check.status).json({ error: check.error });

  db.prepare('INSERT INTO downloads (user_id, product_id, ip) VALUES (?, ?, ?)').run(check.userId, product.id, check.ip);
  if (file.path && fs.existsSync(file.path)) {
    return res.download(file.path, file.filename || `${product.slug}.exe`);
  }
  return res.status(410).json({ error: 'Fichier absent du disque' });
});

/* ---- Galerie d'images de preview (plusieurs images par produit) ---- */

router.get('/:id/images', (req, res) => {
  const rows = db.prepare(
    'SELECT id, url, sort FROM product_images WHERE product_id = ? ORDER BY sort ASC, id ASC'
  ).all(req.params.id);
  res.json({ images: rows });
});

// Ajoute une image par URL (body.url) OU par upload (champ « file »)
router.post('/:id/images', adminRequired, imgUpload.single('file'), (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Produit introuvable' });
  let url = (req.body && req.body.url && String(req.body.url).trim()) || null;
  if (req.file) url = `/uploads/${req.file.filename}`;
  if (!url) return res.status(400).json({ error: 'URL ou fichier image requis' });
  const sort = Number(req.body && req.body.sort) || 0;
  const info = db.prepare(
    'INSERT INTO product_images (product_id, url, sort) VALUES (?, ?, ?)'
  ).run(product.id, url, sort);
  // Si le produit n'a pas encore d'image principale, on l'y met.
  if (!product.image_url) db.prepare('UPDATE products SET image_url = ? WHERE id = ?').run(url, product.id);
  res.json({ image: db.prepare('SELECT id, url, sort FROM product_images WHERE id = ?').get(info.lastInsertRowid) });
});

router.delete('/images/:imageId', adminRequired, (req, res) => {
  const row = db.prepare('SELECT * FROM product_images WHERE id = ?').get(req.params.imageId);
  if (!row) return res.status(404).json({ error: 'Image introuvable' });
  // Supprime le fichier disque si c'était un upload local
  if (row.url && row.url.startsWith('/uploads/')) {
    const p = path.join(uploadsDir, path.basename(row.url));
    if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch { /* ignore */ } }
  }
  db.prepare('DELETE FROM product_images WHERE id = ?').run(row.id);
  // Si c'était l'image principale, on repointe sur la 1ʳᵉ image restante
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(row.product_id);
  if (product && product.image_url === row.url) {
    const next = db.prepare('SELECT url FROM product_images WHERE product_id = ? ORDER BY sort ASC, id ASC').get(row.product_id);
    db.prepare('UPDATE products SET image_url = ? WHERE id = ?').run(next ? next.url : null, row.product_id);
  }
  res.json({ ok: true });
});

router.post('/:id/upload', adminRequired, upload.single('file'), (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Produit introuvable' });
  if (!req.file) return res.status(400).json({ error: 'Fichier requis (champ « file »)' });

  // Supprime l'ancien build si c'était un fichier uploadé
  if (product.download_path && product.download_path.startsWith(uploadsDir) && fs.existsSync(product.download_path)) {
    try { fs.unlinkSync(product.download_path); } catch { /* ignore */ }
  }

  db.prepare('UPDATE products SET download_path = ?, in_stock = 1 WHERE id = ?').run(req.file.path, product.id);
  res.json({
    ok: true,
    file: req.file.originalname,
    download_path: req.file.path,
    product: db.prepare('SELECT * FROM products WHERE id = ?').get(product.id),
  });
});

router.post('/:slug/download', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE slug = ?').get(req.params.slug);
  if (!product) return res.status(404).json({ error: 'Produit introuvable' });
  if (!product.in_stock) return res.status(400).json({ error: 'Hors stock' });

  const check = verifyDownloadAccess(req, product);
  if (check.error) return res.status(check.status).json({ error: check.error });

  db.prepare('INSERT INTO downloads (user_id, product_id, ip) VALUES (?, ?, ?)').run(check.userId, product.id, check.ip);

  if (product.download_path && fs.existsSync(product.download_path)) {
    return res.download(product.download_path);
  }

  // Fichier placeholder si pas encore uploadé
  const placeholder = path.join(uploadsDir, `${product.slug}.txt`);
  if (!fs.existsSync(placeholder)) {
    fs.writeFileSync(
      placeholder,
      `Anokles — ${product.name}\n\nPlace ton fichier de build ici (server/uploads/${product.slug}.zip)\net mets download_path dans le panel admin.\n`
    );
  }
  res.download(placeholder, `${product.slug}-readme.txt`);
});

module.exports = router;

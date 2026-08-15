const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { db, uploadsDir } = require('../db');
const { adminRequired } = require('../auth');

const router = express.Router();

// Stockage des fichiers hébergés (lien de téléchargement direct)
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 12);
    cb(null, `hosted-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

function makeToken() {
  for (let i = 0; i < 6; i++) {
    const t = crypto.randomBytes(6).toString('hex'); // 12 chars
    if (!db.prepare('SELECT 1 FROM hosted_files WHERE token = ?').get(t)) return t;
  }
  return crypto.randomBytes(9).toString('hex');
}

// Liste (admin)
router.get('/', adminRequired, (_req, res) => {
  const files = db.prepare(
    'SELECT id, name, filename, size, token, downloads, created_by, created_at FROM hosted_files ORDER BY id DESC LIMIT 500'
  ).all();
  res.json({ files });
});

// Upload → lien direct /f/<token>
router.post('/', adminRequired, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Fichier requis (champ « file »)' });
  const token = makeToken();
  const info = db.prepare(
    'INSERT INTO hosted_files (name, filename, path, size, token, created_by) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    (req.body && req.body.name) || req.file.originalname || req.file.filename,
    req.file.originalname || req.file.filename,
    req.file.path,
    req.file.size || null,
    token,
    req.user.username
  );
  const file = db.prepare('SELECT id, name, filename, size, token, downloads, created_by, created_at FROM hosted_files WHERE id = ?').get(info.lastInsertRowid);
  res.json({ file, link: `/f/${token}` });
});

router.delete('/:id', adminRequired, (req, res) => {
  const row = db.prepare('SELECT * FROM hosted_files WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Fichier introuvable' });
  if (row.path && row.path.startsWith(uploadsDir) && fs.existsSync(row.path)) {
    try { fs.unlinkSync(row.path); } catch { /* ignore */ }
  }
  db.prepare('DELETE FROM hosted_files WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

// Téléchargement direct public (à monter sur /f/:token) — pas de licence requise
function directDownload(req, res) {
  const row = db.prepare('SELECT * FROM hosted_files WHERE token = ?').get(req.params.token);
  if (!row) return res.status(404).send('Fichier introuvable');
  if (!row.path || !fs.existsSync(row.path)) return res.status(410).send('Fichier absent du disque');
  db.prepare('UPDATE hosted_files SET downloads = downloads + 1 WHERE id = ?').run(row.id);
  res.download(row.path, row.filename || `file-${row.token}`);
}

module.exports = { router, directDownload };

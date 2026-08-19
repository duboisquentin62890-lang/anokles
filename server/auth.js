const jwt = require('jsonwebtoken');
const { db } = require('./db');

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    process.env.JWT_SECRET || 'dev-secret',
    { expiresIn: '7d' }
  );
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Non authentifié' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
    if (!user) return res.status(401).json({ error: 'Utilisateur introuvable' });
    if (user.banned) return res.status(403).json({ error: 'Compte banni', reason: user.ban_reason });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalide' });
  }
}

function adminRequired(req, res, next) {
  authRequired(req, res, () => {
    if (!['owner', 'admin', 'staff'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Accès staff requis' });
    }
    next();
  });
}

// "Owner" = compte tout-puissant. Un compte est owner si son rôle est 'owner',
// OU si son username figure dans OWNER_USERNAMES (fallback : le compte admin
// de bootstrap ADMIN_USER, défaut 'admin') — comme ça on ne se verrouille jamais dehors.
function ownerUsernames() {
  const raw = process.env.OWNER_USERNAMES || process.env.ADMIN_USER || 'admin';
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}
function isOwner(user) {
  if (!user) return false;
  if (user.role === 'owner') return true;
  return ownerUsernames().includes(String(user.username || '').toLowerCase());
}
function ownerRequired(req, res, next) {
  authRequired(req, res, () => {
    if (!isOwner(req.user)) {
      return res.status(403).json({ error: 'Réservé aux owners' });
    }
    next();
  });
}

function resellerRequired(req, res, next) {
  authRequired(req, res, () => {
    if (!['owner', 'admin', 'staff', 'reseller'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Accès reseller requis' });
    }
    next();
  });
}

function isBlacklisted({ discordId, ip, hwid }) {
  const checks = [];
  if (discordId) checks.push(db.prepare("SELECT * FROM blacklist WHERE type = 'discord' AND value = ?").get(String(discordId)));
  if (ip) checks.push(db.prepare("SELECT * FROM blacklist WHERE type = 'ip' AND value = ?").get(ip));
  if (hwid) checks.push(db.prepare("SELECT * FROM blacklist WHERE type = 'hwid' AND value = ?").get(hwid));
  return checks.find(Boolean) || null;
}

function isBanned({ discordId, username, ip }) {
  if (discordId) {
    const ban = db.prepare('SELECT * FROM bans WHERE discord_id = ? AND active = 1').get(String(discordId));
    if (ban) return ban;
  }
  if (username) {
    const ban = db.prepare('SELECT * FROM bans WHERE username = ? AND active = 1').get(username);
    if (ban) return ban;
  }
  if (ip) {
    const ban = db.prepare('SELECT * FROM bans WHERE ip = ? AND active = 1').get(ip);
    if (ban) return ban;
  }
  return null;
}

module.exports = { signToken, authRequired, adminRequired, ownerRequired, resellerRequired, isOwner, isBlacklisted, isBanned };

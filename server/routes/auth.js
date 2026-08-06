const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { signToken, authRequired, isBlacklisted, isBanned } = require('../auth');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const SITE_URL = process.env.SITE_URL || 'http://localhost:5173';
const API_URL = process.env.API_URL || 'http://localhost:3001';
const DISCORD_REDIRECT = process.env.DISCORD_REDIRECT_URI || `${API_URL}/api/auth/discord/callback`;

function discordConfigured() {
  return Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET);
}

router.post('/register', (req, res) => {
  const { username, password, email, discord_id } = req.body || {};
  if (!username || !password || username.length < 3 || password.length < 6) {
    return res.status(400).json({ error: 'Username (3+) et password (6+) requis' });
  }

  const ip = req.headers['x-forwarded-for']?.toString().split(',')[0] || req.ip;
  const ban = isBanned({ discordId: discord_id, username, ip });
  const bl = isBlacklisted({ discordId: discord_id, ip });
  if (ban || bl) return res.status(403).json({ error: 'Accès refusé (ban/blacklist)' });

  try {
    const info = db.prepare(
      'INSERT INTO users (username, password_hash, email, discord_id) VALUES (?, ?, ?, ?)'
    ).run(username, bcrypt.hashSync(password, 10), email || null, discord_id || null);
    const user = db.prepare('SELECT id, username, role, discord_id, email FROM users WHERE id = ?').get(info.lastInsertRowid);
    const token = signToken(user);
    res.json({ token, user });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Username ou Discord déjà utilisé' });
    }
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Identifiants invalides' });
  }
  if (user.banned) return res.status(403).json({ error: 'Compte banni', reason: user.ban_reason });

  const ip = req.headers['x-forwarded-for']?.toString().split(',')[0] || req.ip;
  const ban = isBanned({ discordId: user.discord_id, username: user.username, ip });
  const bl = isBlacklisted({ discordId: user.discord_id, ip });
  if (ban || bl) return res.status(403).json({ error: 'Accès refusé (ban/blacklist)' });

  const safe = { id: user.id, username: user.username, role: user.role, discord_id: user.discord_id, email: user.email };
  res.json({ token: signToken(user), user: safe });
});

router.get('/me', authRequired, (req, res) => {
  const keys = db.prepare(`
    SELECT k.*, p.name AS product_name, p.slug AS product_slug
    FROM license_keys k
    JOIN products p ON p.id = k.product_id
    WHERE k.redeemed_by = ? AND k.status = 'active'
  `).all(req.user.id);

  const row = db.prepare(
    'SELECT id, username, role, discord_id, discord_username, discord_global_name, discord_avatar, email FROM users WHERE id = ?'
  ).get(req.user.id);

  res.json({
    user: row || {
      id: req.user.id,
      username: req.user.username,
      role: req.user.role,
      discord_id: req.user.discord_id,
      email: req.user.email,
    },
    discord_oauth: discordConfigured(),
    keys,
  });
});

router.patch('/me', authRequired, (req, res) => {
  const { discord_id, email } = req.body || {};
  const updates = [];
  const values = [];
  if (discord_id !== undefined) { updates.push('discord_id = ?'); values.push(discord_id ? String(discord_id).trim() : null); }
  if (email !== undefined) { updates.push('email = ?'); values.push(email ? String(email).trim() : null); }
  if (!updates.length) return res.status(400).json({ error: 'Rien à mettre à jour' });
  values.push(req.user.id);
  try {
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Ce Discord est déjà lié à un autre compte' });
    return res.status(500).json({ error: 'Erreur serveur' });
  }
  const user = db.prepare('SELECT id, username, role, discord_id, email FROM users WHERE id = ?').get(req.user.id);
  res.json({ user });
});

/* ---- Liaison compte ↔ Discord via OAuth2 ---- */

// Démarre le flow : le front ouvre /api/auth/discord/link?token=<jwt>
router.get('/discord/link', (req, res) => {
  if (!discordConfigured()) {
    return res.redirect(`${SITE_URL}/dashboard?discord=unconfigured`);
  }
  const token = req.query.token;
  let payload;
  try {
    payload = jwt.verify(String(token || ''), JWT_SECRET);
  } catch {
    return res.redirect(`${SITE_URL}/login?discord=auth`);
  }
  const state = jwt.sign({ id: payload.id, purpose: 'discord-link' }, JWT_SECRET, { expiresIn: '10m' });
  const url = new URL('https://discord.com/api/oauth2/authorize');
  url.searchParams.set('client_id', process.env.DISCORD_CLIENT_ID);
  url.searchParams.set('redirect_uri', DISCORD_REDIRECT);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'consent');
  res.redirect(url.toString());
});

// Callback OAuth : échange le code, récupère l'ID Discord, le lie au compte
router.get('/discord/callback', async (req, res) => {
  const { code, state } = req.query;
  let payload;
  try {
    payload = jwt.verify(String(state || ''), JWT_SECRET);
    if (payload.purpose !== 'discord-link') throw new Error('bad state');
  } catch {
    return res.redirect(`${SITE_URL}/dashboard?discord=state`);
  }
  if (!code) return res.redirect(`${SITE_URL}/dashboard?discord=cancel`);

  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: DISCORD_REDIRECT,
      }),
    });
    if (!tokenRes.ok) throw new Error('token exchange failed');
    const tokenData = await tokenRes.json();

    const meRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!meRes.ok) throw new Error('user fetch failed');
    const discordUser = await meRes.json();
    const discordId = String(discordUser.id);
    const avatarUrl = discordUser.avatar
      ? `https://cdn.discordapp.com/avatars/${discordId}/${discordUser.avatar}.${discordUser.avatar.startsWith('a_') ? 'gif' : 'png'}?size=256`
      : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(discordId) >> 22n) % 6n)}.png`;

    // Refus si déjà lié à un autre compte, ou si Discord ban/blacklist
    const taken = db.prepare('SELECT id FROM users WHERE discord_id = ? AND id != ?').get(discordId, payload.id);
    if (taken) return res.redirect(`${SITE_URL}/dashboard?discord=taken`);
    if (isBanned({ discordId }) || isBlacklisted({ discordId })) {
      return res.redirect(`${SITE_URL}/dashboard?discord=banned`);
    }

    db.prepare(`
      UPDATE users SET discord_id = ?, discord_username = ?, discord_global_name = ?, discord_avatar = ?
      WHERE id = ?
    `).run(
      discordId,
      discordUser.username || null,
      discordUser.global_name || null,
      avatarUrl,
      payload.id
    );
    res.redirect(`${SITE_URL}/dashboard?discord=linked`);
  } catch {
    res.redirect(`${SITE_URL}/dashboard?discord=error`);
  }
});

module.exports = router;

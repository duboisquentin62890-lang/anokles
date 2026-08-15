const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { customAlphabet } = require('nanoid');

// Alphabet propre (pas de 0/O/1/I/L ambigus, pas de - ni _)
const KEY_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const keyGroup = customAlphabet(KEY_ALPHABET, 4);

// Sur Railway : monte un volume et pose DATA_DIR=/data pour persister la base + les uploads.
// En local (DATA_DIR absent) : server/data et server/uploads comme avant.
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');
const uploadsDir = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : (process.env.DATA_DIR ? path.join(dataDir, 'uploads') : path.join(__dirname, 'uploads'));

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'tkr.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    discord_id TEXT UNIQUE,
    discord_username TEXT,
    discord_global_name TEXT,
    discord_avatar TEXT,
    email TEXT,
    banned INTEGER NOT NULL DEFAULT 0,
    ban_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'General',
    price REAL NOT NULL DEFAULT 0,
    is_free INTEGER NOT NULL DEFAULT 0,
    in_stock INTEGER NOT NULL DEFAULT 1,
    featured INTEGER NOT NULL DEFAULT 0,
    download_path TEXT,
    image_url TEXT,
    status TEXT NOT NULL DEFAULT 'undetected',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS license_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_code TEXT UNIQUE NOT NULL,
    product_id INTEGER NOT NULL,
    duration_days INTEGER NOT NULL DEFAULT 30,
    note TEXT,
    created_by TEXT,
    discord_id TEXT,
    hwid TEXT,
    redeemed_by INTEGER,
    redeemed_at TEXT,
    expires_at TEXT,
    status TEXT NOT NULL DEFAULT 'unused',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (redeemed_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS blacklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    reason TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(type, value)
  );

  CREATE TABLE IF NOT EXISTS bans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT,
    username TEXT,
    ip TEXT,
    reason TEXT,
    banned_by TEXT,
    site_ban INTEGER NOT NULL DEFAULT 1,
    discord_ban INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS downloads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    product_id INTEGER NOT NULL,
    ip TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    product_id INTEGER NOT NULL,
    key_id INTEGER,
    amount REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (key_id) REFERENCES license_keys(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number INTEGER NOT NULL,
    guild_id TEXT NOT NULL,
    channel_id TEXT UNIQUE NOT NULL,
    category TEXT NOT NULL,
    opener_id TEXT NOT NULL,
    opener_tag TEXT,
    claimed_by TEXT,
    claimed_tag TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at TEXT,
    closed_by TEXT
  );

  CREATE TABLE IF NOT EXISTS ticket_blacklist (
    user_id TEXT PRIMARY KEY,
    reason TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ticket_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL,
    author_id TEXT,
    author_tag TEXT,
    content TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS product_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    duration TEXT NOT NULL,
    price REAL NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS product_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    label TEXT,
    filename TEXT NOT NULL,
    path TEXT NOT NULL,
    size INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS bot_whitelist (
    discord_id TEXT PRIMARY KEY,
    added_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS product_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS hosted_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    filename TEXT NOT NULL,
    path TEXT NOT NULL,
    size INTEGER,
    token TEXT UNIQUE NOT NULL,
    downloads INTEGER NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reseller_products (
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, product_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  );
`);

// Migrations légères : ajoute les colonnes manquantes sur une base existante.
function ensureColumn(table, column, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}
ensureColumn('users', 'discord_username', 'TEXT');
ensureColumn('users', 'discord_global_name', 'TEXT');
ensureColumn('users', 'discord_avatar', 'TEXT');
ensureColumn('license_keys', 'ip', 'TEXT');
ensureColumn('users', 'key_quota', 'INTEGER NOT NULL DEFAULT 0');

function wrapDb(database) {
  return {
    prepare(sql) {
      const stmt = database.prepare(sql);
      return {
        get(...params) {
          return stmt.get(...params);
        },
        all(...params) {
          return stmt.all(...params);
        },
        run(...params) {
          const result = stmt.run(...params);
          return {
            changes: result.changes,
            lastInsertRowid: Number(result.lastInsertRowid),
          };
        },
      };
    },
    exec(sql) {
      return database.exec(sql);
    },
    transaction(fn) {
      return (...args) => {
        database.exec('BEGIN');
        try {
          const result = fn(...args);
          database.exec('COMMIT');
          return result;
        } catch (e) {
          database.exec('ROLLBACK');
          throw e;
        }
      };
    },
  };
}

const api = wrapDb(db);

function seed() {
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASS || 'changeme123';
  const existing = api.prepare('SELECT id FROM users WHERE username = ?').get(adminUser);
  if (!existing) {
    api.prepare(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
    ).run(adminUser, bcrypt.hashSync(adminPass, 10), 'admin');
  }

  const count = api.prepare('SELECT COUNT(*) AS c FROM products').get().c;
  if (count === 0) {
    const insert = api.prepare(`
      INSERT INTO products (slug, name, description, category, price, is_free, featured, status, image_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(
      'temp-spoofer',
      'Temp Spoofer',
      'Spoofer temporaire HWID — livraison instantanée, support Discord 24/7.',
      'HWID Spoofer',
      24.99,
      0,
      1,
      'undetected',
      null
    );
    insert.run(
      'fortnite-external',
      'Fortnite External',
      'External premium — ESP, aim, misc. Mises à jour quotidiennes.',
      'Fortnite',
      29.99,
      0,
      1,
      'undetected',
      null
    );
    insert.run(
      'tkr-free-loader',
      'Anokles Free Loader',
      'Loader gratuit pour tester Anokles. Reset HWID limité.',
      'Free',
      0,
      1,
      0,
      'undetected',
      null
    );
  }
}

// Format: ANK-<DURATION>-XXXX-XXXX-XXXX-XXXX (durationCode ∈ LFTM/MONTH/WEEK/DAY/HOURS/MEDIA)
function generateKeyCode(durationCode = 'MONTH') {
  const code = String(durationCode || 'MONTH').replace(/[^A-Z0-9]/gi, '').toUpperCase() || 'MONTH';
  return `ANK-${code}-${keyGroup()}-${keyGroup()}-${keyGroup()}-${keyGroup()}`;
}

module.exports = { db: api, seed, generateKeyCode, uploadsDir };

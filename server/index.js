require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { seed, uploadsDir } = require('./db');
const { setDiscordBanHandler } = require('./routes/admin');
const { startBot, banDiscordUser } = require('./bot');
const { startKeyBackups } = require('./backup');

seed();

const app = express();
app.set('trust proxy', 1);

// Sécurité en-têtes. CSP désactivée (SPA + images CDN Discord/produits),
// mais on garde HSTS, noSniff, frameguard, etc. Ressources cross-origin
// autorisées pour que le loader puisse télécharger les builds via /uploads.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(uploadsDir));

// --- Rate limiting anti-abus / anti-crack ---
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,               // 240 req/min/IP sur l'API générale
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessaie dans un instant.' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,                // 20 tentatives login/register / 15 min / IP
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Trop de tentatives, réessaie plus tard.' },
});
const sensitiveLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,                // redeem / verify / download : 30/min/IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes sur cette ressource.' },
});

app.use('/api', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/keys/verify', sensitiveLimiter);
app.use('/api/keys/redeem', sensitiveLimiter);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, brand: 'JinxWare', time: new Date().toISOString() });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/keys', require('./routes/keys').router);
app.use('/api/admin', require('./routes/admin').router);
app.use('/api/reseller', require('./routes/reseller'));

const hostedFiles = require('./routes/files');
app.use('/api/files', hostedFiles.router);
// Lien de téléchargement direct public : /f/<token>
app.get('/f/:token', hostedFiles.directDownload);

const webDist = path.join(__dirname, '..', 'web', 'dist');
app.use(express.static(webDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(webDist, 'index.html'), (err) => {
    if (err) next();
  });
});

setDiscordBanHandler(banDiscordUser);

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => {
  console.log(`[api] http://localhost:${port}`);
});

startBot().catch((e) => console.error('[bot] fail', e));
startKeyBackups();

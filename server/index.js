require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { seed, uploadsDir } = require('./db');
const { setDiscordBanHandler } = require('./routes/admin');
const { startBot, banDiscordUser } = require('./bot');

seed();

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(uploadsDir));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, brand: 'Anokles', time: new Date().toISOString() });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/keys', require('./routes/keys').router);
app.use('/api/admin', require('./routes/admin').router);

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

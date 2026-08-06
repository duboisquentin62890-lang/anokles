# TKR

Site vente / download + API + bot Discord + panel admin.  
Style **rouge / noir / gris / blanc** (inspiré [rebooted.lol](https://rebooted.lol)).

## Stack

- **API** Express + SQLite (`better-sqlite3`)
- **Bot** discord.js (slash `/` + préfixe `+`)
- **Web** React + Vite

## Setup rapide

```bash
cp .env.example .env
npm run setup
npm run dev
```

- Site: http://localhost:5173  
- API: http://localhost:3001  
- Admin défaut: `admin` / `changeme123` (change dans `.env`)

### Discord

1. Crée une appli bot sur https://discord.com/developers  
2. Active **Message Content Intent** + **Server Members Intent**  
3. Remplis `.env` :

```env
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_GUILD_ID=...
DISCORD_OWNER_IDS=ton_id_discord
```

4. Invite le bot avec permissions Ban Members  
5. Les slash commands s’enregistrent au démarrage (`npm run register-commands` si besoin)

## Commandes bot

| Commande | Exemple |
|----------|---------|
| `+help` / `/help` | aide |
| `+genkey` / `/genkey` | `+genkey fortnite-external lftm 1` · `+genkey 1 30d 5` |
| `+hwid_reset` / `/hwid_reset` | `+hwid_reset TKR-XXXX…` |
| `+bl` / `/bl` | `+bl discord 123456 raison` · `+bl hwid ABC` · `+bl key TKR-…` |
| `+unbl` | `+unbl 3` |
| `+ban` / `/ban` | ban **site + Discord** |
| `+unban` | unban |
| `+check` | infos licence |
| `+stock` | stock clés |
| `+lookup` | user / BL / bans |

Durées: `1d` `7d` `30d` `1m` `lftm` / `lifetime`

Staff = `DISCORD_OWNER_IDS` · Admin Discord · rôle `DISCORD_STAFF_ROLE_ID`

## Site

- Landing produits (paid + free)
- Download free sans clé
- Download paid via key ou licence redeem
- Dashboard client (redeem / download)
- **Panel admin** `/admin` : keys, products, blacklist, bans (sync Discord), users

## Fichiers download

Place tes builds dans `server/uploads/` puis mets `download_path` via API patch produit, ou laisse le placeholder `.txt` généré auto.

## Prod

```bash
npm run build
npm run server
```

Le serveur sert `web/dist` + l’API + le bot.

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  REST,
  Routes,
} = require('discord.js');
const { db, generateKeyCode } = require('../db');
const { resolveDuration, codeForDuration } = require('../routes/keys');

let client = null;

function staffOnly(member) {
  if (!member) return false;
  const owners = (process.env.DISCORD_OWNER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (owners.includes(member.id)) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const staffRole = process.env.DISCORD_STAFF_ROLE_ID;
  if (staffRole && member.roles.cache.has(staffRole)) return true;
  return false;
}

function helpEmbed() {
  return new EmbedBuilder()
    .setColor(0xe10600)
    .setTitle('Anokles — Commandes')
    .setDescription('Préfixe `+` ou slash `/` · Staff uniquement sauf mention')
    .addFields(
      { name: '+help / /help', value: 'Affiche cette aide' },
      { name: '+genkey / /genkey', value: '`+genkey <slug|id> <durée> [qty] [note]`\nEx: `+genkey fortnite-external lftm 1` · `+genkey 1 30d 5`' },
      { name: '+hwid_reset / /hwid_reset', value: '`+hwid_reset <key|discord_id>` — reset HWID' },
      { name: '+bl / /bl', value: '`+bl <discord|ip|hwid|key> <valeur> [raison]`' },
      { name: '+unbl / /unbl', value: '`+unbl <id>` — retire une entrée blacklist' },
      { name: '+ban / /ban', value: '`+ban <@user|id> [raison]` — ban site + Discord' },
      { name: '+unban / /unban', value: '`+unban <discord_id>`' },
      { name: '+check / /check', value: '`+check <key|discord_id>` — infos licence' },
      { name: '+stock / /stock', value: 'Stock clés par produit' },
      { name: '+lookup / /lookup', value: '`+lookup <discord_id|username>`' }
    )
    .setFooter({ text: 'Anokles API · rouge / noir' });
}

function findProduct(ref) {
  if (!ref) return null;
  if (/^\d+$/.test(ref)) return db.prepare('SELECT * FROM products WHERE id = ?').get(Number(ref));
  return db.prepare('SELECT * FROM products WHERE slug = ? OR name LIKE ?').get(ref, `%${ref}%`);
}

async function handleGenKey(ctx, args) {
  const [productRef, duration = '30d', amount = '1', ...noteParts] = args;
  const product = findProduct(productRef);
  if (!product) return ctx.reply('❌ Produit introuvable. Utilise slug ou id (`+stock`).');

  const days = resolveDuration(duration);
  const durationCode = codeForDuration(duration);
  const count = Math.min(Math.max(Number(amount) || 1, 1), 25);
  const note = noteParts.join(' ') || null;
  const keys = [];
  const insert = db.prepare(`
    INSERT INTO license_keys (key_code, product_id, duration_days, note, created_by, status)
    VALUES (?, ?, ?, ?, ?, 'unused')
  `);
  const tx = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const code = generateKeyCode(durationCode);
      insert.run(code, product.id, days, note, ctx.authorTag);
      keys.push(code);
    }
  });
  tx();

  const embed = new EmbedBuilder()
    .setColor(0xe10600)
    .setTitle('Clés générées')
    .setDescription(keys.map((k) => `\`${k}\``).join('\n'))
    .addFields(
      { name: 'Produit', value: product.name, inline: true },
      { name: 'Durée', value: `${days}j`, inline: true },
      { name: 'Qty', value: String(count), inline: true }
    );
  return ctx.reply({ embeds: [embed], ephemeral: true });
}

async function handleHwidReset(ctx, args) {
  const target = args[0];
  if (!target) return ctx.reply('Usage: `+hwid_reset <key|discord_id>`');
  let row = db.prepare('SELECT * FROM license_keys WHERE key_code = ?').get(target);
  if (!row) {
    row = db.prepare(`
      SELECT * FROM license_keys WHERE discord_id = ? AND status IN ('active','unused') ORDER BY id DESC LIMIT 1
    `).get(target);
  }
  if (!row) return ctx.reply('❌ Licence introuvable');
  db.prepare('UPDATE license_keys SET hwid = NULL WHERE id = ?').run(row.id);
  return ctx.reply(`✅ HWID reset pour \`${row.key_code}\``);
}

async function handleBl(ctx, args) {
  const [type, value, ...reasonParts] = args;
  if (!type || !value) return ctx.reply('Usage: `+bl <discord|ip|hwid|key> <valeur> [raison]`');
  if (!['discord', 'ip', 'hwid', 'key'].includes(type)) return ctx.reply('❌ Type invalide');
  const reason = reasonParts.join(' ') || 'Blacklisted';
  try {
    db.prepare('INSERT INTO blacklist (type, value, reason, created_by) VALUES (?, ?, ?, ?)').run(
      type, value, reason, ctx.authorTag
    );
    if (type === 'key') db.prepare("UPDATE license_keys SET status = 'blacklisted' WHERE key_code = ?").run(value);
    if (type === 'hwid') db.prepare("UPDATE license_keys SET status = 'blacklisted' WHERE hwid = ?").run(value);
    return ctx.reply(`✅ BL \`${type}\` → \`${value}\``);
  } catch {
    return ctx.reply('❌ Déjà blacklisté ou erreur');
  }
}

async function handleUnbl(ctx, args) {
  const id = Number(args[0]);
  if (!id) return ctx.reply('Usage: `+unbl <id>`');
  db.prepare('DELETE FROM blacklist WHERE id = ?').run(id);
  return ctx.reply(`✅ Entrée BL #${id} supprimée`);
}

async function handleBan(ctx, args, guild) {
  const raw = args[0];
  if (!raw) return ctx.reply('Usage: `+ban <@user|id> [raison]`');
  const discordId = raw.replace(/[<@!>]/g, '');
  const reason = args.slice(1).join(' ') || 'Banned from Anokles';

  db.prepare(`
    INSERT INTO bans (discord_id, reason, banned_by, site_ban, discord_ban, active)
    VALUES (?, ?, ?, 1, 1, 1)
  `).run(discordId, reason, ctx.authorTag);
  db.prepare('UPDATE users SET banned = 1, ban_reason = ? WHERE discord_id = ?').run(reason, discordId);

  let discordOk = false;
  try {
    if (guild) {
      await guild.members.ban(discordId, { reason: `Anokles: ${reason}` });
      discordOk = true;
    }
  } catch (e) {
    return ctx.reply(`⚠️ Ban site OK, Discord fail: ${e.message}`);
  }
  return ctx.reply(`✅ Ban site${discordOk ? ' + Discord' : ''} · \`${discordId}\` · ${reason}`);
}

async function handleUnban(ctx, args, guild) {
  const discordId = (args[0] || '').replace(/[<@!>]/g, '');
  if (!discordId) return ctx.reply('Usage: `+unban <discord_id>`');
  db.prepare('UPDATE bans SET active = 0 WHERE discord_id = ?').run(discordId);
  db.prepare('UPDATE users SET banned = 0, ban_reason = NULL WHERE discord_id = ?').run(discordId);
  try {
    if (guild) await guild.members.unban(discordId, 'Anokles unban');
  } catch { /* ignore */ }
  return ctx.reply(`✅ Unban \`${discordId}\``);
}

async function handleCheck(ctx, args) {
  const target = args[0];
  if (!target) return ctx.reply('Usage: `+check <key|discord_id>`');
  let rows = db.prepare('SELECT k.*, p.name AS product_name FROM license_keys k JOIN products p ON p.id = k.product_id WHERE k.key_code = ?').all(target);
  if (!rows.length) {
    rows = db.prepare(`
      SELECT k.*, p.name AS product_name FROM license_keys k
      JOIN products p ON p.id = k.product_id WHERE k.discord_id = ? ORDER BY k.id DESC LIMIT 10
    `).all(target);
  }
  if (!rows.length) return ctx.reply('❌ Rien trouvé');
  const lines = rows.map((r) =>
    `\`${r.key_code}\` · **${r.product_name}** · ${r.status} · HWID: \`${r.hwid || '—'}\` · exp: ${r.expires_at || '—'}`
  );
  return ctx.reply({ embeds: [new EmbedBuilder().setColor(0xe10600).setTitle('Lookup').setDescription(lines.join('\n'))] });
}

async function handleStock(ctx) {
  const rows = db.prepare(`
    SELECT p.name, p.slug,
      SUM(CASE WHEN k.status = 'unused' THEN 1 ELSE 0 END) AS unused,
      SUM(CASE WHEN k.status = 'active' THEN 1 ELSE 0 END) AS active
    FROM products p
    LEFT JOIN license_keys k ON k.product_id = p.id
    GROUP BY p.id
    ORDER BY p.id
  `).all();
  const desc = rows.map((r) => `**${r.name}** (\`${r.slug}\`) · unused: **${r.unused || 0}** · active: **${r.active || 0}**`).join('\n') || 'Aucun produit';
  return ctx.reply({ embeds: [new EmbedBuilder().setColor(0xe10600).setTitle('Stock clés').setDescription(desc)] });
}

async function handleLookup(ctx, args) {
  const q = args[0];
  if (!q) return ctx.reply('Usage: `+lookup <discord_id|username>`');
  const user = db.prepare('SELECT * FROM users WHERE discord_id = ? OR username = ?').get(q, q);
  const bl = db.prepare('SELECT * FROM blacklist WHERE value = ?').all(q);
  const ban = db.prepare('SELECT * FROM bans WHERE discord_id = ? OR username = ? ORDER BY id DESC LIMIT 3').all(q, q);
  const embed = new EmbedBuilder()
    .setColor(0xe10600)
    .setTitle('Lookup')
    .addFields(
      { name: 'User', value: user ? `\`${user.username}\` · role ${user.role} · banned=${user.banned}` : '—' },
      { name: 'Blacklist', value: bl.length ? bl.map((b) => `#${b.id} ${b.type}:${b.value}`).join('\n') : '—' },
      { name: 'Bans', value: ban.length ? ban.map((b) => `#${b.id} active=${b.active} · ${b.reason}`).join('\n') : '—' }
    );
  return ctx.reply({ embeds: [embed] });
}

function makeCtx(source) {
  if (source.type === 'interaction') {
    const i = source.interaction;
    return {
      authorTag: i.user.tag,
      authorId: i.user.id,
      member: i.member,
      guild: i.guild,
      reply: (content) => {
        if (typeof content === 'string') return i.reply({ content, ephemeral: true });
        return i.reply({ ...content, ephemeral: content.ephemeral !== false });
      },
    };
  }
  const msg = source.message;
  return {
    authorTag: msg.author.tag,
    authorId: msg.author.id,
    member: msg.member,
    guild: msg.guild,
    reply: (content) => {
      if (typeof content === 'string') return msg.reply(content);
      return msg.reply(content);
    },
  };
}

async function dispatch(ctx, cmd, args) {
  const guild = ctx.guild;
  switch (cmd) {
    case 'help':
      return ctx.reply({ embeds: [helpEmbed()] });
    case 'genkey':
      return handleGenKey(ctx, args);
    case 'hwid_reset':
    case 'hwidreset':
    case 'resethwid':
      return handleHwidReset(ctx, args);
    case 'bl':
    case 'blacklist':
      return handleBl(ctx, args);
    case 'unbl':
      return handleUnbl(ctx, args);
    case 'ban':
      return handleBan(ctx, args, guild);
    case 'unban':
      return handleUnban(ctx, args, guild);
    case 'check':
      return handleCheck(ctx, args);
    case 'stock':
      return handleStock(ctx);
    case 'lookup':
      return handleLookup(ctx, args);
    default:
      return ctx.reply('Commande inconnue. `+help`');
  }
}

function buildSlashCommands() {
  return [
    new SlashCommandBuilder().setName('help').setDescription('Aide Anokles'),
    new SlashCommandBuilder()
      .setName('genkey')
      .setDescription('Générer des clés')
      .addStringOption((o) => o.setName('product').setDescription('slug ou id').setRequired(true))
      .addStringOption((o) => o.setName('duration').setDescription('30d / lftm / 7d').setRequired(true))
      .addIntegerOption((o) => o.setName('amount').setDescription('Quantité').setRequired(false))
      .addStringOption((o) => o.setName('note').setDescription('Note').setRequired(false)),
    new SlashCommandBuilder()
      .setName('hwid_reset')
      .setDescription('Reset HWID')
      .addStringOption((o) => o.setName('target').setDescription('key ou discord_id').setRequired(true)),
    new SlashCommandBuilder()
      .setName('bl')
      .setDescription('Blacklist')
      .addStringOption((o) => o.setName('type').setDescription('discord|ip|hwid|key').setRequired(true))
      .addStringOption((o) => o.setName('value').setDescription('Valeur').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Raison').setRequired(false)),
    new SlashCommandBuilder()
      .setName('unbl')
      .setDescription('Retirer blacklist')
      .addIntegerOption((o) => o.setName('id').setDescription('ID entrée').setRequired(true)),
    new SlashCommandBuilder()
      .setName('ban')
      .setDescription('Ban site + Discord')
      .addUserOption((o) => o.setName('user').setDescription('Membre').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Raison').setRequired(false)),
    new SlashCommandBuilder()
      .setName('unban')
      .setDescription('Unban')
      .addStringOption((o) => o.setName('discord_id').setDescription('ID').setRequired(true)),
    new SlashCommandBuilder()
      .setName('check')
      .setDescription('Check licence')
      .addStringOption((o) => o.setName('target').setDescription('key ou discord_id').setRequired(true)),
    new SlashCommandBuilder().setName('stock').setDescription('Stock clés'),
    new SlashCommandBuilder()
      .setName('lookup')
      .setDescription('Lookup user')
      .addStringOption((o) => o.setName('query').setDescription('discord_id ou username').setRequired(true)),
  ].map((c) => c.toJSON());
}

async function registerCommands() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!token || !clientId) {
    console.warn('[bot] DISCORD_TOKEN / CLIENT_ID manquants — skip register');
    return;
  }
  const rest = new REST({ version: '10' }).setToken(token);
  const body = buildSlashCommands();
  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
    console.log('[bot] Slash commands enregistrées (guild)');
  } else {
    await rest.put(Routes.applicationCommands(clientId), { body });
    console.log('[bot] Slash commands enregistrées (global)');
  }
}

async function startBot() {
  const token = process.env.DISCORD_TOKEN;
  if (!token || token === 'ton_token_bot') {
    console.warn('[bot] Pas de token Discord — bot désactivé (API seule)');
    return null;
  }

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  client.once('ready', () => {
    console.log(`[bot] Connecté: ${client.user.tag}`);
    client.user.setActivity('Anokles · +help', { type: 3 });
  });

  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    if (!message.content.startsWith('+')) return;
    if (!staffOnly(message.member)) {
      return message.reply('❌ Staff uniquement');
    }
    const parts = message.content.slice(1).trim().split(/\s+/);
    const cmd = (parts.shift() || '').toLowerCase();
    const ctx = makeCtx({ type: 'message', message });
    try {
      await dispatch(ctx, cmd, parts);
    } catch (e) {
      console.error(e);
      await message.reply(`Erreur: ${e.message}`);
    }
  });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (!staffOnly(interaction.member)) {
      return interaction.reply({ content: '❌ Staff uniquement', ephemeral: true });
    }
    const ctx = makeCtx({ type: 'interaction', interaction });
    const name = interaction.commandName;
    let args = [];
    if (name === 'genkey') {
      args = [
        interaction.options.getString('product'),
        interaction.options.getString('duration'),
        String(interaction.options.getInteger('amount') || 1),
        interaction.options.getString('note') || '',
      ].filter((x) => x !== '');
    } else if (name === 'hwid_reset' || name === 'check') {
      args = [interaction.options.getString('target')];
    } else if (name === 'bl') {
      args = [
        interaction.options.getString('type'),
        interaction.options.getString('value'),
        interaction.options.getString('reason') || '',
      ];
    } else if (name === 'unbl') {
      args = [String(interaction.options.getInteger('id'))];
    } else if (name === 'ban') {
      args = [interaction.options.getUser('user').id, interaction.options.getString('reason') || ''];
    } else if (name === 'unban') {
      args = [interaction.options.getString('discord_id')];
    } else if (name === 'lookup') {
      args = [interaction.options.getString('query')];
    }
    try {
      await dispatch(ctx, name, args);
    } catch (e) {
      console.error(e);
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: `Erreur: ${e.message}`, ephemeral: true });
      } else {
        await interaction.reply({ content: `Erreur: ${e.message}`, ephemeral: true });
      }
    }
  });

  await client.login(token);
  try {
    await registerCommands();
  } catch (e) {
    console.warn('[bot] Register commands failed:', e.message);
  }
  return client;
}

async function banDiscordUser(discordId, reason) {
  if (!client) return { ok: false, error: 'Bot offline' };
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) return { ok: false, error: 'DISCORD_GUILD_ID manquant' };
  const guild = await client.guilds.fetch(guildId);
  await guild.members.ban(discordId, { reason });
  return { ok: true };
}

module.exports = { startBot, banDiscordUser, registerCommands };

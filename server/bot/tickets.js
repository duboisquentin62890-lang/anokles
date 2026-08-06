// Système de tickets Anokles — panel + catégories + IA auto-responder + transcripts.
// Tout l'état est en base (table tickets/ticket_messages/ticket_blacklist) et les
// boutons utilisent des customId stables → tout continue de marcher après un reboot.
const {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { db } = require('../db');

const RED = 0xe10600;

const TICKET_TYPES = [
  { key: 'buy', label: 'Buy', emoji: '🛒', desc: 'Acheter un produit ou une clé' },
  { key: 'support', label: 'Support', emoji: '🛠️', desc: 'Aide / problème technique' },
  { key: 'hwid', label: 'HWID', emoji: '💻', desc: 'Reset ou souci HWID' },
  { key: 'resell', label: 'Resell', emoji: '🤝', desc: 'Devenir revendeur' },
  { key: 'media', label: 'Média', emoji: '🎥', desc: 'Créateur / partenariat' },
];
const TICKET_COMMANDS = ['ticketsetup', 'claim', 'close', 'add', 'remove', 'ticketbl', 'unticketbl', 'ticketpanel'];

function typeInfo(key) { return TICKET_TYPES.find((t) => t.key === key); }

/* ---------- config persistée (survit au reboot) ---------- */
function getConfig() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'tickets_config'").get();
  if (!row) return {};
  try { return JSON.parse(row.value); } catch { return {}; }
}
function saveConfig(cfg) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('tickets_config', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(JSON.stringify(cfg));
}

/* ---------- helpers ---------- */
function ticketByChannel(channelId) {
  return db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(String(channelId));
}
function nextNumber() {
  const row = db.prepare('SELECT COALESCE(MAX(number), 0) AS n FROM tickets').get();
  return (row.n || 0) + 1;
}

/* ---------- staff / blacklist ---------- */
function isStaff(member) {
  if (!member) return false;
  const owners = (process.env.DISCORD_OWNER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (owners.includes(member.id)) return true;
  if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  const staffRole = process.env.DISCORD_STAFF_ROLE_ID;
  if (staffRole && member.roles?.cache?.has(staffRole)) return true;
  const cfg = getConfig();
  if (cfg.staffRoleId && member.roles?.cache?.has(cfg.staffRoleId)) return true;
  return false;
}

function isTicketBlacklisted(userId) {
  return Boolean(db.prepare('SELECT user_id FROM ticket_blacklist WHERE user_id = ?').get(String(userId)));
}
function addTicketBl(userId, reason, by) {
  db.prepare(`
    INSERT INTO ticket_blacklist (user_id, reason, created_by) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET reason = excluded.reason, created_by = excluded.created_by
  `).run(String(userId), reason || null, by || null);
}
function removeTicketBl(userId) {
  return db.prepare('DELETE FROM ticket_blacklist WHERE user_id = ?').run(String(userId)).changes > 0;
}

/* ---------- panel (embed + boutons) ---------- */
function panelEmbed() {
  return new EmbedBuilder()
    .setColor(RED)
    .setTitle('🎟️ Anokles — Support')
    .setDescription(
      "Ouvre un ticket en choisissant la catégorie qui correspond à ta demande.\n" +
      "Un membre du staff (ou l'IA) te répondra rapidement.\n\n" +
      TICKET_TYPES.map((t) => `${t.emoji} **${t.label}** — ${t.desc}`).join('\n')
    )
    .setFooter({ text: 'Anokles · un seul ticket ouvert à la fois' });
}

function buildPanelRows() {
  const rows = [];
  let row = new ActionRowBuilder();
  TICKET_TYPES.forEach((t, i) => {
    if (i > 0 && i % 5 === 0) { rows.push(row); row = new ActionRowBuilder(); }
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`tk_open_${t.key}`)
        .setLabel(t.label)
        .setEmoji(t.emoji)
        .setStyle(ButtonStyle.Secondary)
    );
  });
  rows.push(row);
  return rows;
}

/* ---------- setup auto (survit au reboot via settings) ---------- */
async function setup(guild, panelChannel) {
  const everyone = guild.roles.everyone;

  // Rôle "Ticket BL" — empêche d'ouvrir des tickets
  let blRole = guild.roles.cache.find((r) => r.name === 'Ticket BL');
  if (!blRole) {
    blRole = await guild.roles.create({ name: 'Ticket BL', color: 0x555555, reason: 'Anokles tickets' });
  }

  // Catégorie qui héberge les salons de tickets
  let category = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === '🎟️ Tickets'
  );
  if (!category) {
    category = await guild.channels.create({
      name: '🎟️ Tickets',
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      ],
    });
  }

  // Salon transcripts (staff only)
  let transcripts = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && c.name === 'ticket-logs'
  );
  if (!transcripts) {
    transcripts = await guild.channels.create({
      name: 'ticket-logs',
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: [{ id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] }],
    });
  }

  const target = panelChannel || guild.systemChannel;
  const panelMsg = await target.send({ embeds: [panelEmbed()], components: buildPanelRows() });

  const cfg = getConfig();
  cfg.guildId = guild.id;
  cfg.categoryId = category.id;
  cfg.blacklistRoleId = blRole.id;
  cfg.transcriptChannelId = transcripts.id;
  cfg.panelChannelId = target.id;
  cfg.panelMessageId = panelMsg.id;
  saveConfig(cfg);
  return cfg;
}

/* ---------- ouverture d'un ticket ---------- */
function controlRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tk_claim').setLabel('Claim').setEmoji('🙋').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('tk_close').setLabel('Close').setEmoji('🔒').setStyle(ButtonStyle.Danger)
  );
}

async function openTicket(interaction, key) {
  const type = typeInfo(key);
  if (!type) return interaction.reply({ content: '❌ Catégorie inconnue.', ephemeral: true });
  const guild = interaction.guild;
  const opener = interaction.user;

  if (isTicketBlacklisted(opener.id)) {
    return interaction.reply({ content: '⛔ Tu es blacklist des tickets.', ephemeral: true });
  }
  const cfg = getConfig();
  if (cfg.blacklistRoleId && interaction.member?.roles?.cache?.has(cfg.blacklistRoleId)) {
    return interaction.reply({ content: '⛔ Tu es blacklist des tickets.', ephemeral: true });
  }
  if (!cfg.categoryId) {
    return interaction.reply({ content: '❌ Tickets non configurés. Un admin doit faire `+ticketsetup`.', ephemeral: true });
  }

  // Un seul ticket ouvert par personne
  const existing = db.prepare("SELECT * FROM tickets WHERE opener_id = ? AND status = 'open'").get(opener.id);
  if (existing) {
    return interaction.reply({ content: `❗ Tu as déjà un ticket ouvert : <#${existing.channel_id}>`, ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });
  const number = nextNumber();
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: opener.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    },
  ];
  const staffRole = process.env.DISCORD_STAFF_ROLE_ID || cfg.staffRoleId;
  if (staffRole) {
    overwrites.push({
      id: staffRole,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    });
  }

  const channel = await guild.channels.create({
    name: `${type.emoji}${type.key}-${number}`,
    type: ChannelType.GuildText,
    parent: cfg.categoryId,
    topic: `Ticket #${number} · ${type.label} · ${opener.tag} (${opener.id})`,
    permissionOverwrites: overwrites,
  });

  db.prepare(`
    INSERT INTO tickets (number, guild_id, channel_id, category, opener_id, opener_tag)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(number, guild.id, channel.id, type.key, opener.id, opener.tag);

  const embed = new EmbedBuilder()
    .setColor(RED)
    .setTitle(`${type.emoji} Ticket #${number} · ${type.label}`)
    .setDescription(
      `Salut <@${opener.id}> 👋\nDécris ta demande en détail, le staff arrive.\n` +
      `L'assistant IA peut déjà te répondre en attendant.`
    )
    .setFooter({ text: 'Staff : Claim pour prendre · Close pour fermer' });

  await channel.send({ content: `<@${opener.id}>`, embeds: [embed], components: [controlRow()] });
  return interaction.editReply({ content: `✅ Ticket ouvert : <#${channel.id}>` });
}

/* ---------- claim / close ---------- */
async function claimButton(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: '❌ Staff uniquement.', ephemeral: true });
  }
  const ticket = ticketByChannel(interaction.channel.id);
  if (!ticket) return interaction.reply({ content: '❌ Pas un ticket.', ephemeral: true });
  if (ticket.claimed_by) {
    return interaction.reply({ content: `Déjà claim par <@${ticket.claimed_by}>.`, ephemeral: true });
  }
  db.prepare('UPDATE tickets SET claimed_by = ?, claimed_tag = ? WHERE id = ?')
    .run(interaction.user.id, interaction.user.tag, ticket.id);
  await interaction.reply({ content: `🙋 Ticket claim par <@${interaction.user.id}>.` });
}

async function buildTranscript(ticket) {
  const rows = db.prepare(
    'SELECT author_tag, content, created_at FROM ticket_messages WHERE ticket_id = ? ORDER BY id ASC'
  ).all(ticket.id);
  const header = `Transcript ticket #${ticket.number} · ${ticket.category}\n` +
    `Ouvert par ${ticket.opener_tag} (${ticket.opener_id})\n` +
    `Claim: ${ticket.claimed_tag || '—'} · Statut: closed\n` +
    '='.repeat(48) + '\n';
  const body = rows.length
    ? rows.map((m) => `[${m.created_at}] ${m.author_tag || '?'}: ${m.content || ''}`).join('\n')
    : '(aucun message)';
  return header + body + '\n';
}

async function closeTicket(channel, ticket, byUser, reason) {
  db.prepare("UPDATE tickets SET status = 'closed', closed_at = datetime('now'), closed_by = ? WHERE id = ?")
    .run(byUser?.tag || 'system', ticket.id);

  const cfg = getConfig();
  const text = await buildTranscript({ ...ticket, claimed_tag: ticket.claimed_tag });
  const buf = Buffer.from(text, 'utf8');
  if (cfg.transcriptChannelId) {
    try {
      const logCh = await channel.guild.channels.fetch(cfg.transcriptChannelId);
      const embed = new EmbedBuilder()
        .setColor(RED)
        .setTitle(`🔒 Ticket #${ticket.number} fermé`)
        .addFields(
          { name: 'Catégorie', value: ticket.category, inline: true },
          { name: 'Ouvert par', value: `<@${ticket.opener_id}>`, inline: true },
          { name: 'Fermé par', value: byUser ? `<@${byUser.id}>` : 'system', inline: true },
          { name: 'Raison', value: reason || '—' }
        );
      await logCh.send({
        embeds: [embed],
        files: [{ attachment: buf, name: `ticket-${ticket.number}.txt` }],
      });
    } catch (e) { console.warn('[tickets] transcript fail', e.message); }
  }
  await channel.delete(`Ticket #${ticket.number} fermé par ${byUser?.tag || 'system'}`).catch(() => {});
}

async function closeButton(interaction) {
  if (!isStaff(interaction.member)) {
    return interaction.reply({ content: '❌ Staff uniquement.', ephemeral: true });
  }
  const ticket = ticketByChannel(interaction.channel.id);
  if (!ticket) return interaction.reply({ content: '❌ Pas un ticket.', ephemeral: true });
  await interaction.reply({ content: '🔒 Fermeture du ticket dans 3s…' });
  setTimeout(() => closeTicket(interaction.channel, ticket, interaction.user, 'Fermé via bouton'), 3000);
}

async function handleButton(interaction) {
  const id = interaction.customId;
  if (id.startsWith('tk_open_')) return openTicket(interaction, id.slice('tk_open_'.length));
  if (id === 'tk_claim') return claimButton(interaction);
  if (id === 'tk_close') return closeButton(interaction);
  return false;
}

/* ---------- IA auto-responder ---------- */
function systemPrompt() {
  return (
    "Tu es l'assistant support d'Anokles, une boutique de loaders/logiciels de jeu. " +
    "Réponds en français, court (2-4 phrases), poli et pro. " +
    "Catégories de tickets: Buy (achat/clé), Support (bug technique), HWID (reset HWID), " +
    "Resell (revendeur), Média (créateur/partenariat). " +
    "Les clés ont le format ANK-XXXX. Un reset HWID se demande au staff. " +
    "Ne promets jamais de remboursement ni de prix ; si tu ne sais pas, dis qu'un membre du staff va prendre le relais. " +
    "Ne donne aucune info sensible (tokens, mots de passe)."
  );
}

const RULES = [
  { re: /\bhwid\b|reset/i, a: "Pour un reset HWID, précise ta clé `ANK-...` ou ton ID Discord — un membre du staff va traiter ça rapidement." },
  { re: /\b(achat|acheter|buy|prix|price|paiement|payer)\b/i, a: "Pour un achat, indique le produit qui t'intéresse. Le staff t'enverra le lien de paiement et ta clé après validation." },
  { re: /\b(clé|cle|key|redeem|activ)/i, a: "Ta clé est au format `ANK-XXXX-XXXX-...`. Active-la sur le dashboard (onglet Redeem) ou envoie-la ici, le staff vérifie." },
  { re: /\b(bug|crash|erreur|marche pas|fonctionne pas|inject)/i, a: "Décris le bug (jeu, message d'erreur, capture si possible) et depuis quand ça arrive — ça aide le staff à diagnostiquer." },
  { re: /\b(resell|revend|reseller)/i, a: "Pour devenir revendeur, indique ton volume estimé et ton contact. Un responsable resell va te répondre." },
  { re: /\b(media|média|créateur|createur|partenariat|promo)/i, a: "Pour un partenariat média, envoie tes stats (audience, plateforme) — l'équipe média revient vers toi." },
];

function ruleBasedReply(text) {
  for (const r of RULES) if (r.re.test(text)) return r.a;
  return "Merci pour ton message ! Un membre du staff va te répondre dès que possible. Donne un maximum de détails en attendant. 🙌";
}

async function aiReply(text, category) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return ruleBasedReply(text);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        max_tokens: 180,
        temperature: 0.5,
        messages: [
          { role: 'system', content: systemPrompt() },
          { role: 'user', content: `[Catégorie: ${category}]\n${text}` },
        ],
      }),
    });
    if (!res.ok) return ruleBasedReply(text);
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || ruleBasedReply(text);
  } catch {
    return ruleBasedReply(text);
  }
}

// Anti-spam IA : 1 réponse / 12s / salon
const lastAi = new Map();

async function onMessage(message) {
  if (!message.guild || message.author.bot) return false;
  const ticket = ticketByChannel(message.channel.id);
  if (!ticket || ticket.status !== 'open') return false;

  // Sauvegarde du message (transcript persistant)
  db.prepare('INSERT INTO ticket_messages (ticket_id, author_id, author_tag, content) VALUES (?, ?, ?, ?)')
    .run(ticket.id, message.author.id, message.author.tag, message.content || '');

  // IA seulement tant que personne n'a claim, et pas pour le staff
  if (ticket.claimed_by || isStaff(message.member)) return true;
  const now = Date.now();
  if (now - (lastAi.get(message.channel.id) || 0) < 12000) return true;
  lastAi.set(message.channel.id, now);

  try {
    await message.channel.sendTyping();
    const answer = await aiReply(message.content || '', ticket.category);
    await message.reply({
      embeds: [new EmbedBuilder().setColor(RED).setAuthor({ name: 'Anokles · Assistant IA' }).setDescription(answer)],
    });
  } catch (e) { console.warn('[tickets] ai fail', e.message); }
  return true;
}

/* ---------- commandes texte / slash (via ctx) ---------- */
function parseUserId(raw) {
  return (raw || '').replace(/[<@!>]/g, '').trim();
}

async function command(ctx, cmd, args) {
  if (!isStaff(ctx.member)) return ctx.reply('❌ Staff uniquement.');
  const guild = ctx.guild;
  const channel = ctx.channel;

  switch (cmd) {
    case 'ticketsetup': {
      const cfg = await setup(guild, channel);
      return ctx.reply(
        `✅ Tickets configurés.\n• Catégorie <#${cfg.categoryId}>\n• Panel <#${cfg.panelChannelId}>\n` +
        `• Logs <#${cfg.transcriptChannelId}>\n• Rôle BL <@&${cfg.blacklistRoleId}>`
      );
    }
    case 'ticketpanel': {
      const cfg = getConfig();
      if (!cfg.categoryId) return ctx.reply('❌ Fais `+ticketsetup` d\'abord.');
      await channel.send({ embeds: [panelEmbed()], components: buildPanelRows() });
      return ctx.reply('✅ Panel envoyé.');
    }
    case 'claim': {
      const ticket = ticketByChannel(channel.id);
      if (!ticket) return ctx.reply('❌ Pas dans un ticket.');
      if (ticket.claimed_by) return ctx.reply(`Déjà claim par <@${ticket.claimed_by}>.`);
      db.prepare('UPDATE tickets SET claimed_by = ?, claimed_tag = ? WHERE id = ?')
        .run(ctx.authorId, ctx.authorTag, ticket.id);
      return ctx.reply(`🙋 Ticket claim par <@${ctx.authorId}>.`);
    }
    case 'close': {
      const ticket = ticketByChannel(channel.id);
      if (!ticket) return ctx.reply('❌ Pas dans un ticket.');
      await ctx.reply('🔒 Fermeture dans 3s…');
      setTimeout(() => closeTicket(channel, ticket, { id: ctx.authorId, tag: ctx.authorTag }, args.join(' ') || 'Fermé via commande'), 3000);
      return;
    }
    case 'add': {
      const uid = parseUserId(args[0]);
      if (!uid) return ctx.reply('Usage: `+add @user`');
      if (!ticketByChannel(channel.id)) return ctx.reply('❌ Pas dans un ticket.');
      await channel.permissionOverwrites.edit(uid, {
        ViewChannel: true, SendMessages: true, ReadMessageHistory: true,
      });
      return ctx.reply(`✅ <@${uid}> ajouté au ticket.`);
    }
    case 'remove': {
      const uid = parseUserId(args[0]);
      if (!uid) return ctx.reply('Usage: `+remove @user`');
      if (!ticketByChannel(channel.id)) return ctx.reply('❌ Pas dans un ticket.');
      await channel.permissionOverwrites.edit(uid, {
        ViewChannel: false, SendMessages: false,
      });
      return ctx.reply(`✅ <@${uid}> retiré du ticket.`);
    }
    case 'ticketbl': {
      const uid = parseUserId(args[0]);
      if (!uid) return ctx.reply('Usage: `+ticketbl @user [raison]`');
      addTicketBl(uid, args.slice(1).join(' '), ctx.authorTag);
      const cfg = getConfig();
      if (cfg.blacklistRoleId) {
        try { const m = await guild.members.fetch(uid); await m.roles.add(cfg.blacklistRoleId); } catch { /* ignore */ }
      }
      return ctx.reply(`⛔ <@${uid}> blacklist des tickets.`);
    }
    case 'unticketbl': {
      const uid = parseUserId(args[0]);
      if (!uid) return ctx.reply('Usage: `+unticketbl @user`');
      removeTicketBl(uid);
      const cfg = getConfig();
      if (cfg.blacklistRoleId) {
        try { const m = await guild.members.fetch(uid); await m.roles.remove(cfg.blacklistRoleId); } catch { /* ignore */ }
      }
      return ctx.reply(`✅ <@${uid}> retiré de la blacklist tickets.`);
    }
    default:
      return ctx.reply('Commande ticket inconnue.');
  }
}

module.exports = {
  TICKET_TYPES,
  TICKET_COMMANDS,
  setup,
  handleButton,
  onMessage,
  command,
  isTicketBlacklisted,
};

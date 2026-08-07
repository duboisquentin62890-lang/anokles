// Autoclaim Anokles — panel "Claim Customer Role" + rôles auto par produit payant.
// L'utilisateur clique le bouton, entre sa clé ANK-... dans un modal, et reçoit
// le rôle Customer + le rôle de son produit. État persistant (settings) → survit au reboot.
const {
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { db } = require('../db');

const RED = 0xe10600;
const GREEN = 0x2ecc71;
const AUTOCLAIM_COMMANDS = ['autoclaim'];

/* ---------- staff ---------- */
function isStaff(member) {
  if (!member) return false;
  const owners = (process.env.DISCORD_OWNER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (owners.includes(member.id)) return true;
  if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  const staffRole = process.env.DISCORD_STAFF_ROLE_ID;
  if (staffRole && member.roles?.cache?.has(staffRole)) return true;
  return false;
}

/* ---------- config persistée ---------- */
function getConfig() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'autoclaim_config'").get();
  if (!row) return {};
  try { return JSON.parse(row.value); } catch { return {}; }
}
function saveConfig(cfg) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('autoclaim_config', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(JSON.stringify(cfg));
}

/* ---------- helpers ---------- */
async function ensureRole(guild, name, color) {
  let role = guild.roles.cache.find((r) => r.name === name);
  if (!role) role = await guild.roles.create({ name, color, reason: 'Anokles autoclaim' });
  return role;
}
function paidProducts() {
  return db.prepare('SELECT id, name, slug FROM products WHERE is_free = 0 ORDER BY id').all();
}

function panelEmbed() {
  return new EmbedBuilder()
    .setColor(RED)
    .setTitle('🎫 Récupère ton rôle Customer')
    .setDescription(
      "Clique le bouton ci-dessous et entre ta **clé de licence** `ANK-...`.\n\n" +
      'Tu recevras instantanément le rôle **Customer** et le rôle de ton produit.'
    )
    .setFooter({ text: 'Anokles · vérification automatique' });
}
function panelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ac_claim').setLabel('Claim Customer Role').setEmoji('🎫').setStyle(ButtonStyle.Success)
  );
}

/* ---------- setup (crée les rôles + poste le panel) ---------- */
async function setup(guild, channel) {
  const customer = await ensureRole(guild, 'Customer', GREEN);

  // Un rôle par produit payant : "Customer · <nom du produit>"
  const productRoles = {};
  for (const p of paidProducts()) {
    const role = await ensureRole(guild, `Customer · ${p.name}`, RED);
    productRoles[p.id] = role.id;
  }

  const target = channel || guild.systemChannel;
  const msg = await target.send({ embeds: [panelEmbed()], components: [panelRow()] });

  const cfg = getConfig();
  cfg.guildId = guild.id;
  cfg.customerRoleId = customer.id;
  cfg.productRoles = productRoles; // { [product_id]: roleId }
  cfg.panelChannelId = target.id;
  cfg.panelMessageId = msg.id;
  saveConfig(cfg);
  return cfg;
}

/* ---------- bouton → ouvre le modal de saisie de clé ---------- */
async function handleButton(interaction) {
  if (interaction.customId !== 'ac_claim') return false;
  const modal = new ModalBuilder().setCustomId('ac_modal').setTitle('Vérification de licence');
  const input = new TextInputBuilder()
    .setCustomId('ac_key')
    .setLabel('Ta clé de licence')
    .setPlaceholder('ANK-XXXX-XXXX-XXXX-XXXX')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(80);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
  return true;
}

/* ---------- soumission du modal → vérifie la clé et donne les rôles ---------- */
async function handleModal(interaction) {
  if (interaction.customId !== 'ac_modal') return false;
  await interaction.deferReply({ ephemeral: true });

  const cfg = getConfig();
  if (!cfg.customerRoleId) {
    return interaction.editReply('❌ Système non configuré. Un admin doit faire `+autoclaim`.');
  }

  const key = (interaction.fields.getTextInputValue('ac_key') || '').trim();
  const row = db.prepare('SELECT * FROM license_keys WHERE key_code = ?').get(key);
  if (!row) return interaction.editReply('❌ Clé introuvable. Vérifie que tu as bien copié `ANK-...`.');
  if (row.status === 'revoked' || row.status === 'blacklisted') {
    return interaction.editReply('❌ Cette clé est révoquée ou blacklist.');
  }
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return interaction.editReply('❌ Cette clé est expirée.');
  }

  // Anti-partage : une clé = un seul compte Discord
  if (row.discord_id && row.discord_id !== interaction.user.id) {
    return interaction.editReply('❌ Cette clé est déjà liée à un autre compte Discord.');
  }
  if (!row.discord_id) {
    db.prepare('UPDATE license_keys SET discord_id = ? WHERE id = ?').run(interaction.user.id, row.id);
  }

  const rolesToAdd = [cfg.customerRoleId];
  const productRoleId = cfg.productRoles?.[row.product_id];
  if (productRoleId) rolesToAdd.push(productRoleId);

  try {
    await interaction.member.roles.add(rolesToAdd.filter(Boolean));
  } catch (e) {
    return interaction.editReply(
      `⚠️ Clé valide mais impossible d'ajouter le rôle (${e.message}).\n` +
      "Le bot a-t-il la permission « Gérer les rôles » **et** une position au-dessus des rôles Customer ?"
    );
  }

  const product = db.prepare('SELECT name FROM products WHERE id = ?').get(row.product_id);
  return interaction.editReply(
    `✅ Vérifié ! Rôle **Customer**${productRoleId && product ? ` + **${product.name}**` : ''} attribué. 🎉`
  );
}

/* ---------- commande texte ---------- */
async function command(ctx, cmd) {
  if (cmd !== 'autoclaim') return false;
  if (!isStaff(ctx.member)) return ctx.reply('❌ Staff uniquement.');
  const cfg = await setup(ctx.guild, ctx.channel);
  const n = Object.keys(cfg.productRoles || {}).length;
  return ctx.reply(
    `✅ Autoclaim configuré.\n• Rôle <@&${cfg.customerRoleId}>\n• ${n} rôle(s) produit créé(s)\n• Panel envoyé dans <#${cfg.panelChannelId}>`
  );
}

module.exports = {
  AUTOCLAIM_COMMANDS,
  setup,
  handleButton,
  handleModal,
  command,
};

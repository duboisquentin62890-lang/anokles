import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { api, downloadProduct } from '../lib/api';
import { useAuth } from '../lib/auth';

const DISCORD_URL = 'https://discord.gg/';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'redeem', label: 'Redeem key' },
  { id: 'loaders', label: 'Loaders' },
  { id: 'settings', label: 'Paramètres' },
];

const LINK_MESSAGES = {
  linked: ['Discord lié avec succès 🎉', true],
  taken: ['Ce Discord est déjà lié à un autre compte.', false],
  banned: ['Ce compte Discord est banni ou blacklisté.', false],
  state: ['Lien Discord expiré, réessaie.', false],
  cancel: ['Liaison Discord annulée.', false],
  error: ['Erreur pendant la liaison Discord.', false],
  unconfigured: ["L'OAuth Discord n'est pas configuré côté serveur — lie ton ID manuellement.", false],
};

function isExpired(license) {
  return license?.expires_at && new Date(license.expires_at) < new Date();
}
function daysLeft(license) {
  if (!license?.expires_at) return null;
  const ms = new Date(license.expires_at) - new Date();
  return Math.max(0, Math.ceil(ms / 86400000));
}
function discordLinkUrl() {
  const token = localStorage.getItem('tkr_token') || '';
  return `/api/auth/discord/link?token=${encodeURIComponent(token)}`;
}

// __REST__
export default function Dashboard() {
  const { user, keys, discordOauth, loading, refresh } = useAuth();
  const location = useLocation();
  const [tab, setTab] = useState('overview');
  const [key, setKey] = useState('');
  const [discordId, setDiscordId] = useState('');
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [products, setProducts] = useState([]);
  const [keyInputs, setKeyInputs] = useState({});
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (user) {
      setDiscordId(user.discord_id || '');
      setEmail(user.email || '');
    }
  }, [user]);

  useEffect(() => {
    api('/api/products')
      .then((d) => setProducts((d.products || []).filter((p) => !p.is_free)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const status = new URLSearchParams(location.search).get('discord');
    if (status && LINK_MESSAGES[status]) {
      const [text, ok] = LINK_MESSAGES[status];
      if (ok) { setMsg(text); refresh(); } else { setErr(text); }
    }
  }, [location.search]); // eslint-disable-line react-hooks/exhaustive-deps

  const ownedBySlug = useMemo(() => {
    const map = {};
    for (const k of keys) map[k.product_slug] = k;
    return map;
  }, [keys]);
// __REST2__
  if (!loading && !user) return <Navigate to="/login" replace />;
  if (loading) return <div className="container section muted">Chargement…</div>;

  const isStaff = user.role === 'admin' || user.role === 'staff';
  const linked = Boolean(user.discord_id);

  async function redeem(e) {
    e.preventDefault();
    setErr(''); setMsg('');
    try {
      const data = await api('/api/keys/redeem', { method: 'POST', body: { key } });
      setMsg(`Loader activé : ${data.product.name}`);
      setKey('');
      await refresh();
    } catch (e2) { setErr(e2.message); }
  }

  async function saveProfile(e) {
    e.preventDefault();
    setErr(''); setMsg('');
    try {
      await api('/api/auth/me', { method: 'PATCH', body: { discord_id: discordId, email } });
      setMsg('Profil mis à jour · Discord lié');
      await refresh();
    } catch (e2) { setErr(e2.message); }
  }

  async function linkManual(e) {
    e.preventDefault();
    setErr(''); setMsg('');
    if (!discordId.trim()) { setErr('Entre ton ID Discord.'); return; }
    try {
      await api('/api/auth/me', { method: 'PATCH', body: { discord_id: discordId } });
      await refresh();
    } catch (e2) { setErr(e2.message); }
  }

  async function download(slug) {
    setErr('');
    try { await downloadProduct(slug); } catch (e2) { setErr(e2.message); }
  }

  async function unlock(slug) {
    const k = (keyInputs[slug] || '').trim();
    if (!k) return;
    setErr(''); setMsg(''); setBusy(slug);
    try {
      const data = await api('/api/keys/redeem', { method: 'POST', body: { key: k } });
      setMsg(`Loader débloqué : ${data.product.name}`);
      setKeyInputs((s) => ({ ...s, [slug]: '' }));
      await refresh();
    } catch (e2) { setErr(e2.message); } finally { setBusy(''); }
  }

  async function launch(slug) {
    setErr(''); setBusy(slug);
    try { await downloadProduct(slug); } catch (e2) { setErr(e2.message); } finally { setBusy(''); }
  }
// __REST3__
  // Gate : le Discord est obligatoire pour se connecter au dashboard (hors staff)
  if (!isStaff && !linked) {
    return (
      <div className="container section">
        <div className="card-plain" style={{ maxWidth: 560, margin: '0 auto', textAlign: 'center' }}>
          <div className="eyebrow">Accès dashboard</div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', margin: '0.5rem 0 0.75rem' }}>
            Lie ton <span className="grad">Discord</span>
          </h2>
          <p className="muted" style={{ marginBottom: '1.25rem' }}>
            Pour accéder à ton dashboard, tu dois d'abord lier ton compte Discord.
            Ça synchronise tes accès, ton support et tes loaders avec le bot Anokles.
          </p>
          {err ? <div className="alert" style={{ marginBottom: '1rem' }}>{err}</div> : null}
          {discordOauth ? (
            <a className="btn btn-primary" href={discordLinkUrl()}>Se connecter avec Discord</a>
          ) : (
            <form className="form" onSubmit={linkManual} style={{ textAlign: 'left' }}>
              <label>
                Ton ID Discord
                <input value={discordId} onChange={(e) => setDiscordId(e.target.value)} placeholder="123456789012345678" />
              </label>
              <button className="btn btn-primary" type="submit">Lier mon Discord</button>
            </form>
          )}
          <p style={{ marginTop: '1rem' }}>
            <Link to="/" className="muted">← Retour au site</Link>
          </p>
        </div>
      </div>
    );
  }

  const activeCount = keys.length;
  const unlockedCount = products.filter((p) => {
    const lic = ownedBySlug[p.slug];
    return lic && !isExpired(lic);
  }).length;

  return (
    <div className="panel-shell">
      <aside className="panel-side">
        {TABS.map((t) => (
          <a
            key={t.id}
            href={`#${t.id}`}
            className={tab === t.id ? 'active' : ''}
            onClick={(e) => { e.preventDefault(); setTab(t.id); }}
          >
            {t.label}
          </a>
        ))}
        <Link to="/">← Site</Link>
      </aside>

      <main className="panel-main">
        <div className="section-head">
          <div className="eyebrow">Dashboard</div>
          <h2>Salut, {user.username}</h2>
          <p>{TABS.find((t) => t.id === tab)?.label} · gère tes loaders et ton compte.</p>
        </div>

        {err ? <div className="alert">{err}</div> : null}
        {msg ? <div className="alert" style={{ borderColor: 'rgba(80,200,120,0.4)' }}>{msg}</div> : null}
// __REST4__
        {tab === 'overview' ? (
          <>
            <div className="stats">
              <div className="stat"><strong>{activeCount}</strong><span>loaders actifs</span></div>
              <div className="stat"><strong>{user.role}</strong><span>rôle</span></div>
              <div className="stat"><strong>{linked ? 'Lié' : 'Non lié'}</strong><span>discord</span></div>
            </div>
            <div className="hero-cta" style={{ marginTop: '1.25rem' }}>
              <button className="btn btn-primary" type="button" onClick={() => setTab('redeem')}>Redeem une clé</button>
              <button className="btn btn-ghost" type="button" onClick={() => setTab('loaders')}>Mes loaders</button>
              <a className="btn btn-ghost" href={DISCORD_URL} target="_blank" rel="noreferrer">Ouvrir Discord</a>
            </div>
          </>
        ) : null}

        {tab === 'redeem' ? (
          <div className="card-plain">
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', marginBottom: '0.75rem' }}>Redeem key</h3>
            <p className="muted" style={{ marginBottom: '1rem' }}>Entre la clé reçue à l'achat (ou via le bot Discord) pour débloquer ton loader.</p>
            <form className="form" onSubmit={redeem}>
              <label>
                License key
                <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="ANK-MONTH-XXXX-XXXX-XXXX-XXXX" required />
              </label>
              <button className="btn btn-primary" type="submit">Redeem</button>
            </form>
          </div>
        ) : null}
// __REST5__
        {tab === 'loaders' ? (
          <div className="card-plain">
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', marginBottom: '0.35rem' }}>Mes loaders</h3>
            <p className="muted" style={{ marginBottom: '1rem' }}>
              {unlockedCount}/{products.length} loaders débloqués · entre une clé pour activer un loader payant.
            </p>
            <div className="loader-grid">
              {products.map((p) => {
                const lic = ownedBySlug[p.slug];
                const expired = isExpired(lic);
                const unlocked = lic && !expired;
                const left = daysLeft(lic);
                return (
                  <article key={p.id} className={`loader-card ${unlocked ? 'on' : 'off'}`}>
                    <div className="loader-top">
                      <span className="glyph">{(p.name || '?').slice(0, 2).toUpperCase()}</span>
                      <span className={`loader-state ${unlocked ? 'ok' : 'locked'}`}>
                        {unlocked ? '● Actif' : expired ? '○ Expiré' : '🔒 Verrouillé'}
                      </span>
                    </div>
                    <h3>{p.name}</h3>
                    <p className="muted">{p.description}</p>
                    {unlocked ? (
                      <div className="loader-meta">
                        <span>Expire : {lic.expires_at ? new Date(lic.expires_at).toLocaleDateString() : 'lifetime'}</span>
                        {left != null ? <span>{left}j restants</span> : null}
                        <span>HWID : <code>{lic.hwid || '—'}</code></span>
                      </div>
                    ) : (
                      <div className="loader-price">
                        {expired ? 'Licence expirée — réactive avec une nouvelle clé' : `Payant · dès $${Number(p.price).toFixed(2)}`}
                      </div>
                    )}
                    {unlocked ? (
                      <button className="btn btn-primary btn-sm" type="button" disabled={busy === p.slug} onClick={() => launch(p.slug)}>
                        {busy === p.slug ? '…' : 'Lancer / Download'}
                      </button>
                    ) : (
                      <form className="loader-unlock" onSubmit={(e) => { e.preventDefault(); unlock(p.slug); }}>
                        <input
                          placeholder="ANK-XXXX-XXXX-XXXX-XXXX"
                          value={keyInputs[p.slug] || ''}
                          onChange={(e) => setKeyInputs((s) => ({ ...s, [p.slug]: e.target.value }))}
                        />
                        <button className="btn btn-primary btn-sm" type="submit" disabled={busy === p.slug}>
                          {busy === p.slug ? '…' : 'Débloquer'}
                        </button>
                      </form>
                    )}
                  </article>
                );
              })}
              {!products.length ? <p className="muted">Aucun loader payant pour le moment.</p> : null}
            </div>
          </div>
        ) : null}
// __REST6__
        {tab === 'settings' ? (
          <div className="card-plain">
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', marginBottom: '0.75rem' }}>Paramètres · Discord</h3>
            <p className="muted" style={{ marginBottom: '1rem' }}>
              Lie ton compte Discord : synchronise tes accès, bans et le support avec le bot Anokles.
            </p>
            {discordOauth ? (
              <div className="hero-cta" style={{ marginBottom: '1.25rem' }}>
                <a className="btn btn-primary" href={discordLinkUrl()}>
                  {linked ? 'Re-lier / changer de Discord' : 'Se connecter avec Discord'}
                </a>
              </div>
            ) : null}
            <form className="form" onSubmit={saveProfile}>
              <label>
                Discord ID {discordOauth ? '(ou lie via le bouton ci-dessus)' : ''}
                <input value={discordId} onChange={(e) => setDiscordId(e.target.value)} placeholder="123456789012345678" />
              </label>
              <label>
                Email
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="toi@mail.com" />
              </label>
              <div className="hero-cta">
                <button className="btn btn-primary" type="submit">Enregistrer</button>
                <a className="btn btn-ghost" href={DISCORD_URL} target="_blank" rel="noreferrer">Rejoindre le Discord</a>
              </div>
            </form>
            <p className="muted" style={{ marginTop: '1rem', fontSize: '0.85rem' }}>
              Statut : {linked ? `lié à ${user.discord_id}` : 'aucun Discord lié'}
            </p>
          </div>
        ) : null}
      </main>
    </div>
  );
}







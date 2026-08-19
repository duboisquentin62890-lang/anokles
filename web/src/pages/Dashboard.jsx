import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { api, downloadProduct } from '../lib/api';
import { useAuth } from '../lib/auth';

const DISCORD_URL = 'https://discord.gg/';

const IC = {
  overview: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  redeem: 'M15 7a4 4 0 11-3.4 6.1L9 16H7v2H5v2H2v-3l7.9-7.9A4 4 0 0115 7z',
  loaders: 'M12 3v12m0 0l-4-4m4 4l4-4M4 21h16',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-2-4-2 1a7 7 0 00-2-1V4h-4v2a7 7 0 00-2 1L5 6 3 10l2 1v2l-2 1 2 4 2-1a7 7 0 002 1v2h4v-2a7 7 0 002-1l2 1 2-4-2-1v-2z',
  box: 'M3 7l9-4 9 4-9 4-9-4zm0 5l9 4 9-4M3 17l9 4 9-4',
  shield: 'M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5l8-3z',
  link: 'M9 17H7A5 5 0 017 7h2m6 0h2a5 5 0 010 10h-2m-8-5h8',
  bolt: 'M13 2L3 14h7l-1 8 10-12h-7l1-8z',
};
function Ic({ d }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
}

const TABS = [
  { id: 'overview', label: 'Overview', icon: 'overview' },
  { id: 'redeem', label: 'Redeem key', icon: 'redeem' },
  { id: 'loaders', label: 'Loaders', icon: 'loaders' },
  { id: 'settings', label: 'Paramètres', icon: 'settings' },
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

  if (!loading && !user) return <Navigate to="/login" replace />;
  if (loading) return <div className="container section muted">Chargement…</div>;

  const isStaff = user.role === 'owner' || user.role === 'admin' || user.role === 'staff' || user.is_owner;
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
            Ça synchronise tes accès, ton support et tes loaders avec le bot JinxWare.
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
        <div className="dash-userchip">
          {user.discord_avatar ? (
            <img src={user.discord_avatar} alt="" />
          ) : (
            <span className="dash-userchip-glyph">{(user.discord_global_name || user.username || '?').slice(0, 1).toUpperCase()}</span>
          )}
          <div>
            <strong>{user.discord_global_name || user.discord_username || user.username}</strong>
            <span className={`dash-role r-${user.role}`}>{user.role}</span>
          </div>
        </div>
        <nav className="panel-nav">
          {TABS.map((t) => (
            <a
              key={t.id}
              href={`#${t.id}`}
              className={tab === t.id ? 'active' : ''}
              onClick={(e) => { e.preventDefault(); setTab(t.id); }}
            >
              <Ic d={IC[t.icon]} />{t.label}
            </a>
          ))}
        </nav>
        <Link to="/" className="dash-back">← Retour au site</Link>
      </aside>

      <main className="panel-main">
        {err ? <div className="alert">{err}</div> : null}
        {msg ? <div className="alert alert-ok">{msg}</div> : null}

        {tab === 'overview' ? (
          <>
            <div className="dash-hero">
              <div className="dash-hero-glow" aria-hidden="true" />
              <div className="dash-hero-top">
                {user.discord_avatar ? (
                  <img className="dash-hero-avatar" src={user.discord_avatar} alt="Avatar Discord" />
                ) : (
                  <span className="dash-hero-avatar dash-hero-avatar-fallback">{(user.discord_global_name || user.username || '?').slice(0, 1).toUpperCase()}</span>
                )}
                <div>
                  <div className="eyebrow">Dashboard</div>
                  <h2>Salut, <span className="grad">{user.discord_global_name || user.discord_username || user.username}</span></h2>
                  {user.discord_username ? <p className="muted">@{user.discord_username}</p> : null}
                </div>
              </div>
              <div className="dash-hero-actions">
                <button className="btn btn-primary btn-round" type="button" onClick={() => setTab('redeem')}><Ic d={IC.redeem} /> Redeem une clé</button>
                <button className="btn btn-ghost btn-round" type="button" onClick={() => setTab('loaders')}><Ic d={IC.loaders} /> Mes loaders</button>
                <a className="btn btn-ghost btn-round" href={DISCORD_URL} target="_blank" rel="noreferrer"><Ic d={IC.link} /> Discord</a>
              </div>
            </div>

            <div className="dash-stats">
              <div className="dash-stat">
                <span className="dash-stat-ico"><Ic d={IC.box} /></span>
                <div><strong>{activeCount}</strong><span>loaders actifs</span></div>
              </div>
              <div className="dash-stat">
                <span className="dash-stat-ico"><Ic d={IC.bolt} /></span>
                <div><strong>{unlockedCount}/{products.length}</strong><span>débloqués</span></div>
              </div>
              <div className="dash-stat">
                <span className="dash-stat-ico"><Ic d={IC.shield} /></span>
                <div><strong style={{ textTransform: 'capitalize' }}>{user.role}</strong><span>rôle</span></div>
              </div>
              <div className={`dash-stat ${linked ? 'ok' : 'warn'}`}>
                <span className="dash-stat-ico"><Ic d={IC.link} /></span>
                <div><strong>{linked ? 'Lié' : 'Non lié'}</strong><span>discord</span></div>
              </div>
            </div>

            <div className="card-plain">
              <div className="dash-section-head">
                <h3><Ic d={IC.loaders} /> Aperçu de tes loaders</h3>
                <button className="btn btn-ghost btn-sm btn-round" type="button" onClick={() => setTab('loaders')}>Tout voir →</button>
              </div>
              <div className="dash-mini-list">
                {products.slice(0, 4).map((p) => {
                  const lic = ownedBySlug[p.slug];
                  const unlocked = lic && !isExpired(lic);
                  return (
                    <div className="dash-mini" key={p.id}>
                      <span className="glyph">{(p.name || '?').slice(0, 2).toUpperCase()}</span>
                      <div className="dash-mini-body">
                        <strong>{p.name}</strong>
                        <span className={`loader-state ${unlocked ? 'ok' : 'locked'}`}>{unlocked ? '● Actif' : '🔒 Verrouillé'}</span>
                      </div>
                    </div>
                  );
                })}
                {!products.length ? <p className="muted">Aucun loader pour le moment.</p> : null}
              </div>
            </div>
          </>
        ) : null}

        {tab === 'redeem' ? (
          <div className="card-plain dash-redeem">
            <span className="dash-redeem-ico"><Ic d={IC.redeem} /></span>
            <h3>Redeem key</h3>
            <p className="muted">Entre la clé reçue à l'achat (ou via le bot Discord) pour débloquer ton loader.</p>
            <form className="form" onSubmit={redeem}>
              <label>
                License key
                <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="ANK-MONTH-XXXX-XXXX-XXXX-XXXX" required />
              </label>
              <button className="btn btn-primary btn-round" type="submit"><Ic d={IC.bolt} /> Redeem</button>
            </form>
          </div>
        ) : null}

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
                    <div className="loader-media">
                      {p.image_url ? (
                        <>
                          <span className="media-bg" style={{ backgroundImage: `url("${p.image_url}")` }} />
                          <img src={p.image_url} alt={p.name} loading="lazy" />
                        </>
                      ) : (
                        <span className="loader-media-glyph">{(p.name || '?').slice(0, 2).toUpperCase()}</span>
                      )}
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

        {tab === 'settings' ? (
          <div className="card-plain">
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', marginBottom: '0.75rem' }}>Paramètres · Discord</h3>
            <p className="muted" style={{ marginBottom: '1rem' }}>
              Lie ton compte Discord : synchronise tes accès, bans et le support avec le bot JinxWare.
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






